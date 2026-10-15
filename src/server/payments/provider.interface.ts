import type {
  CardChargeResult,
  CreateCardParams,
  CreatePixParams,
  ParsedWebhookEvent,
  PixChargeResult,
} from '@/types/payment';

/**
 * ==============================================================================
 * Interface Unificada de Gateway de Pagamento (Adapter / Strategy Pattern)
 * Desacopla o sistema de qualquer provedor específico (Asaas, Mercado Pago, etc).
 * ==============================================================================
 */
export interface IPaymentProvider {
  /**
   * Código identificador do provedor ('asaas', 'mercadopago', 'mock').
   */
  readonly code: string;

  /**
   * Cria uma cobrança imediata via Pix com QR Code e Chave Copia e Cola.
   */
  createPixCharge(params: CreatePixParams): Promise<PixChargeResult>;

  /**
   * Alias de integração: cria cobrança Pix.
   */
  createPixPayment(params: CreatePixParams): Promise<PixChargeResult>;

  /**
   * Cria uma cobrança via Cartão de Crédito.
   */
  createCardCharge(params: CreateCardParams): Promise<CardChargeResult>;

  /**
   * Alias de integração: cria cobrança Cartão de Crédito.
   */
  createCardPayment(params: CreateCardParams): Promise<CardChargeResult>;

  /**
   * Valida a assinatura de autenticidade enviada no cabeçalho do webhook.
   */
  verifyWebhookSignature(headers: Headers, rawBody: string, webhookSecret?: string): Promise<boolean>;

  /**
   * Converte o payload bruto do webhook em um formato de evento padronizado.
   */
  parseWebhook(payload: unknown): ParsedWebhookEvent;

  /**
   * Consulta o status de um pagamento diretamente na API do gateway (conciliação ativa).
   */
  getPaymentStatus(externalId: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
    paidAt?: string;
    amount?: number;
  }>;
}
