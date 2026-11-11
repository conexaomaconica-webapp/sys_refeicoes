const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const nextBin = path.join(root, 'node_modules/next/dist/bin/next');

const child = spawn(
  process.execPath,
  ['-r', './scripts/patch-fs.cjs', nextBin, 'start', '-H', '127.0.0.1', '-p', '3100'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://sprint20-synthetic.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sprint20-synthetic-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'sprint20-synthetic-server-key',
      CONSUMER_IDENTITY_HMAC_KEY: 'sprint20-synthetic-hmac-key-32-characters',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
      NEXT_PUBLIC_DEFAULT_TENANT_SLUG: 'sprint20-synthetic',
      DEFAULT_PAYMENT_PROVIDER: 'mock',
    },
  }
);

const forwardSignal = (signal) => {
  if (child.exitCode === null) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));

