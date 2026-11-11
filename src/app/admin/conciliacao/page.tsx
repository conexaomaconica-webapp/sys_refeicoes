import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ReconciliationDashboard } from '@/components/admin/ReconciliationDashboard';
import { getReconciliationDashboard } from '@/server/reconciliation/reconciliation.server';

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    redirect('/login');
  }

  const allowedRoles = ['admin_general', 'operations_director', 'finance'];
  if (!allowedRoles.includes(profile.role)) {
    redirect('/admin');
  }

  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startDate = firstDayOfMonth.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  const initialData = await getReconciliationDashboard({ startDate, endDate });

  return <ReconciliationDashboard initialData={initialData} />;
}

