import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOperationalDashboardInitialData } from '@/server/dashboard/operational-dashboard.server';
import { OperationalDashboard } from '@/components/admin/OperationalDashboard';

export const metadata = {
  title: 'Dashboard Operacional e Picos | MA Refeições',
  description: 'Monitoramento em tempo real de velocidade de linha, picos de atendimento e terminais.',
};

interface PageProps {
  searchParams: Promise<{
    unit_id?: string;
    date?: string;
    meal_type_id?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/conta/login');
  }

  const params = await searchParams;

  try {
    const data = await getOperationalDashboardInitialData(
      params.unit_id,
      params.date,
      params.meal_type_id
    );

    return <OperationalDashboard initialData={data} />;
  } catch (err) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-sm">
          <h1 className="text-xl font-black">Dashboard Operacional</h1>
          <p className="mt-2 text-sm">
            {(err as Error).message || 'Não foi possível carregar as métricas operacionais.'}
          </p>
        </div>
      </main>
    );
  }
}

