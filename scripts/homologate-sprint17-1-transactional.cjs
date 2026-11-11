/**
 * ==============================================================================
 * SPRINT 17.1 — HOMOLOGAÇÃO TRANSACIONAL EM POSTGRESQL 17 DESCARTÁVEL
 * Executa os 10 cenários reais com papéis sem SUPERUSER e sem BYPASSRLS.
 *
 * RESTRIÇÕES DE SEGURANÇA:
 * - Aceita somente loopback local (127.0.0.1, localhost, ::1).
 * - Exige banco descartável prefixado com sprint17_1_ e validação do data_dir.
 * - Bloqueia explicitamente qualquer URL de Supabase remoto ou produção.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const pgUrl = process.env.DISPOSABLE_PG_URL;
const expectedDataDir = process.env.SPRINT17_1_EXPECTED_DATA_DIR || '';
const expectedPort = Number(process.env.SPRINT17_1_EXPECTED_PORT || 0);
const evidenceJsonPath = process.env.SPRINT17_1_EVIDENCE_JSON || '';

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
if (!target.pathname.slice(1).startsWith('sprint17_1_')) {
  throw new Error(`Banco recusado: ${target.pathname}. Nome deve iniciar com sprint17_1_.`);
}

const readSql = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

const results = [];
let passed = 0;
let failed = 0;

function pass(name, detail = '') {
  passed += 1;
  results.push({ name, passed: true, detail });
  console.log(`PASS ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
}

function check(cond, name, detail = '') {
  if (cond) {
    pass(name, detail);
  } else {
    failed += 1;
    results.push({ name, passed: false, detail });
    console.error(`FAIL ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

async function asRole(client, role, userId, work) {
  await client.query('SAVEPOINT sp_role');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', $1, true)", [role]);
    const res = await work();
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT sp_role');
    return res;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_role');
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT sp_role');
    throw err;
  }
}

async function asOwner(client, work) {
  await client.query('SAVEPOINT sp_owner');
  try {
    const res = await work();
    await client.query('RELEASE SAVEPOINT sp_owner');
    return res;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_owner');
    await client.query('RELEASE SAVEPOINT sp_owner');
    throw err;
  }
}

async function expectFail(fn, expectedPattern, label, expectedCode = null) {
  let errCaught = null;
  try {
    await fn();
  } catch (err) {
    errCaught = err;
  }
  if (!errCaught) {
    check(false, label, 'operação deveria ter sido bloqueada');
    return;
  }
  if (expectedCode && errCaught.code !== expectedCode) {
    check(false, label, `esperado SQLSTATE ${expectedCode}, recebido ${errCaught.code}: ${errCaught.message}`);
    return;
  }
  if (expectedPattern && !expectedPattern.test(errCaught.message)) {
    check(false, label, `esperado ${expectedPattern}, recebido: ${errCaught.message}`);
    return;
  }
  check(true, label, errCaught.code || 'blocked');
}

async function main() {
  const client = new Client({ connectionString: pgUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();

  let serverMeta = {};
  try {
    // 0. Validações de Ambiente Descartável (Estilo Stage 7C.2 / 8A.4)
    const metaRes = await client.query(`
      SELECT
        pg_catalog.current_setting('server_version_num')::int AS version_num,
        pg_catalog.current_setting('data_directory') AS data_dir,
        pg_catalog.current_setting('listen_addresses') AS listen_addresses,
        pg_catalog.host(pg_catalog.inet_server_addr())::text AS addr,
        pg_catalog.inet_server_port()::int AS port,
        pg_catalog.current_database() AS db_name
    `);
    const meta = metaRes.rows[0];
    serverMeta = { versionNum: meta.version_num, addr: meta.addr, listenAddresses: meta.listen_addresses, port: meta.port };

    check(meta.version_num >= 170000 && meta.version_num < 180000, 'PostgreSQL 17 descartável confirmado', `v${meta.version_num}`);
    check(
      !expectedDataDir || path.resolve(meta.data_dir).toLowerCase() === path.resolve(expectedDataDir).toLowerCase(),
      'Data directory exclusivo descartável confirmado'
    );
    check(
      meta.addr === '127.0.0.1' && meta.listen_addresses === '127.0.0.1' && (!expectedPort || meta.port === expectedPort),
      'Listener restrito a loopback',
      `${meta.addr}:${meta.port}`
    );

    await client.query('BEGIN');

    // 1. Aplicar Baseline + Migrations 77 -> 78 -> 79 -> 80 -> 81
    await client.query(readSql('scripts/sql/sprint17_1_disposable_pg17_baseline.sql'));

    const roleRes = await client.query(`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('authenticated', 'anon')
      ORDER BY rolname
    `);
    const restrictedOk =
      roleRes.rowCount === 2 &&
      roleRes.rows.every((r) => r.rolsuper === false && r.rolbypassrls === false);
    check(restrictedOk, 'Papéis authenticated e anon sem SUPERUSER ou BYPASSRLS');

    await client.query(readSql('supabase/migrations/20261029000077_create_contingency_regularization.sql'));
    await client.query(readSql('supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql'));
    await client.query(readSql('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql'));
    await client.query(readSql('supabase/migrations/20261109000080_create_financial_reconciliation.sql'));
    await client.query(readSql('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql'));
    check(true, 'Cadeia de migrations 77 -> 78 -> 79 -> 80 -> 81 compilada sobre baseline');

    // 2. Massa Sintética (Tenant A com 2 Instituições/Unidades vs Tenant B)
    const ids = {
      tenantA: 'a0000000-0000-4000-8000-000000000001',
      tenantB: 'b0000000-0000-4000-8000-000000000002',
      instA1:  'a1000000-0000-4000-8000-000000000001',
      instA2:  'a1000000-0000-4000-8000-000000000002',
      instB1:  'b1000000-0000-4000-8000-000000000001',
      unitA1:  'a2000000-0000-4000-8000-000000000001',
      unitA2:  'a2000000-0000-4000-8000-000000000002',
      unitB1:  'b2000000-0000-4000-8000-000000000001',
      dirA:    'a3000000-0000-4000-8000-000000000001',
      finA:    'a3000000-0000-4000-8000-000000000002',
      supA1:   'a3000000-0000-4000-8000-000000000003',
      mgrA1:   'a3000000-0000-4000-8000-000000000004',
      opA1:    'a3000000-0000-4000-8000-000000000005',
      inactA:  'a3000000-0000-4000-8000-000000000006',
      finB:    'b3000000-0000-4000-8000-000000000001',
      catIntA: 'a4000000-0000-4000-8000-000000000001',
      catParA: 'a4000000-0000-4000-8000-000000000002',
      stdA1:   'a5000000-0000-4000-8000-000000000001',
      stdA2:   'a5000000-0000-4000-8000-000000000002',
      walA1:   'a6000000-0000-4000-8000-000000000001',
      mealAlm: 'a7000000-0000-4000-8000-000000000001',
      provA:   'a8000000-0000-4000-8000-000000000001',
      payMatch:'a9000000-0000-4000-8000-000000000001',
      payMiss: 'a9000000-0000-4000-8000-000000000002',
      payMis:  'a9000000-0000-4000-8000-000000000003',
      payRef:  'a9000000-0000-4000-8000-000000000004',
      payCan:  'a9000000-0000-4000-8000-000000000005',
      payOrph: 'a9000000-0000-4000-8000-000000000099',
    };

    await client.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES
        ('${ids.tenantA}', 'Tenant Alfa', 'alfa'),
        ('${ids.tenantB}', 'Tenant Beta', 'beta');
      INSERT INTO public.institutions (id, tenant_id, name) VALUES
        ('${ids.instA1}', '${ids.tenantA}', 'UF Alfa 1'),
        ('${ids.instA2}', '${ids.tenantA}', 'UF Alfa 2'),
        ('${ids.instB1}', '${ids.tenantB}', 'UF Beta 1');
      INSERT INTO public.units (id, tenant_id, institution_id, name) VALUES
        ('${ids.unitA1}', '${ids.tenantA}', '${ids.instA1}', 'RU Unidade A1'),
        ('${ids.unitA2}', '${ids.tenantA}', '${ids.instA2}', 'RU Unidade A2'),
        ('${ids.unitB1}', '${ids.tenantB}', '${ids.instB1}', 'RU Unidade B1');
      INSERT INTO public.profiles (id, tenant_id, full_name, role, status) VALUES
        ('${ids.dirA}', '${ids.tenantA}', 'Diretor Alfa', 'operations_director', 'active'),
        ('${ids.finA}', '${ids.tenantA}', 'Financeiro Alfa', 'finance', 'active'),
        ('${ids.supA1}', '${ids.tenantA}', 'Supervisor A1', 'supervisor', 'active'),
        ('${ids.mgrA1}', '${ids.tenantA}', 'Gerente A1', 'unit_manager', 'active'),
        ('${ids.opA1}', '${ids.tenantA}', 'Operador A1', 'operator', 'active'),
        ('${ids.inactA}', '${ids.tenantA}', 'Inativo Alfa', 'finance', 'inactive'),
        ('${ids.finB}', '${ids.tenantB}', 'Financeiro Beta', 'finance', 'active');
      INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
        ('${ids.tenantA}', '${ids.supA1}', '${ids.unitA1}'),
        ('${ids.tenantA}', '${ids.mgrA1}', '${ids.unitA1}');
      INSERT INTO public.student_categories (id, tenant_id, code, name, requires_wallet) VALUES
        ('${ids.catIntA}', '${ids.tenantA}', 'integral', 'Bolsista Integral', false),
        ('${ids.catParA}', '${ids.tenantA}', 'partial', 'Bolsista Parcial', true);
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number) VALUES
        ('${ids.stdA1}', '${ids.tenantA}', '${ids.instA1}', '${ids.catParA}', 'Comensal Parcial', '2026001'),
        ('${ids.stdA2}', '${ids.tenantA}', '${ids.instA2}', '${ids.catIntA}', 'Comensal Integral', '2026002');
      INSERT INTO public.wallets (id, tenant_id, student_id, balance) VALUES
        ('${ids.walA1}', '${ids.tenantA}', '${ids.stdA1}', 96.00);
      INSERT INTO public.meal_types (id, tenant_id, code, name, status) VALUES
        ('${ids.mealAlm}', '${ids.tenantA}', 'lunch', 'Almoço', 'active');
      INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealAlm}');
      INSERT INTO public.meal_rules (tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, effective_from) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealAlm}', '${ids.catParA}', 13.50, 4.00, 9.50, now() - INTERVAL '1 day'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealAlm}', '${ids.catIntA}', 13.50, 0.00, 13.50, now() - INTERVAL '1 day');
      INSERT INTO public.payment_providers (id, tenant_id, code, name) VALUES
        ('${ids.provA}', '${ids.tenantA}', 'asaas', 'Asaas');
      INSERT INTO public.payments (id, tenant_id, student_id, provider_id, external_payment_id, method, amount, status, raw_response, confirmed_at) VALUES
        ('${ids.payMatch}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'ext-1', 'pix', 100.00, 'confirmed', '{"fee": "2.50"}'::jsonb, now()),
        ('${ids.payMiss}',  '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'ext-2', 'pix', 50.00,  'confirmed', '{}'::jsonb, now());
      INSERT INTO public.recharges (tenant_id, student_id, wallet_id, payment_id, amount, status, source, confirmed_at) VALUES
        ('${ids.tenantA}', '${ids.stdA1}', '${ids.walA1}', '${ids.payMatch}', 100.00, 'confirmed', 'pix', now());
      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, reference_type, reference_id, description) VALUES
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge',   100.00,  0.00, 100.00, 'payment', '${ids.payMatch}', 'Recarga Pix'),
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'meal_debit',  -4.00, 100.00, 96.00, 'meal',    gen_random_uuid(), 'Consumo Almoço');
      INSERT INTO public.meal_consumptions (tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id, consumption_date, full_price, student_price, subsidy_amount, operator_id) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.instA1}', '${ids.stdA1}', '${ids.catParA}', '${ids.mealAlm}', CURRENT_DATE, 13.50, 4.00, 9.50, '${ids.opA1}');
      INSERT INTO public.blocked_attempts (tenant_id, unit_id, student_id, category_id, meal_type_id, reason_code, reason_message, operator_id) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.stdA1}', '${ids.catParA}', '${ids.mealAlm}', 'ALREADY_CONSUMED_TODAY', 'Já consumiu', '${ids.opA1}');
      INSERT INTO storage.objects (bucket_id, name, owner) VALUES
        ('contingency-evidence', '${ids.tenantA}/ata-a1.pdf', '${ids.mgrA1}'),
        ('contingency-evidence', '${ids.tenantB}/ata-b1.pdf', '${ids.finB}');
    `);

    // CENÁRIO 1: Isolamento Multi-Tenant, Instituição, Unidade e Storage
    await expectFail(
      () => asRole(client, 'authenticated', ids.finB, () =>
        client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE)', [ids.tenantA])
      ),
      /TENANT_MISMATCH/,
      'C1.1 Financeiro Tenant B bloqueado no relatório de Tenant A'
    );
    await expectFail(
      () => asRole(client, 'authenticated', ids.mgrA1, () =>
        client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE, NULL, $2)', [ids.tenantA, ids.unitA2])
      ),
      /ACCESS_DENIED_UNIT/,
      'C1.2 Gerente A1 bloqueado na Unidade A2 no relatório financeiro'
    );
    const storageRes = await asRole(client, 'authenticated', ids.mgrA1, () =>
      client.query("SELECT name FROM storage.objects WHERE bucket_id = 'contingency-evidence'")
    );
    check(
      storageRes.rowCount === 1 && storageRes.rows[0].name.startsWith(ids.tenantA),
      'C1.3a Storage bucket contingency-evidence isola SELECT por tenant_id'
    );
    await expectFail(
      () => asRole(client, 'authenticated', ids.mgrA1, () =>
        client.query("INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('contingency-evidence', $1, $2)", [`${ids.tenantB}/hack.pdf`, ids.mgrA1])
      ),
      /42501|row-level security/,
      'C1.3b Storage bucket contingency-evidence bloqueia INSERT cruzado em Tenant B'
    );

    // CENÁRIO 2: Contingência — Bloqueio de Autoaprovação e Imutabilidade Pós-Deliberação
    const subMgrRes = await asRole(client, 'authenticated', ids.mgrA1, () =>
      client.query(
        "SELECT public.submit_contingency_batch($1, $2, CURRENT_DATE, 'type_b_unidentified_count', 10, $3, 'Queda de energia elétrica verificada no turno.') AS res",
        [ids.unitA1, ids.mealAlm, ids.catParA]
      )
    );
    const batchId = subMgrRes.rows[0].res.batch_id;
    check(subMgrRes.rows[0].res.success === true && Boolean(batchId), 'C2.1 Gerente submete contingência com meal_rules/meal_types válidos');

    await expectFail(
      () => asRole(client, 'authenticated', ids.mgrA1, () =>
        client.query("UPDATE public.contingency_meal_batches SET status = 'approved' WHERE id = $1", [batchId])
      ),
      /42501|row-level security|FORBIDDEN_APPROVAL/,
      'C2.2 Gerente bloqueado ao tentar autoaprovar via UPDATE direto (WITH CHECK)'
    );

    const revByMgr = await asRole(client, 'authenticated', ids.mgrA1, () =>
      client.query("SELECT public.review_contingency_batch($1, 'approve') AS res", [batchId])
    );
    check(revByMgr.rows[0].res.error === 'FORBIDDEN', 'C2.3 Gerente bloqueado na RPC review_contingency_batch');

    const subDirRes = await asRole(client, 'authenticated', ids.dirA, () =>
      client.query(
        "SELECT public.submit_contingency_batch($1, $2, CURRENT_DATE, 'type_b_unidentified_count', 2, $3, 'Lote submetido pelo próprio diretor para teste.') AS res",
        [ids.unitA1, ids.mealAlm, ids.catParA]
      )
    );
    const selfRevRes = await asRole(client, 'authenticated', ids.dirA, () =>
      client.query("SELECT public.review_contingency_batch($1, 'approve') AS res", [subDirRes.rows[0].res.batch_id])
    );
    check(selfRevRes.rows[0].res.error === 'SELF_APPROVAL_PROHIBITED', 'C2.4 Segregação de funções impede diretor de aprovar próprio lote');

    const okRevRes = await asRole(client, 'authenticated', ids.dirA, () =>
      client.query("SELECT public.review_contingency_batch($1, 'approve') AS res", [batchId])
    );
    check(okRevRes.rows[0].res.success === true && okRevRes.rows[0].res.status === 'approved', 'C2.5 Diretor aprova lote de gerente (10 refeições = R$ 95,00 subsídio)');

    await expectFail(
      () => asRole(client, 'authenticated', ids.dirA, () =>
        client.query("UPDATE public.contingency_meal_batches SET total_subsidy_amount = 99999 WHERE id = $1", [batchId])
      ),
      /CONTINGENCY_IMMUTABLE/,
      'C2.6 Lote aprovado torna-se imutável pela trigger prevent_contingency_tampering'
    );

    // CENÁRIO 3: Imutabilidade do Ledger (UPDATE, DELETE, TRUNCATE bloqueados + INSERT legítimo)
    await expectFail(
      () => asRole(client, 'authenticated', ids.finA, () =>
        client.query("UPDATE public.wallet_transactions SET amount = 999.00 WHERE tenant_id = $1", [ids.tenantA])
      ),
      null,
      'C3.1 authenticated bloqueado em UPDATE de wallet_transactions'
    );
    await expectFail(
      () => asOwner(client, () => client.query("DELETE FROM public.wallet_transactions WHERE tenant_id = $1", [ids.tenantA])),
      /LEDGER_IMMUTABLE/,
      'C3.2 Trigger bloqueia DELETE em wallet_transactions até para proprietário'
    );
    await expectFail(
      () => asOwner(client, () => client.query("TRUNCATE public.wallet_transactions")),
      /cannot truncate a table referenced in a foreign key constraint/i,
      'C3.3a TRUNCATE sem CASCADE bloqueado pela constraint FK (0A000)',
      '0A000'
    );
    await expectFail(
      () => asOwner(client, () => client.query("TRUNCATE public.wallet_transactions CASCADE")),
      /LEDGER_IMMUTABLE/,
      'C3.3b TRUNCATE CASCADE bloqueado pela trigger BEFORE TRUNCATE (LEDGER_IMMUTABLE)',
      '42501'
    );

    await client.query('SAVEPOINT sp_legit_tx');
    await client.query(`
      UPDATE public.wallets SET balance = 92.00 WHERE id = '${ids.walA1}';
      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, reference_type, reference_id, description)
      VALUES ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'meal_debit', -4.00, 96.00, 92.00, 'meal', gen_random_uuid(), 'Débito legítimo');
    `);
    const legitCheck = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.audit_wallet_custody_integrity($1) AS res', [ids.tenantA])
    );
    check(legitCheck.rows[0].res.is_patrimony_balanced === true && Number(legitCheck.rows[0].res.wallets_custody_balance) === 92.00, 'C3.4 Caminho legítimo append-only de lançamento no ledger funciona');
    await client.query('ROLLBACK TO SAVEPOINT sp_legit_tx');
    await client.query('RELEASE SAVEPOINT sp_legit_tx');

    // CENÁRIO 4: Consistência Carteiras vs Ledger & Detecção de Deriva (Drift)
    const custOk = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.audit_wallet_custody_integrity($1) AS res', [ids.tenantA])
    );
    check(
      custOk.rows[0].res.is_patrimony_balanced === true &&
      Number(custOk.rows[0].res.wallets_custody_balance) === 96.00 &&
      Number(custOk.rows[0].res.ledger_net_sum) === 96.00,
      'C4.1 Batimento patrimonial 1:1 equilibrado (96.00 = 100.00 - 4.00)'
    );

    await client.query('SAVEPOINT sp_drift');
    await client.query(`UPDATE public.wallets SET balance = 106.00 WHERE id = '${ids.walA1}'`);
    const custDrift = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.audit_wallet_custody_integrity($1) AS res', [ids.tenantA])
    );
    check(
      custDrift.rows[0].res.is_patrimony_balanced === false &&
      Number(custDrift.rows[0].res.custody_drift) === 10.00 &&
      Number(custDrift.rows[0].res.inconsistent_wallets_count) === 1,
      'C4.2 audit_wallet_custody_integrity detecta deriva patrimonial (+10.00)'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_drift');
    await client.query('RELEASE SAVEPOINT sp_drift');

    // CENÁRIO 5 & 6: Segregação Contábil e Filtros da RPC Financeira
    const repFull = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE) AS res', [ids.tenantA])
    );
    const sum = repFull.rows[0].res.summary;
    check(
      Number(sum.student_paid_amount) === 4.00 &&
      Number(sum.regular_subsidy_amount) === 9.50 &&
      Number(sum.contingency_subsidy_amount) === 95.00 &&
      Number(sum.recharges_in_period) === 100.00 &&
      Number(sum.current_custody_liability) === 96.00 &&
      Number(sum.gateway_processing_fees) === 2.50,
      'C5.1/C6.1 Relatório fiscal segrega receita (4.00), subsídio (104.50), recargas (100.00), custódia (96.00) e taxa JSON (2.50)'
    );

    const repInst2 = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE, $2) AS res', [ids.tenantA, ids.instA2])
    );
    check(
      Number(repInst2.rows[0].res.summary.total_meals_delivered) === 0 &&
      Number(repInst2.rows[0].res.summary.recharges_in_period) === 0,
      'C6.2 Filtro por instituição A2 exclui consumos, contingência e recargas da instituição A1'
    );

    // CENÁRIO 7: Conciliação, Divergências Variadas e Idempotência
    await client.query(`
      INSERT INTO public.payments (id, tenant_id, student_id, provider_id, external_payment_id, method, amount, status) VALUES
        ('${ids.payMis}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'ext-3', 'pix', 50.00, 'confirmed'),
        ('${ids.payRef}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'ext-4', 'pix', 30.00, 'refunded'),
        ('${ids.payCan}', '${ids.tenantA}', '${ids.stdA1}', '${ids.provA}', 'ext-5', 'pix', 20.00, 'cancelled');
      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, reference_type, reference_id, description) VALUES
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 40.00, 96.00, 136.00, 'payment', '${ids.payMis}', 'Mismatch'),
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 30.00, 136.00, 166.00, 'payment', '${ids.payRef}', 'Sem estorno'),
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 20.00, 166.00, 186.00, 'payment', '${ids.payCan}', 'Cancelada com crédito'),
        ('${ids.tenantA}', '${ids.walA1}', '${ids.stdA1}', 'recharge', 15.00, 186.00, 201.00, 'payment', '${ids.payOrph}', 'Órfã');
    `);

    const rec1 = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.run_financial_reconciliation_audit($1, CURRENT_DATE, CURRENT_DATE) AS res', [ids.tenantA])
    );
    const rec2 = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT public.run_financial_reconciliation_audit($1, CURRENT_DATE, CURRENT_DATE) AS res', [ids.tenantA])
    );
    const divTypesRes = await asRole(client, 'authenticated', ids.finA, () =>
      client.query('SELECT DISTINCT divergence_type::text AS t FROM public.financial_reconciliation_divergences WHERE batch_id = $1 ORDER BY 1', [rec1.rows[0].res.batch_id])
    );
    const types = divTypesRes.rows.map((r) => r.t);
    check(
      rec1.rows[0].res.matched_count === 1 &&
      rec1.rows[0].res.divergences_count === 5 &&
      rec2.rows[0].res.divergences_count === 5 &&
      types.includes('missing_ledger_credit') &&
      types.includes('amount_mismatch') &&
      types.includes('refund_mismatch') &&
      types.includes('cancelled_with_credit') &&
      types.includes('orphan_ledger_credit'),
      'C7.1 Conciliação detecta todos os 5 tipos de divergência e re-execução é idempotente sem mutar ledger'
    );

    // CENÁRIO 8: Permissões Efetivas das Funções SECURITY DEFINER (pg_proc)
    const aclRes = await client.query(`
      SELECT p.proname,
             p.prosecdef,
             COALESCE(array_to_string(p.proconfig, ','), '') AS cfg,
             EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
             ) AS public_exec,
             EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
               WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE'
             ) AS anon_exec
      FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN (
          'get_consolidated_financial_report',
          'run_financial_reconciliation_audit',
          'audit_wallet_custody_integrity',
          'get_realtime_operational_dashboard',
          'submit_contingency_batch',
          'review_contingency_batch'
        )
    `);
    const aclsOk =
      aclRes.rowCount === 6 &&
      aclRes.rows.every((r) => r.prosecdef === true && r.cfg.includes('search_path=') && r.public_exec === false && r.anon_exec === false);
    check(aclsOk, 'C8.1 Todas as 6 RPCs críticas têm SECURITY DEFINER, search_path="" e zero EXECUTE para PUBLIC/anon');

    // CENÁRIO 9: Rejeição de anon, inativo, sem escopo e operator
    await expectFail(
      () => asRole(client, 'anon', null, () =>
        client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE)', [ids.tenantA])
      ),
      /permission denied/,
      'C9.1 Papel anon bloqueado por ACL nas RPCs'
    );
    await expectFail(
      () => asRole(client, 'authenticated', ids.inactA, () =>
        client.query('SELECT public.audit_wallet_custody_integrity($1)', [ids.tenantA])
      ),
      /ACTIVE_PROFILE_REQUIRED/,
      'C9.2 Usuário inativo bloqueado em audit_wallet_custody_integrity'
    );
    await expectFail(
      () => asRole(client, 'authenticated', ids.supA1, () =>
        client.query('SELECT public.get_consolidated_financial_report($1, CURRENT_DATE, CURRENT_DATE)', [ids.tenantA])
      ),
      /UNIT_SCOPE_REQUIRED/,
      'C9.3 Supervisor sem unidade é bloqueado fail-closed'
    );
    const opSigRes = await asRole(client, 'authenticated', ids.opA1, () =>
      client.query('SELECT count(*)::int AS c FROM public.operational_dashboard_signals')
    );
    check(opSigRes.rows[0].c === 0, 'C9.4 Operador de terminal é excluído de operational_dashboard_signals');

    // CENÁRIO 10: Fluxos Autorizados, Publicação Realtime sem PII & Rollback Seguro
    const dashRes = await asRole(client, 'authenticated', ids.mgrA1, () =>
      client.query('SELECT public.get_realtime_operational_dashboard($1, CURRENT_DATE) AS res', [ids.unitA1])
    );
    check(
      Number(dashRes.rows[0].res.summary.total_meals) === 1 &&
      Number(dashRes.rows[0].res.summary.partial_meals) === 1 &&
      Number(dashRes.rows[0].res.summary.total_blocked) === 1,
      'C10.1 RPC get_realtime_operational_dashboard executa sem erro de sc.is_integral para gerente da unidade'
    );

    const pubRes = await client.query(`
      SELECT tablename FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      ORDER BY tablename
    `);
    const pubTables = pubRes.rows.map((r) => r.tablename);
    check(
      pubTables.includes('operational_dashboard_signals') &&
      !pubTables.includes('meal_consumptions') &&
      !pubTables.includes('blocked_attempts'),
      'C10.2 Publicação supabase_realtime contém apenas operational_dashboard_signals (sem meal_consumptions/blocked_attempts)'
    );

    // 10.3 Proteção de rollback contra perda de dados (deve abortar com lotes presentes)
    await expectFail(
      () => asOwner(client, () => client.query(readSql('scripts/sql/sprint17_1_rollback_79_80_81.sql'))),
      /ROLLBACK_BLOCKED_DATA_EXISTS/,
      'C10.3 Rollback recusa apagar tabelas da Sprint 16 quando há registros gravados'
    );

    // 10.4 Rollback controlado quando tabelas Sprint 16 estão vazias + preservação de dados pré-79 + reaplicação
    await client.query('DELETE FROM public.financial_reconciliation_divergences; DELETE FROM public.financial_reconciliation_batches; DELETE FROM public.financial_daily_closings;');
    await client.query(readSql('scripts/sql/sprint17_1_rollback_79_80_81.sql'));

    const postRbCounts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.wallets WHERE tenant_id = $1) AS w,
        (SELECT count(*)::int FROM public.wallet_transactions WHERE tenant_id = $1) AS wt,
        (SELECT count(*)::int FROM public.meal_consumptions WHERE tenant_id = $1) AS mc,
        (SELECT count(*)::int FROM public.contingency_meal_batches WHERE tenant_id = $1) AS cb,
        (SELECT count(*)::int FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'meal_consumptions') AS pub_mc
    `, [ids.tenantA]);
    const prc = postRbCounts.rows[0];
    check(
      prc.w === 1 && prc.wt === 6 && prc.mc === 1 && prc.cb === 2 && prc.pub_mc === 1,
      'C10.4 Rollback reverso 81->80->79 preserva 100% dos dados anteriores e restaura supabase_realtime pré-81'
    );

    // Reaplicação após rollback (idempotência de ciclo completo)
    await client.query(readSql('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql'));
    await client.query(readSql('supabase/migrations/20261109000080_create_financial_reconciliation.sql'));
    await client.query(readSql('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql'));
    check(true, 'C10.5 Reaplicação 79 -> 80 -> 81 após rollback concluída com sucesso');

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }

  console.log(`\nRESULT passed=${passed} failed=${failed} total=${passed + failed}`);

  if (evidenceJsonPath) {
    const payload = {
      sprint: '17.1',
      generatedAt: new Date().toISOString(),
      server: serverMeta,
      summary: { passed, failed, total: passed + failed },
      checks: results,
    };
    fs.writeFileSync(evidenceJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FALHA NA HOMOLOGAÇÃO TRANSACIONAL SPRINT 17.1:', err.message);
  process.exit(1);
});
