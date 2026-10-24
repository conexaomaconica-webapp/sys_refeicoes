import { redirect } from 'next/navigation';
import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getStudentManagementAccessServer } from '@/services/student-management-access.service';
import { CommensalManager, type CommensalListItem, type SelectOption } from './CommensalManager';
import type { StudentAcademicStatus } from '@/types/student';

interface StudentRow {
  id: string;
  institution_id: string;
  category_id: string;
  registration_number: string;
  full_name: string;
  course: string | null;
  email: string | null;
  phone: string | null;
  status: StudentAcademicStatus;
  user_id: string | null;
  first_access_status: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface InstitutionRow {
  id: string;
  name: string;
  status: string;
}

export default async function ComensaisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { access } = await getStudentManagementAccessServer(user.id);
  if (!access) redirect('/admin');

  const adminClient = getAdminClient();
  let studentsQuery = adminClient
    .from('students')
    .select('id,institution_id,category_id,registration_number,full_name,course,email,phone,status,user_id,first_access_status,updated_at')
    .eq('tenant_id', access.tenantId)
    .order('full_name', { ascending: true })
    .limit(1000);
  let institutionsQuery = adminClient
    .from('institutions')
    .select('id,name,status')
    .eq('tenant_id', access.tenantId)
    .order('name', { ascending: true });

  if (access.institutionIds !== null) {
    const scopedInstitutionIds = access.institutionIds.length > 0
      ? access.institutionIds
      : ['00000000-0000-0000-0000-000000000000'];
    studentsQuery = studentsQuery.in('institution_id', scopedInstitutionIds);
    institutionsQuery = institutionsQuery.in('id', scopedInstitutionIds);
  }

  const [studentsResult, categoriesResult, institutionsResult] = await Promise.all([
    studentsQuery,
    adminClient
      .from('student_categories')
      .select('id,code,name,status')
      .eq('tenant_id', access.tenantId)
      .order('name', { ascending: true }),
    institutionsQuery,
  ]);

  if (studentsResult.error || categoriesResult.error || institutionsResult.error) {
    throw new Error(
      studentsResult.error?.message ||
      categoriesResult.error?.message ||
      institutionsResult.error?.message ||
      'Não foi possível carregar os comensais.'
    );
  }

  const categoryRows = (categoriesResult.data || []) as CategoryRow[];
  const institutionRows = (institutionsResult.data || []) as InstitutionRow[];
  const studentRows = (studentsResult.data || []) as StudentRow[];
  const linkedUserIds = studentRows.flatMap((student) => student.user_id ? [student.user_id] : []);
  const { data: consumerProfiles } = linkedUserIds.length > 0
    ? await adminClient
        .from('profiles')
        .select('id,email,status,role')
        .eq('tenant_id', access.tenantId)
        .eq('role', 'student')
        .in('id', linkedUserIds)
    : { data: [] };
  const profileMap = new Map(
    (consumerProfiles || []).map((profile) => [profile.id, profile])
  );
  const categoryMap = new Map(categoryRows.map((category) => [category.id, category]));
  const institutionMap = new Map(institutionRows.map((institution) => [institution.id, institution]));
  const students = studentRows
    .filter((student) => categoryMap.get(student.category_id)?.code !== 'visitante')
    .map((student): CommensalListItem => ({
      ...student,
      category_name: categoryMap.get(student.category_id)?.name || 'Categoria não encontrada',
      institution_name: institutionMap.get(student.institution_id)?.name || 'Instituição não encontrada',
      access_email: student.user_id ? profileMap.get(student.user_id)?.email || student.email : null,
      access_status: student.user_id ? profileMap.get(student.user_id)?.status || null : null,
    }));

  const categories: SelectOption[] = categoryRows
    .filter((category) => category.status === 'active' && category.code !== 'visitante')
    .map((category) => ({ id: category.id, name: category.name }));
  const institutions: SelectOption[] = institutionRows
    .filter((institution) => institution.status === 'active')
    .map((institution) => ({ id: institution.id, name: institution.name }));

  return <CommensalManager students={students} categories={categories} institutions={institutions} />;
}
