import 'server-only';

import { randomInt } from 'node:crypto';
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
  requesterRole: UserRole;
  allowedRoles: UserRole[];
}

export interface CreateAdminUserParams {
  requestingUserId: string;
  tenantId: string;
  email: string;
  fullName: string;
  phone?: string;
  password?: string;
  mustChangePassword?: boolean;
  role: UserRole;
  status?: ProfileStatus;
  unitIds?: string[];
  institutionIds?: string[];
  redirectTo: string;
  provisioningMethod: 'manual_password' | 'temporary_password' | 'invite';
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
  newPassword?: string;
}

interface RequesterProfile {
  id: string;
  tenant_id: string;
  role: UserRole;
  status: ProfileStatus;
  unitIds: string[];
}

export interface CreateAdminUserResult {
  success: boolean;
  error?: string;
  temporaryPassword?: string;
  provisioningMethod?: 'manual_password' | 'temporary_password' | 'invite';
}

export const CAN_MANAGE_ROLES: UserRole[] = ['admin_general', 'operations_director', 'unit_manager'];

export function getAllowedRolesForRequester(role: UserRole): UserRole[] {
  if (role === 'admin_general') {
    return [
      'admin_general',
      'operations_director',
      'finance',
      'supervisor',
      'unit_manager',
      'operator',
      'institution_user',
    ];
  }
  if (role === 'operations_director') {
    return [
      'operations_director',
      'finance',
      'supervisor',
      'unit_manager',
      'operator',
      'institution_user',
    ];
  }
  if (role === 'unit_manager') {
    return ['operator'];
  }
  return [];
}

async function getRequester(requestingUserId: string): Promise<RequesterProfile | null> {
  const adminClient = getAdminClient();
  const [{ data: profile }, { data: unitAccesses }] = await Promise.all([
    adminClient
      .from('profiles')
      .select('tenant_id,role,status')
      .eq('id', requestingUserId)
      .maybeSingle(),
    adminClient
      .from('user_unit_access')
      .select('unit_id')
      .eq('user_id', requestingUserId),
  ]);

  if (!profile) return null;
  return {
    id: requestingUserId,
    tenant_id: profile.tenant_id,
    role: profile.role as UserRole,
    status: profile.status as ProfileStatus,
    unitIds: (unitAccesses || []).map((access: { unit_id: string }) => access.unit_id),
  };
}

async function validateManager(requestingUserId: string, tenantId: string): Promise<RequesterProfile | null> {
  const requester = await getRequester(requestingUserId);
  if (
    requester &&
    requester.tenant_id === tenantId &&
    CAN_MANAGE_ROLES.includes(requester.role) &&
    requester.status === 'active'
  ) {
    return requester;
  }
  return null;
}

function uniqueIds(ids: string[] = []) {
  return [...new Set(ids.filter(Boolean))];
}

function generateTemporaryPassword(): string {
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const symbols = '!@#$';

  const pick = (chars: string) => chars[randomInt(chars.length)];

  // Garante 1 maiúscula, 1 minúscula, 1 número e 1 símbolo
  const chars = [
    pick(uppercase),
    pick(lowercase),
    pick(numbers),
    pick(symbols),
  ];

  const pool = lowercase + uppercase + numbers;
  while (chars.length < 8) {
    chars.push(pick(pool));
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
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
    const requesterUnitIds = new Set(requester.unitIds);
    const institutionIds = new Set(
      visibleUnits.filter((unit) => requesterUnitIds.has(unit.id)).map((unit) => unit.institution_id)
    );
    visibleProfiles = visibleProfiles.filter((profile) =>
      profile.id === requestingUserId ||
      (profile.role === 'operator' && (unitsByUser.get(profile.id) || []).some((unitId) => requesterUnitIds.has(unitId)))
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
      canManage: CAN_MANAGE_ROLES.includes(requester.role),
      requesterId: requestingUserId,
      requesterRole: requester.role,
      allowedRoles: getAllowedRolesForRequester(requester.role),
    },
  };
}

export async function createAdminUser(
  params: CreateAdminUserParams
): Promise<CreateAdminUserResult> {
  const requester = await validateManager(params.requestingUserId, params.tenantId);
  if (!requester) {
    return { success: false, error: 'Apenas Master, Diretor Operacional ou Gerente de Unidade ativos podem criar usuários.' };
  }

  const allowedRoles = getAllowedRolesForRequester(requester.role);
  if (!allowedRoles.includes(params.role)) {
    return { success: false, error: `Seu perfil (${requester.role}) não possui permissão para cadastrar o perfil selecionado.` };
  }

  const email = params.email.trim().toLocaleLowerCase('pt-BR');
  const fullName = params.fullName.trim();
  const unitIds = uniqueIds(params.unitIds);
  const institutionIds = uniqueIds(params.institutionIds);
  if (!fullName) return { success: false, error: 'Informe o nome completo.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { success: false, error: 'Informe um e-mail válido.' };

  if (requester.role === 'unit_manager') {
    if (params.role !== 'operator') {
      return { success: false, error: 'Gerentes de unidade só podem cadastrar operadores.' };
    }
    if (unitIds.length === 0 || unitIds.some((id) => !requester.unitIds.includes(id))) {
      return { success: false, error: 'Selecione ao menos uma unidade sob sua gestão.' };
    }
    if (institutionIds.length > 0) {
      return { success: false, error: 'Gerentes de unidade não podem atribuir instituições.' };
    }
  }

  const scopeError = validateRoleAndScopes(params.role, unitIds, institutionIds);
  if (scopeError) return { success: false, error: scopeError };
  if (!(await validateScopeIds(params.tenantId, unitIds, institutionIds))) {
    return { success: false, error: 'Um dos escopos selecionados não pertence ao tenant.' };
  }

  const adminClient = getAdminClient();
  let createdPassword: string | undefined;

  if (params.provisioningMethod === 'invite') {
    const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: params.redirectTo,
    });
    if (authError || !authData.user) {
      return { success: false, error: `Não foi possível enviar o convite: ${authError?.message || 'usuário não retornado'}` };
    }
    return finishCreateUser(authData.user.id, params, fullName, email, unitIds, institutionIds);
  }

  if (params.provisioningMethod === 'manual_password') {
    const pwd = params.password?.trim() || '';
    if (pwd.length < 6) {
      return { success: false, error: 'A senha informada deve ter no mínimo 6 caracteres.' };
    }
    createdPassword = pwd;
  } else {
    // temporary_password
    createdPassword = generateTemporaryPassword();
  }

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: createdPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError || !authData.user) {
    return { success: false, error: `Não foi possível criar o usuário no sistema: ${authError?.message || 'usuário não retornado'}` };
  }

  const profileResult = await finishCreateUser(authData.user.id, params, fullName, email, unitIds, institutionIds);
  if (!profileResult.success) {
    return profileResult;
  }

  return {
    success: true,
    temporaryPassword: createdPassword,
    provisioningMethod: params.provisioningMethod,
  };
}

async function finishCreateUser(
  userId: string,
  params: CreateAdminUserParams,
  fullName: string,
  email: string,
  unitIds: string[],
  institutionIds: string[]
): Promise<CreateAdminUserResult> {
  const adminClient = getAdminClient();
  const mustChangePassword = params.mustChangePassword !== undefined ? params.mustChangePassword : true;

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    tenant_id: params.tenantId,
    full_name: fullName,
    email,
    phone: params.phone?.trim() || null,
    role: params.role,
    status: params.status || 'active',
    must_change_password: mustChangePassword,
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
  const requester = await validateManager(params.requestingUserId, params.tenantId);
  if (!requester) {
    return { success: false, error: 'Você não possui permissão para alterar usuários.' };
  }

  if (params.targetUserId === params.requestingUserId && params.status !== 'active') {
    return { success: false, error: 'Você não pode desativar ou suspender o próprio acesso.' };
  }
  if (params.targetUserId === params.requestingUserId && params.role !== requester.role) {
    return { success: false, error: 'Você não pode alterar o próprio perfil de acesso.' };
  }

  const fullName = params.fullName.trim();
  const unitIds = uniqueIds(params.unitIds);
  const institutionIds = uniqueIds(params.institutionIds);
  if (!fullName) return { success: false, error: 'Informe o nome completo.' };

  const adminClient = getAdminClient();
  const { data: target } = await adminClient
    .from('profiles')
    .select('id,role,status')
    .eq('id', params.targetUserId)
    .eq('tenant_id', params.tenantId)
    .neq('role', 'student')
    .maybeSingle();

  if (!target) return { success: false, error: 'Usuário interno não encontrado neste tenant.' };

  if (requester.role === 'unit_manager') {
    if (target.role !== 'operator' || params.role !== 'operator') {
      return { success: false, error: 'Gerentes de unidade só podem gerenciar operadores.' };
    }
    const { data: targetUnits } = await adminClient
      .from('user_unit_access')
      .select('unit_id')
      .eq('user_id', params.targetUserId);
    const existingUnitIds = (targetUnits || []).map((u: { unit_id: string }) => u.unit_id);
    const hasCommonUnit = existingUnitIds.some((id) => requester.unitIds.includes(id));
    if (!hasCommonUnit && target.id !== requester.id) {
      return { success: false, error: 'Este operador não pertence às suas unidades gerenciadas.' };
    }
    if (unitIds.length === 0 || unitIds.some((id) => !requester.unitIds.includes(id))) {
      return { success: false, error: 'Selecione apenas unidades sob sua gestão.' };
    }
  }

  if (requester.role === 'operations_director') {
    if (target.role === 'admin_general' || params.role === 'admin_general') {
      return { success: false, error: 'Diretores operacionais não podem alterar perfis Master.' };
    }
  }

  const scopeError = validateRoleAndScopes(params.role, unitIds, institutionIds);
  if (scopeError) return { success: false, error: scopeError };
  if (!(await validateScopeIds(params.tenantId, unitIds, institutionIds))) {
    return { success: false, error: 'Um dos escopos selecionados não pertence ao tenant.' };
  }

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

  if (params.newPassword && params.newPassword.trim().length >= 6) {
    const { error: pwdError } = await adminClient.auth.admin.updateUserById(params.targetUserId, {
      password: params.newPassword.trim(),
    });
    if (pwdError) {
      return { success: false, error: `Dados atualizados, mas falhou ao redefinir a senha: ${pwdError.message}` };
    }
  }

  return { success: true };
}

export async function resendInternalAccessServer(
  requestingUserId: string,
  tenantId: string,
  targetUserId: string,
  redirectTo: string
): Promise<{ success: boolean; error?: string }> {
  const requester = await validateManager(requestingUserId, tenantId);
  if (!requester) {
    return { success: false, error: 'Você não possui permissão para reenviar o acesso.' };
  }

  const adminClient = getAdminClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('email,role,status,must_change_password')
    .eq('id', targetUserId)
    .eq('tenant_id', tenantId)
    .neq('role', 'student')
    .maybeSingle();

  if (!profile?.email) return { success: false, error: 'Usuário sem e-mail cadastrado.' };
  if (profile.status !== 'active') return { success: false, error: 'Ative o usuário antes de reenviar o acesso.' };

  if (requester.role === 'unit_manager') {
    if (profile.role !== 'operator') {
      return { success: false, error: 'Gerentes de unidade só podem reenviar acesso para operadores.' };
    }
  }

  const destination = profile.must_change_password
    ? redirectTo
    : redirectTo.replace('/conta/ativar', '/conta/redefinir-senha');
  const { error } = await adminClient.auth.resetPasswordForEmail(profile.email, { redirectTo: destination });
  if (error) return { success: false, error: `Não foi possível enviar o e-mail: ${error.message}` };
  return { success: true };
}
