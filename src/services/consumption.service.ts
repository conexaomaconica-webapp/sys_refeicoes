import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type {
  ConsumeMealInput,
  ConsumeMealResult,
  CancelMealConsumptionInput,
  CancelMealConsumptionResult,
  MealConsumption,
  ConfirmTerminalMealPaymentInput,
} from '@/types/consumption';

/**
 * ==============================================================================
 * Serviço de Consumo de Refeições (Terminal de Atendimento / Caixa Operacional)
 * Executa consume_meal e cancel_meal_consumption com garantias de idempotência.
 * ==============================================================================
 */

/**
 * Gera uma chave de idempotência aleatória de alta entropia para proteger retries de rede
 */
export function generateIdempotencyKey(unitId: string, terminalId?: string): string {
  const prefix = terminalId ? `TERM-${terminalId}` : `UNIT-${unitId.substring(0, 8)}`;
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Executa a liberação e débito atômico de uma refeição no terminal operacional
 */
export async function executeConsumeMeal(
  input: ConsumeMealInput
): Promise<ConsumeMealResult> {
  const cleanId = input.identifier ? input.identifier.trim() : '';

  if (!input.unit_id) {
    return {
      success: false,
      error_code: 'ACCESS_DENIED_UNIT',
      message: 'Unidade operacional não informada.',
    };
  }

  if (!cleanId) {
    return {
      success: false,
      error_code: 'INVALID_IDENTIFIER',
      message: 'Matrícula, QR Code ou Cartão Físico não informado.',
    };
  }

  const idempotencyKey = input.idempotency_key || generateIdempotencyKey(input.unit_id, input.terminal_id);

  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: {
            p_unit_id: string;
            p_identifier: string;
            p_meal_type_id: string | null;
            p_idempotency_key: string | null;
            p_terminal_id: string | null;
          }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('consume_operator_terminal_meal', {
      p_unit_id: input.unit_id,
      p_identifier: cleanId,
      p_meal_type_id: input.meal_type_id || null,
      p_idempotency_key: idempotencyKey,
      p_terminal_id: input.terminal_id || null,
    });

    if (error) {
      return {
        success: false,
        error_code: 'CONCURRENT_CONSUMPTION_CONFLICT',
        message: error.message,
      };
    }

    return data as unknown as ConsumeMealResult;
  } catch (err) {
    return {
      success: false,
      error_code: 'CONCURRENT_CONSUMPTION_CONFLICT',
      message: (err as Error).message,
    };
  }
}

export async function previewTerminalMeal(input: ConsumeMealInput): Promise<ConsumeMealResult> {
  const cleanId = input.identifier?.trim();
  if (!cleanId) return { success: false, error_code: 'INVALID_IDENTIFIER', message: 'Identificação não informada.' };
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('preview_operator_terminal_meal', {
      p_unit_id: input.unit_id,
      p_identifier: cleanId,
      p_meal_type_id: input.meal_type_id || null,
    });
    if (error) return { success: false, error_code: 'CLIENT_ERROR', message: error.message };
    return data as unknown as ConsumeMealResult;
  } catch (err) {
    return { success: false, error_code: 'CLIENT_ERROR', message: (err as Error).message };
  }
}

export async function confirmTerminalMealPayment(
  input: ConfirmTerminalMealPaymentInput
): Promise<ConsumeMealResult> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('confirm_operator_terminal_payment', {
      p_unit_id: input.unit_id,
      p_identifier: input.identifier.trim(),
      p_meal_type_id: input.meal_type_id || '',
      p_terminal_id: input.terminal_id || 'TERM-01',
      p_idempotency_key: input.idempotency_key || generateIdempotencyKey(input.unit_id, input.terminal_id),
      p_payment_method: input.payment_method,
      p_amount_received: input.amount_received ?? null,
    });
    if (error) return { success: false, error_code: 'CLIENT_ERROR', message: error.message };
    return data as unknown as ConsumeMealResult;
  } catch (err) {
    return { success: false, error_code: 'CLIENT_ERROR', message: (err as Error).message };
  }
}

/**
 * Executa o estorno financeiro ou cancelamento operacional de um consumo
 */
export async function executeCancelMealConsumption(
  input: CancelMealConsumptionInput
): Promise<CancelMealConsumptionResult> {
  if (!input.consumption_id) {
    return {
      success: false,
      error_code: 'CONSUMPTION_NOT_FOUND',
      message: 'Identificador do consumo não informado.',
    };
  }

  if (!input.reason || input.reason.trim().length < 5) {
    return {
      success: false,
      error_code: 'REASON_REQUIRED',
      message: 'Justificativa auditável obrigatória (mínimo de 5 caracteres).',
    };
  }

  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: {
            p_consumption_id: string;
            p_cancel_type: string;
            p_reason: string;
          }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('cancel_meal_consumption', {
      p_consumption_id: input.consumption_id,
      p_cancel_type: input.cancel_type,
      p_reason: input.reason.trim(),
    });

    if (error) {
      return {
        success: false,
        error_code: 'CANCEL_ERROR',
        message: error.message,
      };
    }

    return data as unknown as CancelMealConsumptionResult;
  } catch (err) {
    return {
      success: false,
      error_code: 'CLIENT_ERROR',
      message: (err as Error).message,
    };
  }
}

/**
 * Consulta histórico de consumos do estudante
 */
export async function getStudentMealHistory(
  studentId: string,
  limit = 20
): Promise<{ consumptions: MealConsumption[]; error?: string }> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('meal_consumptions')
      .select('*')
      .eq('student_id', studentId)
      .order('consumed_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { consumptions: [], error: error.message };
    }

    return { consumptions: (data || []) as unknown as MealConsumption[] };
  } catch (err) {
    return { consumptions: [], error: (err as Error).message };
  }
}

/**
 * Executa a liberação rápida de 1 refeição avulsa de visitante paga na entrada (sem necessidade de saldo/carteira)
 */
export async function executeRegisterVisitorEntry(params: {
  unitId: string;
  mealTypeId?: string;
  terminalId?: string;
  paymentMethod?: 'cash' | 'pix' | 'card';
  amountReceived?: number;
}): Promise<ConsumeMealResult> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: {
            p_unit_id: string;
            p_meal_type_id: string | null;
            p_terminal_id: string | null;
            p_payment_method: string;
            p_amount_received: number | null;
          }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('register_operator_visitor_entry_v2', {
      p_unit_id: params.unitId,
      p_meal_type_id: params.mealTypeId || null,
      p_terminal_id: params.terminalId || null,
      p_payment_method: params.paymentMethod || 'cash',
      p_amount_received: params.amountReceived ?? null,
    });

    if (error) {
      return {
        success: false,
        error_code: 'CLIENT_ERROR',
        message: error.message,
      };
    }

    return data as unknown as ConsumeMealResult;
  } catch (err) {
    return {
      success: false,
      error_code: 'CLIENT_ERROR',
      message: (err as Error).message,
    };
  }
}

export async function getOperatorVisitorPrice(params: {
  unitId: string;
  mealTypeId?: string;
}): Promise<{ success: boolean; price: number; message?: string }> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_unit_id: string; p_meal_type_id: string | null }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('get_operator_visitor_price', {
      p_unit_id: params.unitId,
      p_meal_type_id: params.mealTypeId || null,
    });

    if (error) return { success: false, price: 0, message: error.message };
    const result = data as { success?: boolean; price?: number; message?: string } | null;
    return {
      success: Boolean(result?.success),
      price: Number(result?.price || 0),
      message: result?.message,
    };
  } catch (error) {
    return { success: false, price: 0, message: (error as Error).message };
  }
}
