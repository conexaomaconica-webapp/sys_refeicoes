import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import {
  canManageStudentInstitution,
  getStudentManagementAccessServer,
} from '@/services/student-management-access.service';
import type { ProfileStatus } from '@/types/auth';

export interface SaveConsumerAccessInput {
  studentId: string;
  email: string;
  status: Extract<ProfileStatus, 'active' | 'inactive'>;
  sendRecoveryEmail?: boolean;
  redirectTo: string;
}

export interface ConsumerAccessResult {
  userId: string;
  email: string;
  status: Extract<ProfileStatus, 'active' | 'inactive'>;
  created: boolean;
}

const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('pt-BR');

export async function saveConsumerAccessServer(
  requestingUserId: string,
  input: SaveConsumerAccessInput
): Promise<{ access: ConsumerAccessResult | null; error?: string; warning?: string }> {
  const { access: requesterAccess, error: accessError } =
    await getStudentManagementAccessServer(requestingUserId);

  if (!requesterAccess) return { access: null, error: accessError || 'Acesso negado.' };

  const email = normalizeEmail(input.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { access: null, error: 'Informe um e-mail válido para o consumidor.' };
  }

  const adminClient = getAdminClient();
  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('id,tenant_id,institution_id,user_id,full_name,category_id')
    .eq('id', input.studentId)
    .eq('tenant_id', requesterAccess.tenantId)
    .maybeSingle();

  if (studentError || !student) {
    return { access: null, error: 'Comensal não encontrado neste tenant.' };
  }

  if (!canManageStudentInstitution(requesterAccess, student.institution_id)) {
    return { access: null, error: 'Você não possui escopo sobre a instituição deste comensal.' };
  }

  if (student.user_id) {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id,tenant_id,role,email,status,must_change_password')
      .eq('id', student.user_id)
      .maybeSingle();

    if (!profile || profile.tenant_id !== requesterAccess.tenantId || profile.role !== 'student') {
      return { access: null, error: 'O vínculo atual não corresponde a uma conta de consumidor válida.' };
    }

    const authAttributes: { email: string; email_confirm: boolean } = {
      email,
      email_confirm: true,
    };

    const { error: authError } = await adminClient.auth.admin.updateUserById(
      student.user_id,
      authAttributes
    );
    if (authError) {
      return { access: null, error: `Não foi possível atualizar o acesso: ${authError.message}` };
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        email,
        full_name: student.full_name,
        status: input.status,
      })
      .eq('id', student.user_id)
      .eq('tenant_id', requesterAccess.tenantId)
      .eq('role', 'student');

    if (profileError) {
      return { access: null, error: `A autenticação foi atualizada, mas o perfil falhou: ${profileError.message}` };
    }

    await adminClient
      .from('students')
      .update({
        email,
        first_access_status: input.status === 'inactive'
          ? 'disabled'
          : profile.must_change_password ? 'invited' : 'active',
      })
      .eq('id', student.id)
      .eq('tenant_id', requesterAccess.tenantId);

    if (input.sendRecoveryEmail && input.status === 'active') {
      const { error: recoveryError } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: input.redirectTo,
      });
      if (recoveryError) {
        return {
          access: { userId: student.user_id, email, status: input.status, created: false },
          warning: `Acesso salvo, mas o e-mail de redefinição não pôde ser enviado: ${recoveryError.message}`,
        };
      }
    }

    return {
      access: { userId: student.user_id, email, status: input.status, created: false },
    };
  }

  const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: input.redirectTo }
  );

  if (authError || !authData.user) {
    return {
      access: null,
      error: `Não foi possível criar o usuário de autenticação: ${authError?.message || 'usuário não retornado'}`,
    };
  }

  const userId = authData.user.id;
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    tenant_id: requesterAccess.tenantId,
    full_name: student.full_name,
    email,
    role: 'student',
    status: input.status,
    must_change_password: true,
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return { access: null, error: `Não foi possível criar o perfil do consumidor: ${profileError.message}` };
  }

  const { data: linkedStudent, error: linkError } = await adminClient
    .from('students')
    .update({
      user_id: userId,
      email,
      first_access_status: input.status === 'inactive' ? 'disabled' : 'invited',
      first_access_requested_at: new Date().toISOString(),
    })
    .eq('id', student.id)
    .eq('tenant_id', requesterAccess.tenantId)
    .is('user_id', null)
    .select('id')
    .maybeSingle();

  if (linkError || !linkedStudent) {
    await adminClient.auth.admin.deleteUser(userId);
    return {
      access: null,
      error: `Não foi possível vincular o acesso ao comensal: ${linkError?.message || 'o cadastro foi alterado por outra operação'}`,
    };
  }

  const { data: category } = await adminClient
    .from('student_categories')
    .select('requires_wallet')
    .eq('id', student.category_id)
    .eq('tenant_id', requesterAccess.tenantId)
    .maybeSingle();

  if (category?.requires_wallet) {
    const { data: existingWallet } = await adminClient
      .from('wallets')
      .select('id')
      .eq('student_id', student.id)
      .eq('tenant_id', requesterAccess.tenantId)
      .maybeSingle();

    if (!existingWallet) {
      const { error: walletError } = await adminClient.from('wallets').insert({
        tenant_id: requesterAccess.tenantId,
        student_id: student.id,
        balance: 0,
        status: 'active',
      });
      if (walletError) {
        return {
          access: { userId, email, status: input.status, created: true },
          warning: `Acesso criado, mas a carteira não pôde ser provisionada: ${walletError.message}`,
        };
      }
    }
  }

  return {
    access: { userId, email, status: input.status, created: true },
  };
}
