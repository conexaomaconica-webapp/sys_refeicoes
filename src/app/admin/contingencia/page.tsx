import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
    redirect('/login');
  }

  redirect('/admin/ajustes-refeicoes');
}
