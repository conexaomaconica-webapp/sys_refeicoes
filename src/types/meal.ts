export type MealTypeCode = 'breakfast' | 'lunch' | 'dinner';

export interface MealType {
  id: string;
  tenant_id: string;
  code: MealTypeCode;
  name: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface UnitMealType {
  id: string;
  tenant_id: string;
  unit_id: string;
  meal_type_id: string;
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
  meal_type?: MealType;
}

export interface MealRule {
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
  meal_type?: MealType;
}

export interface SetMealRuleInput {
  unit_id: string;
  meal_type_id: string;
  category_id: string;
  full_price: number;
  student_price: number;
  effective_from?: string;
}

export interface ToggleUnitMealTypeInput {
  unit_id: string;
  meal_type_id: string;
  enabled: boolean;
  start_time?: string | null;
  end_time?: string | null;
}
