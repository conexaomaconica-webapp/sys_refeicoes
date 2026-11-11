const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/^SUPABASE_DB_URL=["']?([^"'\r\n]+)/m);

if (!match) throw new Error('SUPABASE_DB_URL nao configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  application_name: 'stage4b-homologation',
});

const ids = {
  tenantA: '4b000000-0000-4000-8000-000000000001',
  tenantB: '4b000000-0000-4000-8000-000000000002',
  institutionA: '4b100000-0000-4000-8000-000000000001',
  institutionB: '4b100000-0000-4000-8000-000000000002',
  institutionOtherTenant: '4b100000-0000-4000-8000-000000000003',
  unitA1: '4b200000-0000-4000-8000-000000000001',
  unitA2: '4b200000-0000-4000-8000-000000000002',
  unitB: '4b200000-0000-4000-8000-000000000003',
  unitOtherTenant: '4b200000-0000-4000-8000-000000000004',
  categoryPartialA: '4b300000-0000-4000-8000-000000000001',
  categoryIntegralA: '4b300000-0000-4000-8000-000000000002',
  categoryPartialB: '4b300000-0000-4000-8000-000000000003',
  studentA1: '4b400000-0000-4000-8000-000000000001',
  studentA2: '4b400000-0000-4000-8000-000000000002',
  studentB: '4b400000-0000-4000-8000-000000000003',
  studentOtherTenant: '4b400000-0000-4000-8000-000000000004',
  walletA1: '4b500000-0000-4000-8000-000000000001',
  walletA2: '4b500000-0000-4000-8000-000000000002',
  walletB: '4b500000-0000-4000-8000-000000000003',
  walletOtherTenant: '4b500000-0000-4000-8000-000000000004',
  providerA: '4b600000-0000-4000-8000-000000000001',
  providerB: '4b600000-0000-4000-8000-000000000002',
  mealLunchA: '4b700000-0000-4000-8000-000000000001',
  mealLunchB: '4b700000-0000-4000-8000-000000000002',
};

const users = {
  admin: '4ba00000-0000-4000-8000-000000000001',
  director: '4ba00000-0000-4000-8000-000000000002',
  finance: '4ba00000-0000-4000-8000-000000000003',
  supervisor: '4ba00000-0000-4000-8000-000000000004',
  manager: '4ba00000-0000-4000-8000-000000000005',
  operator: '4ba00000-0000-4000-8000-000000000006',
  institution: '4ba00000-0000-4000-8000-000000000007',
  student: '4ba00000-0000-4000-8000-000000000008',
  inactive: '4ba00000-0000-4000-8000-000000000009',
  otherTenantAdmin: '4ba00000-0000-4000-8000-000000000010',
};

let passed = 0;
let failed = 0;

function check(condition, message, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${message}${details ? ` | ${details}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${message}${details ? ` | ${details}` : ''}`);
  }
}

async function setAuth(userId, role = 'authenticated') {
  await client.query('RESET ROLE');
  const claims = userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role: 'anon' });
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
  await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [role]);
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
  await client.query(`SET LOCAL ROLE ${role === 'anon' ? 'anon' : 'authenticated'}`);
}

async function asPostgres() {
  await client.query('RESET ROLE');
}

async function scalar(sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0].value);
}

async function seed() {
  await client.query(`
    INSERT INTO public.tenants (id, name, slug) VALUES
      ('${ids.tenantA}', 'Etapa 4B Tenant A', 'etapa-4b-a'),
      ('${ids.tenantB}', 'Etapa 4B Tenant B', 'etapa-4b-b');

    INSERT INTO public.institutions (id, tenant_id, name, short_name) VALUES
      ('${ids.institutionA}', '${ids.tenantA}', 'Instituicao A', 'IA'),
      ('${ids.institutionB}', '${ids.tenantA}', 'Instituicao B', 'IB'),
      ('${ids.institutionOtherTenant}', '${ids.tenantB}', 'Instituicao Outro Tenant', 'IOT');

    INSERT INTO public.units (id, tenant_id, institution_id, name, city, state) VALUES
      ('${ids.unitA1}', '${ids.tenantA}', '${ids.institutionA}', 'Unidade A1', 'Sao Paulo', 'SP'),
      ('${ids.unitA2}', '${ids.tenantA}', '${ids.institutionA}', 'Unidade A2', 'Sao Paulo', 'SP'),
      ('${ids.unitB}', '${ids.tenantA}', '${ids.institutionB}', 'Unidade B', 'Campinas', 'SP'),
      ('${ids.unitOtherTenant}', '${ids.tenantB}', '${ids.institutionOtherTenant}', 'Unidade Outro Tenant', 'Recife', 'PE');
  `);

  for (const [name, id] of Object.entries(users)) {
    await client.query(
      `INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous)
       VALUES ($1, $2, 'authenticated', 'authenticated', false, false)`,
      [id, `etapa4b-${name}@example.invalid`],
    );
  }

  const profileRows = [
    [users.admin, ids.tenantA, 'Admin', 'admin_general', 'active'],
    [users.director, ids.tenantA, 'Diretor', 'operations_director', 'active'],
    [users.finance, ids.tenantA, 'Financeiro', 'finance', 'active'],
    [users.supervisor, ids.tenantA, 'Supervisor A1', 'supervisor', 'active'],
    [users.manager, ids.tenantA, 'Gerente A1', 'unit_manager', 'active'],
    [users.operator, ids.tenantA, 'Operador A1', 'operator', 'active'],
    [users.institution, ids.tenantA, 'Instituicao A', 'institution_user', 'active'],
    [users.student, ids.tenantA, 'Consumidor A1', 'student', 'active'],
    [users.inactive, ids.tenantA, 'Usuario Inativo', 'unit_manager', 'inactive'],
    [users.otherTenantAdmin, ids.tenantB, 'Admin Outro Tenant', 'admin_general', 'active'],
  ];
  for (const row of profileRows) {
    await client.query(
      'INSERT INTO public.profiles (id, tenant_id, full_name, role, status) VALUES ($1, $2, $3, $4, $5)',
      row,
    );
  }

  await client.query(`
    INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
      ('${ids.tenantA}', '${users.supervisor}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.manager}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.operator}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.inactive}', '${ids.unitA1}');
    INSERT INTO public.user_institution_access (tenant_id, user_id, institution_id) VALUES
      ('${ids.tenantA}', '${users.institution}', '${ids.institutionA}');

    INSERT INTO public.student_categories
      (id, tenant_id, code, name, requires_wallet)
    VALUES
      ('${ids.categoryPartialA}', '${ids.tenantA}', 'partial', 'Parcial A', true),
      ('${ids.categoryIntegralA}', '${ids.tenantA}', 'integral', 'Integral A', false),
      ('${ids.categoryPartialB}', '${ids.tenantB}', 'partial', 'Parcial B', true);

    INSERT INTO public.students
      (id, tenant_id, institution_id, user_id, category_id, registration_number, full_name)
    VALUES
      ('${ids.studentA1}', '${ids.tenantA}', '${ids.institutionA}', '${users.student}', '${ids.categoryPartialA}', '4B-A1', 'Aluno A1'),
      ('${ids.studentA2}', '${ids.tenantA}', '${ids.institutionA}', NULL, '${ids.categoryPartialA}', '4B-A2', 'Aluno A2'),
      ('${ids.studentB}', '${ids.tenantA}', '${ids.institutionB}', NULL, '${ids.categoryIntegralA}', '4B-B', 'Aluno B'),
      ('${ids.studentOtherTenant}', '${ids.tenantB}', '${ids.institutionOtherTenant}', NULL, '${ids.categoryPartialB}', '4B-OT', 'Aluno Outro Tenant');

    INSERT INTO public.wallets (id, tenant_id, student_id, balance, status) VALUES
      ('${ids.walletA1}', '${ids.tenantA}', '${ids.studentA1}', 60, 'active'),
      ('${ids.walletA2}', '${ids.tenantA}', '${ids.studentA2}', 25, 'frozen'),
      ('${ids.walletB}', '${ids.tenantA}', '${ids.studentB}', 0, 'closed'),
      ('${ids.walletOtherTenant}', '${ids.tenantB}', '${ids.studentOtherTenant}', 999, 'active');

    INSERT INTO public.payment_providers (id, tenant_id, code, name, credentials) VALUES
      ('${ids.providerA}', '${ids.tenantA}', 'mock', 'Stage 4B A', '{}'),
      ('${ids.providerB}', '${ids.tenantB}', 'mock', 'Stage 4B B', '{}');

    INSERT INTO public.meal_types (id, tenant_id, code, name) VALUES
      ('${ids.mealLunchA}', '${ids.tenantA}', 'lunch', 'Almoco A'),
      ('${ids.mealLunchB}', '${ids.tenantB}', 'lunch', 'Almoco B');
  `);

  await client.query(`
    INSERT INTO public.payments
      (tenant_id, student_id, provider_id, external_payment_id, method, amount, status, confirmed_at)
    VALUES
      ('${ids.tenantA}', '${ids.studentA1}', '${ids.providerA}', '4b-pay-1', 'pix', 100, 'confirmed', now()),
      ('${ids.tenantA}', '${ids.studentA2}', '${ids.providerA}', '4b-pay-2', 'pix', 50, 'pending', NULL),
      ('${ids.tenantA}', '${ids.studentA2}', '${ids.providerA}', '4b-pay-3', 'credit_card', 30, 'confirmed', now()),
      ('${ids.tenantA}', '${ids.studentA1}', '${ids.providerA}', '4b-pay-4', 'pix', 40, 'refunded', now()),
      ('${ids.tenantB}', '${ids.studentOtherTenant}', '${ids.providerB}', '4b-pay-ot', 'pix', 999, 'confirmed', now());

    INSERT INTO public.recharges
      (tenant_id, student_id, wallet_id, amount, status, source, confirmed_at)
    VALUES
      ('${ids.tenantA}', '${ids.studentA1}', '${ids.walletA1}', 100, 'confirmed', 'pix', now()),
      ('${ids.tenantA}', '${ids.studentA2}', '${ids.walletA2}', 50, 'pending', 'pix', NULL),
      ('${ids.tenantA}', '${ids.studentA2}', '${ids.walletA2}', 30, 'confirmed', 'credit_card', now()),
      ('${ids.tenantA}', '${ids.studentA1}', '${ids.walletA1}', 40, 'reversed', 'pix', now()),
      ('${ids.tenantB}', '${ids.studentOtherTenant}', '${ids.walletOtherTenant}', 999, 'confirmed', 'pix', now());
  `);

  const meals = [
    [ids.unitA1, ids.institutionA, ids.studentA1, ids.categoryPartialA, 15, 5, 10, 'approved', 'registration_number', '4b-meal-1'],
    [ids.unitA1, ids.institutionA, ids.studentA2, ids.categoryPartialA, 15, 5, 10, 'approved', 'registration_number', '4b-meal-2'],
    [ids.unitA2, ids.institutionA, ids.studentA1, ids.categoryPartialA, 20, 20, 0, 'financially_refunded', 'registration_number', '4b-meal-3'],
    [ids.unitA2, ids.institutionA, ids.studentA2, ids.categoryPartialA, 15, 5, 10, 'cancelled_unserved', 'registration_number', '4b-meal-4'],
    [ids.unitB, ids.institutionB, ids.studentB, ids.categoryIntegralA, 15, 0, 15, 'approved', 'offline_contingency', '4b-meal-5'],
    [ids.unitB, ids.institutionB, ids.studentB, ids.categoryIntegralA, 18, 18, 0, 'approved', 'registration_number', '4b-meal-6'],
  ];
  for (let index = 0; index < meals.length; index += 1) {
    const [unitId, institutionId, studentId, categoryId, fullPrice, studentPrice,
      subsidyAmount, status, verificationMethod, idempotencyKey] = meals[index];
    await client.query(
      `INSERT INTO public.meal_consumptions
       (tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id,
        consumption_date, consumed_at, full_price, student_price, subsidy_amount,
        operator_id, terminal_id, verification_method, idempotency_key, status, allow_multi_meal)
       VALUES ($1,$2,$3,$4,$5,$6,current_date - $7::integer,now() - ($7::text || ' days')::interval,
               $8,$9,$10,$11,'STAGE-4B',$12,$13,$14,true)`,
      [
        ids.tenantA, unitId, institutionId, studentId, categoryId, ids.mealLunchA,
        index + 1, fullPrice, studentPrice, subsidyAmount, users.admin,
        verificationMethod, idempotencyKey, status,
      ],
    );
  }

  await client.query(`
    INSERT INTO public.cash_shifts
      (tenant_id, unit_id, meal_type_id, terminal_id, operator_id, status, opened_at,
       initial_float_amount, counted_closing_balance, difference_amount, closed_at, closed_by)
    VALUES
      ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealLunchA}', '4B-CASH-1', '${users.operator}', 'closed', now() - interval '3 days', 300, 295, -5, now() - interval '2 days', '${users.manager}'),
      ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealLunchA}', '4B-CASH-2', '${users.admin}', 'closed', now() - interval '2 days', 200, 212, 12, now() - interval '1 day', '${users.admin}'),
      ('${ids.tenantA}', '${ids.unitB}', '${ids.mealLunchA}', '4B-CASH-3', '${users.admin}', 'opened', now(), 0, NULL, NULL, NULL, NULL);
  `);

  await client.query(`
    INSERT INTO public.offline_contingency_events
      (tenant_id, unit_id, institution_id, terminal_id, operator_id, student_id,
       registration_attempted, meal_type_id, consumption_date, sequence_num,
       device_timestamp, idempotency_key, previous_event_hash, integrity_hash, status)
    VALUES
      ('${ids.tenantA}', '${ids.unitA1}', '${ids.institutionA}', '4B-OFFLINE', '${users.operator}', '${ids.studentA1}',
       '4B-A1', '${ids.mealLunchA}', current_date, 1, now(), '4b-offline-001', 'GENESIS', 'HASH-001', 'received'),
      ('${ids.tenantA}', '${ids.unitB}', '${ids.institutionB}', '4B-OFFLINE-B', '${users.admin}', '${ids.studentB}',
       '4B-B', '${ids.mealLunchA}', current_date, 1, now(), '4b-offline-002', 'GENESIS', 'HASH-002', 'received');
  `);
}

async function testIndicators() {
  const params = [ids.tenantA];
  const served = await scalar(
    `SELECT count(*)::integer AS value FROM public.meal_consumptions
      WHERE tenant_id=$1 AND status IN ('approved','financially_refunded')`, params,
  );
  const gross = await scalar(
    `SELECT coalesce(sum(full_price),0) AS value FROM public.meal_consumptions
      WHERE tenant_id=$1 AND status IN ('approved','financially_refunded')`, params,
  );
  const recharges = await scalar(
    `SELECT coalesce(sum(amount),0) AS value FROM public.recharges
      WHERE tenant_id=$1 AND status='confirmed'`, params,
  );
  const custody = await scalar(
    `SELECT coalesce(sum(balance),0) AS value FROM public.wallets
      WHERE tenant_id=$1`, params,
  );
  const cash = await client.query(
    `SELECT coalesce(sum(CASE WHEN difference_amount < 0 THEN -difference_amount ELSE 0 END),0) shortage,
            coalesce(sum(CASE WHEN difference_amount > 0 THEN difference_amount ELSE 0 END),0) surplus,
            coalesce(sum(abs(difference_amount)),0) exposure,
            coalesce(sum(difference_amount),0) net
       FROM public.cash_shifts WHERE tenant_id=$1 AND status='closed'`, params,
  );
  check(served === 5, 'Indicador de refeicoes servidas', `obtido=${served}`);
  check(gross === 83, 'Indicador de valor facial', `obtido=${gross}`);
  check(recharges === 130, 'Indicador de recargas confirmadas', `obtido=${recharges}`);
  check(custody === 85, 'Indicador de saldo em custodia', `obtido=${custody}`);
  check(Number(cash.rows[0].shortage) === 5, 'Indicador de falta de caixa', `obtido=${cash.rows[0].shortage}`);
  check(Number(cash.rows[0].surplus) === 12, 'Indicador de sobra de caixa', `obtido=${cash.rows[0].surplus}`);
  check(Number(cash.rows[0].exposure) === 17, 'Indicador de exposicao absoluta', `obtido=${cash.rows[0].exposure}`);
  check(Number(cash.rows[0].net) === 7, 'Indicador de diferenca liquida', `obtido=${cash.rows[0].net}`);
}

async function testOfflineIdempotency() {
  await client.query('SAVEPOINT offline_duplicate');
  let duplicateRejected = false;
  try {
    await client.query(`
      INSERT INTO public.offline_contingency_events
        (tenant_id, unit_id, institution_id, terminal_id, operator_id, student_id,
         registration_attempted, meal_type_id, consumption_date, sequence_num,
         device_timestamp, idempotency_key, previous_event_hash, integrity_hash, status)
      VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.institutionA}', '4B-OFFLINE', '${users.operator}', '${ids.studentA1}',
         '4B-A1', '${ids.mealLunchA}', current_date, 2, now(), '4b-offline-001', 'HASH-001', 'HASH-002', 'received')
    `);
  } catch (error) {
    duplicateRejected = error.code === '23505';
    await client.query('ROLLBACK TO SAVEPOINT offline_duplicate');
  }
  await client.query('RELEASE SAVEPOINT offline_duplicate');
  check(duplicateRejected, 'Idempotencia offline rejeita chave duplicada');
}

async function visibleCounts(userId, role = 'authenticated') {
  await setAuth(userId, role);
  const queries = {
    units: `SELECT count(*)::integer value FROM public.units WHERE id IN ('${ids.unitA1}','${ids.unitA2}','${ids.unitB}','${ids.unitOtherTenant}')`,
    institutions: `SELECT count(*)::integer value FROM public.institutions WHERE id IN ('${ids.institutionA}','${ids.institutionB}','${ids.institutionOtherTenant}')`,
    students: `SELECT count(*)::integer value FROM public.students WHERE id IN ('${ids.studentA1}','${ids.studentA2}','${ids.studentB}','${ids.studentOtherTenant}')`,
    meals: `SELECT count(*)::integer value FROM public.meal_consumptions WHERE tenant_id IN ('${ids.tenantA}','${ids.tenantB}')`,
    wallets: `SELECT count(*)::integer value FROM public.wallets WHERE id IN ('${ids.walletA1}','${ids.walletA2}','${ids.walletB}','${ids.walletOtherTenant}')`,
    payments: `SELECT count(*)::integer value FROM public.payments WHERE external_payment_id LIKE '4b-%'`,
    recharges: `SELECT count(*)::integer value FROM public.recharges WHERE tenant_id IN ('${ids.tenantA}','${ids.tenantB}')`,
    offline: `SELECT count(*)::integer value FROM public.offline_contingency_events WHERE idempotency_key IN ('4b-offline-001','4b-offline-002')`,
    cash: `SELECT count(*)::integer value FROM public.cash_shifts WHERE terminal_id LIKE '4B-CASH-%'`,
  };
  const counts = {};
  for (const [name, sql] of Object.entries(queries)) {
    await client.query(`SAVEPOINT rls_${name}`);
    try {
      counts[name] = await scalar(sql);
      await client.query(`RELEASE SAVEPOINT rls_${name}`);
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT rls_${name}`);
      await client.query(`RELEASE SAVEPOINT rls_${name}`);
      if (role === 'anon' && error.code === '42501') counts[name] = 0;
      else throw error;
    }
  }
  await asPostgres();
  return counts;
}

async function testRls() {
  const results = {
    admin: await visibleCounts(users.admin),
    director: await visibleCounts(users.director),
    finance: await visibleCounts(users.finance),
    supervisor: await visibleCounts(users.supervisor),
    manager: await visibleCounts(users.manager),
    operator: await visibleCounts(users.operator),
    institution: await visibleCounts(users.institution),
    student: await visibleCounts(users.student),
    inactive: await visibleCounts(users.inactive),
    otherTenantAdmin: await visibleCounts(users.otherTenantAdmin),
    anonymous: await visibleCounts(null, 'anon'),
  };

  check(results.admin.units === 3 && results.admin.wallets === 3, 'Admin restrito ao proprio tenant');
  check(results.director.units === 3 && results.director.meals === 6, 'Diretor possui escopo global no tenant');
  check(results.finance.units === 3 && results.finance.wallets === 3, 'Financeiro possui escopo financeiro global no tenant');
  check(results.supervisor.units === 1 && results.supervisor.meals === 2, 'Supervisor restrito a unidade nos dados operacionais');
  check(results.manager.units === 1 && results.manager.meals === 2, 'Gerente restrito a unidade nos dados operacionais');
  check(results.operator.units === 1 && results.operator.meals === 2 && results.operator.cash === 1, 'Operador restrito a unidade em consumo e caixa');
  check(results.student.students === 1 && results.student.wallets === 1 && results.student.meals === 2, 'Consumidor acessa somente dados proprios');
  check(Object.values(results.inactive).every((value) => value === 0), 'Usuario inativo sem acesso');
  check(Object.values(results.anonymous).every((value) => value === 0), 'Anonimo sem acesso');
  check(results.otherTenantAdmin.units === 1 && results.otherTenantAdmin.wallets === 1, 'Isolamento entre tenants');

  check(results.supervisor.wallets === 1, 'Supervisor nao enxerga carteiras fora da unidade', `obtido=${results.supervisor.wallets}`);
  check(results.manager.wallets === 1, 'Gerente nao enxerga carteiras fora da unidade', `obtido=${results.manager.wallets}`);
  check(results.supervisor.students === 1, 'Supervisor nao enxerga estudantes associados a outra unidade da mesma instituicao', `obtido=${results.supervisor.students}`);
  check(results.manager.students === 1, 'Gerente nao enxerga estudantes associados a outra unidade da mesma instituicao', `obtido=${results.manager.students}`);
  check(results.supervisor.payments === 1, 'Supervisor nao enxerga pagamentos fora da unidade', `obtido=${results.supervisor.payments}`);
  check(results.manager.recharges === 1, 'Gerente nao enxerga recargas fora da unidade', `obtido=${results.manager.recharges}`);
  check(results.operator.offline === 1, 'Operador acessa somente eventos offline da unidade', `obtido=${results.operator.offline}`);
  check(results.institution.students === 2, 'Usuario institucional acessa estudantes da propria instituicao', `obtido=${results.institution.students}`);
  check(results.institution.offline === 0, 'Usuario institucional nao acessa eventos offline', `obtido=${results.institution.offline}`);
  check(results.student.offline === 0, 'Consumidor nao acessa eventos offline', `obtido=${results.student.offline}`);
  check(results.inactive.offline === 0, 'Usuario inativo nao acessa eventos offline', `obtido=${results.inactive.offline}`);
  check(results.otherTenantAdmin.cash === 0, 'Administrador nao acessa caixas de outro tenant', `obtido=${results.otherTenantAdmin.cash}`);

  console.log('RLS_MATRIX=' + JSON.stringify(results));
}

async function main() {
  await client.connect();
  await client.query('BEGIN');
  let runError;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    console.log('STAGE seed:start');
    await seed();
    console.log('STAGE seed:complete');
    await testIndicators();
    console.log('STAGE indicators:complete');
    await testOfflineIdempotency();
    console.log('STAGE offline:complete');
    await testRls();
    console.log('STAGE rls:complete');
  } catch (error) {
    runError = error;
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    try { await client.end(); } catch {}
  }
  if (runError) throw runError;
  console.log(`RESULT passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 2 : 0;
}

main().catch(async (error) => {
  console.error(`FATAL code=${error.code || 'unknown'} message=${error.message}`);
  process.exitCode = 1;
});
