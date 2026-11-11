export interface CategoryFinancialMetric {
  category_id: string;
  category_name: string;
  category_code: string;
  is_integral: boolean;
  meals_count: number;
  gross_amount: number;
  subsidy_amount: number;
  student_paid_amount: number;
}

export interface UnitFinancialMetric {
  unit_id: string;
  unit_name: string;
  institution_name: string;
  meals_count: number;
  gross_amount: number;
  subsidy_amount: number;
  student_paid_amount: number;
}

export interface ContingencyFinancialBatch {
  id: string;
  unit_name: string;
  meal_type_name: string;
  service_date: string;
  batch_type: 'type_a_identified' | 'type_b_unidentified_count' | 'type_c_administrative_adjustment';
  total_meals_served: number;
  total_amount: number;
  total_subsidy_amount: number;
  justification: string;
  approved_by_name: string | null;
  approved_at: string | null;
}

export interface FinancialReportSummary {
  regular_meals_served: number;
  contingency_meals_served: number;
  contingency_identified_meals?: number;
  contingency_aggregated_meals?: number;
  unallocated_pending_meals_total?: number;
  total_meals_delivered: number;

  gross_meal_amount: number;
  contingency_gross_amount: number;
  contingency_identified_gross?: number;
  contingency_aggregated_gross?: number;
  total_gross_invoicing: number;

  regular_subsidy_amount: number;
  contingency_subsidy_amount: number;
  contingency_identified_subsidy?: number;
  contingency_aggregated_subsidy?: number;
  total_institutional_subsidy: number;

  student_paid_amount: number;

  recharges_in_period: number;
  current_custody_liability: number;
  gateway_processing_fees: number;
}

export interface ConsolidatedFinancialReport {
  generated_at: string;
  period: {
    start_date: string;
    end_date: string;
  };
  applied_filters: {
    institution_id: string | null;
    unit_id: string | null;
    category_id: string | null;
  };
  summary: FinancialReportSummary;
  category_breakdown: CategoryFinancialMetric[];
  unit_breakdown: UnitFinancialMetric[];
  contingency_breakdown: ContingencyFinancialBatch[];
}

export interface FinancialReportFilters {
  startDate: string;
  endDate: string;
  institutionId?: string;
  unitId?: string;
  categoryId?: string;
}

export interface ReportingInitialData {
  institutions: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string; institutionId: string }>;
  categories: Array<{ id: string; name: string; code: string }>;
  defaultStartDate: string;
  defaultEndDate: string;
  userRole: string;
  userCanExport: boolean;
}

