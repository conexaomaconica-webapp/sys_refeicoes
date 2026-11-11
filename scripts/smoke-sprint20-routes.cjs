/**
 * ==============================================================================
 * SPRINT 20 — SMOKE TEST DE SERVIDOR LOCAL (SSR, ROTAS E GUARDS DE AUTENTICAÇÃO)
 * Executa o build de produção Next.js em loopback isolado com variáveis sintéticas
 * (sem tocar no Supabase remoto) e valida HTTP 200 nas rotas públicas, ausência
 * de marcadores legados/mojibake no HTML e redirecionamento seguro nas rotas privadas.
 * ==============================================================================
 */

const path = require('node:path');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = 3229;
const baseUrl = `http://127.0.0.1:${port}`;
const nextBin = path.join(root, 'node_modules/next/dist/bin/next');

const child = spawn(
  process.execPath,
  ['-r', './scripts/patch-fs.cjs', nextBin, 'start', '-H', '127.0.0.1', '-p', String(port)],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://sprint20-synthetic.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sprint20-synthetic-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'sprint20-synthetic-server-key',
      CONSUMER_IDENTITY_HMAC_KEY: 'sprint20-synthetic-hmac-key-32-characters',
      NEXT_PUBLIC_APP_URL: baseUrl,
      NEXT_PUBLIC_DEFAULT_TENANT_SLUG: 'sprint20-synthetic',
      DEFAULT_PAYMENT_PROVIDER: 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let logs = '';
child.stdout.on('data', (chunk) => {
  logs = `${logs}${chunk}`.slice(-4000);
});
child.stderr.on('data', (chunk) => {
  logs = `${logs}${chunk}`.slice(-4000);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Servidor Next.js encerrou prematuramente:\n${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health/live`, { cache: 'no-store' });
      if (res.status === 200) return;
    } catch {
      // aguarda servidor subir
    }
    await delay(400);
  }
  throw new Error(`Timeout aguardando servidor local Next.js na porta 3229.\nLogs:\n${logs}`);
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

async function main() {
  console.log('================================================================================');
  console.log('SPRINT 20: SMOKE TEST HTTP & GUARDS DE AUTENTICAÇÃO EM SERVIDOR LOCAL');
  console.log('================================================================================\n');

  let passed = 0;
  try {
    await waitForServer();

    const publicRoutes = [
      '/api/health/live',
      '/',
      '/login',
      '/terminal',
      '/conta/login',
      '/conta/esqueci-senha',
      '/conta/primeiro-acesso',
      '/demonstracao/central-inteligencia',
    ];

    for (const route of publicRoutes) {
      console.log(`  [TEST] GET ${route}...`);
      const res = await fetch(`${baseUrl}${route}`, {
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.text();
      assert.strictEqual(res.status, 200, `${route} retornou HTTP ${res.status} (location: ${res.headers.get('location') || '-'})`);
      if (!route.startsWith('/api/')) {
        assert(!body.includes('Application error: a server-side exception'), `${route} renderizou erro Next`);
        const mojibakeMatch = body.match(/Ã[£¡ª­³¢º©]|ï¿½|\uFFFD/);
        assert(!mojibakeMatch, `${route} possui mojibake UTF-8 no HTML: ${mojibakeMatch ? mojibakeMatch[0] : ''}`);
      }
      if (route === '/') {
        assert(!body.includes('Auditoria Sprint 1'), 'Home / não deve conter botão debug Sprint 1');
      }
      if (route === '/terminal') {
        assert(!body.includes('RA900001') && !body.includes('VISITANTE01'), '/terminal não deve expor RAs mock');
        assert(!body.includes('operador@marefeicoes.com'), '/terminal não deve expor credencial mock');
      }
      passed += 1;
      console.log(`  [PASS] GET ${route} -> HTTP ${res.status}`);
    }

    const protectedRoutes = [
      { route: '/admin', expectedRedirectPart: '/login' },
      { route: '/admin/caixa', expectedRedirectPart: '/login' },
      { route: '/admin/conciliacao', expectedRedirectPart: '/login' },
      { route: '/admin/relatorios', expectedRedirectPart: '/login' },
      { route: '/admin/ajustes-refeicoes', expectedRedirectPart: '/login' },
      { route: '/admin/contingencia', expectedRedirectPart: '/login' },
      { route: '/consumer', expectedRedirectPart: '/conta/login' },
      { route: '/conta/redefinir-senha', expectedRedirectPart: '/login' },
    ];

    for (const item of protectedRoutes) {
      const res = await fetch(`${baseUrl}${item.route}`, { cache: 'no-store', redirect: 'manual' });
      const location = res.headers.get('location') || '';
      assert(
        res.status >= 300 && res.status < 400,
        `${item.route} deveria redirecionar sem sessão, retornou HTTP ${res.status}`
      );
      assert(
        location.includes(item.expectedRedirectPart),
        `${item.route} redirecionou para "${location}", esperado conter "${item.expectedRedirectPart}"`
      );
      passed += 1;
      console.log(`  [PASS] GUARD ${item.route} -> HTTP ${res.status} (${location})`);
    }

    const total = publicRoutes.length + protectedRoutes.length;
    console.log(`\nSPRINT 20 SERVER SMOKE CHECKS: ${passed}/${total} PASS (0 failures)`);
  } finally {
    await stopServer();
  }
}

main().catch((err) => {
  console.log(`\n[FAIL] Smoke server Sprint 20: ${err.message}`);
  process.exit(1);
});

