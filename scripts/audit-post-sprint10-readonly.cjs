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
        to_regprocedure('public.get_public_tenant_branding_v3(text)')::text AS branding_v3_rpc,
        to_regprocedure('public.get_public_tenant_branding_v4(text)')::text AS branding_v4_rpc,
        to_regprocedure('public.update_tenant_terminal_background(text,text,text)')::text AS background_update_rpc,
        to_regprocedure('public.update_tenant_terminal_layout(text)')::text AS layout_update_rpc,
        to_regprocedure('public.get_operator_visitor_price(uuid,uuid)')::text AS visitor_price_rpc,
        to_regprocedure('public.register_operator_visitor_entry_v2(uuid,uuid,text,text,numeric)')::text AS visitor_change_rpc,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cash_shifts' AND column_name = 'expected_cash_balance'
        ) AS has_expected_cash_balance,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'legacy_wallet_bridge'
        ) AS has_legacy_marker,
        (
          SELECT count(*) = 3
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tenant_branding'
            AND column_name IN (
              'terminal_background_mode',
              'terminal_background_preset',
              'terminal_background_url'
            )
        ) AS has_terminal_background_fields,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tenant_branding'
            AND column_name = 'terminal_layout_variant'
        ) AS has_terminal_layout_variant,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'units'
            AND column_name = 'cash_shift_mode'
        ) AS has_unit_cash_shift_mode,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'cash_shifts'
            AND column_name = 'cash_shift_mode'
        ) AS has_cash_shift_mode_snapshot,
        to_regprocedure('public.get_unit_cash_shift_settings()')::text AS cash_shift_settings_rpc,
        to_regprocedure('public.set_unit_cash_shift_mode(uuid,text)')::text AS cash_shift_mode_update_rpc
        ,to_regclass('public.cash_shift_partial_settlements')::text AS cash_partial_settlements
        ,to_regprocedure('public.record_operator_cash_partial_settlement(uuid,uuid,numeric,numeric,text)')::text AS cash_partial_settlement_rpc
    `);

    const rls = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND relname IN ('cash_shifts', 'cash_movements')
      ORDER BY relname
    `);

    const brandingBucket = await client.query(`
      SELECT id, public, file_size_limit
      FROM storage.buckets
      WHERE id = 'tenant-branding'
    `);

    console.log(`Migrations locais: ${local.length}`);
    console.log(`Migrations remotas registradas: ${applied.rows.length}`);
    console.log(`Pendentes no remoto: ${pending.length}`);
    pending.forEach((item) => console.log(`  PENDING ${item.version}_${item.name}.sql`));
    console.log(`Somente no remoto: ${remoteOnly.length}`);
    remoteOnly.forEach((item) => console.log(`  REMOTE_ONLY ${item.version}: ${item.name || '(sem nome)'}`));
    console.log('Estado da estabilização:', state.rows[0]);
    console.log('RLS caixa:', rls.rows);
    console.log('Bucket de branding:', brandingBucket.rows);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Falha na auditoria read-only: ${error.message}`);
  process.exit(1);
});
