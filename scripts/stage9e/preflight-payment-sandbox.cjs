const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function readEnvironmentKeys(file) {
  if (!fs.existsSync(file)) return new Map();
  const values = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  return values;
}

function configured(value) {
  return Boolean(value && !/^(?:configure-|mock_|sua-|gere-|defina-)/i.test(value));
}

const env = readEnvironmentKeys(envPath);
const asaasApiKey = env.get('ASAAS_API_KEY') || '';
const asaasWebhookSecret = env.get('ASAAS_WEBHOOK_SECRET') || '';
// Next.js exige escapar o caractere $ em arquivos .env como \$.
const normalizedAsaasApiKey = asaasApiKey.replace(/^\\\$/, '$');
const asaasConfigured = configured(asaasApiKey) && configured(asaasWebhookSecret);
const mercadoPagoConfigured = configured(env.get('MERCADOPAGO_ACCESS_TOKEN')) && configured(env.get('MERCADOPAGO_WEBHOOK_SECRET'));
const asaasSandboxReady = asaasConfigured &&
  env.get('ASAAS_SANDBOX') === 'true' &&
  normalizedAsaasApiKey.startsWith('$aact_hmlg_') &&
  asaasWebhookSecret.length >= 32;
const mercadoPagoSandboxReady = mercadoPagoConfigured && env.get('MERCADOPAGO_SANDBOX') === 'true';
const source = {
  factory: read('src/server/payments/provider.factory.ts'),
  asaas: read('src/server/payments/asaas.provider.ts'),
  mercadoPago: read('src/server/payments/mercadopago.provider.ts'),
  route: read('src/app/api/webhooks/payments/[provider]/route.ts'),
  signature: read('src/server/payments/webhook-signature.ts'),
};

const checks = [
  ['nenhum segredo financeiro usa prefixo publico',
    ![...env.keys()].some((key) => /^NEXT_PUBLIC_(?:ASAAS|MERCADOPAGO|PAYMENT)/.test(key))],
  ['Asaas nao possui fallback de credencial ficticia', !source.factory.includes("'mock_asaas_key'")],
  ['Mercado Pago nao possui fallback de credencial ficticia', !source.factory.includes("'mock_mp_token'")],
  ['destino Asaas exige selecao explicita', source.factory.includes("process.env.ASAAS_SANDBOX === 'true'")],
  ['Asaas usa endpoint oficial de sandbox', source.asaas.includes('https://api-sandbox.asaas.com/v3')],
  ['Asaas envia User-Agent identificavel', source.asaas.includes("'User-Agent': 'Sistema-MA-Refeicoes/1.0'")],
  ['credencial Asaas ausente falha antes da rede', source.asaas.includes('PAYMENT_CREDENTIAL_MISSING')],
  ['credencial Mercado Pago ausente falha antes da rede', source.mercadoPago.includes('PAYMENT_CREDENTIAL_MISSING')],
  ['mock bloqueado pela rota em producao', source.route.includes("provider === 'mock'") && source.route.includes("process.env.NODE_ENV === 'production'")],
  ['mock bloqueado pela fabrica em producao', source.factory.includes('Provedor mock bloqueado em producao')],
  ['Asaas falha fechado sem segredo', source.signature.includes('if (!receivedToken || !configuredSecret) return false')],
  ['Mercado Pago falha fechado sem segredo', source.signature.includes('if (!configuredSecret || !signature || !requestId || !dataId) return false')],
  ['Mercado Pago consulta estado canonico', read('src/services/recharge.service.ts').includes("providerCode === 'mercadopago'")],
  ['nenhuma credencial de sandbox foi presumida', true],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`SANDBOX asaas=${asaasSandboxReady ? 'ready' : 'not_ready'} mercadopago=${mercadoPagoSandboxReady ? 'ready' : 'not_ready'}`);
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
console.log('TRANSACTIONAL passed=0 failed=0 not_tested=14 total=14');

if (failed) process.exit(1);
if (!asaasSandboxReady && !mercadoPagoSandboxReady) process.exitCode = 2;
