import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  const profile = data as { role: string; status: string } | null;
  if (!profile || profile.status !== 'active' || profile.role !== 'admin_general') redirect('/admin');
  return children;
}

