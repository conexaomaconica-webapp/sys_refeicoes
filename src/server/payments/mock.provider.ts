import 'server-only';

import type {
  CardChargeResult,
  CreateCardParams,
  CreatePixParams,
  ParsedWebhookEvent,
  PixChargeResult,
} from '@/types/payment';
import type { IPaymentProvider } from './provider.interface';

export class MockPaymentProvider implements IPaymentProvider {
  readonly code = 'mock';

  async createPixCharge(params: CreatePixParams): Promise<PixChargeResult> {
    const mockId = `mock_pix_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const copyPaste = `00020126580014br.gov.bcb.pix0136mock-pix-key-for-test520400005303986540${params.amount.toFixed(2)}5802BR5920SISTEMA MA REFEICOES6009SALVADOR62070503***6304E1D2`;

    return {
      externalId: mockId,
      qrCodeBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      copyPasteKey: copyPaste,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rawResponse: { mock: true, amount: params.amount },
    };
  }

  async createPixPayment(params: CreatePixParams): Promise<PixChargeResult> {
    return this.createPixCharge(params);
  }

  async createCardCharge(params: CreateCardParams): Promise<CardChargeResult> {
    const mockId = `mock_card_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return {
      externalId: mockId,
      status: 'confirmed',
      authorizationCode: 'AUTH_MOCK_123456',
      rawResponse: { mock: true, amount: params.amount },
    };
  }

  async createCardPayment(params: CreateCardParams): Promise<CardChargeResult> {
    return this.createCardCharge(params);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyWebhookSignature(_headers: Headers, _rawBody: string): Promise<boolean> {
    return true;
  }

  parseWebhook(payload: unknown): ParsedWebhookEvent {
    const data = payload as { event_id?: string; external_id?: string; amount?: number; status?: string };
    return {
      isValid: true,
      eventId: data.event_id || `mock_evt_${Date.now()}`,
      eventType: 'PAYMENT_CONFIRMED',
      externalPaymentId: data.external_id || 'mock_payment_123',
      isConfirmed: data.status !== 'failed',
      amount: data.amount,
      rawPayload: payload,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPaymentStatus(_externalId: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
    paidAt?: string;
    amount?: number;
  }> {
    return {
      status: 'confirmed',
      paidAt: new Date().toISOString(),
      amount: 25.00,
    };
  }
}
