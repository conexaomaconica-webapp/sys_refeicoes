/**
 * ==============================================================================
 * Tipos e Interfaces da Sprint 2: Autenticação, Perfis e Permissões
 * Em conformidade com /docs/PERMISSIONS_v1_2.md e /docs/SECURITY.md
 * ==============================================================================
 */

export type UserRole =
  | 'admin_general'
  | 'operations_director'
  | 'finance'
  | 'supervisor'
  | 'unit_manager'
  | 'operator'
  | 'institution_user'
  | 'student';

export type ProfileStatus = 'active' | 'inactive' | 'suspended';

export interface Profile {
  id: string; // Fk auth.users.id
  tenant_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export interface UserUnitAccess {
  id: string;
  tenant_id: string;
  user_id: string;
  unit_id: string;
  created_at: string;
}

export interface UserInstitutionAccess {
  id: string;
  tenant_id: string;
  user_id: string;
  institution_id: string;
  created_at: string;
}

export interface AuthUserSession {
  user: {
    id: string;
    email?: string;
  };
  profile: Profile;
  unitAccesses: UserUnitAccess[];
  institutionAccesses: UserInstitutionAccess[];
}

/**
 * Dimensão de Ação para o Princípio de Autorização: PERFIL + ESCOPO + AÇÃO
 */
export type AuthAction =
  | 'view_dashboard'
  | 'manage_tenants'
  | 'manage_users'
  | 'manage_institutions'
  | 'manage_units'
  | 'view_reports'
  | 'operate_reception'
  | 'process_meal'
  | 'manage_finance'
  | 'manage_students';
