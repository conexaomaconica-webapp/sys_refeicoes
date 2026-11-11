import 'server-only';

import type {
  CardChargeResult,
  CreateCardParams,
  CreatePixParams,
  ParsedWebhookEvent,
  PixChargeResult,
} from '@/types/payment';
import type { IPaymentProvider } from './provider.interface';
import { verifyAsaasWebhookToken } from './webhook-signature';

export interface AsaasConfig {
  apiKey: string;
  webhookSecret?: string;
  isSandbox?: boolean;
}

export class AsaasPaymentProvider implements IPaymentProvider {
  readonly code = 'asaas';
  readonly environment: 'sandbox' | 'production';
  private apiKey: string;
  private webhookSecret?: string;
  private baseUrl: string;

  constructor(config: AsaasConfig) {
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.environment = config.isSandbox ? 'sandbox' : 'production';
    this.baseUrl = config.isSandbox
      ? 'https://api-sandbox.asaas.com/v3'
      : 'https://api.asaas.com/v3';
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey || /^(?:mock_|configure-)/i.test(this.apiKey)) {
      throw new Error('PAYMENT_CREDENTIAL_MISSING: credencial Asaas nao configurada.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Sistema-MA-Refeicoes/1.0',
      access_token: this.apiKey,
      ...(options.headers || {}),
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Asaas API Error [${response.status}]: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  async createPixCharge(params: CreatePixParams): Promise<PixChargeResult> {
    // 1. Criar cobrança PIX no Asaas
    const today = new Date().toISOString().split('T')[0];
    const payment = await this.request<{ id: string; value: number }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: 'cus_000000000000', // customer ID or anonymous/auto customer
        billingType: 'PIX',
        value: params.amount,
        dueDate: today,
        description: params.description,
      }),
    });

    // 2. Obter QR Code e Chave Copia e Cola
    const qrData = await this.request<{
      encodedImage: string;
      payload: string;
      expirationDate: string;
    }>(`/payments/${payment.id}/pixQrCode`);

    return {
      externalId: payment.id,
      qrCodeBase64: qrData.encodedImage,
      copyPasteKey: qrData.payload,
      expiresAt: qrData.expirationDate || new Date(Date.now() + 3600000).toISOString(),
      rawResponse: { payment, qrData },
    };
  }

  async createPixPayment(params: CreatePixParams): Promise<PixChargeResult> {
    return this.createPixCharge(params);
  }

  async createCardCharge(params: CreateCardParams): Promise<CardChargeResult> {
    const today = new Date().toISOString().split('T')[0];
    const payment = await this.request<{ id: string; status: string; netValue?: number }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        billingType: 'CREDIT_CARD',
        value: params.amount,
        dueDate: today,
        description: params.description,
        creditCardToken: params.token,
      }),
    });

    const isApproved = ['CONFIRMED', 'RECEIVED'].includes(payment.status);

    return {
      externalId: payment.id,
      status: isApproved ? 'confirmed' : 'pending',
      rawResponse: payment,
    };
  }

  async createCardPayment(params: CreateCardParams): Promise<CardChargeResult> {
    return this.createCardCharge(params);
  }

  async verifyWebhookSignature(headers: Headers, _rawBody: string, secretOverride?: string): Promise<boolean> {
    const tokenHeader = headers.get('asaas-access-token');
    const secret = secretOverride || this.webhookSecret;
    return verifyAsaasWebhookToken(tokenHeader, secret);
  }

  parseWebhook(payload: unknown): ParsedWebhookEvent {
    const data = payload as {
      id?: string;
      event?: string;
      payment?: { id: string; value: number; status: string };
    };

    const isConfirmed = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(data.event || '');

    return {
      isValid: Boolean(data.payment?.id),
      eventId: data.id || `asaas_evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: data.event || 'UNKNOWN',
      externalPaymentId: data.payment?.id || '',
      isConfirmed,
      amount: data.payment?.value,
      rawPayload: payload,
    };
  }

  async getPaymentStatus(externalId: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
    paidAt?: string;
    amount?: number;
  }> {
    const payment = await this.request<{
      id: string;
      status: string;
      value: number;
      paymentDate?: string;
      clientPaymentDate?: string;
    }>(`/payments/${externalId}`);

    let status: 'pending' | 'confirmed' | 'failed' | 'cancelled' = 'pending';
    if (['CONFIRMED', 'RECEIVED'].includes(payment.status)) {
      status = 'confirmed';
    } else if (['REFUNDED', 'CHARGEBACK'].includes(payment.status)) {
      status = 'cancelled';
    }

    return {
      status,
      paidAt: payment.paymentDate || payment.clientPaymentDate,
      amount: payment.value,
    };
  }
}
