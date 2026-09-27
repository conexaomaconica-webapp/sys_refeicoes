import { createBrowserClient } from '@/lib/supabase/client';
import type { Student, StudentCategory } from '@/types/student';

/**
 * Servicio de Leitura de Alunos no Cliente (Browser)
 */

export async function getStudentCategories(): Promise<StudentCategory[]> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('student_categories')
      .select('*')
      .eq('status', 'active')
      .order('name');

    if (error || !data) return [];
    return data as StudentCategory[];
  } catch (err) {
    console.error('[StudentService] Erro ao buscar categorias:', err);
    return [];
  }
}

export async function getStudentByRegistration(
  institutionId: string,
  registrationNumber: string
): Promise<Student | null> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('institution_id', institutionId)
      .eq('registration_number', registrationNumber)
      .maybeSingle();

    if (error || !data) return null;
    return data as Student;
  } catch (err) {
    console.error('[StudentService] Erro ao buscar aluno por matrícula:', err);
    return null;
  }
}

export async function getStudentByUserId(userId: string): Promise<Student | null> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data as Student;
  } catch (err) {
    console.error('[StudentService] Erro ao buscar aluno por user_id:', err);
    return null;
  }
}
