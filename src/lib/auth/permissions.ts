import type { AuthAction, AuthUserSession, Profile, UserRole } from '@/types/auth';

/**
 * ==============================================================================
 * Auxiliares de Autorização Múltipla Dimensão (Perfil + Escopo + Ação)
 * Em conformidade com /docs/PERMISSIONS_v1_2.md
 * ==============================================================================
 */

/**
 * Verifica se o perfil do usuário possui um dos papéis requeridos.
 */
export function hasRole(profile: Profile | null, allowedRoles: UserRole[]): boolean {
  if (!profile || profile.status !== 'active') return false;
  return allowedRoles.includes(profile.role);
}

/**
 * Verifica se o usuário possui ESCOPO ORGANIZACIONAL/GEOGRÁFICO sobre uma unidade.
 * Nota Arquitetural: Ter escopo sobre a unidade NÃO significa autorização para qualquer ação.
 */
export function canAccessUnit(session: AuthUserSession | null, unitId: string): boolean {
  if (!session || session.profile.status !== 'active') return false;

  const { role } = session.profile;

  // Papéis tenant-wide possuem escopo em todas as unidades do seu próprio tenant
  if (role === 'admin_general' || role === 'operations_director' || role === 'finance') {
    return true;
  }

  // Demais papéis requerem vínculo explícito na tabela de escopos
  return session.unitAccesses.some((access) => access.unit_id === unitId);
}

/**
 * Verifica se o usuário possui ESCOPO INSTITUCIONAL sobre uma instituição de ensino.
 */
export function canAccessInstitution(
  session: AuthUserSession | null,
  institutionId: string
): boolean {
  if (!session || session.profile.status !== 'active') return false;

  const { role } = session.profile;

  if (role === 'admin_general' || role === 'operations_director' || role === 'finance') {
    return true;
  }

  return session.institutionAccesses.some((access) => access.institution_id === institutionId);
}

/**
 * Avalia o Princípio de Autorização: PERFIL + ESCOPO + AÇÃO
 */
export function canPerformAction(
  session: AuthUserSession | null,
  action: AuthAction,
  context?: { unitId?: string; institutionId?: string }
): boolean {
  if (!session || session.profile.status !== 'active') return false;

  const { role } = session.profile;

  switch (action) {
    case 'manage_tenants':
      // Exclusivo admin_general
      return role === 'admin_general';

    case 'manage_users':
      // Apenas admin_general pode gerenciar usuários administrativos
      return role === 'admin_general';

    case 'manage_institutions':
    case 'manage_units':
      return role === 'admin_general' || role === 'operations_director';

    case 'view_reports':
      return (
        role === 'admin_general' ||
        role === 'operations_director' ||
        role === 'finance' ||
        role === 'supervisor' ||
        role === 'unit_manager' ||
        role === 'institution_user'
      );

    case 'operate_reception':
    case 'process_meal':
      // Operações de recepção exigem perfil operador/gerente E escopo explícito na unidade
      if (role !== 'operator' && role !== 'unit_manager' && role !== 'admin_general') {
        return false;
      }
      return context?.unitId ? canAccessUnit(session, context.unitId) : false;

    case 'manage_finance':
      // Financeiro e Admin
      return role === 'admin_general' || role === 'finance';

    case 'manage_students':
      return (
        role === 'admin_general' ||
        role === 'operations_director' ||
        role === 'supervisor' ||
        role === 'unit_manager'
      );

    default:
      return false;
  }
}
