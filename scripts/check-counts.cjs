const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  const tables = [
    'tenants', 'tenant_branding', 'institutions', 'units',
    'user_institution_access', 'user_unit_access', 'profiles',
    'student_categories', 'students', 'imports', 'import_rows',
    'meal_types', 'unit_meal_types', 'meal_rules', 'wallets',
    'wallet_transactions', 'payment_providers', 'payments',
    'recharges', 'payment_webhook_events', 'cards', 'qr_tokens',
    'meal_consumptions', 'blocked_attempts'
  ];

  console.log('=== CONTAGENS REAIS ===');
  for (const t of tables) {
    const r = await client.query(`SELECT count(*)::bigint as total FROM public."${t}"`);
    console.log(`public.${t}: ${r.rows[0].total}`);
  }
  const u = await client.query(`SELECT count(*)::bigint as total FROM auth.users`);
  console.log(`auth.users: ${u.rows[0].total}`);
  const b = await client.query(`SELECT id, name, public FROM storage.buckets`);
  console.log('storage.buckets:', b.rows);
  const o = await client.query(`SELECT count(*)::bigint as total FROM storage.objects`);
  console.log(`storage.objects: ${o.rows[0].total}`);
  await client.end();
}

run();
