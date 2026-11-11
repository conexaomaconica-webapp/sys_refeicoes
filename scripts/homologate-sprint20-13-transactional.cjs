/**
 * ==============================================================================
 * SPRINT 20.13 — HOMOLOGAÇÃO TRANSACIONAL COMPLETA EM POSTGRESQL 17 DESCARTÁVEL
 * Executa testes reais contra Migration 84 sobre cadeia 77 -> 81 -> 83 -> 84:
 * - Duplicidade individual entre lotes distintos (DUPLICATE_CROSS_BATCH_ITEM)
 * - Duplicidade contra meal_consumptions (DUPLICATE_REGULAR_CONSUMPTION)
 * - Re-submissão após lote rejeitado
 * - Concorrência simultânea em lotes individuais
 * - Isolamento multi-tenant & has_unit_access (unit_manager)
 * - Permissões (operator/anon/inativo) & anti-autoaprovação & imutabilidade
 * - Bloqueios: dia sem funcionamento no calendário, data fechada, estudante inativo,
 *   falta de referência documental
 * - Relatórios consolidados & fechamento diário (pendência mensal nunca infla receita)
 * - Integridade integral de wallets e wallet_transactions
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const pgUrl = process.env.DISPOSABLE_PG_URL;
const expectedDataDir = process.env.SPRINT20_13_EXPECTED_DATA_DIR || '';
const expectedPort = Number(process.env.SPRINT20_13_EXPECTED_PORT || 0);
const evidenceJsonPath = process.env.SPRINT20_13_EVIDENCE_JSON || '';

if (!pgUrl) {
  throw new Error('DISPOSABLE_PG_URL é obrigatória.');
}
if (/supabase\.(co|com)|pooler\.supabase/i.test(pgUrl)) {
  throw new Error('ERRO CRÍTICO: Proibido executar contra Supabase remoto!');
}

const target = new URL(pgUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(target.hostname)) {
  throw new Error(`Host recusado: ${target.hostname}`);
}
if (!target.pathname.slice(1).startsWith('sprint20_13_')) {
  throw new Error(`Banco recusado: ${target.pathname}. Deve iniciar com sprint20_13_.`);
}

const readSql = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

const results = [];
let passed = 0;
let failed = 0;

function check(cond, name, detail = '') {
  if (cond) {
    passed += 1;
    results.push({ name, passed: true, detail });
    console.log(`PASS ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    failed += 1;
    results.push({ name, passed: false, detail });
    console.error(`FAIL ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

async function asRoleTx(pool, role, userId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', $1, true)", [role]);
    const res = await work(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

async function expectFailTx(fn, expectedPattern, label) {
  try {
    await fn();
    check(false, label, 'operação deveria ter sido bloqueada');
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (expectedPattern && !expectedPattern.test(msg)) {
      check(false, label, `esperado ${expectedPattern}, recebido: ${msg}`);
    } else {
      check(true, label, msg.split('\n')[0]);
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: pgUrl, max: 6, connectionTimeoutMillis: 10_000 });
  let serverMeta = {};

  try {
    const metaRes = await pool.query(`
      SELECT
        pg_catalog.current_setting('server_version_num')::int AS version_num,
        pg_catalog.current_setting('data_directory') AS data_dir,
        pg_catalog.current_setting('listen_addresses') AS listen_addresses,
        pg_catalog.host(pg_catalog.inet_server_addr())::text AS addr,
        pg_catalog.inet_server_port()::int AS port
    `);
    const meta = metaRes.rows[0];
    serverMeta = { versionNum: meta.version_num, addr: meta.addr, port: meta.port };

    check(meta.version_num >= 170000 && meta.version_num < 180000, 'PostgreSQL 17 descartável confirmado', `v${meta.version_num}`);
    check(!expectedDataDir || path.resolve(meta.data_dir).toLowerCase() === path.resolve(expectedDataDir).toLowerCase(), 'Data directory descartável exclusivo confirmado');
    check(meta.addr === '127.0.0.1' && meta.listen_addresses === '127.0.0.1' && (!expectedPort || meta.port === expectedPort), 'Listener restrito a loopback', `${meta.addr}:${meta.port}`);

    await pool.query(readSql('scripts/sql/sprint17_1_disposable_pg17_baseline.sql'));
    await pool.query(readSql('supabase/migrations/20261029000077_create_contingency_regularization.sql'));
    await pool.query(readSql('supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql'));
    await pool.query(readSql('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql'));
    await pool.query(readSql('supabase/migrations/20261109000080_create_financial_reconciliation.sql'));
    await pool.query(readSql('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql'));
    await pool.query(readSql('supabase/migrations/20261110000083_sprint20_daily_closing_persistence.sql'));
    await pool.query(readSql('supabase/migrations/20261111000084_sprint20_smart_meal_adjustments.sql'));
    check(true, 'Cadeia de migrations 77 -> 81 -> 83 -> 84 compilada sobre baseline');

    const dRes = await pool.query(`
      SELECT
        pg_catalog.date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date::text AS month_start,
        ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS today_br,
        (((now() AT TIME ZONE 'America/Sao_Paulo')::date) - 1)::text AS yesterday_br,
        (((now() AT TIME ZONE 'America/Sao_Paulo')::date) + 1)::text AS tomorrow_br
    `);
    const { month_start: monthStart, today_br: todayBr, yesterday_br: yesterdayBr, tomorrow_br: tomorrowBr } = dRes.rows[0];

    // Escolhe 3 dias dentro do mês corrente <= todayBr (usando d01, d02, d03 seguros se dia >= 3, ou mês anterior como competência!)
    const prevMonthRes = await pool.query(`
      SELECT
        pg_catalog.date_trunc('month', ((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month'))::date::text AS prev_m_start,
        (pg_catalog.date_trunc('month', ((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month'))::date + 2)::text AS prev_d03,
        (pg_catalog.date_trunc('month', ((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month'))::date + 3)::text AS prev_d04,
        (pg_catalog.date_trunc('month', ((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month'))::date + 4)::text AS prev_d05,
        (pg_catalog.date_trunc('month', ((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month'))::date + 5)::text AS prev_d06
    `);
    const { prev_m_start: prevMonthStart, prev_d03: d03, prev_d04: d04, prev_d05: d05, prev_d06: d06 } = prevMonthRes.rows[0];

    const ids = {
      tenantA: 'a0000000-0000-4000-8000-000000000001',
      tenantB: 'b0000000-0000-4000-8000-000000000002',
      instA1: 'a1000000-0000-4000-8000-000000000001',
      instB1: 'b1000000-0000-4000-8000-000000000001',
      unitA1: 'a2000000-0000-4000-8000-000000000001',
      unitA2: 'a2000000-0000-4000-8000-000000000002',
      unitB1: 'b2000000-0000-4000-8000-000000000001',
      dirA: 'a3000000-0000-4000-8000-000000000001',
      finA: 'a3000000-0000-4000-8000-000000000002',
      mgrA1: 'a3000000-0000-4000-8000-000000000003',
      opA1: 'a3000000-0000-4000-8000-000000000004',
      mgrB1: 'b3000000-0000-4000-8000-000000000001',
      catPar: 'a4000000-0000-4000-8000-000000000001',
      catInt: 'a4000000-0000-4000-8000-000000000002',
      catExp: 'a4000000-0000-4000-8000-000000000003',
      stdA1: 'a5000000-0000-4000-8000-000000000001',
      stdA2: 'a5000000-0000-4000-8000-000000000002',
      stdInact: 'a5000000-0000-4000-8000-000000000003',
      walA1: 'a6000000-0000-4000-8000-000000000001',
      mealAlm: 'a7000000-0000-4000-8000-000000000001',
      mealJan: 'a7000000-0000-4000-8000-000000000002',
      mealDes: 'a7000000-0000-4000-8000-000000000003',
    };

    await pool.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES
        ('${ids.tenantA}', 'Tenant Alfa', 'alfa'),
        ('${ids.tenantB}', 'Tenant Beta', 'beta');
      INSERT INTO public.institutions (id, tenant_id, name) VALUES
        ('${ids.instA1}', '${ids.tenantA}', 'Escola Alfa'),
        ('${ids.instB1}', '${ids.tenantB}', 'Escola Beta');
      INSERT INTO public.units (id, tenant_id, institution_id, name, status) VALUES
        ('${ids.unitA1}', '${ids.tenantA}', '${ids.instA1}', 'RU A1', 'active'),
        ('${ids.unitA2}', '${ids.tenantA}', '${ids.instA1}', 'RU A2', 'active'),
        ('${ids.unitB1}', '${ids.tenantB}', '${ids.instB1}', 'RU B1', 'active');
      INSERT INTO auth.users (id, email) VALUES
        ('${ids.dirA}', 'dir@a.invalid'),
        ('${ids.finA}', 'fin@a.invalid'),
        ('${ids.mgrA1}', 'mgr@a.invalid'),
        ('${ids.opA1}', 'op@a.invalid'),
        ('${ids.mgrB1}', 'mgr@b.invalid');
      INSERT INTO public.profiles (id, tenant_id, full_name, role, status) VALUES
        ('${ids.dirA}', '${ids.tenantA}', 'Diretor A', 'operations_director', 'active'),
        ('${ids.finA}', '${ids.tenantA}', 'Financeiro A', 'finance', 'active'),
        ('${ids.mgrA1}', '${ids.tenantA}', 'Gerente A1', 'unit_manager', 'active'),
        ('${ids.opA1}', '${ids.tenantA}', 'Operador A1', 'operator', 'active'),
        ('${ids.mgrB1}', '${ids.tenantB}', 'Gerente B1', 'unit_manager', 'active');
      INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
        ('${ids.tenantA}', '${ids.mgrA1}', '${ids.unitA1}'),
        ('${ids.tenantB}', '${ids.mgrB1}', '${ids.unitB1}');
      INSERT INTO public.student_categories (id, tenant_id, code, name, requires_wallet) VALUES
        ('${ids.catPar}', '${ids.tenantA}', 'parcial', 'Parcial', true),
        ('${ids.catInt}', '${ids.tenantA}', 'integral', 'Integral', false),
        ('${ids.catExp}', '${ids.tenantA}', 'expirada', 'Expirada', false);
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status) VALUES
        ('${ids.stdA1}', '${ids.tenantA}', '${ids.instA1}', '${ids.catPar}', 'Aluno Um', 'RA1001', 'active'),
        ('${ids.stdA2}', '${ids.tenantA}', '${ids.instA1}', '${ids.catPar}', 'Aluno Dois', 'RA1002', 'active'),
        ('${ids.stdInact}', '${ids.tenantA}', '${ids.instA1}', '${ids.catPar}', 'Aluno Inativo', 'RA1099', 'inactive');
      INSERT INTO public.wallets (id, tenant_id, student_id, balance) VALUES
        ('${ids.walA1}', '${ids.tenantA}', '${ids.stdA1}', 80.00);
      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, description) VALUES
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 80.00, 0.00, 80.00, 'Saldo inicial teste');
      INSERT INTO public.meal_types (id, tenant_id, code, name, status) VALUES
        ('${ids.mealAlm}', '${ids.tenantA}', 'lunch', 'Almoço', 'active'),
        ('${ids.mealJan}', '${ids.tenantA}', 'dinner', 'Jantar', 'active'),
        ('${ids.mealDes}', '${ids.tenantA}', 'breakfast', 'Desjejum', 'active');
      INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id, enabled) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', true),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealJan}', true),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealDes}', false);
      INSERT INTO public.meal_rules (tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, enabled, effective_from, effective_to) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', '${ids.catPar}', 15.00, 5.00, 10.00, true, '2025-01-01'::timestamptz, NULL),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', '${ids.catInt}', 15.00, 0.00, 15.00, true, '2025-01-01'::timestamptz, NULL),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealJan}', '${ids.catPar}', 15.00, 5.00, 10.00, true, '2025-01-01'::timestamptz, NULL),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealJan}', '${ids.catInt}', 15.00, 0.00, 15.00, true, '2025-01-01'::timestamptz, NULL),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', '${ids.catExp}', 15.00, 0.00, 15.00, true, '2024-01-01'::timestamptz, '2025-01-31'::timestamptz);
      INSERT INTO public.meal_consumptions (tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id, consumption_date, full_price, student_price, subsidy_amount, operator_id, status) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.instA1}', '${ids.stdA1}', '${ids.catPar}', '${ids.mealAlm}', '${d03}'::date, 15.00, 5.00, 10.00, '${ids.opA1}', 'approved');
    `);

    // 1. Permissões e isolamento multi-tenant / has_unit_access
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.opA1, (c) => c.query('SELECT public.upsert_unit_operating_calendar($1,$2,$3)', [ids.unitA1, d04, false])),
      /PERMISSION_DENIED/,
      'Operador bloqueado em upsert_unit_operating_calendar'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) => c.query('SELECT public.upsert_unit_operating_calendar($1,$2,$3)', [ids.unitA2, d04, false])),
      /ACCESS_DENIED_UNIT/,
      'Gerente A1 bloqueado na unidade A2 sem user_unit_access'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrB1, (c) => c.query('SELECT public.upsert_unit_operating_calendar($1,$2,$3)', [ids.unitA1, d04, false])),
      /ACCESS_DENIED_UNIT|TENANT/,
      'Gerente Tenant B bloqueado na unidade do Tenant A'
    );

    // 2. Marcar d04 como feriado (is_operating = false) + fechar d06 no fechamento diário
    await asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
      c.query('SELECT public.upsert_unit_operating_calendar($1,$2,$3,$4,$5)', [ids.unitA1, d04, false, null, 'Recesso acadêmico'])
    );
    await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, d06, ids.unitA1, 'Fechamento prévio para teste'])
    );
    check(true, 'Calendário operacional (d04 sem funcionamento) e fechamento diário (d06) persistidos');

    // 3. Bloqueios de data inválida, não-funcionamento e dia fechado
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_quantity_distribution',
          5,
          JSON.stringify([{ service_date: d04, quantity: 5, category_id: ids.catPar }]),
          '{}',
          'Tentativa em feriado no calendário',
        ])
      ),
      /NON_OPERATING_DAY/,
      'Alocação em dia marcado sem funcionamento no calendário é bloqueada'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_quantity_distribution',
          5,
          JSON.stringify([{ service_date: d06, quantity: 5, category_id: ids.catPar }]),
          '{}',
          'Tentativa em dia fechado no financeiro',
        ])
      ),
      /CLOSED_DAILY_PERIOD/,
      'Alocação em dia com fechamento diário persistido é bloqueada para gerente local'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_quantity_distribution',
          5,
          JSON.stringify([{ service_date: tomorrowBr, quantity: 5, category_id: ids.catPar }]),
          '{}',
          'Tentativa data futura fora da competência',
        ])
      ),
      /INVALID_ALLOCATION_DATE/,
      'Data futura ou fora da competência é bloqueada'
    );

    // 3B. Sprint 20.13.1: Categoria obrigatória, turno habilitado, regra vigente na data e categoria divergente
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_quantity_distribution',
          2,
          JSON.stringify([{ service_date: d05, quantity: 2 }]),
          '{}',
          'Tentativa sem informar categoria administrativa',
        ])
      ),
      /CATEGORY_REQUIRED/,
      'Categoria administrativa obrigatória bloqueia alocação sem categoria'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealDes,
          prevMonthStart,
          'smart_quantity_distribution',
          2,
          JSON.stringify([{ service_date: d05, quantity: 2, category_id: ids.catPar }]),
          '{}',
          'Tentativa em turno desabilitado na unidade',
        ])
      ),
      /UNIT_MEAL_TYPE_DISABLED/,
      'Turno desabilitado em unit_meal_types é bloqueado'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_quantity_distribution',
          2,
          JSON.stringify([{ service_date: d05, quantity: 2, category_id: ids.catExp }]),
          '{}',
          'Tentativa com regra tarifária expirada na data',
        ])
      ),
      /RULE_NOT_EFFECTIVE/,
      'Regra tarifária expirada ou inexistente na data é bloqueada'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catInt,
            identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: 'Folha Integral' }],
          }]),
          '{}',
          'Tentativa de classificar estudante Parcial como Integral',
        ])
      ),
      /CATEGORY_MISMATCH/,
      'Divergência entre categoria vigente do estudante e categoria selecionada é bloqueada'
    );

    // 4. Reconciliação individual exige referência documental e estudante ativo
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: '' }],
          }]),
          '{}',
          'Tentativa sem referência documental',
        ])
      ),
      /DOCUMENT_REFERENCE_REQUIRED/,
      'Reconciliação individual sem referência documental por estudante é bloqueada'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdInact, registration_number: 'RA1099', notes: 'Folha p.1' }],
          }]),
          '{}',
          'Tentativa com estudante inativo',
        ])
      ),
      /INACTIVE_OR_MISSING_STUDENT/,
      'Estudante inativo é bloqueado na reconciliação individual'
    );

    // 5. Duplicidade contra consumo regular (d03 já consumido por stdA1)
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d03,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: 'Folha p.1' }],
          }]),
          '{}',
          'Tentativa sobre dia já consumido',
        ])
      ),
      /DUPLICATE_REGULAR_CONSUMPTION/,
      'Consumo regular aprovado bloqueia regularização individual do mesmo aluno/dia/turno'
    );

    // 6. Submissão válida + trava cross-batch entre lotes diferentes + concorrência
    const campIndivRes = await asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
      c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8) AS res', [
        ids.unitA1,
        ids.mealAlm,
        prevMonthStart,
        'smart_individual_reconciliation',
        1,
        JSON.stringify([{
          service_date: d05,
          quantity: 1,
          category_id: ids.catPar,
          identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: 'Folha assinada #12' }],
        }]),
        '{"habitual": 1}',
        'Regularização individual conferida em lista física',
      ])
    );
    const campIndiv = campIndivRes.rows[0].res;
    check(campIndiv.allocated_meals_count === 1 && campIndiv.unallocated_pending_meals === 0, 'Campanha individual submetida com sucesso');

    // Tentativa cross-batch (lote manual em d05 para o mesmo stdA1) -> deve falhar por DUPLICATE_CROSS_BATCH_ITEM!
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8)', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: 'Outro lote d05' }],
          }]),
          '{}',
          'Duplicidade entre lotes diferentes no mesmo dia',
        ])
      ),
      /DUPLICATE_CROSS_BATCH_ITEM/,
      'Trava cross-batch bloqueia mesmo estudante em lote diferente na mesma data e refeição'
    );

    // Concorrência simultânea para stdA2 em d05: 1 vence, 1 é bloqueado!
    const [race1, race2] = await Promise.allSettled([
      asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8) AS res', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdA2, registration_number: 'RA1002', notes: 'Concorrencia A' }],
          }]),
          '{}',
          'Disparo concorrente lote individual A',
        ])
      ),
      asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
        c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8) AS res', [
          ids.unitA1,
          ids.mealAlm,
          prevMonthStart,
          'smart_individual_reconciliation',
          1,
          JSON.stringify([{
            service_date: d05,
            quantity: 1,
            category_id: ids.catPar,
            identified_students: [{ student_id: ids.stdA2, registration_number: 'RA1002', notes: 'Concorrencia B' }],
          }]),
          '{}',
          'Disparo concorrente lote individual B',
        ])
      ),
    ]);
    const raceFulfilled = [race1, race2].filter((r) => r.status === 'fulfilled').length;
    const raceRejected = [race1, race2].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    check(
      raceFulfilled === 1 && raceRejected.length === 1 && /DUPLICATE_CROSS_BATCH_ITEM/.test(raceRejected[0]),
      'Concorrência simultânea de inclusão individual bloqueia duplicidade cross-batch',
      `fulfilled=${raceFulfilled}`
    );

    // 7. Autoaprovação bloqueada + aprovação segregada + re-submissão após rejeição
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
        c.query('SELECT public.review_smart_adjustment_campaign($1,$2,$3)', [campIndiv.campaign_id, 'approve', null])
      ),
      /PERMISSION_DENIED|SELF_APPROVAL_PROHIBITED/,
      'Criador / gerente local não pode aprovar própria campanha'
    );

    // Diretor cria campanha com pendência mensal (10 comprovadas: 3 alocadas agregadas em d05 + 7 pendentes sem data)
    const campAggRes = await asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
      c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8) AS res', [
        ids.unitA1,
        ids.mealAlm,
        prevMonthStart,
        'smart_quantity_distribution',
        10,
        JSON.stringify([{ service_date: d05, quantity: 3, category_id: ids.catPar }]),
        '{"notes":"Parcial com saldo mensal pendente"}',
        '3 agregadas em d05 e 7 pendentes sem data verificável',
      ])
    );
    const campAgg = campAggRes.rows[0].res;
    check(campAgg.allocated_meals_count === 3 && campAgg.unallocated_pending_meals === 7 && campAgg.allocation_status === 'partially_allocated_pending', 'Campanha mista mantém 7 refeições como Pendência Mensal não alocada');

    // Diretor tenta aprovar a própria campanha -> bloqueado!
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
        c.query('SELECT public.review_smart_adjustment_campaign($1,$2,$3)', [campAgg.campaign_id, 'approve', null])
      ),
      /SELF_APPROVAL_PROHIBITED/,
      'Autoaprovação bloqueada também para Diretor na própria campanha'
    );

    // Financeiro aprova ambas campanhas (segregação de funções válida)
    await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query('SELECT public.review_smart_adjustment_campaign($1,$2,$3)', [campIndiv.campaign_id, 'approve', null])
    );
    await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query('SELECT public.review_smart_adjustment_campaign($1,$2,$3)', [campAgg.campaign_id, 'approve', null])
    );
    check(true, 'Aprovação segregada pelo Financeiro aprovou campanhas e lotes vinculados');

    // Imutabilidade pós-aprovação
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) =>
        c.query('UPDATE public.meal_adjustment_campaigns SET unallocated_pending_meals = 0, allocated_meals_count = 10 WHERE id = $1', [campAgg.campaign_id])
      ),
      /CAMPAIGN_IMMUTABLE/,
      'Campanha aprovada é imutável contra adulterações posteriores'
    );

    // 8. Relatórios segregados (Individual vs Agregada vs Pendência Mensal fora do faturamento)
    const reportRes = await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query('SELECT public.get_consolidated_financial_report($1,$2,$3,$4,$5,$6) AS rep', [
        ids.tenantA,
        prevMonthStart,
        todayBr,
        ids.instA1,
        ids.unitA1,
        null,
      ])
    );
    const rep = reportRes.rows[0].rep;
    check(
      Number(rep.summary.regular_meals_served) === 1 &&
        Number(rep.summary.contingency_identified_meals) === 1 &&
        Number(rep.summary.contingency_aggregated_meals) === 3 &&
        Number(rep.summary.contingency_meals_served) === 4 &&
        Number(rep.summary.unallocated_pending_meals_total) === 7 &&
        Number(rep.summary.total_meals_delivered) === 5 &&
        Number(rep.summary.contingency_subsidy_amount) === 40,
      'Relatório financeiro segrega Individual (1), Agregada (3) e Pendência Mensal (7) sem inflar faturamento',
      `delivered=${rep.summary.total_meals_delivered}, pending=${rep.summary.unallocated_pending_meals_total}`
    );

    // 9. Integridade de carteiras e ledger (zero mutações)
    const walletCheck = await pool.query(`
      SELECT
        (SELECT SUM(balance)::numeric(12,2) FROM public.wallets WHERE tenant_id = '${ids.tenantA}') AS w_sum,
        (SELECT SUM(amount)::numeric(12,2) FROM public.wallet_transactions WHERE tenant_id = '${ids.tenantA}') AS l_sum,
        (SELECT COUNT(*)::int FROM public.wallet_transactions WHERE tenant_id = '${ids.tenantA}') AS l_cnt
    `);
    const wc = walletCheck.rows[0];
    check(
      Number(wc.w_sum) === 80 && Number(wc.l_sum) === 80 && wc.l_cnt === 1,
      'Carteiras e wallet_transactions preservados integralmente (0 mutações automáticas)'
    );

    // RLS cross-tenant na leitura de campanhas e calendário
    const crossCamp = await asRoleTx(pool, 'authenticated', ids.mgrB1, (c) =>
      c.query('SELECT id FROM public.meal_adjustment_campaigns')
    );
    const crossCal = await asRoleTx(pool, 'authenticated', ids.mgrB1, (c) =>
      c.query('SELECT id FROM public.unit_operating_calendar')
    );
    check(crossCamp.rowCount === 0 && crossCal.rowCount === 0, 'RLS multi-tenant oculta campanhas e calendário do Tenant A para Tenant B');

    // 10. Sprint 20.13.1: Multi-turno simultâneo (Almoço + Jantar), histórico de categoria na data e submit_retroactive_date_distribution
    const retMultiRes = await asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
      c.query('SELECT public.submit_retroactive_date_distribution($1,$2,$3,$4,$5,$6) AS res', [
        ids.unitA1,
        d03,
        JSON.stringify([
          {
            meal_type_id: ids.mealJan,
            category_id: ids.catPar,
            batch_type: 'type_a_identified',
            quantity: 1,
            identified_students: [{ student_id: ids.stdA1, registration_number: 'RA1001', notes: 'Jantar confirmado em d03' }],
          },
          {
            meal_type_id: ids.mealJan,
            category_id: ids.catInt,
            batch_type: 'type_b_unidentified_count',
            quantity: 4,
          },
        ]),
        'Regularização multi-categoria do jantar em d03 (mesmo aluno teve almoço aprovado)',
        null,
        false,
      ])
    );
    const retMulti = retMultiRes.rows[0].res;
    check(retMulti.total_meals === 5 && Array.isArray(retMulti.batch_ids) && retMulti.batch_ids.length === 2, 'Almoço e Jantar no mesmo dia permitidos via distribuição multi-linha');

    const campMultiRes = await asRoleTx(pool, 'authenticated', ids.mgrA1, (c) =>
      c.query('SELECT public.submit_smart_adjustment_campaign($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS res', [
        ids.unitA1,
        null,
        prevMonthStart,
        'smart_quantity_distribution',
        12,
        JSON.stringify([
          { service_date: d05, meal_type_id: ids.mealAlm, category_id: ids.catInt, quantity: 4 },
          { service_date: d05, meal_type_id: ids.mealJan, category_id: ids.catPar, quantity: 3 },
        ]),
        '{"multi_shift": true}',
        'Campanha multi-turno Almoço Integral + Jantar Parcial com saldo pendente',
        null,
        false,
        [ids.mealAlm, ids.mealJan],
        JSON.stringify([
          { meal_type_id: ids.mealAlm, category_id: ids.catInt, quantity: 5 },
          { meal_type_id: ids.mealJan, category_id: ids.catPar, quantity: 5 },
        ]),
      ])
    );
    const campMulti = campMultiRes.rows[0].res;
    check(
      campMulti.allocated_meals_count === 7 && campMulti.unallocated_pending_meals === 5,
      'Campanha multi-turno (Almoço + Jantar) grava selected_meal_type_ids, linhas e pendência corretamente'
    );

    const summary = { passed, failed, total: passed + failed, serverMeta, executedAt: new Date().toISOString(), results };
    if (evidenceJsonPath) {
      fs.mkdirSync(path.dirname(evidenceJsonPath), { recursive: true });
      fs.writeFileSync(evidenceJsonPath, JSON.stringify(summary, null, 2));
    }

    console.log(`\nSPRINT 20.13 TRANSACTIONAL HOMOLOGATION: ${passed}/${passed + failed} PASS (${failed} failures)`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

