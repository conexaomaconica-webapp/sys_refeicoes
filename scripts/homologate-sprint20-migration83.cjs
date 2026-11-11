/**
 * ==============================================================================
 * SPRINT 20.11 — HOMOLOGAÇÃO TRANSACIONAL DA MIGRATION 83 EM POSTGRESQL 17
 * Valida close_financial_daily_period e financial_daily_closings sob papéis
 * restritos (authenticated/anon sem SUPERUSER/BYPASSRLS), incluindo concorrência
 * real entre sessões paralelas, idempotência, isolamento multi-tenant e imutabilidade.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const pgUrl = process.env.DISPOSABLE_PG_URL;
const expectedDataDir = process.env.SPRINT20_EXPECTED_DATA_DIR || '';
const expectedPort = Number(process.env.SPRINT20_EXPECTED_PORT || 0);
const evidenceJsonPath = process.env.SPRINT20_EVIDENCE_JSON || '';

if (!pgUrl) {
  throw new Error('DISPOSABLE_PG_URL é obrigatória para homologação descartável.');
}
if (/supabase\.(co|com)|pooler\.supabase/i.test(pgUrl)) {
  throw new Error('ERRO CRÍTICO: Proibido executar homologação contra Supabase remoto!');
}

const target = new URL(pgUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(target.hostname)) {
  throw new Error(`Host recusado: ${target.hostname}. Permitido somente loopback local.`);
}
if (!target.pathname.slice(1).startsWith('sprint20_83_')) {
  throw new Error(`Banco recusado: ${target.pathname}. Nome deve iniciar com sprint20_83_.`);
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
      // ignora erro de rollback
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

    // 1. Baseline + Migrations 77 -> 81 + 83
    await pool.query(readSql('scripts/sql/sprint17_1_disposable_pg17_baseline.sql'));
    const roleRes = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('authenticated', 'anon')
      ORDER BY rolname
    `);
    check(roleRes.rowCount === 2 && roleRes.rows.every((r) => !r.rolsuper && !r.rolbypassrls), 'Papéis authenticated e anon sem SUPERUSER ou BYPASSRLS');

    await pool.query(readSql('supabase/migrations/20261029000077_create_contingency_regularization.sql'));
    await pool.query(readSql('supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql'));
    await pool.query(readSql('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql'));
    await pool.query(readSql('supabase/migrations/20261109000080_create_financial_reconciliation.sql'));
    await pool.query(readSql('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql'));
    await pool.query(readSql('supabase/migrations/20261110000083_sprint20_daily_closing_persistence.sql'));
    check(true, 'Cadeia de migrations 77 -> 81 -> 83 aplicada sobre baseline');

    // 2. Datas de negócio em America/Sao_Paulo + Massa sintética
    const datesRes = await pool.query(`
      SELECT
        (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today_br,
        ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)::text AS yesterday_br,
        ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS tomorrow_br
    `);
    const { today_br: todayBr, yesterday_br: yesterdayBr, tomorrow_br: tomorrowBr } = datesRes.rows[0];
    const safeYesterdayTs = `'${yesterdayBr} 12:00:00-03'`;
    const safeYesterdayDate = `'${yesterdayBr}'`;

    const ids = {
      tenantA: 'a0000000-0000-4000-8000-000000000001',
      tenantB: 'b0000000-0000-4000-8000-000000000002',
      instA1: 'a1000000-0000-4000-8000-000000000001',
      instB1: 'b1000000-0000-4000-8000-000000000001',
      unitA1: 'a2000000-0000-4000-8000-000000000001',
      unitA2: 'a2000000-0000-4000-8000-000000000002',
      unitB1: 'b2000000-0000-4000-8000-000000000001',
      finA: 'a3000000-0000-4000-8000-000000000001',
      dirA: 'a3000000-0000-4000-8000-000000000002',
      opA1: 'a3000000-0000-4000-8000-000000000003',
      inactA: 'a3000000-0000-4000-8000-000000000004',
      finB: 'b3000000-0000-4000-8000-000000000001',
      catA: 'a4000000-0000-4000-8000-000000000001',
      stdA1: 'a5000000-0000-4000-8000-000000000001',
      walA1: 'a6000000-0000-4000-8000-000000000001',
      mealAlm: 'a7000000-0000-4000-8000-000000000001',
      provA: 'a8000000-0000-4000-8000-000000000001',
      payPix: 'a9000000-0000-4000-8000-000000000001',
      payCard: 'a9000000-0000-4000-8000-000000000002',
      batchA1: 'aa000000-0000-4000-8000-000000000001',
    };

    await pool.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES
        ('${ids.tenantA}', 'Prefeitura Sintética A', 'tenant-a'),
        ('${ids.tenantB}', 'Prefeitura Sintética B', 'tenant-b');

      INSERT INTO public.institutions (id, tenant_id, name) VALUES
        ('${ids.instA1}', '${ids.tenantA}', 'Escola A1'),
        ('${ids.instB1}', '${ids.tenantB}', 'Escola B1');

      INSERT INTO public.units (id, tenant_id, institution_id, name, status) VALUES
        ('${ids.unitA1}', '${ids.tenantA}', '${ids.instA1}', 'Restaurante A1', 'active'),
        ('${ids.unitA2}', '${ids.tenantA}', '${ids.instA1}', 'Restaurante A2', 'active'),
        ('${ids.unitB1}', '${ids.tenantB}', '${ids.instB1}', 'Restaurante B1', 'active');

      INSERT INTO auth.users (id, email) VALUES
        ('${ids.finA}', 'fin-a@synthetic.invalid'),
        ('${ids.dirA}', 'dir-a@synthetic.invalid'),
        ('${ids.opA1}', 'op-a@synthetic.invalid'),
        ('${ids.inactA}', 'inact-a@synthetic.invalid'),
        ('${ids.finB}', 'fin-b@synthetic.invalid');

      INSERT INTO public.profiles (id, tenant_id, full_name, role, status) VALUES
        ('${ids.finA}', '${ids.tenantA}', 'Financeiro A', 'finance', 'active'),
        ('${ids.dirA}', '${ids.tenantA}', 'Diretor A', 'operations_director', 'active'),
        ('${ids.opA1}', '${ids.tenantA}', 'Operador A1', 'operator', 'active'),
        ('${ids.inactA}', '${ids.tenantA}', 'Financeiro Inativo', 'finance', 'inactive'),
        ('${ids.finB}', '${ids.tenantB}', 'Financeiro B', 'finance', 'active');

      INSERT INTO public.student_categories (id, tenant_id, code, name, requires_wallet) VALUES
        ('${ids.catA}', '${ids.tenantA}', 'PARCIAL', 'Parcial', true);

      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status) VALUES
        ('${ids.stdA1}', '${ids.tenantA}', '${ids.instA1}', '${ids.catA}', 'Comensal Sintético', 'RA2083', 'active');

      INSERT INTO public.wallets (id, tenant_id, student_id, balance) VALUES
        ('${ids.walA1}', '${ids.tenantA}', '${ids.stdA1}', 30.00);

      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, reference_type, reference_id, description, created_by, created_at) VALUES
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 50.00, 0.00, 50.00, 'payment', '${ids.payPix}', 'Recarga Pix sintética', '${ids.finA}', ${safeYesterdayTs}::timestamptz),
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'meal_debit', -20.00, 50.00, 30.00, 'meal_consumption', NULL, 'Débito refeição sintética', '${ids.opA1}', ${safeYesterdayTs}::timestamptz);

      INSERT INTO public.payment_providers (id, tenant_id, code, name) VALUES
        ('${ids.provA}', '${ids.tenantA}', 'asaas', 'Asaas Sintético');

      INSERT INTO public.payments (id, tenant_id, student_id, provider_id, method, amount, status, confirmed_at, created_at) VALUES
        ('${ids.payPix}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'pix', 50.00, 'confirmed', ${safeYesterdayTs}::timestamptz, ${safeYesterdayTs}::timestamptz),
        ('${ids.payCard}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'credit_card', 25.00, 'confirmed', ${safeYesterdayTs}::timestamptz, ${safeYesterdayTs}::timestamptz);

      INSERT INTO public.meal_types (id, tenant_id, code, name) VALUES
        ('${ids.mealAlm}', '${ids.tenantA}', 'lunch', 'Almoço');

      INSERT INTO public.meal_consumptions (tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id, consumption_date, consumed_at, full_price, student_price, subsidy_amount, operator_id, status) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.instA1}', '${ids.stdA1}', '${ids.catA}', '${ids.mealAlm}', ${safeYesterdayDate}::date, ${safeYesterdayTs}::timestamptz, 15.00, 10.00, 5.00, '${ids.opA1}', 'approved'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.instA1}', '${ids.stdA1}', '${ids.catA}', '${ids.mealAlm}', ${safeYesterdayDate}::date, ${safeYesterdayTs}::timestamptz, 12.00, 8.00, 4.00, '${ids.opA1}', 'approved');

      INSERT INTO public.contingency_meal_batches (id, tenant_id, unit_id, meal_type_id, service_date, batch_type, total_meals_served, category_id, unit_price, subsidy_price, total_amount, total_subsidy_amount, justification, operator_id, status, approved_by, approved_at) VALUES
        ('${ids.batchA1}', '${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', ${safeYesterdayDate}::date, 'type_b_unidentified_count', 2, '${ids.catA}', 10.00, 6.00, 20.00, 12.00, 'Contingência sintética homologação', '${ids.opA1}', 'approved', '${ids.dirA}', ${safeYesterdayTs}::timestamptz);
    `);

    // 3. Controle de Acesso, Tenant Isolation e Validações Fail-Closed
    await expectFailTx(
      () => asRoleTx(pool, 'anon', '', (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Tentativa anonima'])),
      /AUTH_REQUIRED|permission denied/i,
      'Papel anon é bloqueado em close_financial_daily_period'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', '', (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Sem uid autenticado'])),
      /AUTH_REQUIRED/,
      'Chamada authenticated sem JWT sub é rejeitada'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.inactA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Perfil inativo tentando fechar'])),
      /ACTIVE_PROFILE_REQUIRED/,
      'Perfil financeiro inativo é bloqueado'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.opA1, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Operador tentando fechar dia'])),
      /PERMISSION_DENIED/,
      'Operador não autorizado é bloqueado (PERMISSION_DENIED)'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finB, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Acesso cruzado tenant B'])),
      /TENANT_MISMATCH/,
      'Financeiro do Tenant B não pode fechar período do Tenant A'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, ids.unitB1, 'Unidade de outro tenant'])),
      /UNIT_TENANT_MISMATCH/,
      'Unidade de outro tenant é bloqueada (UNIT_TENANT_MISMATCH)'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, tomorrowBr, null, 'Tentativa data futura'])),
      /INVALID_CLOSING_DATE/,
      'Tentativa de fechamento em data futura é bloqueada'
    );

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'ok'])),
      /JUSTIFICATION_REQUIRED/,
      'Justificativa curta (<5 caracteres) é bloqueada'
    );

    // 4. Persistência por unidade + Idempotência
    const closeUnitRes = await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4) AS res', [ids.tenantA, yesterdayBr, ids.unitA1, 'Fechamento auditado da Unidade A1'])
    );
    const closeUnitPayload = closeUnitRes.rows[0].res;
    check(closeUnitPayload && closeUnitPayload.status === 'closed' && closeUnitPayload.health_status === 'balanced', 'Fechamento da Unidade A1 persistido com status equilibrado', `id=${closeUnitPayload.id}`);

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.dirA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, ids.unitA1, 'Duplicidade unidade A1'])),
      /DAILY_CLOSING_ALREADY_EXISTS/,
      'Fechamento duplicado para mesma data e unidade é bloqueado'
    );

    // 5. Persistência Consolidada (unit_id IS NULL) + Índice Único Parcial
    const closeConsRes = await asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
      c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4) AS res', [ids.tenantA, yesterdayBr, null, 'Fechamento consolidado de ontem'])
    );
    check(closeConsRes.rows[0].res.status === 'closed', 'Fechamento consolidado (unit_id NULL) persistido');

    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) => c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4)', [ids.tenantA, yesterdayBr, null, 'Duplicidade consolidada NULL'])),
      /DAILY_CLOSING_ALREADY_EXISTS/,
      'Índice único parcial bloqueia duplicidade consolidada (unit_id IS NULL)'
    );

    // 6. Consulta histórica com segregação contábil e RLS multi-tenant
    const rowsA = await asRoleTx(pool, 'authenticated', ids.finA, (c) =>
      c.query(
        `SELECT unit_id, pix_receipts_amount, card_receipts_amount, total_receipts_by_method,
                wallet_credits_added, wallet_debits_consumed, closing_custody_balance, custody_ledger_drift,
                realized_student_revenue, contractual_subsidies, contingency_subsidies, status, closed_by, metadata
         FROM public.financial_daily_closings
         WHERE closing_date = $1
         ORDER BY unit_id NULLS LAST`,
        [yesterdayBr]
      )
    );
    check(rowsA.rowCount === 2, 'Consulta histórica retorna ambos os fechamentos do Tenant A', `rows=${rowsA.rowCount}`);

    const unitRow = rowsA.rows[0];
    const consRow = rowsA.rows[1];
    check(
      Number(unitRow.pix_receipts_amount) === 50 &&
        Number(unitRow.card_receipts_amount) === 25 &&
        Number(unitRow.total_receipts_by_method) === 75 &&
        Number(unitRow.wallet_credits_added) === 50 &&
        Number(unitRow.wallet_debits_consumed) === 20 &&
        Number(unitRow.closing_custody_balance) === 30 &&
        Number(unitRow.custody_ledger_drift) === 0 &&
        Number(unitRow.realized_student_revenue) === 10 &&
        Number(unitRow.contractual_subsidies) === 5 &&
        Number(unitRow.contingency_subsidies) === 12 &&
        unitRow.closed_by === ids.finA &&
        unitRow.metadata.scope === 'unit',
      'Fechamento da Unidade A1 segrega corretamente recebimentos, custódia, receita realizada e subsídios'
    );

    check(
      consRow.unit_id === null &&
        Number(consRow.realized_student_revenue) === 18 &&
        Number(consRow.contractual_subsidies) === 9 &&
        Number(consRow.contingency_subsidies) === 12 &&
        consRow.metadata.scope === 'consolidated',
      'Fechamento consolidado soma corretamente múltiplas unidades sem inflar custódia'
    );

    const rowsB = await asRoleTx(pool, 'authenticated', ids.finB, (c) =>
      c.query('SELECT id FROM public.financial_daily_closings')
    );
    check(rowsB.rowCount === 0, 'RLS multi-tenant oculta fechamentos do Tenant A para Tenant B');

    const rowsOp = await asRoleTx(pool, 'authenticated', ids.opA1, (c) =>
      c.query('SELECT id FROM public.financial_daily_closings')
    );
    check(rowsOp.rowCount === 0, 'RLS bloqueia leitura de financial_daily_closings para papel operator');

    // 7. Concorrência simultânea real entre duas transações concorrentes (today_br)
    const [race1, race2] = await Promise.allSettled([
      asRoleTx(pool, 'authenticated', ids.finA, (c) =>
        c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4) AS res', [ids.tenantA, todayBr, null, 'Disparo simultaneo A'])
      ),
      asRoleTx(pool, 'authenticated', ids.dirA, (c) =>
        c.query('SELECT public.close_financial_daily_period($1,$2,$3,$4) AS res', [ids.tenantA, todayBr, null, 'Disparo simultaneo B'])
      ),
    ]);
    const fulfilledCount = [race1, race2].filter((r) => r.status === 'fulfilled').length;
    const rejectedErrors = [race1, race2].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    const todayRows = await pool.query('SELECT COUNT(*)::int AS cnt FROM public.financial_daily_closings WHERE tenant_id = $1 AND closing_date = $2 AND unit_id IS NULL', [ids.tenantA, todayBr]);
    check(
      fulfilledCount === 1 &&
        rejectedErrors.length === 1 &&
        /DAILY_CLOSING_ALREADY_EXISTS/.test(rejectedErrors[0]) &&
        todayRows.rows[0].cnt === 1,
      'Concorrência simultânea garante exatamente 1 gravação e erro determinístico DAILY_CLOSING_ALREADY_EXISTS na segunda',
      `fulfilled=${fulfilledCount}, rows=${todayRows.rows[0].cnt}`
    );

    // 8. Integridade do ledger/saldos (zero mutações retroativas)
    const integrityRes = await pool.query(`
      SELECT
        (SELECT SUM(balance)::numeric(12,2) FROM public.wallets WHERE tenant_id = '${ids.tenantA}') AS wallets_sum,
        (SELECT SUM(amount)::numeric(12,2) FROM public.wallet_transactions WHERE tenant_id = '${ids.tenantA}') AS ledger_sum,
        (SELECT COUNT(*)::int FROM public.wallet_transactions WHERE tenant_id = '${ids.tenantA}') AS ledger_count
    `);
    const integ = integrityRes.rows[0];
    check(
      Number(integ.wallets_sum) === 30 && Number(integ.ledger_sum) === 30 && integ.ledger_count === 2,
      'Fechamentos diários preservam integralmente carteiras e wallet_transactions sem ajustes ocultos'
    );

    // 9. Preservação de registros imutáveis (UPDATE/DELETE/INSERT direto bloqueados)
    await expectFailTx(
      () => asRoleTx(pool, 'authenticated', ids.finA, (c) => c.query('UPDATE public.financial_daily_closings SET realized_student_revenue = 999.00')),
      /permission denied|IMMUTABLE_DAILY_CLOSING/i,
      'Authenticated bloqueado de alterar financial_daily_closings'
    );

    await expectFailTx(
      () => pool.query('UPDATE public.financial_daily_closings SET realized_student_revenue = 999.00 WHERE tenant_id = $1', [ids.tenantA]),
      /IMMUTABLE_DAILY_CLOSING/,
      'Trigger de imutabilidade bloqueia UPDATE até para owner/service_role'
    );

    await expectFailTx(
      () => pool.query('DELETE FROM public.financial_daily_closings WHERE tenant_id = $1', [ids.tenantA]),
      /IMMUTABLE_DAILY_CLOSING/,
      'Trigger de imutabilidade bloqueia DELETE até para owner/service_role'
    );

    const summary = {
      passed,
      failed,
      total: passed + failed,
      serverMeta,
      executedAt: new Date().toISOString(),
      results,
    };

    if (evidenceJsonPath) {
      fs.mkdirSync(path.dirname(evidenceJsonPath), { recursive: true });
      fs.writeFileSync(evidenceJsonPath, JSON.stringify(summary, null, 2));
    }

    console.log(`\nMIGRATION 83 TRANSACTIONAL HOMOLOGATION: ${passed}/${passed + failed} PASS (${failed} failures)`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

