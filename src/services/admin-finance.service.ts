import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import { reconcilePaymentServer } from '@/services/recharge.service';
import type { UserRole } from '@/types/auth';
import type { PaymentStatus, RechargeStatus } from '@/types/payment';
import type { WalletStatus, WalletTransactionType } from '@/types/wallet';

const VIEW_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
];
const MANAGE_ROLES: UserRole[] = ['admin_general', 'finance'];

interface FinanceRequester {
  tenantId: string;
  role: UserRole;
  institutionIds: string[] | null;
}

export interface FinanceWalletItem {
  id: string;
  studentId: string;
  studentName: string;
  registrationNumber: string;
  institutionName: string;
  balance: number;
  status: WalletStatus;
  updatedAt: string;
}

export interface FinanceTransactionItem {
  id: string;
  studentId: string;
  studentName: string;
  type: WalletTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  canReverse: boolean;
}

export interface FinancePaymentItem {
  id: string;
  studentName: string;
  providerName: string;
  method: 'pix' | 'credit_card';
  amount: number;
  status: PaymentStatus;
  createdAt: string;
}

export interface FinanceRechargeItem {
  id: string;
  studentName: string;
  source: 'pix' | 'credit_card' | 'cash' | 'manual';
  amount: number;
  status: RechargeStatus;
  createdAt: string;
}

export interface FinanceDashboardData {
  wallets: FinanceWalletItem[];
  transactions: FinanceTransactionItem[];
  payments: FinancePaymentItem[];
  recharges: FinanceRechargeItem[];
  canManage: boolean;
  summary: {
    totalBalance: number;
    activeWallets: number;
    pendingPayments: number;
    pendingAmount: number;
    confirmedRechargesMonth: number;
  };
}

async function getRequester(requestingUserId: string): Promise<FinanceRequester | null> {
  const adminClient = getAdminClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', requestingUserId)
    .maybeSingle();
  if (!profile || profile.status !== 'active' || !VIEW_ROLES.includes(profile.role)) return null;

  if (!['supervisor', 'unit_manager'].includes(profile.role)) {
    return { tenantId: profile.tenant_id, role: profile.role, institutionIds: null };
  }

  const { data: unitAccess } = await adminClient
    .from('user_unit_access')
    .select('unit_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('user_id', requestingUserId);
  const unitIds = (unitAccess || []).map((access) => access.unit_id);
  if (!unitIds.length) return { tenantId: profile.tenant_id, role: profile.role, institutionIds: [] };

  const { data: units } = await adminClient
    .from('units')
    .select('institution_id')
    .eq('tenant_id', profile.tenant_id)
    .in('id', unitIds);
  return {
    tenantId: profile.tenant_id,
    role: profile.role,
    institutionIds: [...new Set((units || []).map((unit) => unit.institution_id))],
  };
}

export async function getFinanceDashboardServer(
  requestingUserId: string
): Promise<{ data: FinanceDashboardData | null; error?: string }> {
  const requester = await getRequester(requestingUserId);
  if (!requester) return { data: null, error: 'Seu perfil não possui acesso ao módulo financeiro.' };

  const adminClient = getAdminClient();
  let studentsQuery = adminClient
    .from('students')
    .select('id,institution_id,full_name,registration_number')
    .eq('tenant_id', requester.tenantId)
    .order('full_name');
  if (requester.institutionIds) {
    if (!requester.institutionIds.length) {
      return {
        data: {
          wallets: [], transactions: [], payments: [], recharges: [],
          canManage: false,
          summary: { totalBalance: 0, activeWallets: 0, pendingPayments: 0, pendingAmount: 0, confirmedRechargesMonth: 0 },
        },
      };
    }
    studentsQuery = studentsQuery.in('institution_id', requester.institutionIds);
  }

  const [{ data: students, error: studentError }, { data: institutions, error: institutionError }] =
    await Promise.all([
      studentsQuery,
      adminClient.from('institutions').select('id,name').eq('tenant_id', requester.tenantId),
    ]);
  if (studentError || institutionError) {
    return { data: null, error: studentError?.message || institutionError?.message };
  }

  const studentIds = (students || []).map((student) => student.id);
  if (!studentIds.length) {
    return {
      data: {
        wallets: [], transactions: [], payments: [], recharges: [],
        canManage: MANAGE_ROLES.includes(requester.role),
        summary: { totalBalance: 0, activeWallets: 0, pendingPayments: 0, pendingAmount: 0, confirmedRechargesMonth: 0 },
      },
    };
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [walletResult, transactionResult, paymentResult, rechargeResult, monthRechargeResult, providerResult] =
    await Promise.all([
      adminClient.from('wallets').select('id,student_id,balance,status,updated_at').eq('tenant_id', requester.tenantId).in('student_id', studentIds).order('updated_at', { ascending: false }),
      adminClient.from('wallet_transactions').select('id,student_id,type,amount,balance_before,balance_after,description,created_at').eq('tenant_id', requester.tenantId).in('student_id', studentIds).order('created_at', { ascending: false }).limit(200),
      adminClient.from('payments').select('id,student_id,provider_id,method,amount,status,created_at').eq('tenant_id', requester.tenantId).in('student_id', studentIds).order('created_at', { ascending: false }).limit(100),
      adminClient.from('recharges').select('id,student_id,source,amount,status,created_at').eq('tenant_id', requester.tenantId).in('student_id', studentIds).order('created_at', { ascending: false }).limit(100),
      adminClient.from('recharges').select('amount').eq('tenant_id', requester.tenantId).in('student_id', studentIds).eq('status', 'confirmed').gte('confirmed_at', monthStart.toISOString()),
      adminClient.from('payment_providers').select('id,name').eq('tenant_id', requester.tenantId),
    ]);

  const firstError = walletResult.error || transactionResult.error || paymentResult.error ||
    rechargeResult.error || monthRechargeResult.error || providerResult.error;
  if (firstError) return { data: null, error: firstError.message };

  const studentsById = new Map((students || []).map((student) => [student.id, student]));
  const institutionsById = new Map((institutions || []).map((institution) => [institution.id, institution.name]));
  const providersById = new Map((providerResult.data || []).map((provider) => [provider.id, provider.name]));
  const canManage = MANAGE_ROLES.includes(requester.role);
  const wallets = walletResult.data || [];
  const pendingPayments = (paymentResult.data || []).filter((payment) => payment.status === 'pending');

  return {
    data: {
      wallets: wallets.map((wallet) => {
        const student = studentsById.get(wallet.student_id);
        return {
          id: wallet.id,
          studentId: wallet.student_id,
          studentName: student?.full_name || 'Comensal não encontrado',
          registrationNumber: student?.registration_number || '',
          institutionName: institutionsById.get(student?.institution_id || '') || 'Instituição não encontrada',
          balance: Number(wallet.balance),
          status: wallet.status,
          updatedAt: wallet.updated_at,
        };
      }),
      transactions: (transactionResult.data || []).map((transaction) => ({
        id: transaction.id,
        studentId: transaction.student_id,
        studentName: studentsById.get(transaction.student_id)?.full_name || 'Comensal não encontrado',
        type: transaction.type,
        amount: Number(transaction.amount),
        balanceBefore: Number(transaction.balance_before),
        balanceAfter: Number(transaction.balance_after),
        description: transaction.description,
        createdAt: transaction.created_at,
        canReverse: canManage && !['reversal', 'refund'].includes(transaction.type),
      })),
      payments: (paymentResult.data || []).map((payment) => ({
        id: payment.id,
        studentName: studentsById.get(payment.student_id)?.full_name || 'Comensal não encontrado',
        providerName: providersById.get(payment.provider_id) || 'Provedor não encontrado',
        method: payment.method,
        amount: Number(payment.amount),
        status: payment.status,
        createdAt: payment.created_at,
      })),
      recharges: (rechargeResult.data || []).map((recharge) => ({
        id: recharge.id,
        studentName: studentsById.get(recharge.student_id)?.full_name || 'Comensal não encontrado',
        source: recharge.source,
        amount: Number(recharge.amount),
        status: recharge.status,
        createdAt: recharge.created_at,
      })),
      canManage,
      summary: {
        totalBalance: wallets.reduce((sum, wallet) => sum + Number(wallet.balance), 0),
        activeWallets: wallets.filter((wallet) => wallet.status === 'active').length,
        pendingPayments: pendingPayments.length,
        pendingAmount: pendingPayments.reduce((sum, payment) => sum + Number(payment.amount), 0),
        confirmedRechargesMonth: (monthRechargeResult.data || []).reduce((sum, recharge) => sum + Number(recharge.amount), 0),
      },
    },
  };
}

export async function reconcileFinancePaymentServer(
  requestingUserId: string,
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  const requester = await getRequester(requestingUserId);
  if (!requester || !MANAGE_ROLES.includes(requester.role)) {
    return { success: false, error: 'Apenas Master e Financeiro podem conciliar pagamentos.' };
  }
  const adminClient = getAdminClient();
  const { data: payment } = await adminClient
    .from('payments')
    .select('id,status')
    .eq('id', paymentId)
    .eq('tenant_id', requester.tenantId)
    .maybeSingle();
  if (!payment) return { success: false, error: 'Pagamento não encontrado neste tenant.' };
  if (payment.status !== 'pending') return { success: false, error: 'Somente pagamentos pendentes podem ser conciliados.' };

  const result = await reconcilePaymentServer(paymentId);
  return result.success ? { success: true } : { success: false, error: result.error || 'Falha na conciliação.' };
}
