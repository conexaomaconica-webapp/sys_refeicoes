import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import {
  hashCpf,
  hashRequestFingerprint,
  isValidCpf,
  normalizeIdentityName,
} from '@/lib/security/consumer-identity';

export interface FirstAccessInstitution {
  id: string;
  name: string;
  shortName: string | null;
}

export interface RequestFirstAccessInput {
  tenantSlug: string;
  institutionId: string;
  registrationNumber: string;
  cpf: string;
  fullName: string;
}

interface RequestContext {
  ip: string;
  userAgent: string;
  origin: string;
}

const GENERIC_MESSAGE =
  'Solicitação recebida. Se os dados corresponderem à listagem oficial, as instruções serão enviadas ao contato cadastrado ou encaminhadas para análise.';

export async function listFirstAccessInstitutionsServer(
  tenantSlug: string
): Promise<FirstAccessInstitution[]> {
  const adminClient = getAdminClient();
  const { data: tenant } = await adminClient
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug.trim().toLocaleLowerCase('pt-BR'))
    .eq('status', 'active')
    .maybeSingle();

  if (!tenant) return [];
  const { data } = await adminClient
    .from('institutions')
    .select('id,name,short_name')
    .eq('tenant_id', tenant.id)
    .eq('status', 'active')
    .order('name');

  return (data || []).map((institution) => ({
    id: institution.id,
    name: institution.name,
    shortName: institution.short_name,
  }));
}

export async function requestConsumerFirstAccessServer(
  input: RequestFirstAccessInput,
  context: RequestContext
): Promise<{ success: true; message: string }> {
  const adminClient = getAdminClient();
  const fingerprint = hashRequestFingerprint(context.ip, context.userAgent);
  const tenantSlug = input.tenantSlug.trim().toLocaleLowerCase('pt-BR');
  const registrationNumber = input.registrationNumber.trim();

  const { data: tenant } = await adminClient
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .eq('status', 'active')
    .maybeSingle();
  if (!tenant) return { success: true, message: GENERIC_MESSAGE };

  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await adminClient
    .from('consumer_first_access_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('request_fingerprint', fingerprint)
    .gte('created_at', windowStart);

  const logAttempt = async (
    outcome: 'rejected' | 'rate_limited' | 'pending_review' | 'invited' | 'already_linked' | 'delivery_failed',
    institutionId?: string,
    studentId?: string
  ) => {
    await adminClient.from('consumer_first_access_attempts').insert({
      tenant_id: tenant.id,
      institution_id: institutionId || null,
      student_id: studentId || null,
      request_fingerprint: fingerprint,
      outcome,
    });
  };

  if ((count || 0) >= 5) {
    await logAttempt('rate_limited');
    return { success: true, message: GENERIC_MESSAGE };
  }

  const { data: institution } = await adminClient
    .from('institutions')
    .select('id')
    .eq('id', input.institutionId)
    .eq('tenant_id', tenant.id)
    .eq('status', 'active')
    .maybeSingle();

  if (!institution || !registrationNumber || !isValidCpf(input.cpf)) {
    await logAttempt('rejected', institution?.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const { data: student } = await adminClient
    .from('students')
    .select('id,tenant_id,institution_id,user_id,full_name,email,status,category_id')
    .eq('tenant_id', tenant.id)
    .eq('institution_id', institution.id)
    .eq('registration_number', registrationNumber)
    .eq('cpf_lookup_hash', hashCpf(input.cpf))
    .maybeSingle();

  if (
    !student ||
    student.status !== 'active' ||
    normalizeIdentityName(student.full_name) !== normalizeIdentityName(input.fullName)
  ) {
    await logAttempt('rejected', institution.id, student?.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const redirectTo = `${context.origin}/auth/callback?next=/conta/ativar`;

  if (student.user_id) {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('email,role,status')
      .eq('id', student.user_id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (profile?.role === 'student' && profile.email) {
      await adminClient.auth.resetPasswordForEmail(profile.email, { redirectTo });
    }
    await logAttempt('already_linked', institution.id, student.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  if (!student.email) {
    await adminClient
      .from('students')
      .update({
        first_access_status: 'pending_review',
        first_access_requested_at: new Date().toISOString(),
      })
      .eq('id', student.id)
      .eq('tenant_id', tenant.id)
      .is('user_id', null);
    await logAttempt('pending_review', institution.id, student.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const email = student.email.trim().toLocaleLowerCase('pt-BR');
  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError || !inviteData.user) {
    await adminClient
      .from('students')
      .update({
        first_access_status: 'pending_review',
        first_access_requested_at: new Date().toISOString(),
      })
      .eq('id', student.id)
      .eq('tenant_id', tenant.id)
      .is('user_id', null);
    await logAttempt('delivery_failed', institution.id, student.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const userId = inviteData.user.id;
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    tenant_id: tenant.id,
    full_name: student.full_name,
    email,
    role: 'student',
    status: 'active',
    must_change_password: true,
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    await logAttempt('delivery_failed', institution.id, student.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const { data: linked, error: linkError } = await adminClient
    .from('students')
    .update({
      user_id: userId,
      first_access_status: 'invited',
      first_access_requested_at: new Date().toISOString(),
    })
    .eq('id', student.id)
    .eq('tenant_id', tenant.id)
    .is('user_id', null)
    .select('id')
    .maybeSingle();

  if (linkError || !linked) {
    await adminClient.auth.admin.deleteUser(userId);
    await logAttempt('delivery_failed', institution.id, student.id);
    return { success: true, message: GENERIC_MESSAGE };
  }

  const { data: category } = await adminClient
    .from('student_categories')
    .select('requires_wallet')
    .eq('id', student.category_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (category?.requires_wallet) {
    const { data: wallet } = await adminClient
      .from('wallets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('student_id', student.id)
      .maybeSingle();
    if (!wallet) {
      await adminClient.from('wallets').insert({
        tenant_id: tenant.id,
        student_id: student.id,
        balance: 0,
        status: 'active',
      });
    }
  }

  await logAttempt('invited', institution.id, student.id);
  return { success: true, message: GENERIC_MESSAGE };
}
