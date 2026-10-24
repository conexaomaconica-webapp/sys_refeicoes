import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { ManualAdjustmentInput, ReverseTransactionInput, Wallet, WalletTransaction } from '@/types/wallet';

/**
 * ==============================================================================
 * Serviço Administrativo de Gestão de Carteira e Livro Razão (Server-Side Exclusivo)
 * Operações com service_role após resolução de sessão autenticada server-side.
 * ==============================================================================
 */

/**
 * Obtém a identidade do usuário autenticado a partir da sessão Supabase Auth nos cookies.
 */
async function getAuthenticatedUserServer(): Promise<{ userId: string | null; tenantId: string | null; role: string | null; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { userId: null, tenantId: null, role: null, error: 'Sessão inválida ou usuário não autenticado.' };
    }

    const adminClient = getAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('tenant_id, role, status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status !== 'active') {
      return { userId: null, tenantId: null, role: null, error: 'Perfil de usuário inativo ou não encontrado.' };
    }

    return { userId: user.id, tenantId: profile.tenant_id, role: profile.role };
  } catch (e) {
    return { userId: null, tenantId: null, role: null, error: `Erro ao validar autenticação: ${(e as Error).message}` };
  }
}

/**
 * Busca a carteira financeira do aluno.
 * Se o aluno for Bolsista Integral (requires_wallet = false), retorna isIntegral: true e wallet: null.
 */
export async function getWalletByStudentServer(
  studentId: string
): Promise<{ wallet: Wallet | null; isIntegral: boolean; error?: string }> {
  const { tenantId, error: authError } = await getAuthenticatedUserServer();
  if (authError || !tenantId) {
    return { wallet: null, isIntegral: false, error: authError || 'Acesso negado.' };
  }

  const adminClient = getAdminClient();

  // Verificar se o aluno é Bolsista Integral
  const { data: student } = await adminClient
    .from('students')
    .select('id, category_id, student_categories (code, requires_wallet)')
    .eq('id', studentId)
    .eq('tenant_id', tenantId)
    .single();

  if (!student) {
    return { wallet: null, isIntegral: false, error: 'Aluno não encontrado neste tenant.' };
  }

  const category = (student.student_categories as unknown) as { code: string; requires_wallet: boolean } | null;
  if (category?.requires_wallet === false) {
    return { wallet: null, isIntegral: true };
  }

  // Buscar registro da carteira
  const { data: wallet, error } = await adminClient
    .from('wallets')
    .select('*')
    .eq('student_id', studentId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    return { wallet: null, isIntegral: false, error: `Erro ao buscar carteira: ${error.message}` };
  }

  return { wallet: wallet as Wallet | null, isIntegral: false };
}

/**
 * Busca o extrato de lançamentos imutáveis no livro razão para um determinado aluno.
 */
export async function getWalletTransactionsServer(
  studentId: string,
  limit: number = 50
): Promise<{ data: WalletTransaction[] | null; error?: string }> {
  const { tenantId, error: authError } = await getAuthenticatedUserServer();
  if (authError || !tenantId) {
    return { data: null, error: authError || 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from('wallet_transactions')
    .select('*')
    .eq('student_id', studentId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: null, error: `Erro ao buscar histórico de movimentações: ${error.message}` };
  }

  return { data: data as WalletTransaction[] };
}

/**
 * Provisiona a carteira financeira de um aluno Bolsista Parcial / Pagante.
 */
export async function createStudentWalletServer(
  studentId: string
): Promise<{ walletId: string | null; error?: string }> {
  const { userId, error: authError } = await getAuthenticatedUserServer();
  if (authError || !userId) {
    return { walletId: null, error: authError || 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { data: walletId, error } = await adminClient.rpc('create_student_wallet', {
    p_requesting_user_id: userId,
    p_student_id: studentId,
  });

  if (error || !walletId) {
    return { walletId: null, error: `Erro ao criar carteira: ${error?.message || 'Falha na RPC'}` };
  }

  return { walletId: walletId as string };
}

/**
 * Realiza um ajuste manual de crédito ou débito com justificativa obrigatória e trava transacional FOR UPDATE.
 */
export async function manualAdjustmentServer(
  input: ManualAdjustmentInput
): Promise<{ transactionId: string | null; error?: string }> {
  const { userId, role, error: authError } = await getAuthenticatedUserServer();
  if (authError || !userId) {
    return { transactionId: null, error: authError || 'Acesso negado.' };
  }

  if (!role || !['admin_general', 'finance'].includes(role)) {
    return { transactionId: null, error: 'Acesso negado. Apenas perfil administrativo ou financeiro pode fazer ajustes de saldo.' };
  }

  const { student_id, amount, description } = input;

  if (!description || description.trim().length < 5) {
    return { transactionId: null, error: 'O ajuste manual exige uma justificativa/descrição de no mínimo 5 caracteres.' };
  }

  if (amount === 0) {
    return { transactionId: null, error: 'O valor do ajuste manual não pode ser R$ 0.00' };
  }

  const adminClient = getAdminClient();
  const { data: transactionId, error } = await adminClient.rpc('manual_wallet_adjustment', {
    p_requesting_user_id: userId,
    p_student_id: student_id,
    p_amount: amount,
    p_description: description,
  });

  if (error || !transactionId) {
    return { transactionId: null, error: `Erro ao realizar ajuste de saldo: ${error?.message || 'Falha na RPC'}` };
  }

  return { transactionId: transactionId as string };
}

/**
 * Estorna uma transação financeira criando um lançamento compensatório no Livro Razão.
 */
export async function reverseTransactionServer(
  input: ReverseTransactionInput
): Promise<{ reversalTransactionId: string | null; error?: string }> {
  const { userId, role, error: authError } = await getAuthenticatedUserServer();
  if (authError || !userId) {
    return { reversalTransactionId: null, error: authError || 'Acesso negado.' };
  }

  if (!role || !['admin_general', 'finance'].includes(role)) {
    return { reversalTransactionId: null, error: 'Acesso negado. Apenas gestores autorizados podem estornar movimentações.' };
  }

  const { transaction_id, reason } = input;

  if (!reason || reason.trim().length < 5) {
    return { reversalTransactionId: null, error: 'O estorno exige um motivo/justificativa de no mínimo 5 caracteres.' };
  }

  const adminClient = getAdminClient();
  const { data: reversalTransactionId, error } = await adminClient.rpc('reverse_wallet_transaction', {
    p_requesting_user_id: userId,
    p_transaction_id: transaction_id,
    p_reason: reason,
  });

  if (error || !reversalTransactionId) {
    return { reversalTransactionId: null, error: `Erro ao estornar transação: ${error?.message || 'Falha na RPC'}` };
  }

  return { reversalTransactionId: reversalTransactionId as string };
}
