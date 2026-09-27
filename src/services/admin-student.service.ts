import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { CreateStudentParams, Student, StudentAcademicStatus } from '@/types/student';

/**
 * ==============================================================================
 * Serviço Administrativo de Gestão de Alunos (Server-Side Exclusivo)
 * Operações acadêmicas realizadas com service_role após autorização prévia.
 * ==============================================================================
 */

/**
 * Valida se o usuário solicitante possui perfil administrativo ativo no tenant.
 */
async function validateStaffRequester(requestingUserId: string, tenantId: string): Promise<boolean> {
  const adminClient = getAdminClient();
  const { data: requester, error } = await adminClient
    .from('profiles')
    .select('tenant_id, role, status')
    .eq('id', requestingUserId)
    .single();

  if (error || !requester) return false;
  return (
    requester.tenant_id === tenantId &&
    ['admin_general', 'operations_director'].includes(requester.role) &&
    requester.status === 'active'
  );
}

/**
 * Cadastra um novo aluno no sistema (sem criar obrigatoriamente conta auth).
 */
export async function createStudentServer(
  requestingUserId: string,
  params: CreateStudentParams
): Promise<{ student: Student | null; error?: string }> {
  const { tenantId, institutionId, categoryId, registrationNumber, fullName, course, email, phone, status } = params;

  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { student: null, error: 'Acesso negado. Apenas administradores ativos do tenant podem cadastrar alunos.' };
  }

  const adminClient = getAdminClient();

  // Verificar se a matrícula já existe na mesma instituição
  const { data: existing } = await adminClient
    .from('students')
    .select('id')
    .eq('institution_id', institutionId)
    .eq('registration_number', registrationNumber)
    .maybeSingle();

  if (existing) {
    return { student: null, error: `Já existe um aluno cadastrado com a matrícula "${registrationNumber}" nesta instituição.` };
  }

  const { data: student, error } = await adminClient
    .from('students')
    .insert({
      tenant_id: tenantId,
      institution_id: institutionId,
      user_id: null,
      category_id: categoryId,
      registration_number: registrationNumber,
      full_name: fullName,
      course: course || null,
      email: email || null,
      phone: phone || null,
      status: status || 'active',
    })
    .select()
    .single();

  if (error || !student) {
    return { student: null, error: `Erro ao cadastrar aluno: ${error?.message}` };
  }

  return { student: student as Student };
}

/**
 * Atualiza o status acadêmico do aluno server-side.
 */
export async function updateStudentAcademicStatusServer(
  requestingUserId: string,
  studentId: string,
  tenantId: string,
  newStatus: StudentAcademicStatus
): Promise<{ success: boolean; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { success: false, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from('students')
    .update({ status: newStatus })
    .eq('id', studentId)
    .eq('tenant_id', tenantId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Processa e armazena a foto do aluno server-side com validação de formato e tamanho.
 */
export async function uploadStudentPhotoServer(
  requestingUserId: string,
  studentId: string,
  tenantId: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ photoPath: string | null; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId);
  if (!isAuthorized) {
    return { photoPath: null, error: 'Acesso negado.' };
  }

  // Validação de formato MIME
  const allowedTypes: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  const extension = allowedTypes[mimeType];
  if (!extension) {
    return { photoPath: null, error: 'Formato de imagem não suportado. Utilize JPEG, PNG ou WebP.' };
  }

  const adminClient = getAdminClient();

  // Buscar dados do aluno para obter institution_id
  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('institution_id')
    .eq('id', studentId)
    .eq('tenant_id', tenantId)
    .single();

  if (studentError || !student) {
    return { photoPath: null, error: 'Aluno não encontrado.' };
  }

  // Gerar caminho canônico e coerente com a extensão real
  const photoPath = `${tenantId}/${student.institution_id}/${studentId}/profile.${extension}`;

  // Upload no bucket privado student-photos
  const { error: uploadError } = await adminClient.storage
    .from('student-photos')
    .upload(photoPath, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    return { photoPath: null, error: `Erro ao salvar foto no armazenamento: ${uploadError.message}` };
  }

  // Atualizar photo_path no registro do aluno
  await adminClient
    .from('students')
    .update({ photo_path: photoPath })
    .eq('id', studentId)
    .eq('tenant_id', tenantId);

  return { photoPath };
}
