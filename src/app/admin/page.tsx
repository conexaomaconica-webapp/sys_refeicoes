import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  Palette,
  Settings2,
  ShieldCheck,
  Tags,
  Users,
  WalletCards,
} from 'lucide-react';
import { AdminSignOutButton } from '@/components/admin/AdminSignOutButton';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/auth';

const roleLabels: Record<UserRole, string> = {
  admin_general: 'Administrador geral',
  operations_director: 'Diretor operacional',
  finance: 'Financeiro',
  supervisor: 'Supervisor',
  unit_manager: 'Gerente de unidade',
  operator: 'Operador',
  institution_user: 'Instituição',
  student: 'Aluno',
};

export default async function AdminHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('full_name,email,role,status')
    .eq('id', user.id)
    .single();
  const profile = profileData as { full_name: string; email: string | null; role: UserRole; status: string } | null;
  if (!profile) redirect('/login');

  const role = profile.role as UserRole;
  const isGeneralAdmin = role === 'admin_general';
  const canManageCategories = ['admin_general', 'operations_director', 'supervisor', 'unit_manager'].includes(role);
  const canViewCash = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(role);
  const canImportStudents = ['admin_general', 'operations_director'].includes(role);

  const modules = [
    {
      title: 'Identidade visual',
      description: 'Logomarca, cores oficiais, tema do terminal e privacidade dos indicadores.',
      href: '/admin/identidade',
      icon: Palette,
      enabled: isGeneralAdmin,
      accent: 'red',
    },
    {
      title: 'Categorias e valores',
      description: 'Regras de cobrança, subsídios e modalidades de pagamento.',
      href: '/admin/categorias',
      icon: Tags,
      enabled: canManageCategories,
      accent: 'amber',
    },
    {
      title: 'Caixas e turnos',
      description: 'Aberturas, fechamentos, entradas, sangrias e conferência operacional.',
      href: '/admin/caixa',
      icon: WalletCards,
      enabled: canViewCash,
      accent: 'emerald',
    },
    {
      title: 'Importação de alunos',
      description: 'Preview, validação parcial, rejeições e histórico de alterações por planilha.',
      href: '/admin/importacoes',
      icon: FileSpreadsheet,
      enabled: canImportStudents,
      accent: 'red',
    },
  ];

  const upcoming = [
    { title: 'Usuários e acessos', icon: Users },
    { title: 'Unidades', icon: Building2 },
    { title: 'Financeiro', icon: CreditCard },
    { title: 'Relatórios', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-red-700 text-white shadow-lg shadow-red-900/15">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">MA Refeições</p>
              <h1 className="text-lg font-black">Painel administrativo</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/terminal" className="hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:border-slate-300 md:inline-flex">
              Abrir terminal
            </Link>
            <AdminSignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-5 py-8 md:px-8 md:py-10">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-red-950 p-7 text-white shadow-xl md:p-10">
          <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300">
                <LayoutDashboard className="h-4 w-4 text-amber-400" />
                Central de gestão
              </div>
              <h2 className="text-3xl font-black tracking-tight md:text-4xl">Olá, {profile.full_name.split(' ')[0]}.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 md:text-base">
                Configure a operação e a experiência visual da MA Refeições em um único lugar.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Perfil conectado</p>
              <p className="mt-1 font-black">{roleLabels[role]}</p>
              <p className="mt-0.5 text-xs text-slate-400">{profile.email || user.email}</p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Configurações disponíveis</h2>
              <p className="mt-1 text-sm text-slate-500">Os módulos são apresentados conforme as permissões do seu perfil.</p>
            </div>
            <Settings2 className="h-6 w-6 text-slate-400" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {modules.map((module) => {
              const Icon = module.icon;
              const colors = module.accent === 'red'
                ? 'bg-red-50 text-red-700 border-red-100'
                : module.accent === 'amber'
                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100';
              const content = (
                <>
                  <div className={`mb-5 grid h-12 w-12 place-items-center rounded-2xl border ${colors}`}><Icon className="h-5 w-5" /></div>
                  <h3 className="text-lg font-black">{module.title}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{module.description}</p>
                  <div className="mt-5 flex items-center justify-between text-sm font-black">
                    <span>{module.enabled ? 'Acessar configuração' : 'Sem permissão'}</span>
                    {module.enabled && <ArrowRight className="h-4 w-4" />}
                  </div>
                </>
              );
              return module.enabled ? (
                <Link key={module.title} href={module.href} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
                  {content}
                </Link>
              ) : (
                <div key={module.title} className="rounded-3xl border border-slate-200 bg-slate-100/70 p-6 opacity-60">{content}</div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-black">Próximas funcionalidades</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {upcoming.map(({ title, icon: Icon }) => (
              <div key={title} className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 text-slate-500">
                <Icon className="h-5 w-5" />
                <div><p className="text-sm font-bold">{title}</p><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Em breve</p></div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
