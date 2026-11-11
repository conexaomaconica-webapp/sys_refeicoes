const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const migration = read('supabase/migrations/20261028000076_add_secure_asaas_integrations.sql');
const service = read('src/services/admin-payment-integration.service.ts');
const manager = read('src/app/admin/integracoes/AsaasIntegrationManager.tsx');
const route = read('src/app/api/webhooks/payments/[provider]/route.ts');
const factory = read('src/server/payments/provider.factory.ts');
const shell = read('src/components/admin/AdminShell.tsx');

const checks = [
  ['rota master criada', exists('src/app/admin/integracoes/page.tsx') && exists('src/app/admin/integracoes/layout.tsx')],
  ['menu exclusivo do admin geral', shell.includes('/admin/integracoes') && shell.includes("roles: ['admin_general']")],
  ['layout reforca admin geral', read('src/app/admin/integracoes/layout.tsx').includes("profile.role !== 'admin_general'")],
  ['Vault habilitado', migration.includes('supabase_vault') && migration.includes('vault.create_secret')],
  ['segredos atualizados sem retorno ao cliente', migration.includes('vault.update_secret') && !manager.includes('api_key')],
  ['tabela com RLS forcado', migration.includes('FORCE ROW LEVEL SECURITY')],
  ['tabela sem acesso direto autenticado', migration.includes('REVOKE ALL ON TABLE public.payment_gateway_integrations FROM PUBLIC, anon, authenticated')],
  ['RPCs de segredo restritas ao service role', migration.includes('GRANT EXECUTE ON FUNCTION public.service_get_asaas_integration(UUID, TEXT) TO service_role')],
  ['listagem autenticada nao retorna segredos', migration.includes('admin_list_asaas_integrations') && migration.includes('has_api_key BOOLEAN')],
  ['chaves separadas por ambiente', migration.includes("'$aact_hmlg_'") && migration.includes("'$aact_prod_'")],
  ['somente um ambiente ativo', migration.includes('uq_payment_gateway_active_provider')],
  ['producao bloqueada por gate', service.includes('PAYMENT_PRODUCTION_ENABLE_ALLOWED')],
  ['teste API somente leitura', service.includes('/myAccount/status/') && service.includes("method: 'GET'")],
  ['teste API possui timeout', service.includes('AbortSignal.timeout')],
  ['teste webhook cobre positivo e negativo', service.includes('verifyAsaasWebhookToken(webhookSecret, webhookSecret)') && service.includes('-invalido')],
  ['URL webhook inclui tenant e ambiente', manager.includes('tenant_id=${tenantId}') && manager.includes('environment=${environment}')],
  ['webhook valida UUID e ambiente', route.includes('Destino de webhook inválido')],
  ['runtime usa Vault ativo', factory.includes('service_get_asaas_runtime_integration')],
  ['endpoint sandbox oficial', read('src/server/payments/asaas.provider.ts').includes('https://api-sandbox.asaas.com/v3')],
  ['nenhum segredo e logado', !/console\.(?:log|error)\([^\n]*(?:apiKey|webhookSecret)/.test(service)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);

