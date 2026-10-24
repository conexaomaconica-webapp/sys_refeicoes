import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import type { UserRole } from '@/types/auth';

const STUDENT_MANAGER_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'supervisor',
  'unit_manager',
];

const TENANT_WIDE_STUDENT_MANAGER_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
];

export interface StudentManagementAccess {
  userId: string;
  tenantId: string;
  role: UserRole;
  institutionIds: string[] | null;
}

export async function getStudentManagementAccessServer(
  userId: string,
  expectedTenantId?: string
): Promise<{ access: StudentManagementAccess | null; error?: string }> {
  const adminClient = getAdminClient();
  const { data: profile, error } = await adminClient
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile || profile.status !== 'active') {
    return { access: null, error: 'Perfil inativo ou não encontrado.' };
  }

  if (expectedTenantId && profile.tenant_id !== expectedTenantId) {
    return { access: null, error: 'Acesso negado para este tenant.' };
  }

  if (!STUDENT_MANAGER_ROLES.includes(profile.role)) {
    return { access: null, error: 'Seu perfil não possui permissão para gerenciar comensais.' };
  }

  if (TENANT_WIDE_STUDENT_MANAGER_ROLES.includes(profile.role)) {
    return {
      access: {
        userId,
        tenantId: profile.tenant_id,
        role: profile.role,
        institutionIds: null,
      },
    };
  }

  const [{ data: institutionAccesses }, { data: unitAccesses }] = await Promise.all([
    adminClient
      .from('user_institution_access')
      .select('institution_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', userId),
    adminClient
      .from('user_unit_access')
      .select('unit_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', userId),
  ]);

  const institutionIds = new Set(
    (institutionAccesses || []).map((item) => item.institution_id)
  );
  const unitIds = (unitAccesses || []).map((item) => item.unit_id);

  if (unitIds.length > 0) {
    const { data: units } = await adminClient
      .from('units')
      .select('institution_id')
      .eq('tenant_id', profile.tenant_id)
      .in('id', unitIds);

    for (const unit of units || []) institutionIds.add(unit.institution_id);
  }

  return {
    access: {
      userId,
      tenantId: profile.tenant_id,
      role: profile.role,
      institutionIds: [...institutionIds],
    },
  };
}

export function canManageStudentInstitution(
  access: StudentManagementAccess,
  institutionId: string
): boolean {
  return access.institutionIds === null || access.institutionIds.includes(institutionId);
}

export function studentManagerRoles(): UserRole[] {
  return [...STUDENT_MANAGER_ROLES];
}
