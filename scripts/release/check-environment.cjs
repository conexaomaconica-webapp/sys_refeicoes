const fs = require('node:fs');
const path = require('node:path');

const requiredPublic = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_NAME',
  'NEXT_PUBLIC_DEFAULT_TENANT_SLUG',
];
const requiredPrivate = ['SUPABASE_SERVICE_ROLE_KEY', 'CONSUMER_IDENTITY_HMAC_KEY'];
const forbiddenPublicFragments = [
  'SERVICE_ROLE',
  'HMAC',
  'SECRET',
  'PASSWORD',
  'ACCESS_TOKEN',
  'API_KEY',
  'DB_URL',
];

function parseEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function isUrl(value, allowLocalhost) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ||
      (allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

const exampleMode = process.argv.includes('--example');
const values = exampleMode
  ? parseEnvFile(path.resolve(__dirname, '..', '..', '.env.example'))
  : process.env;
const checks = [];
const add = (name, passed) => checks.push([name, Boolean(passed)]);

for (const name of [...requiredPublic, ...requiredPrivate]) {
  add(`${name} definido`, values[name]?.length > 0);
}
for (const name of Object.keys(values).filter((key) => key.startsWith('NEXT_PUBLIC_'))) {
  add(
    `${name} não contém classe privada`,
    !forbiddenPublicFragments.some((fragment) => name.includes(fragment))
  );
}

add('URL Supabase válida', isUrl(values.NEXT_PUBLIC_SUPABASE_URL, false));
add('URL da aplicação válida', isUrl(values.NEXT_PUBLIC_APP_URL, exampleMode));
add('HMAC possui no mínimo 32 caracteres', values.CONSUMER_IDENTITY_HMAC_KEY?.length >= 32);

if (!exampleMode) {
  const serialized = [...requiredPublic, ...requiredPrivate].map((name) => values[name]).join(' ');
  add('produção não usa placeholders', !/(sua-|gere-|synthetic-ci|localhost)/i.test(serialized));
}

let failed = 0;
for (const [name, passed] of checks) {
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
  if (!passed) failed += 1;
}
process.stdout.write(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}\n`);
if (failed) process.exit(1);
