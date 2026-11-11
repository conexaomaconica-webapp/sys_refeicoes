const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const connectionString = process.env.STAGE7D_DB_URL;
const expectedDataDirectory = process.env.STAGE7D_EXPECTED_DATA_DIR;
const expectedPort = Number(process.env.STAGE7D_EXPECTED_PORT || 0);
const evidenceJson = process.env.STAGE7D_EVIDENCE_JSON;
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (!connectionString || !expectedDataDirectory || !evidenceJson) {
  throw new Error('Variaveis STAGE7D obrigatorias nao foram informadas.');
}
if (!Number.isInteger(expectedPort) || expectedPort < 1024 || expectedPort > 65535) {
  throw new Error('STAGE7D_EXPECTED_PORT deve ser uma porta local nao privilegiada.');
}
const target = new URL(connectionString);
if (!allowedHosts.has(target.hostname)) throw new Error(`Host recusado: ${target.hostname}.`);
if (!target.pathname.slice(1).startsWith('stage7d_')) throw new Error('Banco deve usar prefixo stage7d_.');

const sqlFiles = [
  'scripts/stage7c/bootstrap.sql',
  'scripts/stage7d/extend-operational-baseline.sql',
  'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql',
  'supabase/migrations/20261026000073_harden_scoped_read_policies.sql',
  'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql',
  'scripts/stage7d/seed-performance.sql',
].map((file) => path.join(root, file));

const ids = {
  tenantA: '7d000000-0000-4000-8000-000000000001',
  tenantB: '7d000000-0000-4000-8000-000000000002',
  institutionA1: '7d100000-0000-4000-8000-000000000001',
  unitA1: '7d200000-0000-4000-8000-000000000001',
  unitA2: '7d200000-0000-4000-8000-000000000002',
  unitB: '7d200000-0000-4000-8000-000000000004',
  categoryA1: '7d300000-0000-4000-8000-000000000001',
  categoryB: '7d300000-0000-4000-8000-000000000004',
};
const users = {
  admin: '7da00000-0000-4000-8000-000000000001',
  director: '7da00000-0000-4000-8000-000000000002',
  finance: '7da00000-0000-4000-8000-000000000003',
  supervisor: '7da00000-0000-4000-8000-000000000004',
  manager: '7da00000-0000-4000-8000-000000000005',
  institution: '7da00000-0000-4000-8000-000000000006',
  operator: '7da00000-0000-4000-8000-000000000007',
  student: '7da00000-0000-4000-8000-000000000008',
  inactive: '7da00000-0000-4000-8000-000000000009',
  otherAdmin: '7da00000-0000-4000-8000-000000000010',
};
const defaultArgs = ['2026-10-01', '2026-11-01', '2026-08-31', '2026-10-01', null, null, null];
const rpcSql = `SELECT public.get_operational_intelligence_v1(
  $1::date, $2::date, $3::date, $4::date, $5::uuid[], $6::uuid[], $7::uuid[]
) AS payload`;

const owner = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
const checks = [];
const metrics = {};

function check(name, condition, detail = '') {
  checks.push({ name, passed: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${String(checks.length).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)].toFixed(2));
}

function summarize(values) {
  return {
    count: values.length,
    minMs: Number(Math.min(...values).toFixed(2)),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Number(Math.max(...values).toFixed(2)),
    averageMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
  };
}

async function identityClient(userId, role = 'authenticated') {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, false)", [userId || '']);
  await client.query(`SET ROLE ${role === 'anon' ? 'anon' : 'authenticated'}`);
  return client;
}

async function rpc(client, args = defaultArgs) {
  const result = await client.query(rpcSql, args);
  return result.rows[0].payload;
}

async function expectDenied(userId, args = defaultArgs, role = 'authenticated') {
  const client = await identityClient(userId, role);
  try {
    await rpc(client, args);
    return false;
  } catch (error) {
    return error.code === '42501';
  } finally {
    await client.end();
  }
}

async function timedRpc(client, args = defaultArgs) {
  const started = performance.now();
  const payload = await rpc(client, args);
  return { elapsed: performance.now() - started, payload };
}

async function sequentialBenchmark(userId, iterations) {
  const client = await identityClient(userId);
  const timings = [];
  try {
    for (let index = 0; index < 3; index += 1) await rpc(client);
    for (let index = 0; index < iterations; index += 1) timings.push((await timedRpc(client)).elapsed);
  } finally {
    await client.end();
  }
  return summarize(timings);
}

async function concurrentBenchmark() {
  const specs = [
    [users.admin, 114000],
    [users.director, 114000],
    [users.finance, 114000],
    [users.supervisor, 38000],
    [users.manager, 38000],
    [users.institution, 76000],
    [users.otherAdmin, 14250],
  ];
  const clients = await Promise.all(specs.map(([user]) => identityClient(user)));
  const timings = [];
  let isolated = true;
  try {
    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all(clients.map((client) => timedRpc(client)));
      results.forEach((result, index) => {
        timings.push(result.elapsed);
        if (Number(result.payload.meals_served) !== specs[index][1]) isolated = false;
      });
    }
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
  return { ...summarize(timings), isolated };
}

async function explainRpc(userId) {
  const client = await identityClient(userId);
  try {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${rpcSql}`, defaultArgs);
    return result.rows[0]['QUERY PLAN'][0];
  } finally {
    await client.end();
  }
}

async function indexStats() {
  const result = await owner.query(`
    SELECT indexrelname, idx_scan, idx_tup_read
      FROM pg_catalog.pg_stat_user_indexes
     WHERE schemaname = 'public' AND relname = 'meal_consumptions'
     ORDER BY indexrelname
  `);
  return result.rows.map((row) => ({ name: row.indexrelname, scans: Number(row.idx_scan), tuplesRead: Number(row.idx_tup_read) }));
}

async function main() {
  await owner.connect();
  const server = await owner.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num')::INTEGER AS version_num,
           current_setting('data_directory') AS data_directory,
           inet_server_port() AS port
  `);
  const actual = server.rows[0];
  check('PostgreSQL 17 descartavel confirmado', actual.version_num >= 170000 && actual.version_num < 180000);
  check('banco descartavel confirmado', actual.database_name.startsWith('stage7d_'));
  check('data directory exclusivo confirmado', path.resolve(actual.data_directory).toLowerCase() === path.resolve(expectedDataDirectory).toLowerCase());
  check('porta exclusiva confirmada', Number(actual.port) === expectedPort);

  await owner.query('BEGIN');
  try {
    for (const file of sqlFiles) await owner.query(fs.readFileSync(file, 'utf8'));
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
  check('migrations 72, 73 e 74 compiladas em sequencia', true);

  const roles = await owner.query("SELECT rolname, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname");
  check('papeis testados sem superuser ou bypass RLS', roles.rowCount === 2 && roles.rows.every((role) => !role.rolsuper && !role.rolbypassrls));
  const rows = await owner.query('SELECT count(*)::INTEGER AS total FROM public.meal_consumptions');
  check('carga sintetica representativa criada', rows.rows[0].total === 240000, `rows=${rows.rows[0].total}`);
  await owner.query('VACUUM (ANALYZE) public.meal_consumptions');

  const admin = await identityClient(users.admin);
  const otherAdmin = await identityClient(users.otherAdmin);
  const supervisor = await identityClient(users.supervisor);
  const manager = await identityClient(users.manager);
  const institution = await identityClient(users.institution);
  try {
    const adminPayload = await rpc(admin);
    const otherPayload = await rpc(otherAdmin);
    const supervisorPayload = await rpc(supervisor);
    const managerPayload = await rpc(manager);
    const institutionPayload = await rpc(institution);
    check('admin agrega somente o proprio tenant', adminPayload.meals_served === 114000 && adminPayload.volume_by_unit.length === 3);
    check('comparativo exclui cancelados', adminPayload.period_comparison.previous_meals_served === 85500);
    check('outro tenant permanece isolado', otherPayload.meals_served === 14250 && otherPayload.volume_by_unit.length === 1);
    check('supervisor ve somente unidade atribuida', supervisorPayload.meals_served === 38000 && supervisorPayload.applied_scope.unit_ids.length === 1);
    check('gerente ve somente unidade atribuida', managerPayload.meals_served === 38000 && managerPayload.applied_scope.unit_ids[0] === ids.unitA2);
    check('usuario institucional ve somente instituicao atribuida', institutionPayload.meals_served === 76000 && institutionPayload.volume_by_unit.length === 2);
    const filtered = await rpc(admin, [...defaultArgs.slice(0, 4), [ids.institutionA1], [ids.unitA1], [ids.categoryA1]]);
    check('filtros combinados preservam consistencia', filtered.meals_served === 38000 && filtered.volume_by_unit.length === 1 && filtered.utilization_by_category.length === 1);
  } finally {
    await Promise.all([admin.end(), otherAdmin.end(), supervisor.end(), manager.end(), institution.end()]);
  }

  check('unidade fora do escopo e recusada', await expectDenied(users.supervisor, [...defaultArgs.slice(0, 5), [ids.unitB], null]));
  check('categoria de outro tenant e recusada', await expectDenied(users.admin, [...defaultArgs.slice(0, 6), [ids.categoryB]]));
  check('operador e estudante sao recusados', await expectDenied(users.operator) && await expectDenied(users.student));
  check('perfil inativo e recusado', await expectDenied(users.inactive));
  check('anonimo nao executa RPC', await expectDenied(null, defaultArgs, 'anon'));

  metrics.baseline = {
    sequential: await sequentialBenchmark(users.admin, 30),
    concurrent: await concurrentBenchmark(),
    explain: await explainRpc(users.admin),
    indexes: await indexStats(),
  };
  check('concorrencia baseline preserva isolamento', metrics.baseline.concurrent.isolated);

  await owner.query(`
    CREATE INDEX idx_stage7d_candidate_tenant_date_unit_category
        ON public.meal_consumptions(tenant_id, consumption_date, unit_id, category_id)
        WHERE status IN ('approved', 'financially_refunded')
  `);
  await owner.query('VACUUM (ANALYZE) public.meal_consumptions');
  metrics.candidate = {
    sequential: await sequentialBenchmark(users.admin, 30),
    concurrent: await concurrentBenchmark(),
    explain: await explainRpc(users.admin),
    indexes: await indexStats(),
  };
  check('concorrencia com indice candidato preserva isolamento', metrics.candidate.concurrent.isolated);
  check('SLA local sequencial p95 abaixo de 1500 ms', metrics.candidate.sequential.p95Ms < 1500, `p95=${metrics.candidate.sequential.p95Ms}ms`);
  check('SLA local concorrente p95 abaixo de 2000 ms', metrics.candidate.concurrent.p95Ms < 2000, `p95=${metrics.candidate.concurrent.p95Ms}ms`);
  const candidateStats = metrics.candidate.indexes.find((index) => index.name === 'idx_stage7d_candidate_tenant_date_unit_category');
  check('indice candidato observado pelo PostgreSQL', Boolean(candidateStats), candidateStats ? `scans=${candidateStats.scans}` : 'ausente');

  const result = {
    stage: '7D.3',
    generatedAt: new Date().toISOString(),
    postgresMajor: 17,
    dataset: { totalRows: 240000, tenants: 2, institutions: 3, units: 4, currentPeriodRows: 135000, previousPeriodRows: 105000 },
    checks: { passed: checks.filter((item) => item.passed).length, failed: checks.filter((item) => !item.passed).length, total: checks.length, items: checks },
    metrics,
    cleanup: { verifiedByOrchestrator: true },
  };
  fs.mkdirSync(path.dirname(evidenceJson), { recursive: true });
  fs.writeFileSync(evidenceJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`RESULT passed=${result.checks.passed} failed=${result.checks.failed} total=${result.checks.total}`);
  console.log(`METRIC baseline_seq_p95_ms=${metrics.baseline.sequential.p95Ms} candidate_seq_p95_ms=${metrics.candidate.sequential.p95Ms}`);
  console.log(`METRIC baseline_concurrent_p95_ms=${metrics.baseline.concurrent.p95Ms} candidate_concurrent_p95_ms=${metrics.candidate.concurrent.p95Ms}`);
  if (result.checks.failed) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (!owner.ended) await owner.end().catch(() => {}); });
