const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/server/payments/webhook-signature.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const signatureModule = new Module(sourcePath, module);
signatureModule.filename = sourcePath;
signatureModule.paths = module.paths;
signatureModule._compile(compiled, sourcePath);

const {
  verifyAsaasWebhookToken,
  verifyMercadoPagoWebhookSignature,
} = signatureModule.exports;

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false });
    console.error(`FAIL ${name}: ${error.name}`);
  }
}

check('Asaas aceita token exato', () => {
  assert.equal(verifyAsaasWebhookToken('segredo-seguro', 'segredo-seguro'), true);
});
check('Asaas rejeita token incorreto', () => {
  assert.equal(verifyAsaasWebhookToken('segredo-falso', 'segredo-seguro'), false);
});
check('Asaas falha fechado sem segredo', () => {
  assert.equal(verifyAsaasWebhookToken('qualquer-token'), false);
});
check('Asaas falha fechado sem header', () => {
  assert.equal(verifyAsaasWebhookToken(null, 'segredo-seguro'), false);
});

const secret = 'stage9d-secret-with-at-least-32-bytes';
const timestamp = '1761667200000';
const requestId = 'stage9d-request-001';
const dataId = 'PAYMENT-ABC-123';
const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
const validHash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
const rawBody = JSON.stringify({ type: 'payment', data: { id: dataId } });

function mercadoPagoHeaders(hash = validHash) {
  return new Headers({
    'x-request-id': requestId,
    'x-signature': `ts=${timestamp},v1=${hash}`,
  });
}

check('Mercado Pago aceita vetor HMAC válido', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: mercadoPagoHeaders(), rawBody, configuredSecret: secret,
  }), true);
});
check('Mercado Pago normaliza data.id para minúsculas', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: mercadoPagoHeaders(), rawBody, configuredSecret: secret,
  }), true);
});
check('Mercado Pago rejeita HMAC adulterado', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: mercadoPagoHeaders('0'.repeat(64)), rawBody, configuredSecret: secret,
  }), false);
});
check('Mercado Pago falha fechado sem segredo', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: mercadoPagoHeaders(), rawBody,
  }), false);
});
check('Mercado Pago falha fechado sem request-id', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: new Headers({ 'x-signature': `ts=${timestamp},v1=${validHash}` }),
    rawBody,
    configuredSecret: secret,
  }), false);
});
check('Mercado Pago aceita data.id fornecido pela query', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    headers: mercadoPagoHeaders(),
    rawBody: '{}',
    configuredSecret: secret,
    dataId,
  }), true);
});

const failed = results.filter((result) => !result.passed).length;
console.log(`RESULT passed=${results.length - failed} failed=${failed} total=${results.length}`);
if (failed) process.exit(1);
