import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/auth';
import { BackupManager } from './BackupManager';

export const dynamic = 'force-dynamic';

export default async function AdminBackupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('tenant_id, role, status, full_name')
    .eq('id', user.id)
    .single();

  const profile = profileData as {
    tenant_id: string;
    role: UserRole;
    status: string;
    full_name: string;
  } | null;

  if (!profile || profile.status !== 'active' || profile.role !== 'admin_general') {
    redirect('/admin');
  }

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('name, slug')
    .eq('id', profile.tenant_id)
    .single();

  const tenant = tenantData as { name?: string; slug?: string } | null;

  return (
    <BackupManager
      tenantId={profile.tenant_id}
      tenantName={tenant?.name || 'Instituição'}
      userName={profile.full_name}
    />
  );
}

