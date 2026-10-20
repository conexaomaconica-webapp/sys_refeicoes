const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function apply() {
  await client.connect();

  console.log('1. Aplicando Migration 34 (Expansão de Categorias, % e Pagamento na Entrada)...');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260927000034_expand_categories_and_entry_payment.sql'), 'utf8');
  await client.query(sql);
  console.log('   Migration 34 aplicada com sucesso!');

  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000034', 'expand_categories_and_entry_payment')
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log('2. Testando admin_list_categories como operador@marefeicoes.com...');
  const opUser = await client.query("SELECT id FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  const listRes = await client.query('SELECT public.admin_list_categories() as out;');
  console.log('   Categorias listadas:', listRes.rows[0].out.categories.map(c => `${c.name} (${c.code}): ${c.pricing_type === 'percentage' ? c.charge_percentage + '%' : 'R$' + c.fixed_price} | Recarrega: ${c.requires_wallet} | Pagamento: ${c.payment_mode}`));

  console.log('3. Testando liberação direta de visitante avulso pago na entrada (register_visitor_entry)...');
  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const mealTypeRes = await client.query("SELECT id FROM public.meal_types LIMIT 1");
  const mealTypeId = mealTypeRes.rows[0].id;

  const visEntryRes1 = await client.query('SELECT public.register_visitor_entry($1::uuid, $2::uuid, $3::text) as out;', [
    unitId, mealTypeId, 'TERM-01'
  ]);
  console.log('   Entrada Visitante 1 (na hora):', visEntryRes1.rows[0].out.success ? 'LIBERADA COM SUCESSO (Pago na Entrada)' : visEntryRes1.rows[0].out);

  const visEntryRes2 = await client.query('SELECT public.register_visitor_entry($1::uuid, $2::uuid, $3::text) as out;', [
    unitId, mealTypeId, 'TERM-01'
  ]);
  console.log('   Entrada Visitante 2 (segunda passagem consecutiva):', visEntryRes2.rows[0].out.success ? 'LIBERADA COM SUCESSO (Multi-refeição sem saldo)' : visEntryRes2.rows[0].out);

  await client.end();
}

apply().catch(console.error);
