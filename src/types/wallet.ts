export type WalletTransactionType =
  | 'recharge'
  | 'meal_debit'
  | 'refund'
  | 'reversal'
  | 'manual_adjustment';

export type WalletStatus = 'active' | 'frozen' | 'closed';

export interface Wallet {
  id: string;
  tenant_id: string;
  student_id: string;
  balance: number;
  status: WalletStatus;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  tenant_id: string;
  wallet_id: string;
  student_id: string;
  type: WalletTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
}

export interface ManualAdjustmentInput {
  student_id: string;
  amount: number;
  description: string;
}

export interface ReverseTransactionInput {
  transaction_id: string;
  reason: string;
}
