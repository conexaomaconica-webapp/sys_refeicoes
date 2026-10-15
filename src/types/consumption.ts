export type MealConsumptionStatus = 'approved' | 'financially_refunded' | 'cancelled_unserved';

export type BlockedReasonCode =
  | 'AUTH_REQUIRED'
  | 'UNAUTHORIZED_CALLER'
  | 'PERMISSION_DENIED'
  | 'ACCESS_DENIED_UNIT'
  | 'UNIT_UNAVAILABLE'
  | 'INVALID_IDENTIFIER'
  | 'INVALID_IDENTIFIER_FORMAT'
  | 'IDEMPOTENCY_KEY_REUSE_MISMATCH'
  | 'STUDENT_NOT_FOUND'
  | 'STUDENT_INACTIVE'
  | 'CARD_INACTIVE'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_REVOKED'
  | 'TOKEN_ALREADY_USED'
  | 'TOKEN_EXPIRED'
  | 'PHYSICAL_CARD_NOT_FOUND'
  | 'MEAL_NOT_ENABLED_FOR_UNIT'
  | 'OUT_OF_SCHEDULE'
  | 'ALREADY_CONSUMED_TODAY'
  | 'NO_PRICE_RULE_CONFIGURED'
  | 'WALLET_NOT_FOUND'
  | 'WALLET_INACTIVE'
  | 'INSUFFICIENT_FUNDS'
  | 'CONCURRENT_CONSUMPTION_CONFLICT';

export interface MealConsumption {
  id: string;
  tenant_id: string;
  unit_id: string;
  institution_id: string;
  student_id: string;
  category_id: string;
  meal_type_id: string;
  consumption_date: string;
  consumed_at: string;
  full_price: number;
  student_price: number;
  subsidy_amount: number;
  wallet_transaction_id: string | null;
  operator_id: string;
  terminal_id: string | null;
  verification_method: string;
  idempotency_key: string | null;
  request_hash: string | null;
  qr_token_id: string | null;
  status: MealConsumptionStatus;
  reversal_reason: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlockedAttempt {
  id: string;
  tenant_id: string;
  unit_id: string;
  student_id: string | null;
  category_id: string | null;
  meal_type_id: string | null;
  registration_attempted: string | null;
  verification_method: string;
  reason_code: BlockedReasonCode;
  reason_message: string;
  terminal_id: string | null;
  operator_id: string | null;
  attempted_at: string;
}

export interface ConsumeMealInput {
  unit_id: string;
  identifier: string;
  meal_type_id?: string;
  idempotency_key?: string;
  terminal_id?: string;
}

export interface ConsumeMealResult {
  success: boolean;
  status?: MealConsumptionStatus;
  already_processed?: boolean;
  consumption_id?: string;
  consumed_at?: string;
  consumption_date?: string;
  student?: {
    id: string;
    full_name: string;
    registration_number: string;
    course: string | null;
    photo_path: string | null;
    category_code: string;
    is_integral: boolean;
  };
  financial?: {
    student_price: number;
    subsidy_amount: number;
    balance_remaining: number | null;
  };
  error_code?: BlockedReasonCode;
  message?: string;
  required_amount?: number;
  current_balance?: number;
}

export interface CancelMealConsumptionInput {
  consumption_id: string;
  cancel_type: 'financially_refunded' | 'cancelled_unserved';
  reason: string;
}

export interface CancelMealConsumptionResult {
  success: boolean;
  consumption_id?: string;
  new_status?: MealConsumptionStatus;
  quota_released?: boolean;
  refund_transaction_id?: string | null;
  error_code?: string;
  message?: string;
}
