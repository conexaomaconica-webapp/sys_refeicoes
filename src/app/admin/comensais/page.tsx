import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CommensalManager, type CommensalListItem, type SelectOption } from './CommensalManager';

export default async function ComensaisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role, status')
    .eq('id', user.id)
    .maybeSingle();

  if (
    !profile ||
    profile.status !== 'active' ||
    !['admin_general', 'operations_director'].includes(profile.role)
  ) {
    redirect('/admin');
  }

  const [studentsResult, categoriesResult, institutionsResult] = await Promise.all([
    supabase
      .from('students')
      .select('id,institution_id,category_id,registration_number,full_name,course,email,phone,status,updated_at')
      .eq('tenant_id', profile.tenant_id)
      .order('full_name', { ascending: true })
      .limit(1000),
    supabase
      .from('student_categories')
      .select('id,code,name,status')
      .eq('tenant_id', profile.tenant_id)
      .order('name', { ascending: true }),
    supabase
      .from('institutions')
      .select('id,name,status')
      .eq('tenant_id', profile.tenant_id)
      .order('name', { ascending: true }),
  ]);

  if (studentsResult.error || categoriesResult.error || institutionsResult.error) {
    throw new Error(
      studentsResult.error?.message ||
      categoriesResult.error?.message ||
      institutionsResult.error?.message ||
      'Não foi possível carregar os comensais.'
    );
  }

  const categoryMap = new Map((categoriesResult.data || []).map((category) => [category.id, category]));
  const institutionMap = new Map((institutionsResult.data || []).map((institution) => [institution.id, institution]));
  const students = (studentsResult.data || [])
    .filter((student) => categoryMap.get(student.category_id)?.code !== 'visitante')
    .map((student): CommensalListItem => ({
      ...student,
      category_name: categoryMap.get(student.category_id)?.name || 'Categoria não encontrada',
      institution_name: institutionMap.get(student.institution_id)?.name || 'Instituição não encontrada',
    }));

  const categories: SelectOption[] = (categoriesResult.data || [])
    .filter((category) => category.status === 'active' && category.code !== 'visitante')
    .map((category) => ({ id: category.id, name: category.name }));
  const institutions: SelectOption[] = (institutionsResult.data || [])
    .filter((institution) => institution.status === 'active')
    .map((institution) => ({ id: institution.id, name: institution.name }));

  return <CommensalManager students={students} categories={categories} institutions={institutions} />;
}
