import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ActivationForm } from './ActivationForm';

export default async function ActivateAccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/conta/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('full_name,role,status,must_change_password')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as {
    full_name: string;
    role: string;
    status: string;
    must_change_password: boolean;
  } | null;
  if (!profile || profile.status !== 'active') redirect('/login');
  const isConsumer = profile.role === 'student';
  if (!profile.must_change_password) redirect(isConsumer ? '/consumer' : '/admin');

  return <ActivationForm fullName={profile.full_name} isConsumer={isConsumer} />;
}
