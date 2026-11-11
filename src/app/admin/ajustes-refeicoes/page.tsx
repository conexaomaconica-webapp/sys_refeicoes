import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMealAdjustmentsWorkspaceData } from '@/server/adjustments/smart-adjustment.service';
import { MealAdjustmentsManager } from './MealAdjustmentsManager';

export const metadata = {
  title: 'Ajustes e Regularizações de Refeições | MA Refeições',
  description:
    'Ajuste retroativo por data específica e análise inteligente mensal com aprovação segregada e trilha de auditoria.',
};

export default async function MealAdjustmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  try {
    const data = await getMealAdjustmentsWorkspaceData();
    return <MealAdjustmentsManager data={data} />;
  } catch (err) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-sm">
          <h1 className="text-xl font-black">Ajustes e Regularizações de Refeições</h1>
          <p className="mt-2 text-sm">
            {(err as Error).message || 'Não foi possível carregar o módulo de ajustes.'}
          </p>
        </div>
      </main>
    );
  }
}

