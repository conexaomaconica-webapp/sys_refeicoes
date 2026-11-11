export interface HourlyFlowBucket {
  interval: string;
  total: number;
  integral: number;
  partial: number;
}

export interface BlockedReasonMetric {
  reason_code: string;
  reason_message: string;
  count: number;
  percentage: number;
}

export interface CategoryConsumptionMetric {
  category_id: string;
  category_name: string;
  category_code: string;
  is_integral: boolean;
  count: number;
  percentage: number;
  total_full_price: number;
  total_subsidy: number;
}

export interface TerminalStatusMetric {
  terminal_id: string;
  operator_name: string | null;
  total_served: number;
  last_consumed_at: string | null;
  seconds_since_last_activity: number | null;
  speed_per_minute: number;
  is_idle_alert: boolean;
}

export interface OperationalDashboardSummary {
  total_meals: number;
  integral_meals: number;
  partial_meals: number;
  recent_5m_meals: number;
  speed_per_minute: number;
  total_blocked: number;
  total_attempts: number;
  block_rate_percentage: number;
  peak_interval: string | null;
  peak_volume: number;
}

export interface OperationalDashboardSnapshot {
  generated_at: string;
  service_date: string;
  unit_id: string;
  unit_name: string;
  meal_type_id: string | null;
  summary: OperationalDashboardSummary;
  hourly_flow: HourlyFlowBucket[];
  blocked_reasons: BlockedReasonMetric[];
  category_breakdown: CategoryConsumptionMetric[];
  terminal_statuses: TerminalStatusMetric[];
}

export interface OperationalDashboardFilters {
  unitId: string;
  serviceDate: string;
  mealTypeId?: string | null;
}

