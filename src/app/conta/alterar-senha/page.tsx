import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPostLoginDestination } from '@/lib/auth/post-login-destination';
import { AdminShell } from '@/components/admin/AdminShell';
import type { UserRole } from '@/types/auth';
import { ChangePasswordForm } from './ChangePasswordForm';

const ADMIN_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
];

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { tenant_id: string; role: UserRole; status: string } | null;
  if (!profile || profile.status !== 'active') redirect('/login');

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

  const backHref = getPostLoginDestination(profile.role);

  if (ADMIN_ROLES.includes(profile.role)) {
    return (
      <AdminShell role={profile.role} branding={brandingPayload}>
        <div className="mx-auto max-w-2xl px-4 py-8">
          <ChangePasswordForm backHref={backHref} branding={brandingPayload} />
        </div>
      </AdminShell>
    );
  }

  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        background: `radial-gradient(circle at 90% 5%, ${brandingPayload.primaryColor}15, transparent 24rem), #f8fafc`,
      }}
    >
      <div className="mx-auto max-w-lg">
        <ChangePasswordForm backHref={backHref} branding={brandingPayload} />
      </div>
    </main>
  );
}
