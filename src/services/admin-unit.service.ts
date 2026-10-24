import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { UserRole } from '@/types/auth';

type UnitStatus = 'active' | 'inactive';

export interface ManagedUnit {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  city: string;
  state: string;
  timezone: string;
  status: UnitStatus;
  cashShiftMode: 'per_meal' | 'daily';
  canEdit: boolean;
}

export interface UnitInstitutionOption {
  id: string;
  name: string;
  status: UnitStatus;
}

export interface UnitManagementData {
  units: ManagedUnit[];
  institutions: UnitInstitutionOption[];
  canCreate: boolean;
  canManageLifecycle: boolean;
}

export interface SaveUnitInput {
  id?: string;
  institutionId: string;
  name: string;
  city: string;
  state: string;
  timezone: string;
  status: UnitStatus;
}

interface Requester {
  tenantId: string;
  role: UserRole;
  unitIds: string[];
}

const VIEW_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
];

async function getRequester(requestingUserId: string): Promise<Requester | null> {
  const adminClient = getAdminClient();
  const [{ data: profile }, { data: accesses }] = await Promise.all([
    adminClient
      .from('profiles')
      .select('tenant_id,role,status')
      .eq('id', requestingUserId)
      .maybeSingle(),
    adminClient.from('user_unit_access').select('unit_id').eq('user_id', requestingUserId),
  ]);
  if (!profile || profile.status !== 'active' || !VIEW_ROLES.includes(profile.role)) return null;
  return {
    tenantId: profile.tenant_id,
    role: profile.role,
    unitIds: (accesses || []).map((access) => access.unit_id),
  };
}

function canEditUnit(requester: Requester, unitId: string) {
  return requester.role === 'admin_general' ||
    requester.role === 'operations_director' ||
    (requester.role === 'unit_manager' && requester.unitIds.includes(unitId));
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

async function hasOpenedCashShift(tenantId: string, unitId: string) {
  const adminClient = getAdminClient();
  const untypedClient = adminClient as unknown as {
    from: (table: 'cash_shifts') => {
      select: (columns: string, options: { count: 'exact'; head: true }) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<{ count: number | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
  const { count, error } = await untypedClient
    .from('cash_shifts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('unit_id', unitId)
    .eq('status', 'opened');
  if (error) throw new Error(`Não foi possível verificar os caixas da unidade: ${error.message}`);
  return (count || 0) > 0;
}

export async function getUnitManagementDataServer(
  requestingUserId: string
): Promise<{ data: UnitManagementData | null; error?: string }> {
  const requester = await getRequester(requestingUserId);
  if (!requester) return { data: null, error: 'Seu perfil não possui acesso às unidades.' };

  const adminClient = getAdminClient();
  const [{ data: unitRows, error: unitError }, { data: institutionRows, error: institutionError }] =
    await Promise.all([
      adminClient
        .from('units')
        .select('id,institution_id,name,city,state,timezone,status,cash_shift_mode')
        .eq('tenant_id', requester.tenantId)
        .order('name'),
      adminClient
        .from('institutions')
        .select('id,name,status')
        .eq('tenant_id', requester.tenantId)
        .order('name'),
    ]);
  if (unitError || institutionError) {
    return { data: null, error: unitError?.message || institutionError?.message };
  }

  const institutionNames = new Map((institutionRows || []).map((item) => [item.id, item.name]));
  const scoped = ['supervisor', 'unit_manager'].includes(requester.role);
  const visibleUnits = (unitRows || []).filter((unit) => !scoped || requester.unitIds.includes(unit.id));
  const visibleInstitutionIds = new Set(visibleUnits.map((unit) => unit.institution_id));
  const institutions = requester.role === 'admin_general' || requester.role === 'operations_director'
    ? institutionRows || []
    : (institutionRows || []).filter((institution) => visibleInstitutionIds.has(institution.id));

  return {
    data: {
      units: visibleUnits.map((unit) => ({
        id: unit.id,
        institutionId: unit.institution_id,
        institutionName: institutionNames.get(unit.institution_id) || 'Instituição não encontrada',
        name: unit.name,
        city: unit.city,
        state: unit.state,
        timezone: unit.timezone,
        status: unit.status,
        cashShiftMode: unit.cash_shift_mode,
        canEdit: canEditUnit(requester, unit.id),
      })),
      institutions,
      canCreate: requester.role === 'admin_general',
      canManageLifecycle: requester.role === 'admin_general' || requester.role === 'operations_director',
    },
  };
}

export async function saveUnitServer(
  requestingUserId: string,
  input: SaveUnitInput
): Promise<{ success: boolean; error?: string }> {
  const requester = await getRequester(requestingUserId);
  if (!requester) return { success: false, error: 'Acesso negado.' };
  if (!input.id && requester.role !== 'admin_general') {
    return { success: false, error: 'Apenas o Master pode criar unidades.' };
  }
  if (input.id && !canEditUnit(requester, input.id)) {
    return { success: false, error: 'Seu perfil não pode alterar esta unidade.' };
  }

  const name = input.name.trim();
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  const timezone = input.timezone.trim();
  if (!name) return { success: false, error: 'Informe o nome da unidade.' };
  if (!city) return { success: false, error: 'Informe a cidade.' };
  if (!/^[A-Z]{2}$/.test(state)) return { success: false, error: 'Informe a UF com duas letras.' };
  if (!validateTimezone(timezone)) return { success: false, error: 'Informe um fuso horário válido.' };
  if (!['active', 'inactive'].includes(input.status)) return { success: false, error: 'Status inválido.' };

  const adminClient = getAdminClient();
  const { data: institution } = await adminClient
    .from('institutions')
    .select('id,status')
    .eq('id', input.institutionId)
    .eq('tenant_id', requester.tenantId)
    .maybeSingle();
  if (!institution) return { success: false, error: 'Instituição inválida para este tenant.' };
  if (!input.id && institution.status !== 'active') {
    return { success: false, error: 'Não é possível criar unidade em uma instituição inativa.' };
  }

  if (!input.id) {
    const { error } = await adminClient.from('units').insert({
      tenant_id: requester.tenantId,
      institution_id: input.institutionId,
      name,
      city,
      state,
      timezone,
      status: input.status,
    });
    return error ? { success: false, error: error.message } : { success: true };
  }

  const { data: current } = await adminClient
    .from('units')
    .select('institution_id,status')
    .eq('id', input.id)
    .eq('tenant_id', requester.tenantId)
    .maybeSingle();
  if (!current) return { success: false, error: 'Unidade não encontrada neste tenant.' };

  const isUnitManager = requester.role === 'unit_manager';
  const institutionId = isUnitManager ? current.institution_id : input.institutionId;
  const status = isUnitManager ? current.status : input.status;
  if (current.status === 'active' && status === 'inactive' && await hasOpenedCashShift(requester.tenantId, input.id)) {
    return { success: false, error: 'Feche os caixas abertos antes de inativar esta unidade.' };
  }

  const { error } = await adminClient
    .from('units')
    .update({ institution_id: institutionId, name, city, state, timezone, status })
    .eq('id', input.id)
    .eq('tenant_id', requester.tenantId);
  return error ? { success: false, error: error.message } : { success: true };
}
