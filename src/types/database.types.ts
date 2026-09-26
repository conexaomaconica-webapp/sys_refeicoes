export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Definições de Tipos do Banco de Dados Supabase (PostgreSQL).
 * Em conformidade com /docs/DATABASE.md.
 * Será expandido incrementalmente a cada Sprint e suas respectivas migrations.
 */
export interface Database {
  public: {
    Tables: {
      // Tabelas da Sprint 1 e posteriores serão mapeadas aqui
      [key: string]: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
    Views: {
      [key: string]: {
        Row: Record<string, unknown>;
      };
    };
    Functions: {
      [key: string]: {
        Args: Record<string, unknown>;
        Returns: unknown;
      };
    };
    Enums: {
      user_role:
        | 'admin_general'
        | 'operations_director'
        | 'finance'
        | 'supervisor'
        | 'unit_manager'
        | 'operator'
        | 'institution_user'
        | 'student';
      student_status: 'active' | 'suspended' | 'cancelled' | 'graduated' | 'inactive';
      student_category_code: 'partial' | 'integral';
      meal_type_code: 'breakfast' | 'lunch' | 'dinner';
      wallet_transaction_type:
        | 'recharge'
        | 'meal_debit'
        | 'refund'
        | 'reversal'
        | 'manual_adjustment';
      payment_status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'refunded';
      recharge_status: 'pending' | 'confirmed' | 'failed' | 'reversed';
      consumption_status: 'approved' | 'blocked' | 'reversed';
    };
    CompositeTypes: {
      [key: string]: unknown;
    };
  };
}
