const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const terminal = read('src/components/terminal/ReceptionTerminal.tsx');
const terminalPage = read('src/app/terminal/page.tsx');
const cash = read('src/services/cash-shift.service.ts');
const reports = read('src/services/shift-reports.service.ts');
const recharge = read('src/services/recharge.service.ts');
const asaas = read('src/server/payments/asaas.provider.ts');
const mercadoPago = read('src/server/payments/mercadopago.provider.ts');
const signature = read('src/server/payments/webhook-signature.ts');
const webhookRoute = read('src/app/api/webhooks/payments/[provider]/route.ts');
const importService = read('src/services/admin-import.service.ts');
const formula = read('src/lib/security/formula-sanitizer.ts');
const recovery = read('src/app/conta/esqueci-senha/actions.ts');
const password = read('src/app/conta/alterar-senha/actions.ts');
const live = read('src/app/api/health/live/route.ts');
const ready = read('src/app/api/health/ready/route.ts');
const offlineStrategy = read('docs/OFFLINE_STRATEGY.md');
const matrix = read('docs/STAGE_9D_TEST_MATRIX.md');
const report = read('docs/STAGE_9D_PREPUBLICATION_HOMOLOGATION.md');
const paymentMigration = read('supabase/migrations/20260927000025_create_payment_security_and_rpc.sql');

const checks = [
  ['login do terminal valida sessão no servidor', terminalPage.includes('auth.getUser()')],
  ['terminal exige autenticação individual', terminalPage.includes('signInWithPassword')],
  ['recuperação de senha usa fluxo Supabase', recovery.includes('resetPasswordForEmail')],
  ['alteração de senha exige sessão autenticada', password.includes('auth.getUser()') && password.includes('updateUser')],
  ['terminal registra consumo somente por serviço transacional', terminal.includes("from '@/services/consumption.service'")],
  ['terminal suporta abertura e fechamento de caixa', cash.includes('open_operator_cash_shift') && cash.includes('close_operator_cash_shift')],
  ['terminal preserva idempotência física', terminal.includes('idempotency') || terminal.includes('Idempotency')],
  ['relatório inclui aprovados e bloqueados', reports.includes('approved_meals') && reports.includes('blocked_attempts')],
  ['F7 abre relatório do turno', terminal.includes("event.key === 'F7'") || terminal.includes("key === 'F7'")],
  ['modo offline do terminal é fail-closed', terminal.includes('Offline bloqueado')],
  ['terminal não libera consumo offline', !terminal.includes('processOfflineMealConsumption')],
  ['terminal não sincroniza fila offline automaticamente', !terminal.includes('executeOfflineSync')],
  ['documento oficial define online-first fail-safe', offlineStrategy.includes('ONLINE-FIRST') && offlineStrategy.includes('FAIL-SAFE')],
  ['recarga valida vínculo do consumidor', recharge.includes('student.user_id !== user.id')],
  ['categoria isenta não recebe recarga', recharge.includes('requires_wallet === false')],
  ['SiTef permanece bloqueado', recharge.includes("providerCode === 'sitef'")],
  ['Asaas usa verificador fail-closed', asaas.includes('verifyAsaasWebhookToken')],
  ['Mercado Pago usa HMAC oficial', mercadoPago.includes('verifyMercadoPagoWebhookSignature')],
  ['comparação de assinatura é constante', signature.includes('crypto.timingSafeEqual')],
  ['Mercado Pago inclui id request-id e timestamp', signature.includes('request-id:${requestId};ts:${timestamp};')],
  ['Mercado Pago consulta status canônico', recharge.includes("providerCode === 'mercadopago'") && recharge.includes('getPaymentStatus')],
  ['mock é bloqueado em produção', webhookRoute.includes("provider === 'mock' && process.env.NODE_ENV === 'production'")],
  ['webhook possui barreira idempotente no banco', paymentMigration.includes('uq_payment_webhook_provider_event') || paymentMigration.includes('already_processed')],
  ['importação é exclusivamente server-side', importService.includes("import 'server-only';")],
  ['relatório de rejeições neutraliza fórmulas', importService.includes('buildRejectionRows') && formula.includes('sanitize')],
  ['health liveness é sanitizado', live.includes("{ status: 'ok' }")],
  ['health readiness falha com 503', ready.includes('status: ready ? 200 : 503')],
  ['matriz distingue aprovado de pendente', matrix.includes('Aprovado') && matrix.includes('Pendente')],
  ['restauração real permanece pendente', matrix.includes('Restauração') && matrix.includes('Pendente')],
  ['isolamento entre duas unidades reais permanece gate', report.includes('duas unidades reais')],
  ['relatório mantém publicação em NO-GO', report.includes('NO-GO para publicação')],
  ['relatório não declara transação financeira real', report.includes('Nenhuma transação financeira real')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
