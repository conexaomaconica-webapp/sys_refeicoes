const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const port = 3219;
const baseUrl = `http://127.0.0.1:${port}`;
const nextBin = path.join(root, 'node_modules/next/dist/bin/next');
const evidencePath = path.join(
  root,
  'docs/evidence/stage9d',
  'stage9d1-build-smoke-20261028.json'
);

const child = spawn(
  process.execPath,
  ['-r', './scripts/patch-fs.cjs', nextBin, 'start', '-H', '127.0.0.1', '-p', String(port)],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://stage9d1-synthetic.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stage9d1-synthetic-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'stage9d1-synthetic-server-key',
      CONSUMER_IDENTITY_HMAC_KEY: 'stage9d1-synthetic-hmac-key-32-characters',
      NEXT_PUBLIC_APP_URL: baseUrl,
      NEXT_PUBLIC_DEFAULT_TENANT_SLUG: 'stage9d1-synthetic',
      DEFAULT_PAYMENT_PROVIDER: 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let serverOutput = '';
child.stdout.on('data', (chunk) => {
  serverOutput = `${serverOutput}${chunk}`.slice(-4000);
});
child.stderr.on('data', (chunk) => {
  serverOutput = `${serverOutput}${chunk}`.slice(-4000);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Servidor encerrou antes do smoke.');
    try {
      const response = await fetch(`${baseUrl}/api/health/live`, { cache: 'no-store' });
      if (response.status === 200) return;
    } catch {
      // Aguarda o próximo probe local.
    }
    await delay(500);
  }
  throw new Error('Timeout aguardando o servidor local.');
}

async function stopServer() {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(10_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function run() {
  const checks = [];
  try {
    await waitForServer();
    const routes = [
      '/api/health/live',
      '/api/health/ready',
      '/',
      '/login',
      '/terminal',
      '/conta/esqueci-senha',
      '/demonstracao/central-inteligencia',
    ];

    for (const route of routes) {
      const response = await fetch(`${baseUrl}${route}`, {
        cache: 'no-store',
        redirect: 'follow',
      });
      const passed = response.status === 200;
      checks.push({ route, status: response.status, passed });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${route} HTTP ${response.status}`);
    }

    const live = await fetch(`${baseUrl}/api/health/live`, { cache: 'no-store' });
    const liveBody = await live.json();
    const livePassed = liveBody.status === 'ok' && live.headers.get('cache-control')?.includes('no-store');
    checks.push({ route: '/api/health/live contract', passed: Boolean(livePassed) });
    console.log(`${livePassed ? 'PASS' : 'FAIL'} liveness sanitizado e sem cache`);

    const ready = await fetch(`${baseUrl}/api/health/ready`, { cache: 'no-store' });
    const readyBody = await ready.json();
    const readyPassed = readyBody.status === 'ready';
    checks.push({ route: '/api/health/ready contract', passed: readyPassed });
    console.log(`${readyPassed ? 'PASS' : 'FAIL'} readiness com configuração sintética`);

    const login = await fetch(`${baseUrl}/login`, { cache: 'no-store' });
    const headersPassed =
      login.headers.get('x-content-type-options') === 'nosniff' &&
      login.headers.get('x-frame-options') === 'DENY' &&
      Boolean(login.headers.get('strict-transport-security'));
    checks.push({ route: '/login security headers', passed: headersPassed });
    console.log(`${headersPassed ? 'PASS' : 'FAIL'} headers de segurança`);

    const failed = checks.filter((check) => !check.passed).length;
    const evidence = {
      stage: '9D.1',
      scope: 'local-http-smoke-with-synthetic-configuration',
      generatedAt: new Date().toISOString(),
      buildIdPresent: fs.existsSync(path.join(root, '.next/BUILD_ID')),
      serverPid: child.pid,
      checks,
      remoteConnectionsPerformed: 0,
      realFinancialTransactionsPerformed: 0,
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`FAIL smoke local: ${error instanceof Error ? error.name : 'UnknownError'}`);
    if (serverOutput.trim()) console.error(serverOutput.trim().split(/\r?\n/).slice(-10).join('\n'));
    process.exitCode = 1;
  } finally {
    await stopServer();
  }
}

run();
