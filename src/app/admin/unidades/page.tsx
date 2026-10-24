import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUnitManagementDataServer } from '@/services/admin-unit.service';
import { UnitManager } from './UnitManager';

export default async function UnitsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await getUnitManagementDataServer(user.id);
  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
          <h1 className="text-xl font-black">Unidades</h1>
          <p className="mt-2 text-sm">{error || 'Não foi possível carregar este módulo.'}</p>
        </div>
      </main>
    );
  }
  return <UnitManager {...data} />;
}
