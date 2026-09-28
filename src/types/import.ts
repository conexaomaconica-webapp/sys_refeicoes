/**
 * Tipos e Interfaces para o Módulo de Importação por Planilha (Sprint 4)
 */

export type ImportStatus = 
  | 'preview'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export type ImportMode = 
  | 'general'
  | 'integral_snapshot';

export type ImportRowAction = 
  | 'insert'
  | 'update'
  | 'reclassify_partial'
  | 'ignore'
  | 'error';

export type ImportRowStatus = 
  | 'pending'
  | 'processed'
  | 'failed'
  | 'skipped';

export interface RawImportRow {
  row_number: number;
  [key: string]: unknown;
}

export interface NormalizedImportData {
  registration_number: string;
  full_name: string;
  category_code?: string;
  category_id?: string;
  course?: string;
  email?: string;
  phone?: string;
  academic_status?: 'active' | 'inactive' | 'suspended' | 'cancelled' | 'graduated';
}

export interface ImportPreviewRow {
  row_number: number;
  registration_number: string;
  full_name?: string;
  action: ImportRowAction;
  status: ImportRowStatus;
  raw_data: Record<string, unknown>;
  normalized_data?: NormalizedImportData;
  errors: string[];
  warnings: string[];
  student_id?: string;
  before_snapshot?: Record<string, unknown>;
  after_snapshot?: Record<string, unknown>;
}

export interface ImportPreviewSummary {
  total_rows: number;
  valid_rows: number;
  insert_rows: number;
  update_rows: number;
  reclassify_rows: number;
  ignored_rows: number;
  error_rows: number;
}

export interface ImportPreviewResult {
  import_id: string;
  tenant_id: string;
  institution_id: string;
  import_mode: ImportMode;
  original_filename: string;
  file_hash: string;
  file_size_bytes: number;
  is_official_snapshot: boolean;
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
}

export interface ImportRecord {
  id: string;
  tenant_id: string;
  institution_id: string;
  import_mode: ImportMode;
  created_by: string;
  original_filename: string;
  storage_path: string;
  file_hash: string;
  file_size_bytes: number;
  status: ImportStatus;
  total_rows: number;
  valid_rows: number;
  insert_rows: number;
  update_rows: number;
  reclassify_rows: number;
  ignored_rows: number;
  error_rows: number;
  is_official_snapshot: boolean;
  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface ImportRowRecord {
  id: string;
  import_id: string;
  tenant_id: string;
  row_number: number;
  registration_number?: string;
  raw_data: Record<string, unknown>;
  normalized_data?: NormalizedImportData;
  action: ImportRowAction;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  student_id?: string;
  before_snapshot?: Record<string, unknown>;
  after_snapshot?: Record<string, unknown>;
  created_at: string;
}
