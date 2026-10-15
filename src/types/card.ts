export type CardType = 'digital' | 'physical';
export type CardStatus = 'active' | 'blocked' | 'cancelled' | 'replaced';
export type QRTokenStatus = 'active' | 'used' | 'expired' | 'revoked';
export type IdentificationMethod = 'qr_dynamic' | 'physical_card' | 'registration_number';

export interface Card {
  id: string;
  tenant_id: string;
  student_id: string;
  card_number: string;
  card_type: CardType;
  physical_code_hash: string | null;
  status: CardStatus;
  issued_at: string;
  expires_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface QRToken {
  id: string;
  tenant_id: string;
  card_id: string;
  token_hash: string;
  status: QRTokenStatus;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface QRTokenGenerationResult {
  success: boolean;
  token_id: string;
  qr_payload: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface IdentityResolutionStudent {
  id: string;
  registration_number: string;
  full_name: string;
  course: string | null;
  photo_path: string | null;
  status: string;
  category: {
    id: string;
    name: string;
    code: string;
    is_integral: boolean;
  };
}

export interface IdentityResolutionResult {
  success: boolean;
  identification_method?: IdentificationMethod;
  token_id?: string | null;
  student?: IdentityResolutionStudent;
  error_code?: string;
  message?: string;
}

export interface IssueCardInput {
  student_id: string;
  card_type?: CardType;
  physical_code?: string;
}

export interface UpdateCardStatusInput {
  card_id: string;
  new_status: CardStatus;
  reason?: string;
}
