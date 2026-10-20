/**
 * ==============================================================================
 * Serviço de Relatórios de Refeições e Bloqueios do Turno
 * MA Refeições
 * Obtém detalhamento de consumos liberados e tentativas bloqueadas no terminal.
 * ==============================================================================
 */

import { createBrowserClient } from '@/lib/supabase/client';

export interface ShiftApprovedMeal {
  id: string;
  consumed_at: string;
  full_name: string;
  registration_number: string;
  category_name: string;
  category_code: string;
  student_price: number;
  full_price: number;
  subsidy_amount: number;
  verification_method: string;
  terminal_id: string;
  operator_name: string | null;
  status: string;
}

export interface ShiftBlockedAttempt {
  id: string;
  attempted_at: string;
  full_name: string | null;
  registration_number: string;
  category_name: string;
  reason_code: string;
  reason_message: string;
  verification_method: string;
  terminal_id: string;
}

export interface ShiftReportsResult {
  success: boolean;
  approved_meals: ShiftApprovedMeal[];
  blocked_attempts: ShiftBlockedAttempt[];
}

export const shiftReportsService = {
  /**
   * Consulta as refeições aprovadas e bloqueadas no turno da unidade/terminal
   */
  async getShiftReports(
    unitId: string,
    mealTypeId?: string,
    terminalId?: string
  ): Promise<ShiftReportsResult> {
    const supabase = createBrowserClient();
    const { data, error } = await (supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('get_terminal_shift_reports', {
      p_unit_id: unitId,
      p_meal_type_id: mealTypeId || null,
      p_terminal_id: terminalId || null,
    });

    if (error) {
      throw new Error(error.message || 'Falha ao carregar relatórios do turno.');
    }

    const res = data as unknown as {
      approved_meals?: ShiftApprovedMeal[];
      blocked_attempts?: ShiftBlockedAttempt[];
    } | null;
    return {
      success: true,
      approved_meals: (res?.approved_meals || []) as ShiftApprovedMeal[],
      blocked_attempts: (res?.blocked_attempts || []) as ShiftBlockedAttempt[],
    };
  },
};
