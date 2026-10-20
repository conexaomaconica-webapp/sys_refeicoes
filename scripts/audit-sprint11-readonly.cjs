const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);
if (!match) throw new Error('SUPABASE_DB_URL não configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migration = await client.query(`
      SELECT version, name
      FROM supabase_migrations.schema_migrations
      WHERE version IN ('20261019000048', '20261019000049', '20261019000050')
      ORDER BY version
    `);
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'imports'
        AND column_name IN ('effective_date', 'processed_rows', 'failed_rows', 'skipped_rows')
      ORDER BY column_name
    `);
    const history = await client.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'student_category_history'
    `);
    const functions = await client.query(`
      SELECT p.proname, p.prosecdef, p.proconfig, p.proacl,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
             CASE WHEN p.proname = 'confirm_and_process_import' THEN
               position('::TIMESTAMPTZ' IN pg_get_functiondef(p.oid)) > 0
             ELSE NULL END AS typed_timestamp_check,
             CASE WHEN p.proname = 'confirm_and_process_import' THEN
               position('request.jwt.claim.sub' IN pg_get_functiondef(p.oid)) > 0
             ELSE NULL END AS internal_update_context
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('stage_import_batch', 'stage_import_batch_v2', 'confirm_and_process_import', 'cancel_import')
      ORDER BY p.proname
    `);
    const policy = await client.query(`
      SELECT policyname, roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'student_category_history'
    `);
    const memberships = await client.query(`
      SELECT member.rolname AS member, parent.rolname AS inherited_role
      FROM pg_auth_members m
      JOIN pg_roles member ON member.oid = m.member
      JOIN pg_roles parent ON parent.oid = m.roleid
      WHERE member.rolname IN ('anon', 'authenticated')
         OR parent.rolname IN ('anon', 'authenticated')
      ORDER BY member.rolname, parent.rolname
    `);

    console.log('Migration 48:', migration.rows);
    console.log('Campos imports:', columns.rows);
    console.log('Histórico/RLS:', history.rows);
    console.log('Funções:', functions.rows);
    console.log('Policies:', policy.rows);
    console.log('Herança de papéis:', memberships.rows);

    const confirm = functions.rows.find((row) => row.proname === 'confirm_and_process_import');
    const ok = migration.rowCount === 3
      && columns.rowCount === 4
      && history.rows[0]?.relrowsecurity === true
      && history.rows[0]?.relforcerowsecurity === true
      && functions.rows.every((row) => row.prosecdef && row.authenticated_execute && !row.anon_execute)
      && confirm?.typed_timestamp_check === true
      && confirm?.internal_update_context === true
      && policy.rowCount === 1;
    if (!ok) throw new Error('A auditoria encontrou divergência na migration 48.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Falha na auditoria read-only da Sprint 11: ${error.message}`);
  process.exit(1);
});
