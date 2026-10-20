const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');
const dbUrlMatch = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!dbUrlMatch) {
  console.error('SUPABASE_DB_URL nao encontrada no .env.local.');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrlMatch[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  {
    version: '20260927000037',
    name: 'terminal_branding_and_payment_flow',
    file: '20260927000037_terminal_branding_and_payment_flow.sql',
  },
  {
    version: '20260927000038',
    name: 'fix_visitor_entry_rpc_ambiguity',
    file: '20260927000038_fix_visitor_entry_rpc_ambiguity.sql',
  },
  {
    version: '20260927000039',
    name: 'enforce_operator_terminal_session',
    file: '20260927000039_enforce_operator_terminal_session.sql',
  },
  {
    version: '20260927000040',
    name: 'fix_wallet_debit_and_counter_payment',
    file: '20260927000040_fix_wallet_debit_and_counter_payment.sql',
  },
  {
    version: '20260927000041',
    name: 'fix_consumption_institution',
    file: '20260927000041_fix_consumption_institution.sql',
  },
  {
    version: '20260927000042',
    name: 'fix_consumption_institution_whitespace',
    file: '20260927000042_fix_consumption_institution_whitespace.sql',
  },
  {
    version: '20260927000043',
    name: 'create_tenant_branding_storage',
    file: '20260927000043_create_tenant_branding_storage.sql',
  },
];

async function apply() {
  await client.connect();

  try {
    for (const migration of migrations) {
      const installed = await client.query(
        'SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1',
        [migration.version]
      );

      if (installed.rowCount > 0) {
        console.log(`Migration ${migration.version} ja registrada; ignorando.`);
        continue;
      }

      const sql = fs.readFileSync(
        path.join(rootDir, 'supabase', 'migrations', migration.file),
        'utf8'
      );

      console.log(`Aplicando migration ${migration.version}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name)
           VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`Migration ${migration.version} aplicada.`);
    }

    await client.query("NOTIFY pgrst, 'reload schema'");

    const verification = await client.query(`
      SELECT proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN (
          'get_public_tenant_branding_v2',
          'preview_terminal_meal',
          'confirm_terminal_meal_payment',
          'register_terminal_visitor_entry',
          'get_operator_terminal_shift',
          'open_operator_cash_shift',
          'close_operator_cash_shift',
          'consume_operator_terminal_meal',
          'confirm_operator_terminal_payment',
          'register_operator_visitor_entry'
          ,'preview_operator_terminal_meal'
        )
      ORDER BY proname
    `);

    console.log('RPCs verificadas:', verification.rows.map((row) => row.proname).join(', '));
  } finally {
    await client.end();
  }
}

apply().catch((error) => {
  console.error('Falha ao aplicar migrations:', error.message || error.code || error.name);
  if (Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      console.error(`- ${nestedError.code || nestedError.name}: ${nestedError.message}`);
    }
  }
  process.exit(1);
});
