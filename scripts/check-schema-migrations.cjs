const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function checkSchemaMigrations() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations';
  `);
  console.log('Colunas de supabase_migrations.schema_migrations:', res.rows);
  const resRows = await client.query(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;`);
  console.log('Migrações registradas no Supabase:');
  resRows.rows.forEach(r => console.log(`  - ${r.version}: ${r.name || '(sem nome)'}`));
  const offlineCheck = await client.query(`
    SELECT to_regclass('public.offline_contingency_events') as table_exists,
           to_regprocedure('public.reconcile_offline_consumptions(jsonb)') as rpc_exists;
  `);
  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000031', 'create_offline_contingency_tables_and_rpc')
    ON CONFLICT (version) DO NOTHING;
  `);
  console.log('Migração 31 devidamente registrada no supabase_migrations.schema_migrations.');
  await client.end();
}

checkSchemaMigrations();
