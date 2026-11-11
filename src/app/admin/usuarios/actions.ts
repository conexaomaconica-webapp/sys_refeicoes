'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  createAdminUser,
  resendInternalAccessServer,
  updateAdminUser,
} from '@/services/admin-user.service';
import { resolveAppOrigin } from '@/lib/app-origin';
import type { ProfileStatus, UserRole } from '@/types/auth';

export interface UserFormInput {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  password?: string;
  mustChangePassword?: boolean;
  role: UserRole;
  status: ProfileStatus;
  unitIds: string[];
  institutionIds: string[];
  provisioningMethod: 'manual_password' | 'temporary_password' | 'invite';
}

type ActionResult =
  | {
      success: true;
      message: string;
      temporaryCredential?: { email: string; password: string };
    }
  | { success: false; error: string };

async function getContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre novamente.');
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();
  const requesterProfile = profile as { tenant_id: string } | null;
  if (!requesterProfile) throw new Error('Perfil administrativo não encontrado.');

  const requestHeaders = await headers();
  const origin = resolveAppOrigin(requestHeaders, process.env.NEXT_PUBLIC_APP_URL);
  return {
    requestingUserId: user.id,
    tenantId: requesterProfile.tenant_id,
    redirectTo: `${origin}/auth/callback?next=/conta/ativar`,
  };
}

export async function saveUserAction(input: UserFormInput): Promise<ActionResult> {
  try {
    const context = await getContext();
    const result = input.id
      ? await updateAdminUser({
          ...context,
          targetUserId: input.id,
          fullName: input.fullName,
          phone: input.phone,
          role: input.role,
          status: input.status,
          unitIds: input.unitIds,
          institutionIds: input.institutionIds,
          newPassword: input.password?.trim() || undefined,
        })
      : await createAdminUser({
          ...context,
          email: input.email,
          fullName: input.fullName,
          phone: input.phone,
          password: input.password?.trim() || undefined,
          mustChangePassword: input.mustChangePassword,
          role: input.role,
          status: input.status,
          unitIds: input.unitIds,
          institutionIds: input.institutionIds,
          provisioningMethod: input.provisioningMethod,
        });
    if (!result.success) return { success: false, error: result.error || 'Não foi possível salvar o usuário.' };

    const temporaryPassword = !input.id &&
      'temporaryPassword' in result &&
      typeof result.temporaryPassword === 'string'
        ? result.temporaryPassword
        : undefined;
    revalidatePath('/admin/usuarios');
    return {
      success: true,
      message: input.id
        ? 'Usuário atualizado com sucesso.'
        : temporaryPassword
          ? input.provisioningMethod === 'manual_password'
            ? 'Usuário cadastrado com sucesso com a senha informada.'
            : 'Usuário criado com senha temporária.'
          : 'Convite enviado e usuário criado com sucesso.',
      temporaryCredential: temporaryPassword
        ? { email: input.email.trim().toLocaleLowerCase('pt-BR'), password: temporaryPassword }
        : undefined,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao salvar usuário.' };
  }
}

export async function resendUserAccessAction(targetUserId: string): Promise<ActionResult> {
  try {
    const context = await getContext();
    const result = await resendInternalAccessServer(
      context.requestingUserId,
      context.tenantId,
      targetUserId,
      context.redirectTo
    );
    if (!result.success) return { success: false, error: result.error || 'Não foi possível reenviar o acesso.' };
    return { success: true, message: 'E-mail de acesso enviado com sucesso.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao reenviar acesso.' };
  }
}
