import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { PaymentProviderCode } from '@/types/payment';
import { AsaasPaymentProvider } from './asaas.provider';
import { MercadoPagoPaymentProvider } from './mercadopago.provider';
import { MockPaymentProvider } from './mock.provider';
import type { IPaymentProvider } from './provider.interface';

export class PaymentProviderFactory {
  private static async getVaultAsaasProvider(
    tenantId: string,
    environment?: 'sandbox' | 'production'
  ): Promise<IPaymentProvider | null> {
    const adminClient = getAdminClient() as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await adminClient.rpc('service_get_asaas_runtime_integration', {
      p_tenant_id: tenantId,
      p_environment: environment || null,
    });
    if (error) {
      // Compatibilidade enquanto a migration 76 ainda não foi aplicada.
      if (/service_get_asaas_runtime_integration|schema cache/i.test(error.message)) return null;
      throw new Error('Não foi possível carregar a integração Asaas ativa.');
    }
    const row = data?.[0];
    if (!row) return null;
    return new AsaasPaymentProvider({
      apiKey: String(row.api_key),
      webhookSecret: String(row.webhook_secret),
      isSandbox: row.environment === 'sandbox',
    });
  }

  static async getAsaasProviderForTenant(
    tenantId: string,
    environment?: 'sandbox' | 'production'
  ): Promise<IPaymentProvider> {
    const provider = await this.getVaultAsaasProvider(tenantId, environment);
    if (!provider) throw new Error('ASAAS_INTEGRATION_NOT_ACTIVE: configure e ative o ambiente no painel master.');
    return provider;
  }

  /**
   * Obtém a instância do provedor configurado para o tenant.
   */
  static async getProviderForTenant(
    tenantId: string,
    preferredCode?: PaymentProviderCode
  ): Promise<IPaymentProvider> {
    if (!preferredCode || preferredCode === 'asaas') {
      const activeAsaas = await this.getVaultAsaasProvider(tenantId);
      if (activeAsaas) return activeAsaas;
    }

    const adminClient = getAdminClient();

    // 1. Buscar configuração do tenant no banco
    let query = adminClient
      .from('payment_providers')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (preferredCode) {
      query = query.eq('code', preferredCode);
    }

    const { data: providerConfig } = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();

    const code = (providerConfig?.code || preferredCode || process.env.DEFAULT_PAYMENT_PROVIDER || 'mock') as PaymentProviderCode;
    const creds = (providerConfig?.credentials || {}) as Record<string, string>;

    if (code === 'asaas') {
      const vaultProvider = await this.getVaultAsaasProvider(tenantId);
      if (vaultProvider) return vaultProvider;
    }
    return this.createProvider(code, creds);
  }

  /**
   * Instancia diretamente um provedor por código com fallback em variáveis de ambiente.
   */
  static createProvider(code: PaymentProviderCode, credentials: Record<string, string> = {}): IPaymentProvider {
    switch (code) {
      case 'asaas': {
        const apiKey = credentials.apiKey || process.env.ASAAS_API_KEY || '';
        const webhookSecret = credentials.webhookSecret || process.env.ASAAS_WEBHOOK_SECRET;
        // O destino financeiro nunca pode ser inferido a partir de NODE_ENV. A
        // selecao do sandbox precisa ser explicita para impedir que um build de
        // desenvolvimento use, por engano, o endpoint produtivo.
        const isSandbox = process.env.ASAAS_SANDBOX === 'true';
        return new AsaasPaymentProvider({ apiKey, webhookSecret, isSandbox });
      }

      case 'mercadopago': {
        const accessToken = credentials.accessToken || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
        const webhookSecret = credentials.webhookSecret || process.env.MERCADOPAGO_WEBHOOK_SECRET;
        return new MercadoPagoPaymentProvider({ accessToken, webhookSecret });
      }

      case 'sitef':
        throw new Error('NOT_IMPLEMENTED: Provedor SiTef/Fiserv planejado para fase de homologação presencial.');

      case 'mock':
        if (process.env.NODE_ENV === 'production') {
          throw new Error('UNAVAILABLE_PROVIDER: Provedor mock bloqueado em producao.');
        }
        return new MockPaymentProvider();

      default: {
        const exhaustiveCheck: never = code;
        throw new Error(`INVALID_PROVIDER: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
