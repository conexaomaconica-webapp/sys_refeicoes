'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createStudentServer, updateStudentServer } from '@/services/admin-student.service';
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

type ActionResult = { success: true; message: string } | { success: false; error: string };

const VALID_STATUSES: StudentAcademicStatus[] = ['active', 'inactive', 'suspended', 'cancelled', 'graduated'];

async function getRequester() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre novamente.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role, status')
    .eq('id', user.id)
    .maybeSingle();

  if (
    !profile ||
    profile.status !== 'active' ||
    !['admin_general', 'operations_director'].includes(profile.role)
  ) {
    throw new Error('Seu perfil não possui permissão para gerenciar comensais.');
  }

  return { userId: user.id, tenantId: profile.tenant_id };
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
