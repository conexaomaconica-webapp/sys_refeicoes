import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { verifyAsaasWebhookToken } from '@/server/payments/webhook-signature';

export type PaymentEnvironment = 'sandbox' | 'production';

export interface AsaasIntegrationSummary {
  environment: PaymentEnvironment;
  isActive: boolean;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  lastApiTestStatus: 'not_tested' | 'success' | 'failed';
  lastApiTestAt: string | null;
  lastWebhookTestStatus: 'not_tested' | 'success' | 'failed';
  lastWebhookTestAt: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
}

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type UntypedRpcClient = { rpc: (name: string, args: Record<string, unknown>) => RpcResult<unknown> };

async function requireMaster() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre novamente.');
  const { data } = await supabase.from('profiles').select('tenant_id,role,status').eq('id', user.id).maybeSingle();
  const profile = data as { tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active' || profile.role !== 'admin_general') {
    throw new Error('Apenas o usuário master pode gerenciar integrações financeiras.');
  }
  return { userId: user.id, tenantId: profile.tenant_id, supabase };
}

export async function listAsaasIntegrationsServer(): Promise<{
  tenantId: string;
  integrations: AsaasIntegrationSummary[];
}> {
  const { userId, tenantId, supabase } = await requireMaster();
  const { data, error } = await (supabase as unknown as UntypedRpcClient).rpc(
    'admin_list_asaas_integrations',
    { p_requester_id: userId }
  );
  if (error) throw new Error(error.message);
  const rows = (data || []) as Array<Record<string, unknown>>;
  return {
    tenantId,
    integrations: rows.map((row) => ({
      environment: row.environment as PaymentEnvironment,
      isActive: Boolean(row.is_active),
      hasApiKey: Boolean(row.has_api_key),
      hasWebhookSecret: Boolean(row.has_webhook_secret),
      lastApiTestStatus: row.last_api_test_status as AsaasIntegrationSummary['lastApiTestStatus'],
      lastApiTestAt: row.last_api_test_at as string | null,
      lastWebhookTestStatus: row.last_webhook_test_status as AsaasIntegrationSummary['lastWebhookTestStatus'],
      lastWebhookTestAt: row.last_webhook_test_at as string | null,
      lastTestMessage: row.last_test_message as string | null,
      updatedAt: row.updated_at as string,
    })),
  };
}

export async function saveAsaasIntegrationServer(input: {
  environment: PaymentEnvironment;
  apiKey?: string;
  webhookSecret?: string;
  isActive: boolean;
}) {
  const { userId } = await requireMaster();
  const apiKey = input.apiKey?.trim() || null;
  const webhookSecret = input.webhookSecret?.trim() || null;
  const expectedPrefix = input.environment === 'sandbox' ? '$aact_hmlg_' : '$aact_prod_';
  if (apiKey && !apiKey.startsWith(expectedPrefix)) {
    throw new Error(`A chave não pertence ao ambiente ${input.environment === 'sandbox' ? 'Sandbox' : 'Produção'}.`);
  }
  if (webhookSecret && webhookSecret.length < 32) {
    throw new Error('O segredo do webhook deve possuir pelo menos 32 caracteres.');
  }
  if (input.environment === 'production' && input.isActive && process.env.PAYMENT_PRODUCTION_ENABLE_ALLOWED !== 'true') {
    throw new Error('A ativação produtiva permanece bloqueada pelo gate de publicação. Salve sem ativar.');
  }

  const admin = createAdminClient() as unknown as UntypedRpcClient;
  const { error } = await admin.rpc('service_upsert_asaas_integration', {
    p_requester_id: userId,
    p_environment: input.environment,
    p_api_key: apiKey,
    p_webhook_secret: webhookSecret,
    p_is_active: input.isActive,
  });
  if (error) throw new Error(error.message);
}

async function getSecretConfig(userId: string, environment: PaymentEnvironment) {
  const admin = createAdminClient() as unknown as UntypedRpcClient;
  const { data, error } = await admin.rpc('service_get_asaas_integration', {
    p_requester_id: userId,
    p_environment: environment,
  });
  if (error) throw new Error(error.message);
  const row = ((data || []) as Array<Record<string, unknown>>)[0];
  if (!row) throw new Error('Configure e salve as credenciais antes de testar.');
  return {
    apiKey: String(row.api_key),
    webhookSecret: String(row.webhook_secret),
  };
}

async function recordTest(userId: string, environment: PaymentEnvironment, type: 'api' | 'webhook', success: boolean, message: string) {
  const admin = createAdminClient() as unknown as UntypedRpcClient;
  await admin.rpc('service_record_asaas_test', {
    p_requester_id: userId,
    p_environment: environment,
    p_test_type: type,
    p_success: success,
    p_message: message,
  });
}

export async function testAsaasApiServer(environment: PaymentEnvironment) {
  const { userId } = await requireMaster();
  const { apiKey } = await getSecretConfig(userId, environment);
  const expectedPrefix = environment === 'sandbox' ? '$aact_hmlg_' : '$aact_prod_';
  if (!apiKey.startsWith(expectedPrefix)) throw new Error('A chave armazenada não corresponde ao ambiente selecionado.');
  const baseUrl = environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';

  try {
    const response = await fetch(`${baseUrl}/myAccount/status/`, {
      method: 'GET',
      headers: { accept: 'application/json', access_token: apiKey, 'User-Agent': 'Sistema-MA-Refeicoes/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const success = response.ok;
    const message = success ? `API autenticada com sucesso (HTTP ${response.status}).` : `API recusou a autenticação (HTTP ${response.status}).`;
    await recordTest(userId, environment, 'api', success, message);
    if (!success) throw new Error(message);
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha de comunicação com o Asaas.';
    await recordTest(userId, environment, 'api', false, message);
    throw new Error(message);
  }
}

export async function testAsaasWebhookServer(environment: PaymentEnvironment) {
  const { userId } = await requireMaster();
  const { webhookSecret } = await getSecretConfig(userId, environment);
  const success = verifyAsaasWebhookToken(webhookSecret, webhookSecret) &&
    !verifyAsaasWebhookToken(`${webhookSecret}-invalido`, webhookSecret);
  const message = success
    ? 'Segredo validado: assinatura correta aceita e assinatura inválida rejeitada.'
    : 'Falha na validação fail-closed do segredo de webhook.';
  await recordTest(userId, environment, 'webhook', success, message);
  if (!success) throw new Error(message);
  return message;
}

