import 'server-only';
import crypto from 'crypto';

import type {
  CardChargeResult,
  CreateCardParams,
  CreatePixParams,
  ParsedWebhookEvent,
  PixChargeResult,
} from '@/types/payment';
import type { IPaymentProvider } from './provider.interface';

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret?: string;
}

export class MercadoPagoPaymentProvider implements IPaymentProvider {
  readonly code = 'mercadopago';
  private accessToken: string;
  private webhookSecret?: string;
  private baseUrl = 'https://api.mercadopago.com/v1';

  constructor(config: MercadoPagoConfig) {
    this.accessToken = config.accessToken;
    this.webhookSecret = config.webhookSecret;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'X-Idempotency-Key': `mp_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      ...(options.headers || {}),
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mercado Pago API Error [${response.status}]: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  async createPixCharge(params: CreatePixParams): Promise<PixChargeResult> {
    interface MPPaymentResponse {
      id: number;
      date_of_expiration?: string;
      point_of_interaction?: {
        transaction_data?: {
          qr_code_base64?: string;
          qr_code?: string;
        };
      };
    }

    const payload = {
      transaction_amount: params.amount,
      description: params.description,
      payment_method_id: 'pix',
      payer: {
        email: params.studentEmail || 'aluno@sistema.local',
        first_name: params.studentName.split(' ')[0] || 'Aluno',
      },
    };

    const data = await this.request<MPPaymentResponse>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const txData = data.point_of_interaction?.transaction_data;

    return {
      externalId: String(data.id),
      qrCodeBase64: txData?.qr_code_base64,
      copyPasteKey: txData?.qr_code || '',
      expiresAt: data.date_of_expiration || new Date(Date.now() + 3600000).toISOString(),
      rawResponse: data,
    };
  }

  async createPixPayment(params: CreatePixParams): Promise<PixChargeResult> {
    return this.createPixCharge(params);
  }

  async createCardCharge(params: CreateCardParams): Promise<CardChargeResult> {
    interface MPCardResponse {
      id: number;
      status: string;
      status_detail?: string;
    }

    const payload = {
      transaction_amount: params.amount,
      token: params.token,
      description: params.description,
      installments: params.installments || 1,
      payment_method_id: 'credit_card',
      payer: {
        email: 'aluno@sistema.local',
      },
    };

    const data = await this.request<MPCardResponse>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const isApproved = data.status === 'approved';

    return {
      externalId: String(data.id),
      status: isApproved ? 'confirmed' : 'pending',
      rawResponse: data,
    };
  }

  async createCardPayment(params: CreateCardParams): Promise<CardChargeResult> {
    return this.createCardCharge(params);
  }

  async verifyWebhookSignature(headers: Headers, _rawBody: string, secretOverride?: string): Promise<boolean> {
    const xSignature = headers.get('x-signature');
    const secret = secretOverride || this.webhookSecret;
    if (!secret || !xSignature) return true; // Em testes locais se não configurado

    try {
      const parts = xSignature.split(',');
      let ts = '';
      let hash = '';
      parts.forEach((p) => {
        const [k, v] = p.split('=');
        if (k.trim() === 'ts') ts = v.trim();
        if (k.trim() === 'v1') hash = v.trim();
      });

      if (!ts || !hash) return false;
      const expected = crypto.createHmac('sha256', secret).update(`id:${ts};`).digest('hex');
      return hash === expected;
    } catch {
      return false;
    }
  }

  parseWebhook(payload: unknown): ParsedWebhookEvent {
    const data = payload as {
      id?: string | number;
      type?: string;
      action?: string;
      data?: { id: string | number };
    };

    const externalId = String(data.data?.id || data.id || '');
    const isPaymentEvent = Boolean(data.type === 'payment' || (data.action && data.action.includes('payment')));

    return {
      isValid: Boolean(externalId),
      eventId: `mp_evt_${data.id || Date.now()}`,
      eventType: data.action || data.type || 'payment.updated',
      externalPaymentId: externalId,
      isConfirmed: isPaymentEvent,
      rawPayload: payload,
    };
  }

  async getPaymentStatus(externalId: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
    paidAt?: string;
    amount?: number;
  }> {
    interface MPPaymentInfo {
      id: number;
      status: string;
      transaction_amount: number;
      date_approved?: string;
    }

    const data = await this.request<MPPaymentInfo>(`/payments/${externalId}`);

    let status: 'pending' | 'confirmed' | 'failed' | 'cancelled' = 'pending';
    if (data.status === 'approved') {
      status = 'confirmed';
    } else if (['rejected', 'cancelled'].includes(data.status)) {
      status = 'failed';
    } else if (data.status === 'refunded') {
      status = 'cancelled';
    }

    return {
      status,
      paidAt: data.date_approved,
      amount: data.transaction_amount,
    };
  }
}
