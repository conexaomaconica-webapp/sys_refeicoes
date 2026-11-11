'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { saveConsumerAccessServer } from '@/services/consumer-access.service';
import { createStudentServer, updateStudentServer } from '@/services/admin-student.service';
import { getStudentManagementAccessServer } from '@/services/student-management-access.service';
import { resolveAppOrigin } from '@/lib/app-origin';
import type { StudentAcademicStatus } from '@/types/student';

export interface CommensalFormInput {
  id?: string;
  institutionId: string;
  categoryId: string;
  registrationNumber: string;
  fullName: string;
  course: string;
  email: string;
  phone: string;
  status: StudentAcademicStatus;
}

type ActionResult =
  | { success: true; message: string; temporaryCredential?: { email: string; password: string } }
  | { success: false; error: string };

export interface ConsumerAccessFormInput {
  studentId: string;
  email: string;
  password?: string;
  mustChangePassword?: boolean;
  provisioningMethod?: 'invite' | 'password';
  status: 'active' | 'inactive';
  sendRecoveryEmail?: boolean;
}

const VALID_STATUSES: StudentAcademicStatus[] = ['active', 'inactive', 'suspended', 'cancelled', 'graduated'];

async function getRequester() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre novamente.');

  const { access, error } = await getStudentManagementAccessServer(user.id);
  if (!access) throw new Error(error || 'Seu perfil não possui permissão para gerenciar comensais.');

  return { userId: user.id, tenantId: access.tenantId };
}

function validateInput(input: CommensalFormInput) {
  if (!input.institutionId) throw new Error('Selecione a instituição.');
  if (!input.categoryId) throw new Error('Selecione a categoria.');
  if (!input.registrationNumber.trim()) throw new Error('Informe a matrícula ou código funcional.');
  if (!input.fullName.trim()) throw new Error('Informe o nome completo.');
  if (!VALID_STATUSES.includes(input.status)) throw new Error('Status inválido.');
}

export async function saveCommensalAction(input: CommensalFormInput): Promise<ActionResult> {
  try {
    validateInput(input);
    const requester = await getRequester();
    const common = {
      tenantId: requester.tenantId,
      institutionId: input.institutionId,
      categoryId: input.categoryId,
      registrationNumber: input.registrationNumber.trim(),
      fullName: input.fullName.trim(),
      course: input.course.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      status: input.status,
    };

    const result = input.id
      ? await updateStudentServer(requester.userId, input.id, common)
      : await createStudentServer(requester.userId, common);

    if (!result.student || result.error) {
      return { success: false, error: result.error || 'Não foi possível salvar o comensal.' };
    }

    revalidatePath('/admin/comensais');
    revalidatePath('/admin/categorias');
    return {
      success: true,
      message: input.id ? 'Comensal atualizado com sucesso.' : 'Comensal cadastrado com sucesso.',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao salvar comensal.' };
  }
}

export async function saveConsumerAccessAction(
  input: ConsumerAccessFormInput
): Promise<ActionResult> {
  try {
    if (!input.studentId) throw new Error('Comensal não informado.');
    if (!['active', 'inactive'].includes(input.status)) throw new Error('Status de acesso inválido.');

    const requester = await getRequester();
    const requestHeaders = await headers();
    const origin = resolveAppOrigin(requestHeaders, process.env.NEXT_PUBLIC_APP_URL);
    const result = await saveConsumerAccessServer(requester.userId, {
      studentId: input.studentId,
      email: input.email,
      password: input.password?.trim() || undefined,
      mustChangePassword: input.mustChangePassword,
      provisioningMethod: input.provisioningMethod,
      status: input.status,
      sendRecoveryEmail: input.sendRecoveryEmail,
      redirectTo: `${origin}/auth/callback?next=/conta/${input.sendRecoveryEmail ? 'redefinir-senha' : 'ativar'}`,
    });

    if (!result.access || result.error) {
      return { success: false, error: result.error || 'Não foi possível salvar o acesso.' };
    }

    revalidatePath('/admin/comensais');
    const tempPassword = result.access.temporaryPassword;
    return {
      success: true,
      message: result.warning || (result.access.created
        ? tempPassword
          ? 'Acesso do consumidor criado com a senha informada.'
          : 'Acesso do consumidor criado e convite enviado.'
        : tempPassword
          ? 'Acesso e senha do consumidor atualizados com sucesso.'
          : 'Acesso do consumidor atualizado com sucesso.'),
      temporaryCredential: tempPassword
        ? { email: input.email.trim().toLocaleLowerCase('pt-BR'), password: tempPassword }
        : undefined,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao salvar o acesso.' };
  }
}
