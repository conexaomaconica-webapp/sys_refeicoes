import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ConsumerDashboard } from '@/components/consumer/ConsumerDashboard';
import type { Card } from '@/types/card';
import type {
  ConsumerMealConsumption,
  ConsumerPortalData,
  ConsumerPreferences,
} from '@/types/consumer';
import type { Wallet, WalletTransaction } from '@/types/wallet';

interface StudentRow {
  id: string;
  tenant_id: string;
  institution_id: string;
  category_id: string;
  full_name: string;
  registration_number: string;
  course: string | null;
  email: string | null;
  phone: string | null;
  photo_path: string | null;
  status: string;
}

interface CategoryRow {
  id: string;
  name: string;
  code: string;
  requires_wallet: boolean;
}

interface ConsumptionRow {
  id: string;
  consumed_at: string;
  consumption_date: string;
  student_price: number;
  subsidy_amount: number;
  status: ConsumerMealConsumption['status'];
  meal_types: { name: string } | { name: string }[] | null;
  units: { name: string } | { name: string }[] | null;
}

const relationName = (
  relation: { name: string } | { name: string }[] | null,
  fallback: string
) => (Array.isArray(relation) ? relation[0]?.name : relation?.name) || fallback;

export default async function ConsumerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/conta/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('role,status,must_change_password')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { role: string; status: string; must_change_password: boolean } | null;

  if (!profile || profile.status !== 'active') redirect('/conta/login');
  if (profile.role === 'student' && profile.must_change_password) redirect('/conta/ativar');
  if (profile.role !== 'student') {
    redirect(
      [
        'admin_general',
        'operations_director',
        'finance',
        'supervisor',
        'unit_manager',
      ].includes(profile.role)
        ? '/admin'
        : '/terminal'
    );
  }

  const { data: studentData } = await supabase
    .from('students')
    .select(
      'id,tenant_id,institution_id,category_id,full_name,registration_number,course,email,phone,photo_path,status'
    )
    .eq('user_id', user.id)
    .maybeSingle();
  const student = studentData as StudentRow | null;

  if (!student || student.status !== 'active') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <section className="max-w-lg rounded-3xl border border-amber-500/30 bg-slate-900 p-8 text-center shadow-2xl">
          <h1 className="text-xl font-bold">Cadastro não vinculado</h1>
          <p className="mt-3 text-sm text-slate-300">
            Sua conta está ativa, mas ainda não há um consumidor ativo vinculado a ela.
            Procure a administração da sua instituição.
          </p>
        </section>
      </main>
    );
  }

  const [{ data: categoryData }, { data: institutionData }] = await Promise.all([
    supabase
      .from('student_categories')
      .select('id,name,code,requires_wallet')
      .eq('id', student.category_id)
      .maybeSingle(),
    supabase
      .from('institutions')
      .select('name')
      .eq('id', student.institution_id)
      .maybeSingle(),
  ]);
  const category = categoryData as CategoryRow | null;
  const institution = institutionData as { name: string } | null;

  if (!category) redirect('/conta/login');

  // A emissão é idempotente e limitada ao próprio consumidor pela RPC.
  await supabase.rpc('ensure_my_digital_card');

  const financialQueries = category.requires_wallet
    ? Promise.all([
        supabase.from('wallets').select('*').eq('student_id', student.id).maybeSingle(),
        supabase
          .from('wallet_transactions')
          .select('*')
          .eq('student_id', student.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ])
    : Promise.resolve([{ data: null }, { data: [] }] as const);

  const [financial, consumptionResult, cardResult, preferenceResult] = await Promise.all([
    financialQueries,
    supabase
      .from('meal_consumptions')
      .select(
        'id,consumed_at,consumption_date,student_price,subsidy_amount,status,meal_types(name),units(name)'
      )
      .eq('student_id', student.id)
      .order('consumed_at', { ascending: false })
      .limit(100),
    supabase
      .from('cards')
      .select('*')
      .eq('student_id', student.id)
      .eq('card_type', 'digital')
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('consumer_preferences')
      .select('low_balance_enabled,low_balance_threshold,push_enabled')
      .eq('student_id', student.id)
      .maybeSingle(),
  ]);

  const wallet = financial[0].data as Wallet | null;
  const transactions = (financial[1].data || []) as WalletTransaction[];
  const consumptions = (
    (consumptionResult.data || []) as unknown as ConsumptionRow[]
  ).map((consumption): ConsumerMealConsumption => ({
    id: consumption.id,
    consumedAt: consumption.consumed_at,
    consumptionDate: consumption.consumption_date,
    mealTypeName: relationName(consumption.meal_types, 'Refeição'),
    unitName: relationName(consumption.units, 'Unidade'),
    studentPrice: Number(consumption.student_price),
    subsidyAmount: Number(consumption.subsidy_amount),
    status: consumption.status,
  }));
  const preferenceRow = preferenceResult.data as {
    low_balance_enabled: boolean;
    low_balance_threshold: number;
    push_enabled: boolean;
  } | null;
  const preferences: ConsumerPreferences = {
    lowBalanceEnabled: preferenceRow?.low_balance_enabled ?? true,
    lowBalanceThreshold: Number(preferenceRow?.low_balance_threshold ?? 10),
    pushEnabled: preferenceRow?.push_enabled ?? false,
  };

  const portalData: ConsumerPortalData = {
    student: {
      id: student.id,
      tenantId: student.tenant_id,
      fullName: student.full_name,
      registrationNumber: student.registration_number,
      course: student.course,
      email: student.email,
      phone: student.phone,
      photoPath: student.photo_path,
      status: student.status,
      institutionName: institution?.name || 'Instituição de ensino',
      category: {
        id: category.id,
        name: category.name,
        code: category.code,
        requiresWallet: category.requires_wallet,
      },
    },
    wallet,
    transactions,
    consumptions,
    card: cardResult.data as Card | null,
    preferences,
  };

  return <ConsumerDashboard initialData={portalData} />;
}
