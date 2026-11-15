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
const POSTGREST_PAGE_SIZE = 1000;
const MAX_PAGINATION_PAGES = 200;

function sumCurrencyCents(values: Array<number | string | null | undefined>): number {
  let cents = 0;
  for (const val of values) {
    const num = Number(val ?? 0);
    if (Number.isFinite(num)) {
      cents += Math.round(num * 100);
    }
  }
  return cents / 100;
}

async function fetchAllPaginatedRows<T extends Record<string, unknown>>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  getKey?: (row: T) => string
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  const seenKeys = getKey ? new Set<string>() : null;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const from = page * POSTGREST_PAGE_SIZE;
    const to = from + POSTGREST_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);

    if (error) {
      return { rows: [], error: error.message };
    }

    const batch = data || [];
    for (const row of batch) {
      if (seenKeys && getKey) {
        const key = getKey(row);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      rows.push(row);
    }

    if (batch.length < POSTGREST_PAGE_SIZE) {
      return { rows };
    }
  }

  return {
    rows: [],
    error: 'Limite de paginação excedido ao carregar totais financeiros; utilize agregação no banco.',
  };
}

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
  if (requester.institutionIds && !requester.institutionIds.length) {
    return {
      data: {
        wallets: [], transactions: [], payments: [], recharges: [],
        canManage: false,
        summary: { totalBalance: 0, activeWallets: 0, pendingPayments: 0, pendingAmount: 0, confirmedRechargesMonth: 0 },
      },
    };
  }

  const [studentsResult, { data: institutions, error: institutionError }] = await Promise.all([
    fetchAllPaginatedRows(
      (from, to) => {
        let query = adminClient
          .from('students')
          .select('id,institution_id,full_name,registration_number')
          .eq('tenant_id', requester.tenantId)
          .order('full_name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        if (requester.institutionIds) {
          query = query.in('institution_id', requester.institutionIds);
        }
        return query;
      },
      (row) => row.id
    ),
    adminClient.from('institutions').select('id,name').eq('tenant_id', requester.tenantId),
  ]);
  if (studentsResult.error || institutionError) {
    return { data: null, error: studentsResult.error || institutionError?.message };
  }

  const students = studentsResult.rows;
  const studentIds = students.map((student) => student.id);
  const studentIdSet = new Set(studentIds);
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

  // Evita URLs gigantes no PostgREST (?student_id=in.(...)) que geram 400 Bad Request em tenants com muitos alunos.
  // Quando há filtro por instituição (unit_manager/supervisor) com <= 50 alunos usa .in(); caso contrário pagina por tenant_id e aplica o recorte em memória.
  const canUseDirectStudentIn = Boolean(requester.institutionIds) && studentIds.length <= 50;

  let transactionsQuery = adminClient
    .from('wallet_transactions')
    .select('id,student_id,type,amount,balance_before,balance_after,description,created_at')
    .eq('tenant_id', requester.tenantId)
    .order('created_at', { ascending: false })
    .limit(canUseDirectStudentIn ? 200 : 400);
  let paymentsQuery = adminClient
    .from('payments')
    .select('id,student_id,provider_id,method,amount,status,created_at')
    .eq('tenant_id', requester.tenantId)
    .order('created_at', { ascending: false })
    .limit(canUseDirectStudentIn ? 100 : 250);
  let rechargesQuery = adminClient
    .from('recharges')
    .select('id,student_id,source,amount,status,created_at')
    .eq('tenant_id', requester.tenantId)
    .order('created_at', { ascending: false })
    .limit(canUseDirectStudentIn ? 100 : 250);

  if (canUseDirectStudentIn) {
    transactionsQuery = transactionsQuery.in('student_id', studentIds);
    paymentsQuery = paymentsQuery.in('student_id', studentIds);
    rechargesQuery = rechargesQuery.in('student_id', studentIds);
  }

  const [
    walletsResult,
    transactionResult,
    paymentResult,
    rechargeResult,
    monthRechargeResult,
    pendingPaymentsResult,
    providerResult,
  ] = await Promise.all([
    fetchAllPaginatedRows(
      (from, to) => {
        let query = adminClient
          .from('wallets')
          .select('id,student_id,balance,status,updated_at')
          .eq('tenant_id', requester.tenantId)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (canUseDirectStudentIn) {
          query = query.in('student_id', studentIds);
        }
        return query;
      },
      (row) => row.id
    ),
    transactionsQuery,
    paymentsQuery,
    rechargesQuery,
    fetchAllPaginatedRows(
      (from, to) => {
        let query = adminClient
          .from('recharges')
          .select('id,student_id,amount')
          .eq('tenant_id', requester.tenantId)
          .eq('status', 'confirmed')
          .gte('confirmed_at', monthStart.toISOString())
          .order('confirmed_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (canUseDirectStudentIn) {
          query = query.in('student_id', studentIds);
        }
        return query;
      },
      (row) => row.id
    ),
    fetchAllPaginatedRows(
      (from, to) => {
        let query = adminClient
          .from('payments')
          .select('id,student_id,amount')
          .eq('tenant_id', requester.tenantId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (canUseDirectStudentIn) {
          query = query.in('student_id', studentIds);
        }
        return query;
      },
      (row) => row.id
    ),
    adminClient.from('payment_providers').select('id,name').eq('tenant_id', requester.tenantId),
  ]);

  const firstError =
    walletsResult.error ||
    transactionResult.error?.message ||
    paymentResult.error?.message ||
    rechargeResult.error?.message ||
    monthRechargeResult.error ||
    pendingPaymentsResult.error ||
    providerResult.error?.message;
  if (firstError) return { data: null, error: firstError };

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const institutionsById = new Map((institutions || []).map((institution) => [institution.id, institution.name]));
  const providersById = new Map((providerResult.data || []).map((provider) => [provider.id, provider.name]));
  const canManage = MANAGE_ROLES.includes(requester.role);
  const scopeFilter = <T extends { student_id: string }>(rows: T[] | null | undefined, max?: number): T[] => {
    const filtered = requester.institutionIds
      ? (rows || []).filter((row) => studentIdSet.has(row.student_id))
      : rows || [];
    return max ? filtered.slice(0, max) : filtered;
  };
  const wallets = scopeFilter(walletsResult.rows);
  const scopedTransactions = scopeFilter(transactionResult.data, 200);
  const scopedPayments = scopeFilter(paymentResult.data, 100);
  const scopedRecharges = scopeFilter(rechargeResult.data, 100);
  const scopedMonthRecharges = scopeFilter(monthRechargeResult.rows);
  const scopedPendingPayments = scopeFilter(pendingPaymentsResult.rows);

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
      transactions: scopedTransactions.map((transaction) => ({
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
      payments: scopedPayments.map((payment) => ({
        id: payment.id,
        studentName: studentsById.get(payment.student_id)?.full_name || 'Comensal não encontrado',
        providerName: providersById.get(payment.provider_id) || 'Provedor não encontrado',
        method: payment.method,
        amount: Number(payment.amount),
        status: payment.status,
        createdAt: payment.created_at,
      })),
      recharges: scopedRecharges.map((recharge) => ({
        id: recharge.id,
        studentName: studentsById.get(recharge.student_id)?.full_name || 'Comensal não encontrado',
        source: recharge.source,
        amount: Number(recharge.amount),
        status: recharge.status,
        createdAt: recharge.created_at,
      })),
      canManage,
      summary: {
        totalBalance: sumCurrencyCents(wallets.map((wallet) => wallet.balance)),
        activeWallets: wallets.filter((wallet) => wallet.status === 'active').length,
        pendingPayments: scopedPendingPayments.length,
        pendingAmount: sumCurrencyCents(scopedPendingPayments.map((payment) => payment.amount)),
        confirmedRechargesMonth: sumCurrencyCents(scopedMonthRecharges.map((recharge) => recharge.amount)),
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
