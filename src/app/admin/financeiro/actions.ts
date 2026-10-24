'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { manualAdjustmentServer, reverseTransactionServer } from '@/services/admin-wallet.service';
import { reconcileFinancePaymentServer } from '@/services/admin-finance.service';

type ActionResult = { success: true; message: string } | { success: false; error: string };

export async function createManualAdjustmentAction(input: {
  studentId: string;
  amount: number;
  description: string;
}): Promise<ActionResult> {
  try {
    if (!Number.isFinite(input.amount) || input.amount === 0) {
      return { success: false, error: 'Informe um valor válido e diferente de zero.' };
    }
    const result = await manualAdjustmentServer({
      student_id: input.studentId,
      amount: input.amount,
      description: input.description,
    });
    if (!result.transactionId) return { success: false, error: result.error || 'Não foi possível registrar o ajuste.' };
    revalidatePath('/admin/financeiro');
    return { success: true, message: 'Ajuste registrado no livro-razão com sucesso.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao registrar ajuste.' };
  }
}

export async function reverseFinanceTransactionAction(input: {
  transactionId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const result = await reverseTransactionServer({ transaction_id: input.transactionId, reason: input.reason });
    if (!result.reversalTransactionId) return { success: false, error: result.error || 'Não foi possível estornar o lançamento.' };
    revalidatePath('/admin/financeiro');
    return { success: true, message: 'Estorno compensatório registrado com sucesso.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao estornar lançamento.' };
  }
}

export async function reconcileFinancePaymentAction(paymentId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sessão expirada. Entre novamente.' };
    const result = await reconcileFinancePaymentServer(user.id, paymentId);
    if (!result.success) return { success: false, error: result.error || 'Não foi possível conciliar o pagamento.' };
    revalidatePath('/admin/financeiro');
    return { success: true, message: 'Pagamento conciliado com sucesso.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao conciliar pagamento.' };
  }
}
