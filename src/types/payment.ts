export type PaymentStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type RechargeStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'reversed';

export type PaymentMethod = 'pix' | 'credit_card';

export type PaymentProviderCode = 'asaas' | 'mercadopago' | 'mock' | 'sitef';

export interface PaymentProvider {
  id: string;
  tenant_id: string;
  code: PaymentProviderCode;
  name: string;
  is_active: boolean;
  credentials: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  student_id: string;
  provider_id: string;
  external_payment_id: string | null;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  raw_response: Record<string, unknown> | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Recharge {
  id: string;
  tenant_id: string;
  student_id: string;
  wallet_id: string;
  payment_id: string | null;
  amount: number;
  status: RechargeStatus;
  source: string;
  unit_id: string | null;
  operator_id: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentWebhookEvent {
  id: string;
  tenant_id: string;
  provider_code: PaymentProviderCode;
  event_id: string;
  event_type: string;
  external_payment_id: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  processed_at: string | null;
  created_at: string;
}

export interface CreatePixParams {
  amount: number;
  description: string;
  studentName: string;
  studentEmail?: string;
  studentDocument?: string;
  expiresInMinutes?: number;
}

export interface PixChargeResult {
  externalId: string;
  qrCodeBase64?: string;
  copyPasteKey: string;
  expiresAt: string;
  rawResponse?: unknown;
}

export interface CreateCardParams {
  amount: number;
  token?: string; // Token do cartão gerado no frontend pelo SDK do gateway
  description: string;
  installments?: number;
  cardHolderName?: string;
  cardHolderDocument?: string;
}

export interface CardChargeResult {
  externalId: string;
  status: 'confirmed' | 'pending' | 'failed';
  authorizationCode?: string;
  rawResponse?: unknown;
}

export interface ParsedWebhookEvent {
  isValid: boolean;
  eventId: string;
  eventType: string;
  externalPaymentId: string;
  isConfirmed: boolean;
  amount?: number;
  rawPayload: unknown;
}

export interface InitiateRechargeInput {
  studentId: string;
  method: PaymentMethod;
  amount: number;
  providerCode?: PaymentProviderCode;
  cardToken?: string;
}
