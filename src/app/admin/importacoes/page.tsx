import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ImportWorkspace } from './_components/ImportWorkspace';

export default async function ImportacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active' || !['admin_general', 'operations_director'].includes(profile.role)) {
    redirect('/admin');
  }

  const { data: institutionData } = await supabase
    .from('institutions')
    .select('id,name,short_name')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .order('name');

  const institutions = (institutionData || []) as { id: string; name: string; short_name: string | null }[];
  const { data: importData } = await supabase
    .from('imports')
    .select('id,original_filename,status,total_rows,error_rows,created_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(10);
  const recentImports = (importData || []) as {
    id: string;
    original_filename: string;
    status: string;
    total_rows: number;
    error_rows: number;
    created_at: string;
  }[];

  return <ImportWorkspace institutions={institutions} recentImports={recentImports} />;
}
