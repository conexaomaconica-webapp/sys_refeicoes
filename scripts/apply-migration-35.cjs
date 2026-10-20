const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function apply() {
  await client.connect();

  console.log('1. Aplicando Migration 35 (Controle de Caixa por Turno e Unidade / PDV)...');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260927000035_create_cash_shift_control.sql'), 'utf8');
  await client.query(sql);
  console.log('   Migration 35 aplicada com sucesso!');

  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000035', 'create_cash_shift_control')
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log('2. Testando abertura de caixa com operador@marefeicoes.com...');
  const opUser = await client.query("SELECT id FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const terminalId = 'TERM-01';
  const mealTypeRes = await client.query("SELECT id FROM public.meal_types LIMIT 1");
  const mealTypeId = mealTypeRes.rows[0].id;

  // Fechar qualquer caixa residual aberto para o terminal para iniciar o teste limpo
  await client.query("UPDATE public.cash_shifts SET status = 'closed', closed_at = now() WHERE terminal_id = $1 AND status = 'opened'", [terminalId]);

  // Abertura de Caixa
  const openRes = await client.query(
    'SELECT public.open_cash_shift($1::uuid, $2::text, $3::uuid, $4::numeric) as out;',
    [unitId, terminalId, mealTypeId, 100.00]
  );
  console.log('   Caixa aberto com sucesso:', openRes.rows[0].out);
  const shiftId = openRes.rows[0].out.cash_shift.id;

  console.log('3. Testando registro de venda de visitante vinculado ao caixa...');
  const visRes = await client.query(
    'SELECT public.register_visitor_entry($1::uuid, $2::uuid, $3::text, $4::text) as out;',
    [unitId, mealTypeId, terminalId, 'cash']
  );
  console.log('   Entrada de visitante registrada no caixa:', visRes.rows[0].out);

  console.log('4. Testando Suprimento e Sangria...');
  const supplyRes = await client.query(
    'SELECT public.record_cash_movement($1::uuid, $2::text, $3::numeric, $4::text, $5::text) as out;',
    [shiftId, 'supply', 50.00, 'cash', 'Troco de moedas fornecido pelo gerente']
  );
  console.log('   Suprimento registrado:', supplyRes.rows[0].out.cash_shift.system_expected_balance);

  const bleedRes = await client.query(
    'SELECT public.record_cash_movement($1::uuid, $2::text, $3::numeric, $4::text, $5::text) as out;',
    [shiftId, 'bleed', 30.00, 'cash', 'Sangria de segurança para o cofre']
  );
  console.log('   Sangria registrada:', bleedRes.rows[0].out.cash_shift.system_expected_balance);

  console.log('5. Testando get_active_cash_shift...');
  const activeRes = await client.query(
    'SELECT public.get_active_cash_shift($1::uuid, $2::text) as out;',
    [unitId, terminalId]
  );
  console.log('   Caixa Ativo Encontrado? Total Esperado:', activeRes.rows[0].out.cash_shift.system_expected_balance);

  console.log('6. Testando Fechamento de Caixa com conferência...');
  const expectedBalance = activeRes.rows[0].out.cash_shift.system_expected_balance;
  const closeRes = await client.query(
    'SELECT public.close_cash_shift($1::uuid, $2::numeric, $3::text) as out;',
    [shiftId, expectedBalance, 'Fechamento do turno normal sem divergências.']
  );
  console.log('   Fechamento do caixa:', closeRes.rows[0].out.difference_status, 'Diferença:', closeRes.rows[0].out.difference_amount);

  await client.end();
  console.log('\n--- TODOS OS TESTES DA MIGRATION 35 PASSARAM COM SUCESSO! ---');
}

apply().catch(err => {
  console.error('Erro na migration 35:', err);
  process.exit(1);
});
