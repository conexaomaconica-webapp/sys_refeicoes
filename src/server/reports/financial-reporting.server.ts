import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  ConsolidatedFinancialReport,
  FinancialReportFilters,
  ReportingInitialData,
} from '@/types/financial-reporting';

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function getFinancialReportingInitialData(): Promise<ReportingInitialData> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    throw new Error('Perfil de usuário inativo ou não autorizado.');
  }

  if (!['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(profile.role)) {
    throw new Error('Acesso restrito ao módulo de relatórios fiscais.');
  }

  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const defaultStartDate = firstDayOfMonth.toISOString().split('T')[0];
  const defaultEndDate = today.toISOString().split('T')[0];

  const [institutionsRes, unitsRes, categoriesRes] = await Promise.all([
    supabase
      .from('institutions')
      .select('id,name')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('units')
      .select('id,name,institution_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('student_categories')
      .select('id,name,code')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .order('name'),
  ]);

  const units = (unitsRes.data || []).map((u: { id: string; name: string; institution_id: string }) => ({
    id: u.id,
    name: u.name,
    institutionId: u.institution_id,
  }));

  const userCanExport = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(profile.role);

  return {
    institutions: institutionsRes.data || [],
    units,
    categories: categoriesRes.data || [],
    defaultStartDate,
    defaultEndDate,
    userRole: profile.role,
    userCanExport,
  };
}

export async function getConsolidatedFinancialReport(
  filters: FinancialReportFilters
): Promise<ConsolidatedFinancialReport> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('AUTH_REQUIRED: Sessão expirada ou não autenticado.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    throw new Error('ACTIVE_PROFILE_REQUIRED: Perfil de usuário inativo ou não autorizado.');
  }

  const allowedRoles = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'];
  if (!allowedRoles.includes(profile.role)) {
    throw new Error('PERMISSION_DENIED: Perfil sem permissão para acessar relatórios fiscais.');
  }

  // Validação de escopo estrito de unidade para gerentes locais e supervisores (Sprint 15.1)
  if (['unit_manager', 'supervisor'].includes(profile.role) && !filters.unitId) {
    throw new Error('UNIT_SCOPE_REQUIRED: Gestores locais e supervisores devem obrigatoriamente especificar uma unidade autorizada.');
  }

  // Única fonte canônica de apuração contábil: RPC com comportamento fail-closed
  const { data: rpcData, error: rpcError } = await (supabase.rpc as unknown as RpcCaller)(
    'get_consolidated_financial_report',
    {
      p_tenant_id: profile.tenant_id,
      p_start_date: filters.startDate,
      p_end_date: filters.endDate,
      p_institution_id: filters.institutionId || null,
      p_unit_id: filters.unitId || null,
      p_category_id: filters.categoryId || null,
    }
  );

  if (rpcError) {
    throw new Error(`FALHA_CONTABIL_FAIL_CLOSED: Erro ao executar apuração canônica RPC: ${rpcError.message}`);
  }

  if (!rpcData) {
    throw new Error('FALHA_CONTABIL_FAIL_CLOSED: Nenhum dado retornado pela apuração canônica.');
  }

  return rpcData as ConsolidatedFinancialReport;
}

export { generateFinancialReportExcelWorkbook } from '@/lib/reports/financial-excel';
