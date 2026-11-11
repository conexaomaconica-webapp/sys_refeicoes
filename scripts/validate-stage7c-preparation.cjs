const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const compose = read('infra/stage7c/compose.yaml');
const runner = read('scripts/homologate-stage7c-local.cjs');
const orchestrator = read('scripts/stage7c/run-disposable.ps1');
const bootstrap = read('scripts/stage7c/bootstrap.sql');
const model = read('docs/STAGE_7C_FINANCIAL_SCOPE_MODEL.md');
const report = read('docs/STAGE_7C_PREPARATION.md');

const checks = [
  ['PostgreSQL 17 definido', compose.includes('postgres:17-alpine')],
  ['porta exposta somente em loopback', compose.includes('127.0.0.1:55437:5432')],
  ['dados do banco em tmpfs', compose.includes('/var/lib/postgresql/data:rw,noexec,nosuid')],
  ['rede do container e interna', compose.includes('internal: true')],
  ['runner exige URL explicita', runner.includes('STAGE7C_DB_URL e obrigatoria')],
  ['runner recusa hosts nao locais', runner.includes('allowedHosts') && runner.includes('Host recusado')],
  ['runner exige nome descartavel', runner.includes("startsWith('stage7c_')")],
  ['runner exige PostgreSQL 17', runner.includes("includes('PostgreSQL 17')")],
  ['runner usa BEGIN e ROLLBACK', runner.includes("client.query('BEGIN')") && runner.includes("client.query('ROLLBACK')")],
  ['runner aplica migration 72 real', runner.includes('20261026000072_reconcile_offline_contingency_security.sql')],
  ['runner aplica migration 73 real', runner.includes('20261026000073_harden_scoped_read_policies.sql')],
  ['runner possui exatamente 31 assercoes', (runner.match(/^\s+check\(/gm) || []).length === 31],
  ['baseline reproduz duas policies drift', bootstrap.includes('Eventos offline do tenant') && bootstrap.includes('Leitura da contingencia')],
  ['orquestrador remove volumes em finally', orchestrator.includes('finally') && orchestrator.includes('down --volumes --remove-orphans')],
  ['modelo separa carteira e origem financeira', model.includes('A carteira não deve pertencer a uma unidade') && model.includes('origin_kind')],
  ['relatorio preserva NO-GO transacional', report.includes('NO-GO') && report.includes('não executada; engine indisponível')],
];

let passed = 0;
for (const [name, condition] of checks) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}`);
  }
}

console.log(`RESULT passed=${passed} failed=${checks.length - passed} total=${checks.length}`);
if (passed !== checks.length) process.exitCode = 1;
