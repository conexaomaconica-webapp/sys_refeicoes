import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { ProfileStatus, UserRole } from '@/types/auth';

const INTERNAL_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
  'operator',
  'institution_user',
];

const VIEW_ROLES: UserRole[] = ['admin_general', 'operations_director', 'unit_manager'];

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: ProfileStatus;
  mustChangePassword: boolean;
  unitIds: string[];
  institutionIds: string[];
  createdAt: string;
}

export interface UserAccessOption {
  id: string;
  name: string;
  institutionId?: string;
}

export interface UserManagementData {
  users: ManagedUser[];
  units: UserAccessOption[];
  institutions: UserAccessOption[];
  canManage: boolean;
  requesterId: string;
}

export interface CreateAdminUserParams {
  requestingUserId: string;
  tenantId: string;
  email: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  status?: ProfileStatus;
  unitIds?: string[];
  institutionIds?: string[];
  redirectTo: string;
}

export interface UpdateAdminUserParams {
  requestingUserId: string;
  tenantId: string;
  targetUserId: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  status: ProfileStatus;
  unitIds?: string[];
  institutionIds?: string[];
}

interface RequesterProfile {
  tenant_id: string;
  role: UserRole;
  status: ProfileStatus;
}

async function getRequester(requestingUserId: string): Promise<RequesterProfile | null> {
  const adminClient = getAdminClient();
  const { data } = await adminClient
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', requestingUserId)
    .maybeSingle();
  return data as RequesterProfile | null;
}

async function validateManager(requestingUserId: string, tenantId: string) {
  const requester = await getRequester(requestingUserId);
  return Boolean(
    requester &&
    requester.tenant_id === tenantId &&
    requester.role === 'admin_general' &&
    requester.status === 'active'
  );
}

function uniqueIds(ids: string[] = []) {
  return [...new Set(ids.filter(Boolean))];
}

function validateRoleAndScopes(role: UserRole, unitIds: string[], institutionIds: string[]) {
  if (!INTERNAL_ROLES.includes(role)) return 'Perfil interno inválido.';
  if (['supervisor', 'unit_manager', 'operator'].includes(role) && unitIds.length === 0) {
    return 'Selecione ao menos uma unidade para este perfil.';
  }
  if (role === 'institution_user' && institutionIds.length === 0) {
    return 'Selecione ao menos uma instituição para este perfil.';
  }
  return null;
}

async function validateScopeIds(tenantId: string, unitIds: string[], institutionIds: string[]) {
  const adminClient = getAdminClient();
  const [{ data: units }, { data: institutions }] = await Promise.all([
    unitIds.length
      ? adminClient.from('units').select('id').eq('tenant_id', tenantId).in('id', unitIds)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    institutionIds.length
      ? adminClient.from('institutions').select('id').eq('tenant_id', tenantId).in('id', institutionIds)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
  ]);
  return (units?.length || 0) === unitIds.length &&
    (institutions?.length || 0) === institutionIds.length;
}

async function replaceScopes(
  tenantId: string,
  userId: string,
  unitIds: string[],
  institutionIds: string[]
) {
  const adminClient = getAdminClient();
  const [{ error: unitDeleteError }, { error: institutionDeleteError }] = await Promise.all([
    adminClient.from('user_unit_access').delete().eq('tenant_id', tenantId).eq('user_id', userId),
    adminClient.from('user_institution_access').delete().eq('tenant_id', tenantId).eq('user_id', userId),
  ]);
  if (unitDeleteError || institutionDeleteError) {
    return unitDeleteError?.message || institutionDeleteError?.message || 'Falha ao limpar escopos.';
  }

  const [{ error: unitInsertError }, { error: institutionInsertError }] = await Promise.all([
    unitIds.length
      ? adminClient.from('user_unit_access').insert(unitIds.map((unitId) => ({
          tenant_id: tenantId,
          user_id: userId,
          unit_id: unitId,
        })))
      : Promise.resolve({ error: null }),
    institutionIds.length
      ? adminClient.from('user_institution_access').insert(institutionIds.map((institutionId) => ({
          tenant_id: tenantId,
          user_id: userId,
          institution_id: institutionId,
        })))
      : Promise.resolve({ error: null }),
  ]);
  return unitInsertError?.message || institutionInsertError?.message;
}

export async function getUserManagementDataServer(
  requestingUserId: string
): Promise<{ data: UserManagementData | null; error?: string }> {
  const requester = await getRequester(requestingUserId);
  if (!requester || requester.status !== 'active' || !VIEW_ROLES.includes(requester.role)) {
    return { data: null, error: 'Seu perfil não possui acesso à gestão de usuários.' };
  }

  const adminClient = getAdminClient();
  const tenantId = requester.tenant_id;
  const [profilesResult, unitsResult, institutionsResult, unitAccessResult, institutionAccessResult] =
    await Promise.all([
      adminClient
        .from('profiles')
        .select('id,full_name,email,phone,role,status,must_change_password,created_at')
        .eq('tenant_id', tenantId)
        .neq('role', 'student')
        .order('full_name'),
      adminClient.from('units').select('id,name,institution_id').eq('tenant_id', tenantId).order('name'),
      adminClient.from('institutions').select('id,name').eq('tenant_id', tenantId).order('name'),
      adminClient.from('user_unit_access').select('user_id,unit_id').eq('tenant_id', tenantId),
      adminClient.from('user_institution_access').select('user_id,institution_id').eq('tenant_id', tenantId),
    ]);

  const firstError = profilesResult.error || unitsResult.error || institutionsResult.error ||
    unitAccessResult.error || institutionAccessResult.error;
  if (firstError) return { data: null, error: firstError.message };

  const unitsByUser = new Map<string, string[]>();
  for (const access of unitAccessResult.data || []) {
    unitsByUser.set(access.user_id, [...(unitsByUser.get(access.user_id) || []), access.unit_id]);
  }
  const institutionsByUser = new Map<string, string[]>();
  for (const access of institutionAccessResult.data || []) {
    institutionsByUser.set(access.user_id, [
      ...(institutionsByUser.get(access.user_id) || []),
      access.institution_id,
    ]);
  }

  let visibleProfiles = profilesResult.data || [];
  let visibleUnits = unitsResult.data || [];
  let visibleInstitutions = institutionsResult.data || [];
  if (requester.role === 'unit_manager') {
    const requesterUnitIds = new Set(unitsByUser.get(requestingUserId) || []);
    const institutionIds = new Set(
      visibleUnits.filter((unit) => requesterUnitIds.has(unit.id)).map((unit) => unit.institution_id)
    );
    visibleProfiles = visibleProfiles.filter((profile) =>
      profile.id === requestingUserId ||
      (unitsByUser.get(profile.id) || []).some((unitId) => requesterUnitIds.has(unitId))
    );
    visibleUnits = visibleUnits.filter((unit) => requesterUnitIds.has(unit.id));
    visibleInstitutions = visibleInstitutions.filter((institution) => institutionIds.has(institution.id));
  }

  return {
    data: {
      users: visibleProfiles.map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email || '',
        phone: profile.phone || '',
        role: profile.role,
        status: profile.status,
        mustChangePassword: profile.must_change_password,
        unitIds: unitsByUser.get(profile.id) || [],
        institutionIds: institutionsByUser.get(profile.id) || [],
        createdAt: profile.created_at,
      })),
      units: visibleUnits.map((unit) => ({ id: unit.id, name: unit.name, institutionId: unit.institution_id })),
      institutions: visibleInstitutions.map((institution) => ({ id: institution.id, name: institution.name })),
      canManage: requester.role === 'admin_general',
      requesterId: requestingUserId,
    },
  };
}

export async function createAdminUser(
  params: CreateAdminUserParams
): Promise<{ success: boolean; error?: string; warning?: string }> {
  if (!(await validateManager(params.requestingUserId, params.tenantId))) {
    return { success: false, error: 'Apenas o Master ativo pode convidar usuários.' };
  }

  const email = params.email.trim().toLocaleLowerCase('pt-BR');
  const fullName = params.fullName.trim();
  const unitIds = uniqueIds(params.unitIds);
  const institutionIds = uniqueIds(params.institutionIds);
  if (!fullName) return { success: false, error: 'Informe o nome completo.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { success: false, error: 'Informe um e-mail válido.' };
  const scopeError = validateRoleAndScopes(params.role, unitIds, institutionIds);
  if (scopeError) return { success: false, error: scopeError };
  if (!(await validateScopeIds(params.tenantId, unitIds, institutionIds))) {
    return { success: false, error: 'Um dos escopos selecionados não pertence ao tenant.' };
  }

  const adminClient = getAdminClient();
  const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: params.redirectTo,
  });
  if (authError || !authData.user) {
    return { success: false, error: `Não foi possível enviar o convite: ${authError?.message || 'usuário não retornado'}` };
  }

  const userId = authData.user.id;
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    tenant_id: params.tenantId,
    full_name: fullName,
    email,
    phone: params.phone?.trim() || null,
    role: params.role,
    status: params.status || 'active',
    must_change_password: true,
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return { success: false, error: `Não foi possível criar o perfil: ${profileError.message}` };
  }

  const accessError = await replaceScopes(params.tenantId, userId, unitIds, institutionIds);
  if (accessError) {
    await adminClient.auth.admin.deleteUser(userId);
    return { success: false, error: `Não foi possível atribuir os acessos: ${accessError}` };
  }
  return { success: true };
}

export async function updateAdminUser(
  params: UpdateAdminUserParams
): Promise<{ success: boolean; error?: string }> {
  if (!(await validateManager(params.requestingUserId, params.tenantId))) {
    return { success: false, error: 'Apenas o Master ativo pode alterar usuários.' };
  }
  if (params.targetUserId === params.requestingUserId && params.status !== 'active') {
    return { success: false, error: 'Você não pode desativar ou suspender o próprio acesso.' };
  }
  if (params.targetUserId === params.requestingUserId && params.role !== 'admin_general') {
    return { success: false, error: 'Você não pode remover o próprio perfil Master.' };
  }

  const fullName = params.fullName.trim();
  const unitIds = uniqueIds(params.unitIds);
  const institutionIds = uniqueIds(params.institutionIds);
  if (!fullName) return { success: false, error: 'Informe o nome completo.' };
  const scopeError = validateRoleAndScopes(params.role, unitIds, institutionIds);
  if (scopeError) return { success: false, error: scopeError };
  if (!(await validateScopeIds(params.tenantId, unitIds, institutionIds))) {
    return { success: false, error: 'Um dos escopos selecionados não pertence ao tenant.' };
  }

  const adminClient = getAdminClient();
  const { data: target } = await adminClient
    .from('profiles')
    .select('id')
    .eq('id', params.targetUserId)
    .eq('tenant_id', params.tenantId)
    .neq('role', 'student')
    .maybeSingle();
  if (!target) return { success: false, error: 'Usuário interno não encontrado neste tenant.' };

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      full_name: fullName,
      phone: params.phone?.trim() || null,
      role: params.role,
      status: params.status,
    })
    .eq('id', params.targetUserId)
    .eq('tenant_id', params.tenantId);
  if (profileError) return { success: false, error: profileError.message };

  const accessError = await replaceScopes(params.tenantId, params.targetUserId, unitIds, institutionIds);
  if (accessError) return { success: false, error: `Perfil salvo, mas os escopos falharam: ${accessError}` };
  return { success: true };
}

export async function resendInternalAccessServer(
  requestingUserId: string,
  tenantId: string,
  targetUserId: string,
  redirectTo: string
): Promise<{ success: boolean; error?: string }> {
  if (!(await validateManager(requestingUserId, tenantId))) {
    return { success: false, error: 'Apenas o Master ativo pode reenviar o acesso.' };
  }
  const adminClient = getAdminClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('email,status,must_change_password')
    .eq('id', targetUserId)
    .eq('tenant_id', tenantId)
    .neq('role', 'student')
    .maybeSingle();
  if (!profile?.email) return { success: false, error: 'Usuário sem e-mail cadastrado.' };
  if (profile.status !== 'active') return { success: false, error: 'Ative o usuário antes de reenviar o acesso.' };

  const destination = profile.must_change_password
    ? redirectTo
    : redirectTo.replace('/conta/ativar', '/conta/redefinir-senha');
  const { error } = await adminClient.auth.resetPasswordForEmail(profile.email, { redirectTo: destination });
  if (error) return { success: false, error: `Não foi possível enviar o e-mail: ${error.message}` };
  return { success: true };
}
