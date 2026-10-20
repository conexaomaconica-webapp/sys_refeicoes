/**
 * ==============================================================================
 * Serviço de Controle de Caixa e Turno (PDV)
 * MA Refeições
 * Gerenciamento de abertura, sangrias, suprimentos, conferência cega e fechamento.
 * ==============================================================================
 */

import { createBrowserClient } from '@/lib/supabase/client';
import type {
  CashShift,
  CashMovement,
  OpenCashShiftParams,
  CloseCashShiftParams,
  RecordMovementParams,
  PaymentMethod,
} from '@/types/cash-shift';

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

const getRpcClient = (): RpcClient => createBrowserClient() as unknown as RpcClient;

export interface ActiveShiftResult {
  shift: CashShift | null;
  movements: CashMovement[];
}

export interface CloseShiftResult {
  shift_id: string;
  system_expected_balance: number;
  counted_closing_balance: number;
  difference_amount: number;
  status: string;
}

export interface VisitorEntryResult {
  success: boolean;
  message: string;
  student_name: string;
  registration_number: string;
  meal_price: number;
  cash_shift_id: string | null;
  balance_after: number;
}

export const cashShiftService = {
  /**
   * Abre um novo turno de caixa com fundo de troco inicial
   */
  async openShift(params: OpenCashShiftParams): Promise<string> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('open_operator_cash_shift', {
      p_unit_id: params.unitId,
      p_terminal_id: params.terminalId,
      p_meal_type_id: params.mealTypeId,
      p_initial_float: params.initialFloat || 0,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao abrir caixa.');
    }

    return data as string;
  },

  /**
   * Obtém o caixa atualmente aberto para a unidade e terminal
   */
  async getActiveShift(unitId: string, terminalId: string): Promise<ActiveShiftResult> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('get_operator_terminal_shift', {
      p_unit_id: unitId,
      p_terminal_id: terminalId,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao carregar turno do caixa.');
    }

    const response = data as unknown as { shift?: CashShift | null; cash_shift?: CashShift | null; movements?: CashMovement[]; terminal_locked?: boolean; message?: string } | null;
    if (response?.terminal_locked) {
      throw new Error(response.message || 'Terminal em uso por outro operador.');
    }
    const shift = response?.shift || response?.cash_shift || null;
    if (!shift) {
      return { shift: null, movements: [] };
    }

    return {
      shift,
      movements: response?.movements || [],
    };
  },

  /**
   * Registra movimentação avulsa: Sangria ou Suprimento
   */
  async recordMovement(params: RecordMovementParams): Promise<string> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('record_operator_cash_movement', {
      p_cash_shift_id: params.cashShiftId,
      p_type: params.type,
      p_amount: params.amount,
      p_payment_method: params.paymentMethod || 'cash',
      p_description: params.description || null,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao registrar movimentação.');
    }

    return data as string;
  },

  /**
   * Fecha o turno de caixa com conferência cega do valor contado fisicamente
   */
  async closeShift(params: CloseCashShiftParams): Promise<CloseShiftResult> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('close_operator_cash_shift', {
      p_cash_shift_id: params.cashShiftId,
      p_counted_amount: params.countedAmount,
      p_closing_notes: params.closingNotes || null,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao fechar caixa.');
    }

    const response = data as unknown as { cash_shift?: CashShift; difference_amount?: number };
    const shift = response.cash_shift;
    if (!shift) throw new Error('Resposta invalida ao fechar o caixa.');
    return {
      shift_id: shift.id,
      system_expected_balance: Number(shift.expected_cash_balance ?? shift.system_expected_balance),
      counted_closing_balance: Number(shift.counted_closing_balance),
      difference_amount: Number(response.difference_amount ?? shift.difference_amount ?? 0),
      status: shift.status,
    };
  },

  /**
   * Registra a entrada e cobrança avulsa de um visitante na portaria
   */
  async registerVisitor(
    unitId: string,
    mealTypeId: string,
    terminalId: string,
    paymentMethod: PaymentMethod = 'cash'
  ): Promise<VisitorEntryResult> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('register_operator_visitor_entry', {
      p_unit_id: unitId,
      p_meal_type_id: mealTypeId,
      p_terminal_id: terminalId,
      p_payment_method: paymentMethod,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao registrar entrada de visitante.');
    }

    return data as VisitorEntryResult;
  },

  /**
   * Lista caixas com filtros para auditoria e controle gerencial
   */
  async listShifts(filters: {
    unitId?: string;
    mealTypeId?: string;
    status?: 'opened' | 'closed';
    startDate?: string;
    endDate?: string;
  }): Promise<CashShift[]> {
    const supabase = getRpcClient();
    const { data, error } = await supabase.rpc('admin_list_cash_shifts', {
      p_unit_id: filters.unitId || null,
      p_meal_type_id: filters.mealTypeId || null,
      p_status: filters.status || null,
      p_start_date: filters.startDate || null,
      p_end_date: filters.endDate || null,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao listar caixas.');
    }

    return (data || []) as CashShift[];
  },
};
