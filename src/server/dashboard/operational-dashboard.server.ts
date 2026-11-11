import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  OperationalDashboardSnapshot,
} from '@/types/operational-dashboard';

export interface OperationalDashboardInitialData {
  units: Array<{ id: string; name: string }>;
  mealTypes: Array<{ id: string; name: string }>;
  selectedUnitId: string;
  selectedMealTypeId: string | null;
  serviceDate: string;
  initialSnapshot: OperationalDashboardSnapshot | null;
  currentUser: {
    id: string;
    role: string;
    fullName: string;
  };
}

export async function getOperationalDashboardInitialData(
  requestedUnitId?: string,
  requestedDate?: string,
  requestedMealTypeId?: string
): Promise<OperationalDashboardInitialData> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status,full_name')
    .eq('id', user.id)
    .single();

  const profile = profileData as {
    id: string;
    tenant_id: string;
    role: string;
    status: string;
    full_name: string;
  } | null;

  if (!profile || profile.status !== 'active') {
    throw new Error('Perfil de usuário inativo ou não autorizado.');
  }

  if (
    !['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(
      profile.role
    )
  ) {
    throw new Error('Acesso restrito a gestores e diretores operacionais.');
  }

  // Buscar unidades acessíveis pelo usuário
  const { data: unitsData, error: unitsError } = await supabase
    .from('units')
    .select('id,name')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .order('name');

  if (unitsError) {
    throw new Error('Erro ao listar unidades: ' + unitsError.message);
  }

  const units = (unitsData || []) as Array<{ id: string; name: string }>;
  if (units.length === 0) {
    throw new Error('Nenhuma unidade operacional ativa disponível para seu perfil.');
  }

  // Selecionar unidade inicial
  const selectedUnitId =
    requestedUnitId && units.some((u) => u.id === requestedUnitId)
      ? requestedUnitId
      : units[0].id;

  // Buscar tipos de refeição
  const { data: mealTypesData } = await supabase
    .from('meal_types')
    .select('id,name')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .order('name');

  const mealTypes = (mealTypesData || []) as Array<{ id: string; name: string }>;

  // Data do serviço padrão: data de hoje no formato YYYY-MM-DD
  const todayStr = requestedDate || new Date().toISOString().split('T')[0];
  const selectedMealTypeId = requestedMealTypeId || null;

  let initialSnapshot: OperationalDashboardSnapshot | null = null;
  type RpcCaller = (
    functionName: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  try {
    const { data: rpcData, error: rpcError } = await (
      supabase.rpc as unknown as RpcCaller
    )('get_realtime_operational_dashboard', {
      p_unit_id: selectedUnitId,
      p_service_date: todayStr,
      p_meal_type_id: selectedMealTypeId,
    });

    if (!rpcError && rpcData) {
      initialSnapshot = rpcData as OperationalDashboardSnapshot;
    }
  } catch (err) {
    console.error('Falha ao carregar snapshot inicial do dashboard:', err);
  }

  return {
    units,
    mealTypes,
    selectedUnitId,
    selectedMealTypeId,
    serviceDate: todayStr,
    initialSnapshot,
    currentUser: {
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name,
    },
  };
}

