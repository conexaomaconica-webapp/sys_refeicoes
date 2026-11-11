import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getFinancialReportingInitialData,
  getConsolidatedFinancialReport,
} from '@/server/reports/financial-reporting.server';
import { FinancialReportingDashboard } from '@/components/admin/FinancialReportingDashboard';

export const metadata = {
  title: 'Relatórios Fiscais e Faturamento | MA Refeições',
  description: 'Demonstrativo consolidado de faturamento, subsídios e saldo sob custódia.',
};

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/conta/login');
  }

  try {
    const initialData = await getFinancialReportingInitialData();
    const initialReport = await getConsolidatedFinancialReport({
      startDate: initialData.defaultStartDate,
      endDate: initialData.defaultEndDate,
    });

    return (
      <FinancialReportingDashboard
        initialData={initialData}
        initialReport={initialReport}
      />
    );
  } catch (err) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-sm">
          <h1 className="text-xl font-black">Relatórios Fiscais e Faturamento</h1>
          <p className="mt-2 text-sm">
            {(err as Error).message || 'Não foi possível carregar os relatórios.'}
          </p>
        </div>
      </main>
    );
  }
}

