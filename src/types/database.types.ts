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
          created_at: string;
          confirmed_at: string | null;
          completed_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          institution_id: string;
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
          created_at?: string;
          confirmed_at?: string | null;
          completed_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          institution_id?: string;
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
    };
    Views: Record<string, never>;
    Functions: {
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
        }[];
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
