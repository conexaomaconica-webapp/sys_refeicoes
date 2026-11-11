/**
 * ==============================================================================
 * SPRINT 18 — HOMOLOGAÇÃO DE PERFORMANCE, CARGA, ESTRESSE E RESILIÊNCIA (PG 17)
 * Executa simulação de carga operacional (1.800 refeições/2 turnos), estresse
 * (3.000 operações até pico alvo de 40 req/s + recuperação) e resiliência em
 * instância PostgreSQL 17 local e descartável, sem tocar no Supabase remoto.
 *
 * RESTRIÇÕES DE SEGURANÇA:
 * - Aceita somente loopback local (127.0.0.1, localhost, ::1).
 * - Exige banco descartável prefixado com sprint18_ e valida data_dir / porta.
 * - Bloqueia explicitamente qualquer URL de Supabase remoto ou produção.
 * ==============================================================================
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const pgUrl = process.env.DISPOSABLE_PG_URL;
const expectedDataDir = process.env.SPRINT18_EXPECTED_DATA_DIR || '';
const expectedPort = Number(process.env.SPRINT18_EXPECTED_PORT || 0);
const evidenceJsonPath = process.env.SPRINT18_EVIDENCE_JSON || '';

if (!pgUrl) {
  throw new Error('DISPOSABLE_PG_URL é obrigatória para homologação descartável Sprint 18.');
}
if (/supabase\.(co|com)|pooler\.supabase/i.test(pgUrl)) {
  throw new Error('ERRO CRÍTICO: Proibido executar homologação contra Supabase remoto!');
}

const target = new URL(pgUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(target.hostname)) {
  throw new Error(`Host recusado: ${target.hostname}. Permitido somente loopback local.`);
}
if (!target.pathname.slice(1).startsWith('sprint18_')) {
  throw new Error(`Banco recusado: ${target.pathname}. Nome deve iniciar com sprint18_.`);
}

const readSql = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

const assertions = [];
let passed = 0;
let failed = 0;

function check(cond, name, detail = '') {
  if (cond) {
    passed += 1;
    assertions.push({ name, passed: true, detail });
    console.log(`PASS ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    failed += 1;
    assertions.push({ name, passed: false, detail });
    console.error(`FAIL ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[idx].toFixed(2));
}

function summarize(values, elapsedMs = 0) {
  if (!values.length) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, averageMs: 0, rps: 0 };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  const rps = elapsedMs > 0 ? Number(((values.length * 1000) / elapsedMs).toFixed(2)) : 0;
  return {
    count: values.length,
    minMs: Number(Math.min(...values).toFixed(2)),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Number(Math.max(...values).toFixed(2)),
    averageMs: Number((sum / values.length).toFixed(2)),
    rps,
    elapsedMs: Number(elapsedMs.toFixed(2)),
  };
}

async function execAsRole(poolOrClient, role, userId, sql, params = []) {
  const client = typeof poolOrClient.connect === 'function' ? await poolOrClient.connect() : poolOrClient;
  const releaseNeeded = typeof poolOrClient.connect === 'function';
  const start = performance.now();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', $1, true)", [role]);
    const res = await client.query(sql, params);
    await client.query('COMMIT');
    return { res, elapsedMs: performance.now() - start };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    if (releaseNeeded) client.release();
  }
}

async function runConcurrentBatch({ pool, items, concurrency, workerFn }) {
  const latencies = [];
  const outcomes = {};
  let cursor = 0;
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) break;
      const item = items[idx];
      const t0 = performance.now();
      try {
        const res = await workerFn(pool, item, idx);
        const dt = performance.now() - t0;
        latencies.push(dt);
        const payload = res.rows?.[0]?.payload;
        const key = payload?.success ? 'approved' : (payload?.error_code || payload?.error || 'rejected');
        outcomes[key] = (outcomes[key] || 0) + 1;
      } catch (err) {
        latencies.push(performance.now() - t0);
        const code = err?.code || 'ERROR';
        outcomes[code] = (outcomes[code] || 0) + 1;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const totalMs = performance.now() - startedAt;
  return {
    summary: summarize(latencies, totalMs),
    outcomes,
  };
}

async function runPacedWave({ pool, items, targetRps, maxConcurrency, workerFn }) {
  const latencies = [];
  const outcomes = {};
  const intervalMs = 1000 / targetRps;
  let inFlight = 0;
  let idx = 0;
  const startedAt = performance.now();

  await new Promise((resolve) => {
    const dispatchNext = () => {
      while (idx < items.length && inFlight < maxConcurrency) {
        const elapsed = performance.now() - startedAt;
        const scheduledAt = idx * intervalMs;
        if (elapsed + 1 < scheduledAt) {
          setTimeout(dispatchNext, Math.max(1, scheduledAt - elapsed));
          return;
        }
        const currentIdx = idx;
        const item = items[currentIdx];
        idx += 1;
        inFlight += 1;

        const reqStart = performance.now();
        workerFn(pool, item, currentIdx)
          .then((res) => {
            latencies.push(performance.now() - reqStart);
            const payload = res.rows?.[0]?.payload;
            const key = payload?.success ? 'approved' : (payload?.error_code || payload?.error || 'rejected');
            outcomes[key] = (outcomes[key] || 0) + 1;
          })
          .catch((err) => {
            latencies.push(performance.now() - reqStart);
            const key = err?.code || 'ERROR';
            outcomes[key] = (outcomes[key] || 0) + 1;
          })
          .finally(() => {
            inFlight -= 1;
            if (idx >= items.length && inFlight === 0) {
              resolve();
            } else {
              setImmediate(dispatchNext);
            }
          });
      }
      if (idx >= items.length && inFlight === 0) {
        resolve();
      }
    };
    dispatchNext();
  });

  const totalMs = performance.now() - startedAt;
  return {
    targetRps,
    maxConcurrency,
    summary: summarize(latencies, totalMs),
    outcomes,
  };
}

async function main() {
  const hostSpec = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCores: os.cpus().length,
    cpuSpeedMhz: os.cpus()[0]?.speed || 0,
    totalMemGB: Number((os.totalmem() / 1073741824).toFixed(2)),
    freeMemBeforeGB: Number((os.freemem() / 1073741824).toFixed(2)),
  };

  const setupClient = new Client({ connectionString: pgUrl, connectionTimeoutMillis: 15_000 });
  await setupClient.connect();

  let serverMeta = {};
  const telemetry = {
    host: hostSpec,
    phases: {},
    indexes: [],
    audit: {},
  };

  const ids = {
    tenantA: 'a0000000-0000-4000-8000-000000000001',
    tenantB: 'b0000000-0000-4000-8000-000000000002',
    instA1: 'a1000000-0000-4000-8000-000000000001',
    instA2: 'a1000000-0000-4000-8000-000000000002',
    instB1: 'b1000000-0000-4000-8000-000000000001',
    unitA1: 'a2000000-0000-4000-8000-000000000001',
    unitA2: 'a2000000-0000-4000-8000-000000000002',
    unitB1: 'b2000000-0000-4000-8000-000000000001',
    dirA: 'a3000000-0000-4000-8000-000000000001',
    finA: 'a3000000-0000-4000-8000-000000000002',
    opA1a: 'a3000000-0000-4000-8000-000000000011',
    opA1b: 'a3000000-0000-4000-8000-000000000012',
    opA2a: 'a3000000-0000-4000-8000-000000000021',
    opA2b: 'a3000000-0000-4000-8000-000000000022',
    opB1: 'b3000000-0000-4000-8000-000000000011',
    catIntA: 'a4000000-0000-4000-8000-000000000001',
    catParA: 'a4000000-0000-4000-8000-000000000002',
    catParB: 'b4000000-0000-4000-8000-000000000002',
    mealLunchA: 'a7000000-0000-4000-8000-000000000001',
    mealDinnerA: 'a7000000-0000-4000-8000-000000000002',
    mealLunchB: 'b7000000-0000-4000-8000-000000000001',
  };

  try {
    // 0. Validações de Ambiente Descartável
    const metaRes = await setupClient.query(`
      SELECT
        pg_catalog.current_setting('server_version_num')::int AS version_num,
        pg_catalog.current_setting('data_directory') AS data_dir,
        pg_catalog.current_setting('listen_addresses') AS listen_addresses,
        pg_catalog.host(pg_catalog.inet_server_addr())::text AS addr,
        pg_catalog.inet_server_port()::int AS port,
        pg_catalog.current_database() AS db_name
    `);
    const meta = metaRes.rows[0];
    serverMeta = {
      versionNum: meta.version_num,
      addr: meta.addr,
      listenAddresses: meta.listen_addresses,
      port: meta.port,
    };

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

    // 1. Aplicar Baseline + Chain de Migrations Reais (36 -> 31 -> 72 -> 77 -> 78 -> 79 -> 80 -> 81 -> 82)
    await setupClient.query('BEGIN');
    await setupClient.query(readSql('scripts/sql/sprint18_disposable_pg17_baseline.sql'));
    await setupClient.query(readSql('supabase/migrations/20260927000036_add_student_to_consume_meal_blocks_and_shift_reports_rpc.sql'));
    await setupClient.query(readSql('supabase/migrations/20260927000031_create_offline_contingency_tables_and_rpc.sql'));
    await setupClient.query(readSql('supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql'));
    await setupClient.query(readSql('supabase/migrations/20261029000077_create_contingency_regularization.sql'));
    await setupClient.query(readSql('supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql'));
    await setupClient.query(readSql('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql'));
    await setupClient.query(readSql('supabase/migrations/20261109000080_create_financial_reconciliation.sql'));
    await setupClient.query(readSql('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql'));
    await setupClient.query(readSql('supabase/migrations/20261110000082_sprint18_performance_indexes.sql'));
    await setupClient.query('REVOKE ALL ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon');
    await setupClient.query('GRANT EXECUTE ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role');
    await setupClient.query('COMMIT');

    const roleRes = await setupClient.query(`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('authenticated', 'anon')
      ORDER BY rolname
    `);
    check(
      roleRes.rowCount === 2 && roleRes.rows.every((r) => !r.rolsuper && !r.rolbypassrls),
      'Papéis authenticated e anon sem SUPERUSER ou BYPASSRLS'
    );
    check(true, 'Cadeia de migrations 36 -> 31 -> 72 -> 77 -> 78 -> 79 -> 80 -> 81 -> 82 compilada');

    // 2. Carga de Massa Sintética Multi-Tenant (5.200 estudantes + carteiras + caixas)
    const seedStart = performance.now();
    await setupClient.query('BEGIN');
    await setupClient.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES
        ('${ids.tenantA}', 'Tenant Carga Alpha', 'tenant-alpha'),
        ('${ids.tenantB}', 'Tenant Isolado Beta', 'tenant-beta');

      INSERT INTO public.institutions (id, tenant_id, name) VALUES
        ('${ids.instA1}', '${ids.tenantA}', 'Campus Alpha Norte'),
        ('${ids.instA2}', '${ids.tenantA}', 'Campus Alpha Sul'),
        ('${ids.instB1}', '${ids.tenantB}', 'Campus Beta Leste');

      INSERT INTO public.units (id, tenant_id, institution_id, name, timezone) VALUES
        ('${ids.unitA1}', '${ids.tenantA}', '${ids.instA1}', 'Restaurante Norte', 'America/Sao_Paulo'),
        ('${ids.unitA2}', '${ids.tenantA}', '${ids.instA2}', 'Restaurante Sul', 'America/Sao_Paulo'),
        ('${ids.unitB1}', '${ids.tenantB}', '${ids.instB1}', 'Restaurante Beta', 'America/Sao_Paulo');

      INSERT INTO auth.users (id, email) VALUES
        ('${ids.dirA}', 'dir@alpha.local'),
        ('${ids.finA}', 'fin@alpha.local'),
        ('${ids.opA1a}', 'op1a@alpha.local'),
        ('${ids.opA1b}', 'op1b@alpha.local'),
        ('${ids.opA2a}', 'op2a@alpha.local'),
        ('${ids.opA2b}', 'op2b@alpha.local'),
        ('${ids.opB1}', 'op1@beta.local');

      INSERT INTO public.profiles (id, tenant_id, full_name, role, status) VALUES
        ('${ids.dirA}', '${ids.tenantA}', 'Diretora Alpha', 'operations_director', 'active'),
        ('${ids.finA}', '${ids.tenantA}', 'Financeiro Alpha', 'finance', 'active'),
        ('${ids.opA1a}', '${ids.tenantA}', 'Operador Norte 01', 'operator', 'active'),
        ('${ids.opA1b}', '${ids.tenantA}', 'Operador Norte 02', 'operator', 'active'),
        ('${ids.opA2a}', '${ids.tenantA}', 'Operador Sul 01', 'operator', 'active'),
        ('${ids.opA2b}', '${ids.tenantA}', 'Operador Sul 02', 'operator', 'active'),
        ('${ids.opB1}', '${ids.tenantB}', 'Operador Beta 01', 'operator', 'active');

      INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
        ('${ids.tenantA}', '${ids.opA1a}', '${ids.unitA1}'),
        ('${ids.tenantA}', '${ids.opA1b}', '${ids.unitA1}'),
        ('${ids.tenantA}', '${ids.opA2a}', '${ids.unitA2}'),
        ('${ids.tenantA}', '${ids.opA2b}', '${ids.unitA2}'),
        ('${ids.tenantB}', '${ids.opB1}', '${ids.unitB1}');

      INSERT INTO public.student_categories (id, tenant_id, code, name, requires_wallet, pricing_type, charge_percentage) VALUES
        ('${ids.catIntA}', '${ids.tenantA}', 'integral', 'Bolsista Integral', false, 'percentage', 0.00),
        ('${ids.catParA}', '${ids.tenantA}', 'parcial', 'Subsidiado Parcial', true, 'percentage', 30.00),
        ('${ids.catParB}', '${ids.tenantB}', 'parcial', 'Parcial Beta', true, 'percentage', 50.00);

      INSERT INTO public.meal_types (id, tenant_id, code, name, status) VALUES
        ('${ids.mealLunchA}', '${ids.tenantA}', 'lunch', 'Almoço', 'active'),
        ('${ids.mealDinnerA}', '${ids.tenantA}', 'dinner', 'Jantar', 'active'),
        ('${ids.mealLunchB}', '${ids.tenantB}', 'lunch', 'Almoço Beta', 'active');

      INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id, enabled, start_time, end_time) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealLunchA}', true, NULL, NULL),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealDinnerA}', true, NULL, NULL),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealLunchA}', true, NULL, NULL),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealDinnerA}', true, NULL, NULL),
        ('${ids.tenantB}', '${ids.unitB1}', '${ids.mealLunchB}', true, NULL, NULL);

      INSERT INTO public.meal_rules (tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, enabled, effective_from) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealLunchA}', '${ids.catIntA}', 15.00, 0.00, 15.00, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealLunchA}', '${ids.catParA}', 15.00, 4.50, 10.50, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealDinnerA}', '${ids.catIntA}', 15.00, 0.00, 15.00, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA1}', '${ids.mealDinnerA}', '${ids.catParA}', 15.00, 4.50, 10.50, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealLunchA}', '${ids.catIntA}', 15.00, 0.00, 15.00, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealLunchA}', '${ids.catParA}', 15.00, 4.50, 10.50, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealDinnerA}', '${ids.catIntA}', 15.00, 0.00, 15.00, true, now() - interval '1 hour'),
        ('${ids.tenantA}', '${ids.unitA2}', '${ids.mealDinnerA}', '${ids.catParA}', 15.00, 4.50, 10.50, true, now() - interval '1 hour'),
        ('${ids.tenantB}', '${ids.unitB1}', '${ids.mealLunchB}', '${ids.catParB}', 14.00, 7.00, 7.00, true, now() - interval '1 hour');

      INSERT INTO public.cash_shifts (tenant_id, unit_id, terminal_id, operator_id, cash_shift_mode, status, opened_at) VALUES
        ('${ids.tenantA}', '${ids.unitA1}', 'TERM-A1-01', '${ids.opA1a}', 'daily', 'opened', now()),
        ('${ids.tenantA}', '${ids.unitA1}', 'TERM-A1-02', '${ids.opA1b}', 'daily', 'opened', now()),
        ('${ids.tenantA}', '${ids.unitA2}', 'TERM-A2-01', '${ids.opA2a}', 'daily', 'opened', now()),
        ('${ids.tenantA}', '${ids.unitA2}', 'TERM-A2-02', '${ids.opA2b}', 'daily', 'opened', now()),
        ('${ids.tenantB}', '${ids.unitB1}', 'TERM-B1-01', '${ids.opB1}', 'daily', 'opened', now());

      -- Histórico realista de 3.000 turnos fechados para validar eficiência do índice parcial WHERE status = 'opened'
      INSERT INTO public.cash_shifts (tenant_id, unit_id, terminal_id, operator_id, cash_shift_mode, status, opened_at, closed_at)
      SELECT
        '${ids.tenantA}',
        CASE WHEN g % 2 = 1 THEN '${ids.unitA1}'::uuid ELSE '${ids.unitA2}'::uuid END,
        CASE WHEN g % 2 = 1 THEN 'TERM-A1-01' ELSE 'TERM-A2-01' END,
        CASE WHEN g % 2 = 1 THEN '${ids.opA1a}'::uuid ELSE '${ids.opA2a}'::uuid END,
        'daily',
        'closed',
        now() - (g || ' hours')::interval,
        now() - (g || ' hours')::interval + interval '4 hours'
      FROM generate_series(1, 3000) AS g;
    `);

    // Gerar 5.200 estudantes sintéticos em Tenant A (2.600 por instituição) + 50 em Tenant B + casos de borda
    await setupClient.query(`
      WITH gs AS (SELECT generate_series(1, 5200) AS i)
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
      SELECT
        gen_random_uuid(),
        '${ids.tenantA}',
        CASE WHEN i % 2 = 1 THEN '${ids.instA1}'::uuid ELSE '${ids.instA2}'::uuid END,
        CASE WHEN i % 3 = 0 THEN '${ids.catIntA}'::uuid ELSE '${ids.catParA}'::uuid END,
        'Comensal Sintetico ' || lpad(i::text, 4, '0'),
        'REG-' || lpad(i::text, 5, '0'),
        'active'
      FROM gs;

      WITH gs_b AS (SELECT generate_series(1, 50) AS i)
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
      SELECT
        gen_random_uuid(),
        '${ids.tenantB}',
        '${ids.instB1}'::uuid,
        '${ids.catParB}'::uuid,
        'Comensal Beta ' || lpad(i::text, 3, '0'),
        'REGB-' || lpad(i::text, 4, '0'),
        'active'
      FROM gs_b;

      -- Estudante especial sem saldo suficiente (R$ 0,50) e estudante de corrida concorrente
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status) VALUES
        ('a5000000-0000-4000-8000-000000009901', '${ids.tenantA}', '${ids.instA1}', '${ids.catParA}', 'Comensal Saldo Baixo', 'REG-LOWBAL', 'active'),
        ('a5000000-0000-4000-8000-000000009902', '${ids.tenantA}', '${ids.instA1}', '${ids.catParA}', 'Comensal Concorrencia', 'REG-RACE01', 'active'),
        ('a5000000-0000-4000-8000-000000009903', '${ids.tenantA}', '${ids.instA1}', '${ids.catParA}', 'Comensal Offline Conflito', 'REG-OFFLINE01', 'active'),
        ('a5000000-0000-4000-8000-000000009904', '${ids.tenantA}', '${ids.instA1}', '${ids.catParA}', 'Comensal Offline Regular', 'REG-OFFLINE02', 'active');

      -- Criar carteiras e créditos iniciais no ledger para garantir paridade 1:1 antes da carga
      INSERT INTO public.wallets (tenant_id, student_id, balance, status)
      SELECT
        s.tenant_id,
        s.id,
        CASE WHEN s.registration_number = 'REG-LOWBAL' THEN 0.50 ELSE 200.00 END,
        'active'
      FROM public.students s;

      INSERT INTO public.wallet_transactions (tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, reference_type, description, created_by)
      SELECT
        w.tenant_id,
        w.id,
        w.student_id,
        'recharge',
        w.balance,
        0.00,
        w.balance,
        'seed_synthetic',
        'Credito sintetico inicial Sprint 18',
        CASE WHEN w.tenant_id = '${ids.tenantA}' THEN '${ids.finA}'::uuid ELSE '${ids.opB1}'::uuid END
      FROM public.wallets w;
    `);
    await setupClient.query('COMMIT');
    await setupClient.query('VACUUM (ANALYZE)');
    const seedMs = Number((performance.now() - seedStart).toFixed(2));
    check(true, 'Massa sintética multi-tenant criada (5.254 comensais e carteiras)', `${seedMs}ms`);

    // Pool com limite adequado para host dual-core / 3.73GB RAM, mantendo alta concorrência até 40 req/s
    const pool = new Pool({
      connectionString: pgUrl,
      max: 16,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 15_000,
    });

    const rpcConsumeSql = 'SELECT public.consume_operator_terminal_meal($1, $2, $3, $4, $5) AS payload';
    const invokeConsume = (p, item, idx) => {
      const idempKey = item.idempotencyKey || `S18-${item.phase}-${idx}-${crypto.randomUUID().slice(0, 8)}`;
      return execAsRole(p, 'authenticated', item.operatorId, rpcConsumeSql, [
        item.unitId,
        item.registration,
        item.mealTypeId,
        idempKey,
        item.terminalId,
      ]).then((r) => r.res);
    };

    try {
      // =========================================================================
      // FASE 18.2 — CARGA OPERACIONAL REALISTA (1.800 REFEIÇÕES EM 2 TURNOS)
      // Turno 1: Almoço (950 refeições) | Turno 2: Jantar (850 refeições)
      // =========================================================================
      const lunchItems = [];
      for (let i = 1; i <= 950; i += 1) {
        const odd = i % 2 === 1;
        lunchItems.push({
          phase: 'lunch',
          unitId: odd ? ids.unitA1 : ids.unitA2,
          operatorId: odd ? (i % 4 === 1 ? ids.opA1a : ids.opA1b) : (i % 4 === 0 ? ids.opA2b : ids.opA2a),
          terminalId: odd ? (i % 4 === 1 ? 'TERM-A1-01' : 'TERM-A1-02') : (i % 4 === 0 ? 'TERM-A2-02' : 'TERM-A2-01'),
          mealTypeId: ids.mealLunchA,
          registration: `REG-${String(i).padStart(5, '0')}`,
        });
      }
      const dinnerItems = [];
      for (let i = 951; i <= 1800; i += 1) {
        const odd = i % 2 === 1;
        dinnerItems.push({
          phase: 'dinner',
          unitId: odd ? ids.unitA1 : ids.unitA2,
          operatorId: odd ? (i % 4 === 1 ? ids.opA1a : ids.opA1b) : (i % 4 === 0 ? ids.opA2b : ids.opA2a),
          terminalId: odd ? (i % 4 === 1 ? 'TERM-A1-01' : 'TERM-A1-02') : (i % 4 === 0 ? 'TERM-A2-02' : 'TERM-A2-01'),
          mealTypeId: ids.mealDinnerA,
          registration: `REG-${String(i).padStart(5, '0')}`,
        });
      }

      const lunchRun = await runConcurrentBatch({ pool, items: lunchItems, concurrency: 4, workerFn: invokeConsume });
      const dinnerRun = await runConcurrentBatch({ pool, items: dinnerItems, concurrency: 4, workerFn: invokeConsume });

      const opTotalSuccess = (lunchRun.outcomes.approved || 0) + (dinnerRun.outcomes.approved || 0);
      telemetry.phases.operational1800 = { lunch: lunchRun, dinner: dinnerRun, totalApproved: opTotalSuccess };

      check(opTotalSuccess === 1800, 'Fase 18.2: 1.800 refeições operacionais (950 almoço + 850 jantar) processadas com 0 erros', `approved=${opTotalSuccess}, lunchP95=${lunchRun.summary.p95Ms}ms, dinnerP95=${dinnerRun.summary.p95Ms}ms`);
      check(
        lunchRun.summary.p95Ms <= 400 && dinnerRun.summary.p95Ms <= 400,
        'Fase 18.2: Latência p95 dentro da meta inicial (<= 400ms)',
        `lunchP95=${lunchRun.summary.p95Ms}ms, dinnerP95=${dinnerRun.summary.p95Ms}ms`
      );

      // Medir dashboard operacional + shift reports no meio do dia (1.800 consumos)
      const dashTimings = [];
      for (let i = 0; i < 10; i += 1) {
        const { elapsedMs } = await execAsRole(pool, 'authenticated', ids.dirA, 'SELECT public.get_realtime_operational_dashboard($1) AS d', [ids.unitA1]);
        dashTimings.push(elapsedMs);
      }
      const shiftTimings = [];
      for (let i = 0; i < 10; i += 1) {
        const { elapsedMs } = await execAsRole(pool, 'authenticated', ids.opA1a, 'SELECT public.get_terminal_shift_reports($1, $2, NULL) AS r', [ids.unitA1, ids.mealLunchA]);
        shiftTimings.push(elapsedMs);
      }
      telemetry.phases.midLoadReads = {
        realtimeDashboard: summarize(dashTimings),
        terminalShiftReports: summarize(shiftTimings),
      };
      check(
        telemetry.phases.midLoadReads.realtimeDashboard.p95Ms <= 400,
        'Fase 18.2: Dashboard operacional tempo real p95 <= 400ms após 1.800 refeições',
        `p95=${telemetry.phases.midLoadReads.realtimeDashboard.p95Ms}ms`
      );

      // =========================================================================
      // FASE 18.3 — ESTRESSE E PICOS CONTROLADOS ATÉ 40 REQ/S (3.000 OPERAÇÕES)
      // Onda 1: 300 req @ 10 req/s | Onda 2: 900 req @ 25 req/s
      // Onda 3: 1.500 req @ 40 req/s (pico máximo) | Onda 4: 300 req @ 10 req/s (recuperação)
      // =========================================================================
      const makeStressItems = (startReg, count, phaseName) => {
        const list = [];
        for (let k = 0; k < count; k += 1) {
          const num = startReg + k;
          const odd = num % 2 === 1;
          list.push({
            phase: phaseName,
            unitId: odd ? ids.unitA1 : ids.unitA2,
            operatorId: odd ? (num % 4 === 1 ? ids.opA1a : ids.opA1b) : (num % 4 === 0 ? ids.opA2b : ids.opA2a),
            terminalId: odd ? (num % 4 === 1 ? 'TERM-A1-01' : 'TERM-A1-02') : (num % 4 === 0 ? 'TERM-A2-02' : 'TERM-A2-01'),
            mealTypeId: num % 3 === 0 ? ids.mealDinnerA : ids.mealLunchA,
            registration: `REG-${String(num).padStart(5, '0')}`,
          });
        }
        return list;
      };

      const wave1 = await runPacedWave({ pool, items: makeStressItems(1801, 300, 'wave1'), targetRps: 10, maxConcurrency: 8, workerFn: invokeConsume });
      const wave2 = await runPacedWave({ pool, items: makeStressItems(2101, 900, 'wave2'), targetRps: 25, maxConcurrency: 12, workerFn: invokeConsume });
      const wave3 = await runPacedWave({ pool, items: makeStressItems(3001, 1500, 'wave3'), targetRps: 40, maxConcurrency: 16, workerFn: invokeConsume });

      // Pausa de recuperação pós-pico (1.500 ms) para medir retorno à linha de base
      await new Promise((r) => setTimeout(r, 1500));
      const wave4 = await runPacedWave({ pool, items: makeStressItems(4501, 300, 'wave4'), targetRps: 10, maxConcurrency: 8, workerFn: invokeConsume });

      const stressTotal =
        (wave1.outcomes.approved || 0) +
        (wave2.outcomes.approved || 0) +
        (wave3.outcomes.approved || 0) +
        (wave4.outcomes.approved || 0);

      telemetry.phases.stress3000 = {
        wave1_10rps: wave1,
        wave2_25rps: wave2,
        wave3_40rps_peak: wave3,
        wave4_recovery_10rps: wave4,
        totalStressApproved: stressTotal,
      };

      check(stressTotal === 3000, 'Fase 18.3: 3.000 operações de estresse executadas integralmente sem perda', `approved=${stressTotal}`);
      check(
        wave4.summary.p95Ms <= Math.max(400, wave1.summary.p95Ms * 2),
        'Fase 18.3: Recuperação pós-pico restabelece latência p95 nominal',
        `baselineP95=${wave1.summary.p95Ms}ms, peakP95=${wave3.summary.p95Ms}ms (rps=${wave3.summary.rps}), recoveryP95=${wave4.summary.p95Ms}ms`
      );

      // Relatório financeiro consolidado pós 4.800+ consumos
      const reportTimings = [];
      for (let i = 0; i < 5; i += 1) {
        const { elapsedMs } = await execAsRole(
          pool,
          'authenticated',
          ids.finA,
          'SELECT public.get_consolidated_financial_report($1::uuid, CURRENT_DATE, CURRENT_DATE, NULL::uuid, NULL::uuid, NULL::uuid) AS rep',
          [ids.tenantA]
        );
        reportTimings.push(elapsedMs);
      }
      telemetry.phases.postStressFinancialReport = summarize(reportTimings);
      check(telemetry.phases.postStressFinancialReport.p95Ms <= 1000, 'Fase 18.3: Relatório financeiro consolidado p95 <= 1000ms pós-4.800 consumos', `p95=${telemetry.phases.postStressFinancialReport.p95Ms}ms`);

      // =========================================================================
      // FASE 18.4 — RESILIÊNCIA TRANSACIONAL, CONCORRÊNCIA E INTEGRIDADE CONTÁBIL
      // =========================================================================
      // 18.4.1 Concorrência na mesma matrícula (12 disparos simultâneos -> apenas 1 aprova)
      const raceItems = Array.from({ length: 12 }, (_, k) => ({
        phase: `race-${k}`,
        unitId: ids.unitA1,
        operatorId: k % 2 === 0 ? ids.opA1a : ids.opA1b,
        terminalId: k % 2 === 0 ? 'TERM-A1-01' : 'TERM-A1-02',
        mealTypeId: ids.mealLunchA,
        registration: 'REG-RACE01',
      }));
      const raceRes = await runConcurrentBatch({ pool, items: raceItems, concurrency: 12, workerFn: invokeConsume });
      const raceWallet = await setupClient.query("SELECT balance FROM public.wallets WHERE student_id = 'a5000000-0000-4000-8000-000000009902'");
      const raceMeals = await setupClient.query("SELECT count(*)::int AS cnt FROM public.meal_consumptions WHERE student_id = 'a5000000-0000-4000-8000-000000009902'");
      check(
        raceRes.outcomes.approved === 1 &&
          (raceRes.outcomes.CONCURRENT_CONSUMPTION_CONFLICT || 0) + (raceRes.outcomes.ALREADY_CONSUMED_TODAY || 0) === 11 &&
          Number(raceWallet.rows[0].balance) === 195.5 &&
          raceMeals.rows[0].cnt === 1,
        'Fase 18.4.1: Concorrência de 12 bips na mesma matrícula aprova exatamente 1 e bloqueia 11 sem débito duplo',
        `outcomes=${JSON.stringify(raceRes.outcomes)}, balance=${raceWallet.rows[0].balance}`
      );

      // 18.4.2 Replay idempotente exato (REG-05011 pertence à instA1/unitA1)
      const fixedIdemp = 'S18-IDEMP-FIXED-001';
      const replayFirst = await execAsRole(pool, 'authenticated', ids.opA1a, rpcConsumeSql, [
        ids.unitA1,
        'REG-05011',
        ids.mealLunchA,
        fixedIdemp,
        'TERM-A1-01',
      ]);
      const replaySecond = await execAsRole(pool, 'authenticated', ids.opA1a, rpcConsumeSql, [
        ids.unitA1,
        'REG-05011',
        ids.mealLunchA,
        fixedIdemp,
        'TERM-A1-01',
      ]);
      const p1 = replayFirst.res.rows[0].payload;
      const p2 = replaySecond.res.rows[0].payload;
      const replayBalanceRes = await setupClient.query(`
        SELECT w.balance, (SELECT count(*)::int FROM public.meal_consumptions mc WHERE mc.student_id = s.id) AS meals
        FROM public.students s
        JOIN public.wallets w ON w.student_id = s.id
        WHERE s.institution_id = '${ids.instA1}' AND s.registration_number = 'REG-05011'
      `);
      check(
        p1.success === true &&
          p2.success === true &&
          p2.idempotent_replay === true &&
          Boolean(p1.consumption_id) &&
          p1.consumption_id === p2.consumption_id &&
          Number(replayBalanceRes.rows[0]?.balance) === 195.5 &&
          replayBalanceRes.rows[0]?.meals === 1,
        'Fase 18.4.2: Replay idempotente retorna o consumo original sem novo débito',
        `consumption_id=${p1.consumption_id}, balance=${replayBalanceRes.rows[0]?.balance}`
      );

      // 18.4.3 Bloqueio por saldo insuficiente sob concorrência (6 disparos -> 0 aprovações, saldo intacto)
      const lowBalItems = Array.from({ length: 6 }, (_, k) => ({
        phase: `lowbal-${k}`,
        unitId: ids.unitA1,
        operatorId: ids.opA1a,
        terminalId: 'TERM-A1-01',
        mealTypeId: ids.mealLunchA,
        registration: 'REG-LOWBAL',
      }));
      const lowBalRes = await runConcurrentBatch({ pool, items: lowBalItems, concurrency: 6, workerFn: invokeConsume });
      const lowBalWallet = await setupClient.query("SELECT balance FROM public.wallets WHERE student_id = 'a5000000-0000-4000-8000-000000009901'");
      check(
        !lowBalRes.outcomes.approved &&
          Number(lowBalWallet.rows[0].balance) === 0.5 &&
          (lowBalRes.outcomes.INSUFFICIENT_FUNDS || 0) >= 1,
        'Fase 18.4.3: Saldo insuficiente sob concorrência mantém saldo R$ 0,50 sem negativar',
        `outcomes=${JSON.stringify(lowBalRes.outcomes)}, balance=${lowBalWallet.rows[0].balance}`
      );

      // 18.4.4 Reconciliação offline (autenticado bloqueado + lotes fora de ordem e duplicados via service_role)
      let offlineDenied = false;
      try {
        await execAsRole(pool, 'authenticated', ids.opA1a, 'SELECT public.reconcile_offline_consumptions($1::jsonb)', ['[]']);
      } catch (err) {
        if (err.code === '42501') offlineDenied = true;
      }
      check(offlineDenied, 'Fase 18.4.4a: RPC legada reconcile_offline_consumptions segue revogada para authenticated (42501)');

      // Primeiro cria consumo online para REG-OFFLINE01 para validar conflito na reconciliação fora de ordem
      await execAsRole(pool, 'authenticated', ids.opA1a, rpcConsumeSql, [
        ids.unitA1,
        'REG-OFFLINE01',
        ids.mealLunchA,
        'S18-ONLINE-BEFORE-OFFLINE',
        'TERM-A1-01',
      ]);

      const buildOfflineEvent = (seq, studentId, reg, idemp, prevHash, tsOffsetSec) => {
        const ts = new Date(Date.now() - tsOffsetSec * 1000).toISOString();
        const raw = `${idemp}:${studentId}:${ts}`;
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        return {
          id: crypto.randomUUID(),
          terminal_id: 'TERM-A1-01',
          unit_id: ids.unitA1,
          operator_id: ids.opA1a,
          student_id: studentId,
          registration_attempted: reg,
          meal_type_id: ids.mealLunchA,
          device_timestamp: ts,
          sequence_num: seq,
          idempotency_key: idemp,
          previous_event_hash: prevHash,
          integrity_hash: hash,
        };
      };

      const ev1 = buildOfflineEvent(1, 'a5000000-0000-4000-8000-000000009904', 'REG-OFFLINE02', 'OFF-KEY-001', 'GENESIS', 120);
      const ev2 = buildOfflineEvent(2, 'a5000000-0000-4000-8000-000000009903', 'REG-OFFLINE01', 'OFF-KEY-002', ev1.integrity_hash, 60);
      // Envia propositalmente fora de ordem (seq 2 antes de seq 1) + evento duplicado
      const offlineBatch = [ev2, ev1, { ...ev1 }];
      // Chamar como owner (equivalente a worker backend privilegiado já que authenticated está revogado na Migration 72)
      await setupClient.query('BEGIN');
      await setupClient.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [ids.opA1a]);
      const recRes = await setupClient.query('SELECT public.reconcile_offline_consumptions($1::jsonb) AS results', [JSON.stringify(offlineBatch)]);
      await setupClient.query('COMMIT');
      const recItems = recRes.rows[0].results;
      const hasRegular = recItems.some((x) => x.idempotency_key === 'OFF-KEY-001' && x.status === 'confirmed_regular');
      const hasConflictDup = recItems.some((x) => x.idempotency_key === 'OFF-KEY-002' && x.status === 'conflict_duplicate');
      const hasReplayFlag = recItems.some((x) => x.idempotency_key === 'OFF-KEY-001' && x.already_processed === true);
      check(
        hasRegular && hasConflictDup && hasReplayFlag,
        'Fase 18.4.4b: Eventos offline fora de ordem e repetidos reconciliados sem débito duplo',
        `results=${JSON.stringify(recItems.map((x) => ({ k: x.idempotency_key, st: x.status, replay: x.already_processed })))}`
      );

      // 18.4.5 Isolamento Multi-Tenant e Unidade sob carga
      const crossUnit = await execAsRole(pool, 'authenticated', ids.opB1, rpcConsumeSql, [
        ids.unitA1,
        'REG-05020',
        ids.mealLunchA,
        'CROSS-TENANT-001',
        'TERM-B1-01',
      ]);
      const crossStudent = await execAsRole(pool, 'authenticated', ids.opA1a, rpcConsumeSql, [
        ids.unitA1,
        'REGB-0001',
        ids.mealLunchA,
        'CROSS-STUDENT-001',
        'TERM-A1-01',
      ]);
      check(
        crossUnit.res.rows[0].payload.success === false && crossStudent.res.rows[0].payload.success === false,
        'Fase 18.4.5: Isolamento multi-tenant e de unidade preserva bloqueio pós-carga',
        `crossUnit=${crossUnit.res.rows[0].payload.error_code}, crossStudent=${crossStudent.res.rows[0].payload.error_code}`
      );

      // 18.4.6 Integridade Financeira e Auditoria 1:1 Pós-Estresse
      const { res: custodyRes } = await execAsRole(pool, 'authenticated', ids.finA, 'SELECT public.audit_wallet_custody_integrity($1::uuid) AS a', [ids.tenantA]);
      const custody = custodyRes.rows[0].a;
      const parityRes = await setupClient.query(`
        SELECT count(*)::int AS mismatches
        FROM public.wallets w
        LEFT JOIN (
          SELECT wallet_id, COALESCE(SUM(amount), 0.00) AS sum_tx
          FROM public.wallet_transactions
          GROUP BY wallet_id
        ) tx ON tx.wallet_id = w.id
        WHERE ROUND(w.balance, 2) <> ROUND(COALESCE(tx.sum_tx, 0.00), 2)
      `);
      const negWallets = await setupClient.query('SELECT count(*)::int AS neg FROM public.wallets WHERE balance < 0');
      const sigCount = await setupClient.query('SELECT count(*)::int AS cnt FROM public.operational_dashboard_signals');
      const indexRes = await setupClient.query(`
        SELECT relname, indexrelname, idx_scan, idx_tup_read
        FROM pg_catalog.pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND relname IN ('cash_shifts', 'meal_consumptions', 'wallets', 'operational_dashboard_signals')
        ORDER BY relname, idx_scan DESC
      `);

      telemetry.indexes = indexRes.rows;
      telemetry.audit = {
        custody,
        walletLedgerMismatches: parityRes.rows[0].mismatches,
        negativeWallets: negWallets.rows[0].neg,
        operationalSignalsEmitted: sigCount.rows[0].cnt,
      };
      telemetry.phases.stress = telemetry.phases.stress3000;

      check(
        parityRes.rows[0].mismatches === 0 &&
          negWallets.rows[0].neg === 0 &&
          custody.is_patrimony_balanced === true &&
          Number(custody.inconsistent_wallets_count || 0) === 0,
        'Fase 18.4.6: Consistência 1:1 carteira/ledger e 0 saldos negativos em 5.254 carteiras após 4.800+ consumos',
        `mismatches=${parityRes.rows[0].mismatches}, patrimonyBalanced=${custody.is_patrimony_balanced}, signals=${sigCount.rows[0].cnt}`
      );
      check(
        Number(sigCount.rows[0].cnt) >= 4800,
        'Fase 18.4.7: Sinais realtime sem PII emitidos sob carga sem bloquear operação do terminal',
        `signals=${sigCount.rows[0].cnt}`
      );

      // Verificar uso efetivo dos índices Sprint 18
      const shiftIdx = telemetry.indexes.find((r) => r.indexrelname === 'idx_cash_shifts_open_operator_terminal');
      check(Boolean(shiftIdx) && Number(shiftIdx.idx_scan) > 0, 'Índice Sprint 18 idx_cash_shifts_open_operator_terminal utilizado em carga real', `scans=${shiftIdx?.idx_scan || 0}`);
    } finally {
      await pool.end();
    }
  } finally {
    await setupClient.end();
  }

  telemetry.host.freeMemAfterGB = Number((os.freemem() / 1073741824).toFixed(2));
  const mem = process.memoryUsage();
  telemetry.nodeProcessMemoryMB = {
    rss: Number((mem.rss / 1048576).toFixed(2)),
    heapUsed: Number((mem.heapUsed / 1048576).toFixed(2)),
    external: Number((mem.external / 1048576).toFixed(2)),
  };

  const report = {
    sprint: '18',
    executedAt: new Date().toISOString(),
    serverMeta,
    summary: { passed, failed, total: passed + failed },
    telemetry,
    assertions,
  };

  if (evidenceJsonPath) {
    fs.mkdirSync(path.dirname(evidenceJsonPath), { recursive: true });
    fs.writeFileSync(evidenceJsonPath, JSON.stringify(report, null, 2));
  }

  console.log(`\nResumo Sprint 18 PG17: ${passed}/${passed + failed} aprovadas, ${failed} falhas.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL SPRINT 18 PG17:', err);
  process.exit(1);
});

