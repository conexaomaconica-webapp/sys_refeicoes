const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'scripts/homologate-stage7d-performance.cjs'), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, 'scripts/stage7d/run-native-performance.ps1'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'scripts/stage7d/extend-operational-baseline.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'scripts/stage7d/seed-performance.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql'), 'utf8');
const checks = [];

function check(name, condition) { checks.push([name, Boolean(condition)]); }

check('runner exige URL explicita', runner.includes('STAGE7D_DB_URL'));
check('runner aceita somente loopback', runner.includes("new Set(['127.0.0.1', 'localhost', '::1'])"));
check('banco exige prefixo stage7d', runner.includes("startsWith('stage7d_')"));
check('data directory e porta sao comprovados', runner.includes('STAGE7D_EXPECTED_DATA_DIR') && runner.includes('STAGE7D_EXPECTED_PORT'));
check('PostgreSQL major 17 e exigido', runner.includes('version_num >= 170000') && orchestrator.includes("PostgreSQL\\) 17\\."));
check('migrations 72 73 e 74 sao aplicadas em ordem', /00072[\s\S]+00073[\s\S]+00074/.test(runner));
check('falha de setup executa rollback', runner.includes("owner.query('ROLLBACK')"));
check('carga possui dois tenants', seed.includes("'Tenant A'") && seed.includes("'Tenant B'"));
check('carga possui 240 mil consumos', seed.includes('generate_series(1, 120000)') && seed.includes('generate_series(1, 90000)') && seed.includes('generate_series(1, 15000)'));
check('estados cancelados fazem parte da carga', seed.includes("'cancelled_unserved'"));
check('baseline reproduz indices existentes', extension.includes('idx_meal_consumptions_unit_date') && extension.includes('idx_meal_consumptions_tenant_created'));
check('RLS permanece habilitada e forcada', extension.includes('ENABLE ROW LEVEL SECURITY') && extension.includes('FORCE ROW LEVEL SECURITY'));
check('concorrencia usa clientes independentes', runner.includes('Promise.all(specs.map(([user]) => identityClient(user)))'));
check('identidades concorrentes validam totais', runner.includes('isolated = false'));
check('perfis locais e institucionais sao testados', ['supervisor', 'manager', 'institution'].every((name) => runner.includes(`users.${name}`)));
check('acesso cruzado e perfis proibidos sao testados', runner.includes('unidade fora do escopo') && runner.includes('operador e estudante sao recusados'));
check('EXPLAIN ANALYZE BUFFERS e coletado', runner.includes('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)'));
check('agregacao evita reutilizar linhas brutas', migration.includes('scoped_counts AS') && migration.includes('counts_by_unit AS') && !migration.includes('scoped_consumptions AS'));
check('visibility map e estatisticas sao atualizados', runner.includes('VACUUM (ANALYZE) public.meal_consumptions'));
check('metricas p50 p95 e maximo sao coletadas', ['p50Ms', 'p95Ms', 'maxMs'].every((key) => runner.includes(key)));
check('indice candidato existe somente no runner descartavel', runner.includes('idx_stage7d_candidate_tenant_date_unit_category') && !migration.includes('idx_stage7d_candidate_tenant_date_unit_category'));
check('SLA local possui limites explicitos', runner.includes('p95 abaixo de 1500 ms') && runner.includes('p95 abaixo de 2000 ms'));
check('orquestrador restringe servidor a loopback', orchestrator.includes("listen_addresses = '127.0.0.1'") && orchestrator.includes('0.0.0.0/0 reject'));
check('orquestrador usa SCRAM', orchestrator.includes('scram-sha-256'));
check('cluster e banco recebem UUID', orchestrator.includes("'ma-stage7d-' + [Guid]::NewGuid()") && orchestrator.includes("'stage7d_' + [Guid]::NewGuid()"));
check('limpeza exige marcador e caminho seguro', orchestrator.includes('.stage7d-disposable') && orchestrator.includes('Test-SafeInstancePath') && orchestrator.includes('Remove-Item -LiteralPath'));
check('evidencias sao sanitizadas', orchestrator.includes("Replace($password, '[REDACTED]')"));
check('migration 74 permanece somente operacional', !/public\.(wallets|wallet_transactions|payments|recharges|cash_shifts|cash_movements)\b/i.test(migration));

const missingBin = path.join(os.tmpdir(), `stage7d-missing-${Date.now()}`);
const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('ma-stage7d-')).sort();
const failure = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(root, 'scripts/stage7d/run-native-performance.ps1'),
  '-PostgresBin', missingBin,
], { cwd: root, encoding: 'utf8', timeout: 30_000 });
const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('ma-stage7d-')).sort();
check('ausencia de binarios falha antes de criar cluster', failure.status !== 0 && JSON.stringify(before) === JSON.stringify(after));

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
