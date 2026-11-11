const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const suites = [
  ['webhook-signatures', 'scripts/test-stage9d-webhook-signatures.cjs'],
  ['stage9d-controls', 'scripts/validate-stage9d.cjs'],
  ['authentication-login-branding', 'scripts/validate-login-branding.cjs'],
  ['authentication-consumer-access', 'scripts/validate-consumer-access-management.cjs'],
  ['authentication-first-access', 'scripts/validate-consumer-first-access.cjs'],
  ['terminal-and-cash-regression', 'scripts/validate-post-sprint10-stabilization.cjs'],
  ['import-base', 'scripts/validate-sprint4.cjs'],
  ['import-tolerant', 'scripts/validate-sprint11.cjs'],
  ['consumer-wallet-pwa', 'scripts/validate-sprint12.cjs'],
  ['rls-static-regression', 'scripts/validate-stage7-security.cjs'],
  ['health-and-release-controls', 'scripts/validate-stage9c.cjs'],
];

function parseCounts(output) {
  const patterns = [
    /RESULT passed=(\d+) failed=(\d+) total=(\d+)/,
    /RESULTADO:\s*(\d+) PASSED,\s*(\d+) FAILED/i,
    /(\d+)\/(\d+) checks passed/i,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (!match) continue;
    if (pattern === patterns[0]) {
      return { passed: Number(match[1]), failed: Number(match[2]), total: Number(match[3]) };
    }
    if (pattern === patterns[1]) {
      return { passed: Number(match[1]), failed: Number(match[2]), total: Number(match[1]) + Number(match[2]) };
    }
    return { passed: Number(match[1]), failed: Number(match[2]) - Number(match[1]), total: Number(match[2]) };
  }
  return null;
}

const results = [];
for (const [name, relativeScript] of suites) {
  const execution = spawnSync(process.execPath, [path.join(root, relativeScript)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, STAGE9D_LOCAL_ONLY: 'true' },
  });
  const output = `${execution.stdout || ''}\n${execution.stderr || ''}`;
  const passed = execution.status === 0;
  results.push({
    name,
    script: relativeScript,
    passed,
    exitCode: execution.status,
    counts: parseCounts(output),
  });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) {
    console.error(output.trim().split(/\r?\n/).slice(-12).join('\n'));
  }
}

const passedSuites = results.filter((result) => result.passed).length;
const evidence = {
  stage: '9D',
  scope: 'local-only-synthetic-no-remote-access',
  generatedAt: new Date().toISOString(),
  verdict: passedSuites === results.length ? 'GO_LOCAL_WITH_EXTERNAL_GATES_PENDING' : 'NO_GO_LOCAL',
  suites: results,
  pendingExternalGates: [
    'real-payment-provider-sandbox',
    'restore-drill-in-isolated-infrastructure',
    'hosted-application-rollback-drill',
    'negative-isolation-between-two-real-units',
    'manual-browser-and-physical-terminal-acceptance',
  ],
  remoteConnectionsPerformed: 0,
  realFinancialTransactionsPerformed: 0,
};

const evidenceDir = path.join(root, 'docs/evidence/stage9d');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, 'stage9d-local-20261028.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8'
);

console.log(`RESULT passed=${passedSuites} failed=${results.length - passedSuites} total=${results.length}`);
if (passedSuites !== results.length) process.exit(1);
