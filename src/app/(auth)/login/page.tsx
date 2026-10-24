import { redirect } from 'next/navigation';
import { PortalLogin } from '@/components/auth/PortalLogin';
import { getPostLoginDestination } from '@/lib/auth/post-login-destination';
import { createClient } from '@/lib/supabase/server';

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('role,status')
      .eq('id', user.id)
      .maybeSingle();
    const profile = profileData as { role: string; status: string } | null;
    if (profile?.status === 'active') redirect(getPostLoginDestination(profile.role));
  }

  return <PortalLogin audience="staff" />;
}
