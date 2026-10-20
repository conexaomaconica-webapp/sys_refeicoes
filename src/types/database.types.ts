import type { UserRole, ProfileStatus } from './auth';
import type { StudentAcademicStatus } from './student';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Definições de Tipos do Banco de Dados Supabase (PostgreSQL).
 * Em conformidade com /docs/DATABASE.md e migrations Sprints 1, 2 e 3.
 */
export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          legal_name: string | null;
          document: string | null;
          status: 'active' | 'inactive' | 'suspended';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          legal_name?: string | null;
          document?: string | null;
          status?: 'active' | 'inactive' | 'suspended';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          legal_name?: string | null;
          document?: string | null;
          status?: 'active' | 'inactive' | 'suspended';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_branding: {
        Row: {
          id: string;
          tenant_id: string;
          app_name: string;
          logo_url: string | null;
          splash_background: string | null;
          splash_animation_type: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
          splash_duration_ms: number;
          primary_color: string | null;
          secondary_color: string | null;
          terminal_theme: 'light' | 'dark';
          terminal_primary_color: string;
          terminal_accent_color: string;
          terminal_surface_color: string;
          terminal_show_kpi_values: boolean;
          report_logo_url: string | null;
          report_header_text: string | null;
          report_footer_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          app_name?: string;
          logo_url?: string | null;
          splash_background?: string | null;
          splash_animation_type?: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
          splash_duration_ms?: number;
          primary_color?: string | null;
          secondary_color?: string | null;
          terminal_theme?: 'light' | 'dark';
          terminal_primary_color?: string;
          terminal_accent_color?: string;
          terminal_surface_color?: string;
          terminal_show_kpi_values?: boolean;
          report_logo_url?: string | null;
          report_header_text?: string | null;
          report_footer_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          app_name?: string;
          logo_url?: string | null;
          splash_background?: string | null;
          splash_animation_type?: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
          splash_duration_ms?: number;
          primary_color?: string | null;
          secondary_color?: string | null;
          terminal_theme?: 'light' | 'dark';
          terminal_primary_color?: string;
          terminal_accent_color?: string;
          terminal_surface_color?: string;
          terminal_show_kpi_values?: boolean;
          report_logo_url?: string | null;
          report_header_text?: string | null;
          report_footer_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      institutions: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          short_name: string | null;
          document: string | null;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          short_name?: string | null;
          document?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          short_name?: string | null;
          document?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          id: string;
          tenant_id: string;
          institution_id: string;
          name: string;
          city: string;
          state: string;
          timezone: string;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          institution_id: string;
          name: string;
          city: string;
          state: string;
          timezone?: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          institution_id?: string;
          name?: string;
          city?: string;
          state?: string;
          timezone?: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          tenant_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          role: UserRole;
          status: ProfileStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          role: UserRole;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          role?: UserRole;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_unit_access: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          unit_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          unit_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          unit_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      user_institution_access: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          institution_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          institution_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          institution_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      student_categories: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          description: string | null;
          requires_wallet: boolean;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          name: string;
          description?: string | null;
          requires_wallet?: boolean;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          code?: string;
          name?: string;
          description?: string | null;
          requires_wallet?: boolean;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          tenant_id: string;
          institution_id: string;
          user_id: string | null;
          category_id: string;
          registration_number: string;
          full_name: string;
          course: string | null;
          email: string | null;
          phone: string | null;
          photo_path: string | null;
          status: StudentAcademicStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          institution_id: string;
          user_id?: string | null;
          category_id: string;
          registration_number: string;
          full_name: string;
          course?: string | null;
          email?: string | null;
          phone?: string | null;
          photo_path?: string | null;
          status?: StudentAcademicStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          institution_id?: string;
          user_id?: string | null;
          category_id?: string;
          registration_number?: string;
          full_name?: string;
          course?: string | null;
          email?: string | null;
          phone?: string | null;
          photo_path?: string | null;
          status?: StudentAcademicStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      imports: {
        Row: {
          id: string;
          tenant_id: string;
          institution_id: string;
          unit_id: string | null;
          import_mode: 'general' | 'integral_snapshot';
          created_by: string;
          original_filename: string;
          storage_path: string;
          file_hash: string;
          file_size_bytes: number;
          status: 'preview' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
          total_rows: number;
          valid_rows: number;
          insert_rows: number;
          update_rows: number;
          reclassify_rows: number;
          ignored_rows: number;
          error_rows: number;
          is_official_snapshot: boolean;
          effective_date: string;
          processed_rows: number;
          failed_rows: number;
          skipped_rows: number;
          created_at: string;
          confirmed_at: string | null;
          completed_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          institution_id: string;
          unit_id?: string | null;
          import_mode?: 'general' | 'integral_snapshot';
          created_by: string;
          original_filename: string;
          storage_path: string;
          file_hash: string;
          file_size_bytes: number;
          status?: 'preview' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
          total_rows?: number;
          valid_rows?: number;
          insert_rows?: number;
          update_rows?: number;
          reclassify_rows?: number;
          ignored_rows?: number;
          error_rows?: number;
          is_official_snapshot?: boolean;
          effective_date?: string;
          processed_rows?: number;
          failed_rows?: number;
          skipped_rows?: number;
          created_at?: string;
          confirmed_at?: string | null;
          completed_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          institution_id?: string;
          unit_id?: string | null;
          import_mode?: 'general' | 'integral_snapshot';
          created_by?: string;
          original_filename?: string;
          storage_path?: string;
          file_hash?: string;
          file_size_bytes?: number;
          status?: 'preview' | 'processing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
          total_rows?: number;
          valid_rows?: number;
          insert_rows?: number;
          update_rows?: number;
          reclassify_rows?: number;
          ignored_rows?: number;
          error_rows?: number;
          is_official_snapshot?: boolean;
          effective_date?: string;
          processed_rows?: number;
          failed_rows?: number;
          skipped_rows?: number;
          created_at?: string;
          confirmed_at?: string | null;
          completed_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [];
      };
      import_rows: {
        Row: {
          id: string;
          import_id: string;
          tenant_id: string;
          row_number: number;
          registration_number: string | null;
          raw_data: Json;
          normalized_data: Json | null;
          action: 'insert' | 'update' | 'reclassify_partial' | 'ignore' | 'error';
          status: 'pending' | 'processed' | 'failed' | 'skipped';
          errors: Json;
          warnings: Json;
          student_id: string | null;
          before_snapshot: Json | null;
          after_snapshot: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_id: string;
          tenant_id: string;
          row_number: number;
          registration_number?: string | null;
          raw_data: Json;
          normalized_data?: Json | null;
          action: 'insert' | 'update' | 'reclassify_partial' | 'ignore' | 'error';
          status?: 'pending' | 'processed' | 'failed' | 'skipped';
          errors?: Json;
          warnings?: Json;
          student_id?: string | null;
          before_snapshot?: Json | null;
          after_snapshot?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          import_id?: string;
          tenant_id?: string;
          row_number?: number;
          registration_number?: string | null;
          raw_data?: Json;
          normalized_data?: Json | null;
          action?: 'insert' | 'update' | 'reclassify_partial' | 'ignore' | 'error';
          status?: 'pending' | 'processed' | 'failed' | 'skipped';
          errors?: Json;
          warnings?: Json;
          student_id?: string | null;
          before_snapshot?: Json | null;
          after_snapshot?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      meal_types: {
        Row: {
          id: string;
          tenant_id: string;
          code: 'breakfast' | 'lunch' | 'dinner';
          name: string;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: 'breakfast' | 'lunch' | 'dinner';
          name: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          code?: 'breakfast' | 'lunch' | 'dinner';
          name?: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      unit_meal_types: {
        Row: {
          id: string;
          tenant_id: string;
          unit_id: string;
          meal_type_id: string;
          enabled: boolean;
          start_time: string | null;
          end_time: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          unit_id: string;
          meal_type_id: string;
          enabled?: boolean;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          unit_id?: string;
          meal_type_id?: string;
          enabled?: boolean;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      meal_rules: {
        Row: {
          id: string;
          tenant_id: string;
          unit_id: string;
          meal_type_id: string;
          category_id: string;
          full_price: number;
          student_price: number;
          subsidy_amount: number;
          enabled: boolean;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          unit_id: string;
          meal_type_id: string;
          category_id: string;
          full_price: number;
          student_price: number;
          subsidy_amount: number;
          enabled?: boolean;
          effective_from?: string;
          effective_to?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          unit_id?: string;
          meal_type_id?: string;
          category_id?: string;
          full_price?: number;
          student_price?: number;
          subsidy_amount?: number;
          enabled?: boolean;
          effective_from?: string;
          effective_to?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          id: string;
          tenant_id: string;
          student_id: string;
          balance: number;
          status: 'active' | 'frozen' | 'closed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          student_id: string;
          balance?: number;
          status?: 'active' | 'frozen' | 'closed';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          student_id?: string;
          balance?: number;
          status?: 'active' | 'frozen' | 'closed';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallet_transactions: {
        Row: {
          id: string;
          tenant_id: string;
          wallet_id: string;
          student_id: string;
          type: 'recharge' | 'meal_debit' | 'refund' | 'reversal' | 'manual_adjustment';
          amount: number;
          balance_before: number;
          balance_after: number;
          reference_type: string | null;
          reference_id: string | null;
          description: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          wallet_id: string;
          student_id: string;
          type: 'recharge' | 'meal_debit' | 'refund' | 'reversal' | 'manual_adjustment';
          amount: number;
          balance_before: number;
          balance_after: number;
          reference_type?: string | null;
          reference_id?: string | null;
          description: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          wallet_id?: string;
          student_id?: string;
          type?: 'recharge' | 'meal_debit' | 'refund' | 'reversal' | 'manual_adjustment';
          amount?: number;
          balance_before?: number;
          balance_after?: number;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_providers: {
        Row: {
          id: string;
          tenant_id: string;
          code: 'asaas' | 'mercadopago' | 'mock' | 'sitef';
          name: string;
          is_active: boolean;
          credentials: Json;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: 'asaas' | 'mercadopago' | 'mock' | 'sitef';
          name: string;
          is_active?: boolean;
          credentials?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          code?: 'asaas' | 'mercadopago' | 'mock' | 'sitef';
          name?: string;
          is_active?: boolean;
          credentials?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          tenant_id: string;
          provider_id: string;
          student_id: string;
          external_payment_id: string | null;
          method: 'pix' | 'credit_card';
          amount: number;
          status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'refunded';
          pix_qr_code: string | null;
          pix_copy_paste: string | null;
          raw_response: Json | null;
          confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          provider_id: string;
          student_id: string;
          external_payment_id?: string | null;
          method: 'pix' | 'credit_card';
          amount: number;
          status?: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'refunded';
          pix_qr_code?: string | null;
          pix_copy_paste?: string | null;
          raw_response?: Json | null;
          confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          provider_id?: string;
          student_id?: string;
          external_payment_id?: string | null;
          method?: 'pix' | 'credit_card';
          amount?: number;
          status?: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'refunded';
          pix_qr_code?: string | null;
          pix_copy_paste?: string | null;
          raw_response?: Json | null;
          confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_payments_provider_tenant";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "payment_providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_payments_student_tenant";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          }
        ];
      };
      recharges: {
        Row: {
          id: string;
          tenant_id: string;
          student_id: string;
          wallet_id: string;
          payment_id: string | null;
          amount: number;
          status: 'pending' | 'confirmed' | 'failed' | 'reversed';
          source: 'pix' | 'credit_card' | 'cash' | 'manual';
          unit_id: string | null;
          operator_id: string | null;
          confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          student_id: string;
          wallet_id: string;
          payment_id?: string | null;
          amount: number;
          status?: 'pending' | 'confirmed' | 'failed' | 'reversed';
          source: 'pix' | 'credit_card' | 'cash' | 'manual';
          unit_id?: string | null;
          operator_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          student_id?: string;
          wallet_id?: string;
          payment_id?: string | null;
          amount?: number;
          status?: 'pending' | 'confirmed' | 'failed' | 'reversed';
          source?: 'pix' | 'credit_card' | 'cash' | 'manual';
          unit_id?: string | null;
          operator_id?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_recharges_wallet_tenant";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_recharges_payment_tenant";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_recharges_student_tenant";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          }
        ];
      };
      payment_webhook_events: {
        Row: {
          id: string;
          tenant_id: string;
          provider_code: string;
          event_id: string;
          event_type: string;
          external_payment_id: string | null;
          payload: Json;
          processed: boolean;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          provider_code: string;
          event_id: string;
          event_type: string;
          external_payment_id?: string | null;
          payload: Json;
          processed?: boolean;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          provider_code?: string;
          event_id?: string;
          event_type?: string;
          external_payment_id?: string | null;
          payload?: Json;
          processed?: boolean;
          processed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          id: string;
          tenant_id: string;
          student_id: string;
          card_number: string;
          card_type: 'digital' | 'physical';
          physical_code_hash: string | null;
          status: 'active' | 'blocked' | 'cancelled' | 'replaced';
          issued_at: string;
          expires_at: string | null;
          blocked_at: string | null;
          blocked_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          student_id: string;
          card_number: string;
          card_type?: 'digital' | 'physical';
          physical_code_hash?: string | null;
          status?: 'active' | 'blocked' | 'cancelled' | 'replaced';
          issued_at?: string;
          expires_at?: string | null;
          blocked_at?: string | null;
          blocked_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          student_id?: string;
          card_number?: string;
          card_type?: 'digital' | 'physical';
          physical_code_hash?: string | null;
          status?: 'active' | 'blocked' | 'cancelled' | 'replaced';
          issued_at?: string;
          expires_at?: string | null;
          blocked_at?: string | null;
          blocked_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_cards_tenant";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_cards_student_tenant";
            columns: ["student_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id", "tenant_id"];
          }
        ];
      };
      qr_tokens: {
        Row: {
          id: string;
          tenant_id: string;
          card_id: string;
          token_hash: string;
          status: 'active' | 'used' | 'expired' | 'revoked';
          issued_at: string;
          expires_at: string;
          used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          card_id: string;
          token_hash: string;
          status?: 'active' | 'used' | 'expired' | 'revoked';
          issued_at?: string;
          expires_at: string;
          used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          card_id?: string;
          token_hash?: string;
          status?: 'active' | 'used' | 'expired' | 'revoked';
          issued_at?: string;
          expires_at?: string;
          used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_qr_tokens_tenant";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_qr_tokens_card_tenant";
            columns: ["card_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id", "tenant_id"];
          }
        ];
      };
      meal_consumptions: {
        Row: {
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
          allow_multi_meal: boolean;
          status: 'approved' | 'financially_refunded' | 'cancelled_unserved';
          reversal_reason: string | null;
          reversed_at: string | null;
          reversed_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          unit_id: string;
          institution_id: string;
          student_id: string;
          category_id: string;
          meal_type_id: string;
          consumption_date: string;
          consumed_at?: string;
          full_price: number;
          student_price: number;
          subsidy_amount: number;
          wallet_transaction_id?: string | null;
          operator_id: string;
          terminal_id?: string | null;
          verification_method: string;
          idempotency_key?: string | null;
          request_hash?: string | null;
          qr_token_id?: string | null;
          allow_multi_meal?: boolean;
          status?: 'approved' | 'financially_refunded' | 'cancelled_unserved';
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          unit_id?: string;
          institution_id?: string;
          student_id?: string;
          category_id?: string;
          meal_type_id?: string;
          consumption_date?: string;
          consumed_at?: string;
          full_price?: number;
          student_price?: number;
          subsidy_amount?: number;
          wallet_transaction_id?: string | null;
          operator_id?: string;
          terminal_id?: string | null;
          verification_method?: string;
          idempotency_key?: string | null;
          request_hash?: string | null;
          qr_token_id?: string | null;
          allow_multi_meal?: boolean;
          status?: 'approved' | 'financially_refunded' | 'cancelled_unserved';
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      blocked_attempts: {
        Row: {
          id: string;
          tenant_id: string;
          unit_id: string;
          student_id: string | null;
          category_id: string | null;
          meal_type_id: string | null;
          registration_attempted: string | null;
          verification_method: string;
          reason_code: string;
          reason_message: string;
          terminal_id: string | null;
          operator_id: string | null;
          attempted_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          unit_id: string;
          student_id?: string | null;
          category_id?: string | null;
          meal_type_id?: string | null;
          registration_attempted?: string | null;
          verification_method: string;
          reason_code: string;
          reason_message: string;
          terminal_id?: string | null;
          operator_id?: string | null;
          attempted_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          unit_id?: string;
          student_id?: string | null;
          category_id?: string | null;
          meal_type_id?: string | null;
          registration_attempted?: string | null;
          verification_method?: string;
          reason_code?: string;
          reason_message?: string;
          terminal_id?: string | null;
          operator_id?: string | null;
          attempted_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      consume_meal: {
        Args: {
          p_unit_id: string;
          p_identifier: string;
          p_meal_type_id?: string | null;
          p_idempotency_key?: string | null;
          p_terminal_id?: string | null;
        };
        Returns: Json;
      };
      cancel_meal_consumption: {
        Args: {
          p_consumption_id: string;
          p_cancel_type: 'financially_refunded' | 'cancelled_unserved';
          p_reason: string;
        };
        Returns: Json;
      };
      admin_issue_card: {

        Args: {
          p_student_id: string;
          p_card_type?: 'digital' | 'physical';
          p_physical_code?: string | null;
        };
        Returns: Json;
      };
      admin_update_card_status: {
        Args: {
          p_card_id: string;
          p_new_status: 'active' | 'blocked' | 'cancelled' | 'replaced';
          p_reason?: string | null;
        };
        Returns: Json;
      };
      generate_student_qr_token: {
        Args: {
          p_card_id?: string | null;
        };
        Returns: Json;
      };
      resolve_student_identity: {
        Args: {
          p_unit_id: string;
          p_identifier: string;
        };
        Returns: Json;
      };
      create_payment_order: {

        Args: {
          p_requesting_user_id: string;
          p_student_id: string;
          p_method: string;
          p_amount: number;
          p_provider_code: string;
          p_external_payment_id: string;
          p_pix_qr_code?: string | null;
          p_pix_copy_paste?: string | null;
          p_raw_response?: Json | null;
        };
        Returns: Json;
      };
      confirm_payment_recharge: {
        Args: {
          p_external_payment_id: string;
          p_provider_code: string;
          p_event_id?: string | null;
          p_payload?: Json | null;
        };
        Returns: Json;
      };
      create_student_wallet: {
        Args: {
          p_requesting_user_id: string;
          p_student_id: string;
        };
        Returns: string;
      };
      manual_wallet_adjustment: {
        Args: {
          p_requesting_user_id: string;
          p_student_id: string;
          p_amount: number;
          p_description: string;
        };
        Returns: string;
      };
      reverse_wallet_transaction: {
        Args: {
          p_requesting_user_id: string;
          p_transaction_id: string;
          p_reason: string;
        };
        Returns: string;
      };
      set_meal_rule: {
        Args: {
          p_requesting_user_id: string;
          p_unit_id: string;
          p_meal_type_id: string;
          p_category_id: string;
          p_full_price: number;
          p_student_price: number;
          p_effective_from?: string;
        };
        Returns: string;
      };


      stage_import_batch: {
        Args: {
          p_institution_id: string;
          p_import_mode: 'general' | 'integral_snapshot';
          p_original_filename: string;
          p_storage_path: string;
          p_file_hash: string;
          p_file_size_bytes: number;
          p_is_official_snapshot: boolean;
          p_force_reimport: boolean;
          p_rows: Json;
        };
        Returns: string;
      };
      confirm_and_process_import: {
        Args: {
          p_import_id: string;
        };
        Returns: Json;
      };
      cancel_import: {
        Args: {
          p_import_id: string;
        };
        Returns: boolean;
      };
      get_public_tenant_branding: {
        Args: {
          p_slug: string;
        };
        Returns: {
          tenant_id: string;
          slug: string;
          app_name: string;
          logo_url: string | null;
          splash_background: string | null;
          splash_animation_type: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
          splash_duration_ms: number;
          primary_color: string | null;
          secondary_color: string | null;
          terminal_theme: 'light' | 'dark';
          terminal_primary_color: string;
          terminal_accent_color: string;
          terminal_surface_color: string;
          terminal_show_kpi_values: boolean;
        }[];
      };
      get_public_tenant_branding_v2: {
        Args: {
          p_slug: string;
        };
        Returns: {
          tenant_id: string;
          slug: string;
          app_name: string;
          logo_url: string | null;
          splash_background: string | null;
          splash_animation_type: 'fade_pulse' | 'slide_up' | 'zoom_in' | 'none';
          splash_duration_ms: number;
          primary_color: string | null;
          secondary_color: string | null;
          terminal_theme: 'light' | 'dark';
          terminal_primary_color: string;
          terminal_accent_color: string;
          terminal_surface_color: string;
          terminal_show_kpi_values: boolean;
        }[];
      };
      update_tenant_branding_settings: {
        Args: {
          p_app_name: string;
          p_logo_url: string;
          p_primary_color: string;
          p_secondary_color: string;
          p_terminal_theme: string;
          p_terminal_primary_color: string;
          p_terminal_accent_color: string;
          p_terminal_surface_color: string;
          p_terminal_show_kpi_values: boolean;
        };
        Returns: Json;
      };
      preview_terminal_meal: {
        Args: {
          p_unit_id: string;
          p_identifier: string;
          p_meal_type_id?: string | null;
        };
        Returns: Json;
      };
      confirm_terminal_meal_payment: {
        Args: {
          p_unit_id: string;
          p_identifier: string;
          p_meal_type_id: string;
          p_terminal_id: string;
          p_idempotency_key: string;
          p_payment_method: string;
          p_amount_received?: number | null;
        };
        Returns: Json;
      };
      open_cash_shift: {
        Args: { p_unit_id: string; p_terminal_id: string; p_meal_type_id: string; p_initial_float: number };
        Returns: Json;
      };
      get_active_cash_shift: {
        Args: { p_unit_id: string; p_terminal_id: string };
        Returns: Json;
      };
      record_cash_movement: {
        Args: { p_cash_shift_id: string; p_type: string; p_amount: number; p_payment_method: string; p_description: string | null };
        Returns: Json;
      };
      close_cash_shift: {
        Args: { p_cash_shift_id: string; p_counted_amount: number; p_closing_notes: string | null };
        Returns: Json;
      };
      register_visitor_entry: {
        Args: { p_unit_id: string; p_meal_type_id: string; p_terminal_id: string; p_payment_method: string };
        Returns: Json;
      };
      register_terminal_visitor_entry: {
        Args: { p_unit_id: string; p_meal_type_id: string | null; p_terminal_id: string | null; p_payment_method: string };
        Returns: Json;
      };
      get_operator_terminal_shift: {
        Args: { p_unit_id: string; p_terminal_id: string };
        Returns: Json;
      };
      open_operator_cash_shift: {
        Args: { p_unit_id: string; p_terminal_id: string; p_meal_type_id: string | null; p_initial_float: number };
        Returns: Json;
      };
      close_operator_cash_shift: {
        Args: { p_cash_shift_id: string; p_counted_amount: number; p_closing_notes: string | null };
        Returns: Json;
      };
      record_operator_cash_movement: {
        Args: { p_cash_shift_id: string; p_type: string; p_amount: number; p_payment_method: string; p_description: string | null };
        Returns: Json;
      };
      consume_operator_terminal_meal: {
        Args: { p_unit_id: string; p_identifier: string; p_meal_type_id: string | null; p_idempotency_key: string | null; p_terminal_id: string | null };
        Returns: Json;
      };
      confirm_operator_terminal_payment: {
        Args: { p_unit_id: string; p_identifier: string; p_meal_type_id: string; p_terminal_id: string; p_idempotency_key: string; p_payment_method: string; p_amount_received: number | null };
        Returns: Json;
      };
      register_operator_visitor_entry: {
        Args: { p_unit_id: string; p_meal_type_id: string | null; p_terminal_id: string | null; p_payment_method: string };
        Returns: Json;
      };
      admin_list_cash_shifts: {
        Args: { p_unit_id: string | null; p_meal_type_id: string | null; p_status: string | null; p_start_date: string | null; p_end_date: string | null };
        Returns: Json;
      };
      get_terminal_shift_reports: {
        Args: { p_unit_id: string; p_meal_type_id: string | null; p_terminal_id: string | null };
        Returns: Json;
      };
      get_auth_tenant_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      get_auth_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole | null;
      };
      get_auth_user_status: {
        Args: Record<PropertyKey, never>;
        Returns: ProfileStatus | null;
      };
      has_unit_access: {
        Args: {
          p_unit_id: string;
        };
        Returns: boolean;
      };
      has_institution_access: {
        Args: {
          p_institution_id: string;
        };
        Returns: boolean;
      };
      provision_default_student_categories: {
        Args: {
          p_tenant_id: string;
        };
        Returns: void;
      };
      provision_default_meal_types: {
        Args: {
          p_tenant_id: string;
        };
        Returns: void;
      };
    };
    Enums: {
      user_role: UserRole;
      student_status: StudentAcademicStatus;
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
};
