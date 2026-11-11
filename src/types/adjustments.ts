export type AdjustmentModality =
  | 'single_date_manual'
  | 'smart_quantity_distribution'
  | 'smart_individual_reconciliation';

export type CampaignAllocationStatus =
  | 'draft'
  | 'partially_allocated_pending'
  | 'submitted_for_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface UnitCalendarDay {
  id?: string;
  unit_id: string;
  calendar_date: string;
  meal_type_id?: string | null;
  is_operating: boolean;
  reason?: string | null;
}

export interface DateContextPreview {
  service_date: string;
  regular_meals_count: number;
  existing_adjustment_meals_count: number;
  is_operating: boolean;
  calendar_reason: string | null;
  is_closed_period: boolean;
}

export interface GapCandidate {
  student_id: string;
  registration_number: string;
  full_name: string;
  category_id: string;
  category_name: string;
  historical_frequency: number;
  prior_meals_count: number;
  attended_other_shift_same_day: boolean;
  is_habitual?: boolean;
  confidence_reason: string;
}

export interface EligibleStudentCompetenceSummary {
  student_id: string;
  registration_number: string;
  full_name: string;
  category_name: string;
  historical_frequency: number;
  prior_meals_count: number;
  is_habitual: boolean;
  available_dates: string[];
  consumed_dates: string[];
  batch_dates: string[];
}

export interface DailyGapRecommendation {
  date: string;
  is_operating: boolean;
  is_closed_period: boolean;
  regular_count: number;
  existing_adjustment_count: number;
  total_recorded: number;
  physical_served_count: number | null;
  proven_divergence: number;
  habitual_gaps_count: number;
  already_consumed_count: number;
  expected_baseline: number;
  anomaly_drop_percent: number;
  conference_weight: number;
  suggested_conference_qty: number;
  auto_allocatable_qty: number;
  reasons: string[];
  gap_candidates: GapCandidate[];
  eligible_non_consumers: GapCandidate[];
}

export interface UnitMealTypeOption {
  unit_id: string;
  meal_type_id: string;
  enabled: boolean;
  start_time?: string | null;
  end_time?: string | null;
}

export interface MealRuleOption {
  id: string;
  unit_id: string;
  meal_type_id: string;
  category_id: string;
  enabled: boolean;
  effective_from: string;
  effective_to?: string | null;
  full_price: number;
  student_price: number;
  subsidy_amount: number;
}

export interface StudentCategoryHistoryEntry {
  student_id: string;
  previous_category_id: string | null;
  new_category_id: string;
  effective_from: string;
  created_at: string;
}

export interface SmartAnalysisResult {
  meal_type_id: string;
  category_id: string | null;
  competence_month: string;
  operating_days_count: number;
  closed_days_count: number;
  habitual_students_count: number;
  total_statistical_gaps: number;
  excluded_duplicates_count: number;
  existing_regular_count: number;
  existing_adjustment_count: number;
  proven_total_meals: number;
  direct_divergence_total: number;
  recommended_allocated_total: number;
  unallocated_pending_meals: number;
  suggested_conference_total: number;
  days: DailyGapRecommendation[];
  eligible_students_summary: EligibleStudentCompetenceSummary[];
}

export interface SmartDistributionLineInput {
  line_id: string;
  meal_type_id: string;
  category_id: string;
  quantity: number;
}

export interface SmartMultiLineAnalysisItem {
  line_id: string;
  meal_type_id: string;
  meal_type_name: string;
  category_id: string;
  category_name: string;
  requested_quantity: number;
  rule_student_price: number;
  rule_subsidy_amount: number;
  analysis: SmartAnalysisResult;
}

export interface SmartMultiAnalysisResult {
  competence_month: string;
  proven_total_meals: number;
  lines_requested_total: number;
  unallocated_to_lines_meals: number;
  operating_days_max: number;
  total_statistical_gaps: number;
  total_excluded_duplicates: number;
  lines: SmartMultiLineAnalysisItem[];
}

export interface MealAdjustmentCampaignSummary {
  id: string;
  tenant_id: string;
  institution_id: string;
  unit_id: string;
  unit_name?: string;
  meal_type_id: string | null;
  meal_type_name?: string;
  selected_meal_type_ids?: string[];
  meal_type_names?: string[];
  distribution_lines?: Array<{ meal_type_id: string; category_id: string; quantity: number }>;
  competence_month: string;
  modality: Exclude<AdjustmentModality, 'single_date_manual'>;
  proven_total_meals: number;
  allocated_meals_count: number;
  unallocated_pending_meals: number;
  allocation_status: CampaignAllocationStatus;
  justification: string;
  evidence_document_url?: string | null;
  rejection_reason?: string | null;
  created_by: string;
  creator_name?: string;
  approved_by?: string | null;
  approver_name?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export interface SmartAllocationInputItem {
  service_date: string;
  meal_type_id?: string;
  category_id: string;
  quantity: number;
  notes?: string;
  identified_students?: Array<{
    student_id: string;
    registration_number: string;
    notes: string;
  }>;
}

export interface SubmitSmartCampaignInput {
  unit_id: string;
  meal_type_id?: string | null;
  meal_type_ids: string[];
  distribution_lines: Array<{
    meal_type_id: string;
    category_id: string;
    quantity: number;
  }>;
  competence_month: string;
  modality: Exclude<AdjustmentModality, 'single_date_manual'>;
  proven_total_meals: number;
  allocations: SmartAllocationInputItem[];
  analysis_snapshot: Record<string, unknown>;
  justification: string;
  evidence_document_url?: string;
  allow_closed_period?: boolean;
}

export interface RetroactiveDistributionLineInput {
  meal_type_id: string;
  category_id: string;
  batch_type: 'type_a_identified' | 'type_b_unidentified_count' | 'type_c_administrative_adjustment';
  quantity: number;
  notes?: string;
  identified_students?: Array<{
    student_id: string;
    registration_number: string;
    notes?: string;
  }>;
}

export interface SubmitRetroactiveDistributionInput {
  unit_id: string;
  service_date: string;
  justification: string;
  evidence_document_url?: string;
  allow_closed_period?: boolean;
  lines: RetroactiveDistributionLineInput[];
}

