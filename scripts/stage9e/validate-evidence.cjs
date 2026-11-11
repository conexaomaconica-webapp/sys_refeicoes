const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const templateDir = path.join(root, 'docs/evidence/stage9e/templates');
const defaultFiles = fs.readdirSync(templateDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.join(templateDir, file));
const files = process.argv.slice(2).map((file) => path.resolve(root, file));
const targets = files.length ? files : defaultFiles;
const allowedStages = new Set(['9E.1', '9E.2', '9E.3', '9E.4', '9E.5']);
const forbiddenValuePatterns = [
  /postgres(?:ql)?:\/\//i,
  /supabase\.co/i,
  /(?:eyJ|sbp_)[A-Za-z0-9._-]{20,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

let failed = 0;
function check(name, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

for (const file of targets) {
  const relative = path.relative(root, file);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    check(`${relative}: JSON válido`, false);
    continue;
  }

  check(`${relative}: etapa reconhecida`, allowedStages.has(document.stage));
  check(`${relative}: autorização presente`, Boolean(document.authorization?.status));
  check(`${relative}: ambiente declarado`, Boolean(document.environment?.kind));
  check(`${relative}: total obrigatório positivo`, Number.isInteger(document.results?.totalRequired) && document.results.totalRequired > 0);
  check(`${relative}: contagens numéricas`, ['passed', 'failed', 'notTested'].every((key) => Number.isInteger(document.results?.[key])));
  check(`${relative}: evidência é lista`, Array.isArray(document.evidence));
  check(`${relative}: riscos são lista`, Array.isArray(document.residualRisks));

  const serialized = JSON.stringify(document);
  check(`${relative}: sem segredo/URL privada`, !forbiddenValuePatterns.some((pattern) => pattern.test(serialized)));

  if (document.executionStatus === 'not_executed') {
    check(`${relative}: template permanece fail-closed`,
      document.authorization.status === 'required' &&
      document.externalActionsPerformed === false &&
      document.remoteConnectionsPerformed === 0 &&
      document.realFinancialTransactionsPerformed === 0 &&
      document.results.passed === 0 &&
      document.results.failed === 0 &&
      document.results.notTested === document.results.totalRequired &&
      document.decision === 'NO_GO_NOT_EXECUTED');
  } else if (document.executionStatus === 'completed') {
    check(`${relative}: execução concluída foi autorizada`, document.authorization.status === 'authorized' && Boolean(document.authorization.reference));
    check(`${relative}: execução possui timestamps`, Boolean(document.startedAt) && Boolean(document.completedAt));
    check(`${relative}: decisão é coerente`,
      document.results.passed + document.results.failed + document.results.notTested === document.results.totalRequired &&
      ['GO', 'NO_GO'].includes(document.decision));
  } else {
    check(`${relative}: status de execução reconhecido`, false);
  }
}

console.log(`RESULT passed=${targets.length * 9 - failed} failed=${failed} total=${targets.length * 9}`);
if (failed) process.exit(1);
