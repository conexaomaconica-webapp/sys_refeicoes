/**
 * ==============================================================================
 * Tipos e Interfaces da Sprint 3: Cadastro de Alunos
 * Em conformidade com /docs/DATABASE.md e /docs/SECURITY.md
 * ==============================================================================
 */

export type StudentAcademicStatus = 'active' | 'inactive' | 'suspended' | 'cancelled' | 'graduated';

export interface StudentCategory {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  requires_wallet: boolean;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  tenant_id: string;
  institution_id: string;
  user_id: string | null;
  category_id: string;
  registration_number: string;
  full_name: string;
  course: string | null;
  email: string | null;
  phone: string | null;
  photo_path: string | null;
  status: StudentAcademicStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateStudentParams {
  tenantId: string;
  institutionId: string;
  categoryId: string;
  registrationNumber: string;
  fullName: string;
  course?: string;
  email?: string;
  phone?: string;
  status?: StudentAcademicStatus;
}

export interface UpdateStudentContactParams {
  studentId: string;
  email?: string;
  phone?: string;
}
