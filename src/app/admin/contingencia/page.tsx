import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getContingencyManagementData } from '@/server/contingency/contingency.service';
import { ContingencyManager } from './ContingencyManager';

export const metadata = {
  title: 'Contingência e Regularização Retroativa | MA Refeições',
  description: 'Apuração e auditoria de refeições servidas em contingência ou ajustes retroativos.',
};

export default async function ContingencyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/conta/login');
  }

  try {
    const data = await getContingencyManagementData();
    return <ContingencyManager data={data} />;
  } catch (err) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-sm">
          <h1 className="text-xl font-black">Contingência e Regularização</h1>
          <p className="mt-2 text-sm">
            {(err as Error).message || 'Não foi possível carregar os lotes de contingência.'}
          </p>
        </div>
      </main>
    );
  }
}
