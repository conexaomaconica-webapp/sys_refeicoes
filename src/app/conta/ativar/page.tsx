import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ActivationForm } from './ActivationForm';

export default async function ActivateAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/conta/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id,full_name,role,status,must_change_password')
    .eq('id', user.id)
    .maybeSingle();

  const profile = profileData as {
    tenant_id: string;
    full_name: string;
    role: string;
    status: string;
    must_change_password: boolean;
  } | null;

  if (!profile || profile.status !== 'active') redirect('/conta/login');
  const isConsumer = profile.role === 'student';
  if (!profile.must_change_password) redirect(isConsumer ? '/consumer' : '/admin');

  const [{ data: tenantData }, { data: brandingData }] = await Promise.all([
    supabase.from('tenants').select('slug,name').eq('id', profile.tenant_id).maybeSingle(),
    supabase
      .from('tenant_branding')
      .select('app_name,logo_url,primary_color,secondary_color')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
  ]);

  const tenant = tenantData as { slug: string; name: string } | null;
  const branding = brandingData as {
    app_name: string;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
  } | null;

  const brandingPayload = {
    appName: branding?.app_name || tenant?.name || 'MA Refeições',
    logoUrl: branding?.logo_url || null,
    slug: tenant?.slug || 'tenant',
    primaryColor: branding?.primary_color || '#C5161D',
    secondaryColor: branding?.secondary_color || '#7F1D1D',
  };

  return (
    <ActivationForm
      fullName={profile.full_name}
      isConsumer={isConsumer}
      branding={brandingPayload}
    />
  );
}
