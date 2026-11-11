const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'scripts/stage8a/function-hardening-baseline.sql',
  'scripts/homologate-stage8a-function-hardening.cjs',
  'scripts/stage8a/run-native-hardening.ps1',
  'supabase/migrations/20261027000075_harden_public_function_execution.sql',
];
const checks = [];
function check(name, value) { checks.push([name, Boolean(value)]); console.log(`${value ? 'PASS' : 'FAIL'} ${String(checks.length).padStart(2, '0')} ${name}`); }
required.forEach((file) => check(`arquivo existe: ${file}`, fs.existsSync(path.join(root, file))));
const baseline = fs.readFileSync(path.join(root, required[0]), 'utf8');
const runner = fs.readFileSync(path.join(root, required[1]), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, required[2]), 'utf8');
check('baseline contem as 12 assinaturas alvo', (baseline.match(/CREATE (?:FUNCTION|EVENT TRIGGER)/g) || []).length >= 12);
check('runner bloqueia host remoto', runner.includes('allowedHosts') && runner.includes('Host recusado'));
check('runner exige prefixo de banco descartavel', runner.includes("startsWith('stage8a_')"));
check('runner aplica migrations 72 a 75', ['migration72','migration73','migration74','migration75'].every((item) => runner.includes(item)));
check('runner prova rollback', runner.includes("owner.query('ROLLBACK')") && runner.includes('rollback restaura'));
check('runner prova idempotencia', runner.includes('segunda aplicacao da migration 75'));
check('runner testa RPC ativa e acesso cruzado', runner.includes('RPC ativa responde') && runner.includes('acesso cruzado'));
check('runner testa gatilhos', runner.includes('triggers de caixa') && runner.includes('trigger de perfil') && runner.includes('event trigger'));
check('orquestrador exige PostgreSQL 17', orchestrator.includes("PostgreSQL\\) 17\\."));
check('orquestrador restringe loopback e SCRAM', orchestrator.includes("listen_addresses = '127.0.0.1'") && orchestrator.includes('scram-sha-256'));
check('limpeza depende de marcador proprio', orchestrator.includes('.stage8a-disposable') && orchestrator.includes('markerMatches'));
check('segredos sao sanitizados', orchestrator.includes("Replace($password, '[REDACTED]')"));
const failed = checks.filter(([, value]) => !value).length;
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;

