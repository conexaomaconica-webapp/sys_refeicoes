import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/auth';

const ADMIN_ROLES: UserRole[] = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id,role,status')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { tenant_id: string; role: UserRole; status: string } | null;

  if (!profile || profile.status !== 'active' || !ADMIN_ROLES.includes(profile.role)) {
    redirect('/terminal');
  }

  const [{ data: tenantData }, { data: brandingData }] = await Promise.all([
    supabase.from('tenants').select('slug,name').eq('id', profile.tenant_id).maybeSingle(),
    supabase
      .from('tenant_branding')
      .select('app_name,logo_url,primary_color')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
  ]);
  const tenant = tenantData as { slug: string; name: string } | null;
  const branding = brandingData as { app_name: string; logo_url: string | null; primary_color: string | null } | null;

  return (
    <AdminShell
      role={profile.role}
      branding={{
        appName: branding?.app_name || tenant?.name || 'MA Refeições',
        logoUrl: branding?.logo_url || null,
        slug: tenant?.slug || 'tenant',
        primaryColor: branding?.primary_color || '#C5161D',
      }}
    >
      {children}
    </AdminShell>
  );
}
