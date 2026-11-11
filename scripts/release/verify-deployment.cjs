const baseArgument = process.argv.find((argument) => /^https?:\/\//.test(argument));
const allowLocalhost = process.argv.includes('--allow-localhost');

if (!baseArgument) {
  process.stderr.write('Uso: node scripts/release/verify-deployment.cjs <url> [--allow-localhost]\n');
  process.exit(2);
}

const baseUrl = new URL(baseArgument);
const localHost = ['localhost', '127.0.0.1'].includes(baseUrl.hostname);
if (baseUrl.protocol !== 'https:' && !(allowLocalhost && localHost)) {
  process.stderr.write('A URL precisa usar HTTPS. HTTP é permitido somente para localhost com --allow-localhost.\n');
  process.exit(2);
}

const paths = [
  ['/', 'page'],
  ['/login', 'page'],
  ['/demonstracao/central-inteligencia', 'page'],
  ['/api/health/live', 'live'],
  ['/api/health/ready', 'ready'],
];

async function verify() {
  const results = [];
  for (const [pathname, kind] of paths) {
    const response = await fetch(new URL(pathname, baseUrl), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'MA-Refeicoes-Deployment-Smoke/1.0' },
    });
    const securityHeaders =
      response.headers.get('x-content-type-options') === 'nosniff' &&
      response.headers.get('x-frame-options') === 'DENY' &&
      response.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
      Boolean(response.headers.get('permissions-policy'));
    let bodyValid = true;
    if (kind === 'live' || kind === 'ready') {
      const body = await response.json();
      bodyValid = body?.status === (kind === 'live' ? 'ok' : 'ready');
    }
    results.push({ path: pathname, status: response.status, securityHeaders, bodyValid });
  }

  const approved = results.every(
    (result) => result.status === 200 && result.securityHeaders && result.bodyValid
  );
  process.stdout.write(`${JSON.stringify({ approved, checks: results }, null, 2)}\n`);
  if (!approved) process.exitCode = 1;
}

verify().catch((error) => {
  process.stderr.write(`Deployment smoke failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`);
  process.exitCode = 1;
});
