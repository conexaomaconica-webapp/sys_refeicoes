export * from './database.types';
export * from './meal';
export * from './wallet';
export * from './payment';
export * from './card';


export type UserRole =
  | 'admin_general'
  | 'operations_director'
  | 'finance'
  | 'supervisor'
  | 'unit_manager'
  | 'operator'
  | 'institution_user'
  | 'student';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string;
  institutionId?: string;
  unitId?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

