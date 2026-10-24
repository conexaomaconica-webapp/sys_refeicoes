'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  createAdminUser,
  resendInternalAccessServer,
  updateAdminUser,
} from '@/services/admin-user.service';
import type { ProfileStatus, UserRole } from '@/types/auth';

export interface UserFormInput {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: ProfileStatus;
  unitIds: string[];
  institutionIds: string[];
}

type ActionResult = { success: true; message: string } | { success: false; error: string };

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
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originHeader = requestHeaders.get('origin');
  const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') || 'https';
  const origin = new URL(
    configuredUrl || originHeader || (host ? `${protocol}://${host}` : 'http://localhost:3000')
  ).origin;
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
        })
      : await createAdminUser({
          ...context,
          email: input.email,
          fullName: input.fullName,
          phone: input.phone,
          role: input.role,
          status: input.status,
          unitIds: input.unitIds,
          institutionIds: input.institutionIds,
        });
    if (!result.success) return { success: false, error: result.error || 'Não foi possível salvar o usuário.' };

    revalidatePath('/admin/usuarios');
    return {
      success: true,
      message: input.id ? 'Usuário atualizado com sucesso.' : 'Convite enviado e usuário criado com sucesso.',
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
