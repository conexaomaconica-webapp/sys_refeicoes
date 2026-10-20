const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function apply() {
  await client.connect();

  console.log('1. Aplicando Migration 33 (Visitantes e Servidores - Multi-Refeição e Mensagens Neutras)...');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260927000033_support_visitor_category_and_multi_meal.sql'), 'utf8');
  await client.query(sql);
  console.log('   Migration 33 aplicada com sucesso!');

  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000033', 'support_visitor_category_and_multi_meal')
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log('2. Cadastrando comensal de teste VISITANTE01...');
  const tenantRes = await client.query("SELECT id FROM public.tenants LIMIT 1");
  const tenantId = tenantRes.rows[0].id;

  const instRes = await client.query("SELECT id FROM public.institutions WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  const instId = instRes.rows[0].id;

  const catRes = await client.query("SELECT id FROM public.student_categories WHERE tenant_id = $1 AND code = 'visitante'", [tenantId]);
  const catVisitanteId = catRes.rows[0].id;

  // Inserir ou atualizar VISITANTE01
  const studentRes = await client.query(`
    INSERT INTO public.students (tenant_id, institution_id, category_id, registration_number, full_name, status)
    VALUES ($1, $2, $3, 'VISITANTE01', 'Visitante Institucional 01', 'active')
    ON CONFLICT (institution_id, registration_number) DO UPDATE
    SET category_id = EXCLUDED.category_id,
        full_name = EXCLUDED.full_name,
        status = 'active'
    RETURNING id;
  `, [tenantId, instId, catVisitanteId]);

  const visitorStudentId = studentRes.rows[0].id;

  // Carteira do Visitante com Saldo R$ 50,00
  await client.query(`
    INSERT INTO public.wallets (tenant_id, student_id, balance, status)
    VALUES ($1, $2, 50.00, 'active')
    ON CONFLICT (student_id) DO UPDATE
    SET balance = 50.00, status = 'active';
  `, [tenantId, visitorStudentId]);

  console.log('   VISITANTE01 cadastrado com categoria visitante e saldo R$ 50,00!');

  // Testar chamada consume_meal duas vezes para comprovar que não bloqueia com ALREADY_CONSUMED_TODAY
  console.log('3. Testando 2 passagens consecutivas do VISITANTE01 no mesmo turno...');
  const opUser = await client.query("SELECT id FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const mealTypeRes = await client.query("SELECT id FROM public.meal_types LIMIT 1");
  const mealTypeId = mealTypeRes.rows[0].id;

  const res1 = await client.query('SELECT public.consume_meal($1::uuid, $2::text, $3::uuid, $4::text, $5::text) as out;', [
    unitId, 'VISITANTE01', mealTypeId, 'IDEM_VIS_TEST_1_' + Date.now(), 'TERM-01'
  ]);
  console.log('   Passagem 1:', res1.rows[0].out.success ? 'APROVADA!' : res1.rows[0].out);

  const res2 = await client.query('SELECT public.consume_meal($1::uuid, $2::text, $3::uuid, $4::text, $5::text) as out;', [
    unitId, 'VISITANTE01', mealTypeId, 'IDEM_VIS_TEST_2_' + (Date.now() + 1), 'TERM-01'
  ]);
  console.log('   Passagem 2 (mesmo turno):', res2.rows[0].out.success ? 'APROVADA (Multi-refeição visitante funcionando perfeitamente!)' : res2.rows[0].out);

  await client.end();
}

apply().catch(console.error);
