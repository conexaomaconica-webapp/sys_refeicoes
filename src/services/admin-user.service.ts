import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { Profile, ProfileStatus, UserRole } from '@/types/auth';

/**
 * ==============================================================================
 * Serviço Administrativo de Gestão de Usuários (Server-Side Exclusivo)
 * Executado exclusivamente com service_role após validação do admin_general.
 * Nenhuma chamada client-side direta altera os campos sensíveis.
 * ==============================================================================
 */

export interface CreateAdminUserParams {
  requestingUserId: string;
  tenantId: string;
  email: string;
  password?: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  unitIds?: string[];
  institutionIds?: string[];
}

/**
 * Valida se o usuário solicitante é um admin_general ativo no mesmo tenant.
 */
async function validateAdminRequester(requestingUserId: string, tenantId: string): Promise<boolean> {
  const adminClient = getAdminClient();
  const { data: requester, error } = await adminClient
    .from('profiles')
    .select('tenant_id, role, status')
    .eq('id', requestingUserId)
    .single();

  if (error || !requester) return false;
  return (
    requester.tenant_id === tenantId &&
    requester.role === 'admin_general' &&
    requester.status === 'active'
  );
}

/**
 * Cria um usuário no Supabase Auth e seu perfil em `public.profiles` com atribuição de escopos.
 */
export async function createAdminUser(params: CreateAdminUserParams): Promise<{ profile: Profile | null; error?: string }> {
  const { requestingUserId, tenantId, email, password, fullName, phone, role, unitIds, institutionIds } = params;

  // 1. Validar autorização do solicitante
  const isAuthorized = await validateAdminRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { profile: null, error: 'Acesso negado. Apenas administradores gerais ativos do tenant podem criar usuários.' };
  }

  const adminClient = getAdminClient();

  // 2. Criar conta em auth.users via Supabase Auth Admin API
  const generatedPassword = password || Math.random().toString(36).slice(-12) + 'A1!';
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: generatedPassword,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    return { profile: null, error: `Erro na criação do usuário de autenticação: ${authError?.message}` };
  }

  const userId = authData.user.id;

  // 3. Criar registro em public.profiles
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .insert({
      id: userId,
      tenant_id: tenantId,
      full_name: fullName,
      email,
      phone: phone || null,
      role,
      status: 'active',
    })
    .select()
    .single();

  if (profileError || !profile) {
    // Rollback do usuário de auth se falhar no banco
    await adminClient.auth.admin.deleteUser(userId);
    return { profile: null, error: `Erro ao criar perfil no banco: ${profileError.message}` };
  }

  // 4. Inserir atribuição de escopos operacionais (unidades)
  if (unitIds && unitIds.length > 0) {
    const unitRecords = unitIds.map((unitId) => ({
      tenant_id: tenantId,
      user_id: userId,
      unit_id: unitId,
    }));
    await adminClient.from('user_unit_access').insert(unitRecords);
  }

  // 5. Inserir atribuição de escopos institucionais
  if (institutionIds && institutionIds.length > 0) {
    const instRecords = institutionIds.map((instId) => ({
      tenant_id: tenantId,
      user_id: userId,
      institution_id: instId,
    }));
    await adminClient.from('user_institution_access').insert(instRecords);
  }

  return { profile: profile as Profile };
}

/**
 * Altera o status de um perfil (active, inactive, suspended) server-side.
 */
export async function updateUserStatusServer(
  requestingUserId: string,
  targetUserId: string,
  tenantId: string,
  newStatus: ProfileStatus
): Promise<{ success: boolean; error?: string }> {
  const isAuthorized = await validateAdminRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { success: false, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from('profiles')
    .update({ status: newStatus })
    .eq('id', targetUserId)
    .eq('tenant_id', tenantId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Altera o papel (role) de um perfil server-side.
 */
export async function updateUserRoleServer(
  requestingUserId: string,
  targetUserId: string,
  tenantId: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
  const isAuthorized = await validateAdminRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { success: false, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetUserId)
    .eq('tenant_id', tenantId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
