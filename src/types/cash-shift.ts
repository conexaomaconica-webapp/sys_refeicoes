export type CashShiftStatus = 'opened' | 'closed';

export type CashMovementType =
  | 'initial_float'
  | 'visitor_sale'
  | 'meal_sale'
  | 'refund'
  | 'supply'
  | 'bleed'
  | 'adjustment';

export type PaymentMethod = 'cash' | 'pix' | 'card' | 'other';

export interface CashMovement {
  id: string;
  cash_shift_id: string;
  type: CashMovementType;
  amount: number;
  payment_method: PaymentMethod;
  description: string | null;
  meal_consumption_id: string | null;
  student_id?: string | null;
  consumer_type?: 'student' | 'visitor' | null;
  idempotency_key?: string | null;
  amount_received?: number | null;
  change_amount?: number;
  status?: 'confirmed' | 'refunded' | 'voided';
  origin?: string | null;
  reversal_reason?: string | null;
  legacy_wallet_bridge?: boolean;
  operator_id: string;
  created_at: string;
}

export interface CashShift {
  id: string;
  tenant_id: string;
  unit_id: string;
  meal_type_id: string;
  terminal_id: string;
  operator_id: string;
  status: CashShiftStatus;
  opened_at: string;
  initial_float_amount: number;
  total_visitors_count: number;
  total_visitors_amount: number;
  total_supplies_amount: number;
  total_bleed_amount: number;
  system_expected_balance: number;
  expected_cash_balance?: number;
  counter_payments_count?: number;
  counter_payments_amount?: number;
  counter_cash_amount?: number;
  counter_pix_amount?: number;
  counter_card_amount?: number;
  counter_other_amount?: number;
  counter_refunds_amount?: number;
  counted_closing_balance: number | null;
  difference_amount: number | null;
  closing_notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  // Joins/enrichments
  operator_name?: string;
  meal_type_name?: string;
  unit_name?: string;
  movements?: CashMovement[];
}

export interface OpenCashShiftParams {
  unitId: string;
  terminalId: string;
  mealTypeId: string;
  initialFloat: number;
}

export interface CloseCashShiftParams {
  cashShiftId: string;
  countedAmount: number;
  closingNotes?: string;
}

export interface RecordMovementParams {
  cashShiftId: string;
  type: 'supply' | 'bleed';
  amount: number;
  paymentMethod?: PaymentMethod;
  description: string;
}

export interface CashShiftFilter {
  unitId?: string;
  mealTypeId?: string;
  status?: CashShiftStatus;
  startDate?: string;
  endDate?: string;
}
