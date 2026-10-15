import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { PaymentProviderCode } from '@/types/payment';
import { AsaasPaymentProvider } from './asaas.provider';
import { MercadoPagoPaymentProvider } from './mercadopago.provider';
import { MockPaymentProvider } from './mock.provider';
import type { IPaymentProvider } from './provider.interface';

export class PaymentProviderFactory {
  /**
   * Obtém a instância do provedor configurado para o tenant.
   */
  static async getProviderForTenant(
    tenantId: string,
    preferredCode?: PaymentProviderCode
  ): Promise<IPaymentProvider> {
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

    return this.createProvider(code, creds);
  }

  /**
   * Instancia diretamente um provedor por código com fallback em variáveis de ambiente.
   */
  static createProvider(code: PaymentProviderCode, credentials: Record<string, string> = {}): IPaymentProvider {
    switch (code) {
      case 'asaas': {
        const apiKey = credentials.apiKey || process.env.ASAAS_API_KEY || 'mock_asaas_key';
        const webhookSecret = credentials.webhookSecret || process.env.ASAAS_WEBHOOK_SECRET;
        const isSandbox = process.env.NODE_ENV !== 'production' || process.env.ASAAS_SANDBOX === 'true';
        return new AsaasPaymentProvider({ apiKey, webhookSecret, isSandbox });
      }

      case 'mercadopago': {
        const accessToken = credentials.accessToken || process.env.MERCADOPAGO_ACCESS_TOKEN || 'mock_mp_token';
        const webhookSecret = credentials.webhookSecret || process.env.MERCADOPAGO_WEBHOOK_SECRET;
        return new MercadoPagoPaymentProvider({ accessToken, webhookSecret });
      }

      case 'sitef':
        throw new Error('NOT_IMPLEMENTED: Provedor SiTef/Fiserv planejado para fase de homologação presencial.');

      case 'mock':
      default:
        return new MockPaymentProvider();
    }
  }
}
