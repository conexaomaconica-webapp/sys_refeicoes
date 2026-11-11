export type ContingencyBatchType =
  | 'type_a_identified'
  | 'type_b_unidentified_count'
  | 'type_c_administrative_adjustment';

export type ContingencyBatchStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface ContingencyMealBatch {
  id: string;
  tenant_id: string;
  unit_id: string;
  unit_name?: string;
  meal_type_id: string;
  meal_type_name?: string;
  service_date: string;
  batch_type: ContingencyBatchType;
  total_meals_served: number;
  category_id?: string | null;
  category_name?: string | null;
  unit_price: number;
  subsidy_price: number;
  total_amount: number;
  total_subsidy_amount: number;
  justification: string;
  evidence_document_url?: string | null;
  operator_id: string;
  operator_name?: string;
  status: ContingencyBatchStatus;
  rejection_reason?: string | null;
  approved_by?: string | null;
  approver_name?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContingencyBatchItem {
  id: string;
  batch_id: string;
  student_id: string;
  registration_number: string;
  student_name: string;
  category_id: string;
  category_name?: string;
  notes?: string | null;
  created_at: string;
}

export interface IdentifiedStudentInput {
  student_id?: string;
  registration_number: string;
  notes?: string;
}

export interface SubmitContingencyBatchInput {
  unit_id: string;
  meal_type_id: string;
  service_date: string;
  batch_type: ContingencyBatchType;
  total_meals_served: number;
  category_id?: string;
  justification: string;
  evidence_document_url?: string;
  identified_students?: IdentifiedStudentInput[];
}

export interface ReviewContingencyBatchInput {
  batch_id: string;
  action: 'approve' | 'reject';
  reason?: string;
}
