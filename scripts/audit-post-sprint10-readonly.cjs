const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);
if (!match) throw new Error('SUPABASE_DB_URL não configurada.');

const migrationsDir = path.join(root, 'supabase', 'migrations');
const local = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .map((name) => ({ version: name.split('_')[0], name: name.replace(/^\d+_/, '').replace(/\.sql$/, '') }))
  .sort((a, b) => a.version.localeCompare(b.version));

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const applied = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version');
    const remoteVersions = new Set(applied.rows.map((row) => String(row.version)));
    const localVersions = new Set(local.map((item) => item.version));
    const pending = local.filter((item) => !remoteVersions.has(item.version));
    const remoteOnly = applied.rows.filter((row) => !localVersions.has(String(row.version)));

    const state = await client.query(`
      SELECT
        to_regclass('public.cash_shifts')::text AS cash_shifts,
        to_regclass('public.cash_movements')::text AS cash_movements,
        to_regprocedure('public.confirm_terminal_meal_payment(uuid,text,uuid,text,text,text,numeric)')::text AS counter_rpc,
        to_regprocedure('public.consume_meal_counter_payment(uuid,text,uuid,text,text)')::text AS counter_consume_rpc,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cash_shifts' AND column_name = 'expected_cash_balance'
        ) AS has_expected_cash_balance,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'legacy_wallet_bridge'
        ) AS has_legacy_marker
    `);

    const rls = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND relname IN ('cash_shifts', 'cash_movements')
      ORDER BY relname
    `);

    console.log(`Migrations locais: ${local.length}`);
    console.log(`Migrations remotas registradas: ${applied.rows.length}`);
    console.log(`Pendentes no remoto: ${pending.length}`);
    pending.forEach((item) => console.log(`  PENDING ${item.version}_${item.name}.sql`));
    console.log(`Somente no remoto: ${remoteOnly.length}`);
    remoteOnly.forEach((item) => console.log(`  REMOTE_ONLY ${item.version}: ${item.name || '(sem nome)'}`));
    console.log('Estado da estabilização:', state.rows[0]);
    console.log('RLS caixa:', rls.rows);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Falha na auditoria read-only: ${error.message}`);
  process.exit(1);
});
