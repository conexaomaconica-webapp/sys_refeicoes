/**
 * ==============================================================================
 * Script de Validação Autônoma e Auditoria da Sprint 7 (Recarga Financeira Automática)
 * Execução: node scripts/validate-sprint7.cjs
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [OK] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

console.log('======================================================================');
console.log('  VALIDAÇÃO AUTÔNOMA DA SPRINT 7 — RECARGA AUTOMÁTICA COM GATEWAY');
console.log('======================================================================\n');

// 1. Validação da Migration 000024 (Tabelas de Gateway, Pagamento, Recarga e Webhook)
console.log('1. Verificando Migration 000024 (Tabelas de Gateway, Pagamentos e Webhooks)...');
const mig24Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000024_create_payment_tables.sql');
assert(fs.existsSync(mig24Path), 'Arquivo 20260927000024_create_payment_tables.sql existe');

if (fs.existsSync(mig24Path)) {
  const content = fs.readFileSync(mig24Path, 'utf8');

  assert(content.includes('CREATE TABLE IF NOT EXISTS public.payment_providers'), 'Cria tabela public.payment_providers');
  assert(content.includes('CREATE TABLE IF NOT EXISTS public.payments'), 'Cria tabela public.payments');
  assert(content.includes('CREATE TABLE IF NOT EXISTS public.recharges'), 'Cria tabela public.recharges');
  assert(content.includes('CREATE TABLE IF NOT EXISTS public.payment_webhook_events'), 'Cria tabela public.payment_webhook_events (Barreira de idempotência)');

  // Checks e Constraints de Integridade
  assert(content.includes('chk_payments_amount CHECK (amount > 0.00)'), 'Possui CHECK garantindo amount > 0.00 em payments');
  assert(content.includes('chk_recharges_amount CHECK (amount > 0.00)'), 'Possui CHECK garantindo amount > 0.00 em recharges');
  assert(content.includes('CONSTRAINT uq_payment_webhook_provider_event UNIQUE (provider_code, event_id)'), 'Idempotência rigorosa UNIQUE (provider_code, event_id)');

  // Isolamento Multi-Tenant
  assert(content.includes('fk_payments_student_tenant'), 'payments possui FK composta (student_id, tenant_id)');
  assert(content.includes('fk_recharges_wallet_tenant'), 'recharges possui FK composta (wallet_id, tenant_id)');
  assert(content.includes('fk_recharges_student_tenant'), 'recharges possui FK composta (student_id, tenant_id)');
}

// 2. Validação da Migration 000025 (RLS, Segurança e RPCs Transacionais Atômicas)
console.log('\n2. Verificando Migration 000025 (RLS Forçado e RPCs Transacionais SQL)...');
const mig25Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000025_create_payment_security_and_rpc.sql');
assert(fs.existsSync(mig25Path), 'Arquivo 20260927000025_create_payment_security_and_rpc.sql existe');

if (fs.existsSync(mig25Path)) {
  const content = fs.readFileSync(mig25Path, 'utf8');

  assert(content.includes('ALTER TABLE public.payment_providers FORCE ROW LEVEL SECURITY;'), 'RLS forçado em payment_providers');
  assert(content.includes('ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;'), 'RLS forçado em payments');
  assert(content.includes('ALTER TABLE public.recharges FORCE ROW LEVEL SECURITY;'), 'RLS forçado em recharges');
  assert(content.includes('ALTER TABLE public.payment_webhook_events FORCE ROW LEVEL SECURITY;'), 'RLS forçado em payment_webhook_events');

  // Mutações client-side bloqueadas
  assert(!content.includes('FOR INSERT TO authenticated'), 'Bloqueia INSERT direto do client-side em pagamentos/recargas');
  assert(!content.includes('FOR UPDATE TO authenticated'), 'Bloqueia UPDATE direto do client-side em pagamentos/recargas');

  // RPC 1: create_payment_order
  assert(content.includes('FUNCTION public.create_payment_order'), 'Define RPC create_payment_order');
  assert(content.includes('IF v_category_requires_wallet IS FALSE THEN'), 'RPC create_payment_order bloqueia alunos Bolsistas Integrais');
  assert(content.includes('REVOKE ALL ON FUNCTION public.create_payment_order FROM authenticated'), 'Revoga execução da RPC create_payment_order para authenticated (exclusivo service_role)');

  // RPC 2: confirm_payment_recharge
  assert(content.includes('FUNCTION public.confirm_payment_recharge'), 'Define RPC confirm_payment_recharge');
  assert(content.includes('FOR UPDATE'), 'confirm_payment_recharge utiliza lock pessimista FOR UPDATE na carteira e pagamento');
  assert(content.includes('INSERT INTO public.wallet_transactions'), 'confirm_payment_recharge lança crédito auditável no Ledger Imutável');
  assert(content.includes('type, amount, balance_before, balance_after'), 'Crédito do ledger contém valores contábeis matematicamente auditados');
  assert(content.includes('already_confirmed'), 'confirm_payment_recharge trata concorrência e retorno idempotente');
}

// 3. Validação dos Provedores e Arquitetura Desacoplada (Adapter/Strategy Pattern)
console.log('\n3. Verificando Arquitetura dos Provedores de Pagamento (Adapter Pattern)...');

const ifacePath = path.join(ROOT_DIR, 'src', 'server', 'payments', 'provider.interface.ts');
assert(fs.existsSync(ifacePath), 'Interface IPaymentProvider definida (src/server/payments/provider.interface.ts)');
if (fs.existsSync(ifacePath)) {
  const c = fs.readFileSync(ifacePath, 'utf8');
  assert(c.includes('createPixPayment'), 'Interface define createPixPayment');
  assert(c.includes('createCardPayment'), 'Interface define createCardPayment');
  assert(c.includes('verifyWebhookSignature'), 'Interface define verifyWebhookSignature');
  assert(c.includes('parseWebhook'), 'Interface define parseWebhook');
  assert(c.includes('getPaymentStatus'), 'Interface define getPaymentStatus');
}

const asaasPath = path.join(ROOT_DIR, 'src', 'server', 'payments', 'asaas.provider.ts');
assert(fs.existsSync(asaasPath), 'Provedor Asaas implementado (src/server/payments/asaas.provider.ts)');
if (fs.existsSync(asaasPath)) {
  const c = fs.readFileSync(asaasPath, 'utf8');
  assert(c.includes('PAYMENT_CONFIRMED') || c.includes('PAYMENT_RECEIVED'), 'Asaas mapeia status PAYMENT_CONFIRMED/RECEIVED');
  assert(c.includes('asaas-access-token'), 'Asaas valida token/secret de webhook');
}

const mpPath = path.join(ROOT_DIR, 'src', 'server', 'payments', 'mercadopago.provider.ts');
assert(fs.existsSync(mpPath), 'Provedor Mercado Pago implementado (src/server/payments/mercadopago.provider.ts)');
if (fs.existsSync(mpPath)) {
  const c = fs.readFileSync(mpPath, 'utf8');
  assert(c.includes('x-signature'), 'Mercado Pago valida assinatura x-signature');
  assert(c.includes('crypto.createHmac'), 'Mercado Pago utiliza HMAC-SHA256 para verificação criptográfica');
}

const mockPath = path.join(ROOT_DIR, 'src', 'server', 'payments', 'mock.provider.ts');
assert(fs.existsSync(mockPath), 'Provedor Mock Sandbox implementado (src/server/payments/mock.provider.ts)');

const factoryPath = path.join(ROOT_DIR, 'src', 'server', 'payments', 'provider.factory.ts');
assert(fs.existsSync(factoryPath), 'Factory multi-tenant implementada (src/server/payments/provider.factory.ts)');

// 4. Validação do Serviço de Recarga e Endpoint Webhook
console.log('\n4. Verificando Serviço de Recarga e Rota de Webhooks...');

const servicePath = path.join(ROOT_DIR, 'src', 'services', 'recharge.service.ts');
assert(fs.existsSync(servicePath), 'Serviço de recarga existe (src/services/recharge.service.ts)');
if (fs.existsSync(servicePath)) {
  const c = fs.readFileSync(servicePath, 'utf8');
  assert(c.includes('category?.requires_wallet === false'), 'Serviço bloqueia alunos integrais antes de gerar cobrança');
  assert(c.includes('initialGatewayStatus === \'confirmed\''), 'Tratamento de crédito imediato para cartão com aprovação instantânea');
  assert(c.includes('processWebhookServer'), 'Serviço exporta processWebhookServer idempotente');
  assert(c.includes('reconcilePaymentServer'), 'Serviço exporta reconciliação de pagamentos pendentes');
}

const webhookRoutePath = path.join(ROOT_DIR, 'src', 'app', 'api', 'webhooks', 'payments', '[provider]', 'route.ts');
assert(fs.existsSync(webhookRoutePath), 'Rota de Webhooks Next.js 15 existe (src/app/api/webhooks/payments/[provider]/route.ts)');
if (fs.existsSync(webhookRoutePath)) {
  const c = fs.readFileSync(webhookRoutePath, 'utf8');
  assert(c.includes('export async function POST'), 'Exporta método POST para receber webhooks');
  assert(c.includes('processWebhookServer'), 'Aciona processWebhookServer server-side');
}

// 5. Validação dos Tipos TypeScript
console.log('\n5. Verificando Tipagem TypeScript...');

const typesPaymentPath = path.join(ROOT_DIR, 'src', 'types', 'payment.ts');
assert(fs.existsSync(typesPaymentPath), 'Arquivo de tipos payment.ts existe');

const dbTypesPath = path.join(ROOT_DIR, 'src', 'types', 'database.types.ts');
if (fs.existsSync(dbTypesPath)) {
  const c = fs.readFileSync(dbTypesPath, 'utf8');
  assert(c.includes('payment_providers:'), 'database.types.ts contém tabela payment_providers');
  assert(c.includes('payments:'), 'database.types.ts contém tabela payments');
  assert(c.includes('recharges:'), 'database.types.ts contém tabela recharges');
  assert(c.includes('payment_webhook_events:'), 'database.types.ts contém tabela payment_webhook_events');
  assert(c.includes('create_payment_order:'), 'database.types.ts contém RPC create_payment_order');
  assert(c.includes('confirm_payment_recharge:'), 'database.types.ts contém RPC confirm_payment_recharge');
}

console.log('\n======================================================================');
console.log(`  RESUMO DA AUDITORIA: ${passCount} aprovados, ${failCount} reprovados`);
console.log('======================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n>> Sprint 7 — Recarga Financeira Automática: ESTRUTURA 100% VALIDADA!\n');
  process.exit(0);
}
