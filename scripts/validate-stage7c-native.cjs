const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runnerPath = path.join(root, 'scripts/homologate-stage7c-local.cjs');
const nativePath = path.join(root, 'scripts/stage7c/run-native-disposable.ps1');
const bootstrapPath = path.join(root, 'scripts/stage7c/bootstrap.sql');
const runner = fs.readFileSync(runnerPath, 'utf8');
const native = fs.readFileSync(nativePath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

const tempRunsBefore = new Set(
  fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('ma-stage7c-'))
    .map((entry) => entry.name),
);

const missingBin = path.join(root, '.stage7c-postgres-not-installed');
const missingResult = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', nativePath, '-PostgresBin', missingBin],
  { cwd: root, encoding: 'utf8' },
);

const tempRunsAfter = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('ma-stage7c-'))
  .map((entry) => entry.name);
const newTempRuns = tempRunsAfter.filter((entry) => !tempRunsBefore.has(entry));

const remoteResult = spawnSync('node', [runnerPath], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    STAGE7C_DB_URL: 'postgresql://user:password@example.invalid/stage7c_security',
    STAGE7C_EXPECTED_DATA_DIR: 'C:\\temp\\stage7c',
    STAGE7C_EXPECTED_PORT: '55437',
  },
});

const checks = [
  ['31 cenarios preservados', (runner.match(/^\s+check\(/gm) || []).length === 31],
  ['Promise.all removido do runner', !runner.includes('Promise.all(')],
  ['leituras por identidade sao sequenciais', runner.includes('visibleCountsSequential') && runner.includes('for (const [userId, table, role] of entries)')],
  ['diretorio real do cluster e obrigatorio', runner.includes('STAGE7C_EXPECTED_DATA_DIR') && runner.includes('Diretorio de dados recusado')],
  ['porta efetiva e obrigatoria', runner.includes('STAGE7C_EXPECTED_PORT') && runner.includes('Porta efetiva recusada')],
  ['papeis sem superuser e bypass validados', runner.includes('rolsuper') && runner.includes('rolbypassrls')],
  ['orquestrador exige caminho de binarios', native.includes('[string]$PostgresBin') && native.includes('Resolve-Path -LiteralPath $PostgresBin')],
  ['todos os binarios necessarios sao exigidos', ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe', 'createdb.exe', 'psql.exe'].every((name) => native.includes(name))],
  ['PostgreSQL major 17 e validado', native.includes("-notmatch 'PostgreSQL\\) 17\\.'")],
  ['servidor fica em loopback', native.includes("listen_addresses = '127.0.0.1'") && native.includes('-h 127.0.0.1')],
  ['autenticacao SCRAM e configurada', native.includes('scram-sha-256')],
  ['cluster e banco recebem identificadores unicos', native.includes("'ma-stage7c-' + [Guid]::NewGuid()") && native.includes("'stage7c_' + [Guid]::NewGuid()")],
  ['limpeza exige prefixo e marcador', native.includes('Test-SafeInstancePath') && native.includes('.stage7c-disposable') && native.includes('$markerMatches')],
  ['remocao usa caminho literal restrito', native.includes('Remove-Item -LiteralPath $instanceRoot -Recurse -Force')],
  ['porta e verificada antes e depois', (native.match(/Get-NetTCPConnection/g) || []).length >= 3],
  ['somente runner local homologado e chamado', native.includes('scripts\\homologate-stage7c-local.cjs') && !native.includes('run-real-postgresql-homologation') && !native.includes('test-postgrest-snapshot')],
  ['evidencia remove senha', native.includes(".Replace($password, '[REDACTED]')")],
  ['papeis do baseline declaram NOBYPASSRLS', (bootstrap.match(/NOBYPASSRLS/g) || []).length === 2],
  ['ausencia de binarios falha antes de criar cluster', missingResult.status !== 0 && newTempRuns.length === 0],
  ['host remoto continua bloqueado sem conectar', remoteResult.status !== 0 && `${remoteResult.stderr}${remoteResult.stdout}`.includes('Host recusado')],
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
