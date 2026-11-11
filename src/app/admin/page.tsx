import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CreditCard,
  FileSpreadsheet,
  Gauge,
  Layers,
  LayoutDashboard,
  Palette,
  PlugZap,
  Receipt,
  Scale,
  Settings2,
  ShieldCheck,
  Tags,
  Users,
  WalletCards,
} from 'lucide-react';
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
  const canManageStudents = ['admin_general', 'operations_director', 'supervisor', 'unit_manager'].includes(role);
  const canViewUsers = ['admin_general', 'operations_director', 'unit_manager'].includes(role);
  const canViewUnits = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(role);
  const canViewFinance = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(role);
  const canReconcile = ['admin_general', 'operations_director', 'finance'].includes(role);
  const canViewDashboard = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(role);

  const modules = [
    {
      title: 'Dashboard operacional',
      description: 'Velocidade de linha, painel de picos de 15 minutos, terminais e alertas em tempo real.',
      href: '/admin/dashboard',
      icon: Gauge,
      enabled: canViewDashboard,
    },
    {
      title: 'Identidade visual',
      description: 'Logomarca, cores oficiais, tema do terminal e privacidade dos indicadores.',
      href: '/admin/identidade',
      icon: Palette,
      enabled: isGeneralAdmin,
    },
    {
      title: 'Usuários e acessos',
      description: 'Convites, perfis internos, status e escopos por unidade ou instituição.',
      href: '/admin/usuarios',
      icon: ShieldCheck,
      enabled: canViewUsers,
    },
    {
      title: 'Unidades',
      description: 'Restaurantes, localização, instituição responsável e situação operacional.',
      href: '/admin/unidades',
      icon: Building2,
      enabled: canViewUnits,
    },
    {
      title: 'Financeiro',
      description: 'Carteiras, movimentações, recargas, pagamentos e conciliação financeira.',
      href: '/admin/financeiro',
      icon: CreditCard,
      enabled: canViewFinance,
    },
    {
      title: 'Categorias e valores',
      description: 'Regras de cobrança, subsídios e modalidades de pagamento.',
      href: '/admin/categorias',
      icon: Tags,
      enabled: canManageCategories,
    },
    {
      title: 'Caixas e turnos',
      description: 'Aberturas, fechamentos, entradas, sangrias e conferência operacional.',
      href: '/admin/caixa',
      icon: WalletCards,
      enabled: canViewCash,
    },
    {
      title: 'Comensais',
      description: 'Consulta, cadastro manual, correção de categoria e situação cadastral.',
      href: '/admin/comensais',
      icon: Users,
      enabled: canManageStudents,
    },
    {
      title: 'Importação de comensais',
      description: 'Alunos, servidores e outros públicos, com atualização segura e rastreabilidade por unidade.',
      href: '/admin/importacoes',
      icon: FileSpreadsheet,
      enabled: canImportStudents,
    },
    {
      title: 'Relatórios fiscais e faturamento',
      description: 'Prestação de contas, subsídios por categoria, saldo sob custódia e exportação Excel/PDF.',
      href: '/admin/relatorios',
      icon: Receipt,
      enabled: canViewFinance,
    },
    {
      title: 'Conciliação e fechamento financeiro',
      description: 'Batimento automático com gateways, auditoria do ledger, fechamento diário e tratamento de divergências.',
      href: '/admin/conciliacao',
      icon: Scale,
      enabled: canReconcile,
    },
    {
      title: 'Ajustes e regularizações',
      description: 'Retroativo por data específica e ajuste inteligente mensal com análise de lacunas.',
      href: '/admin/ajustes-refeicoes',
      icon: Layers,
      enabled: canViewFinance,
    },
    {
      title: 'Contingência e ajustes',
      description: 'Registro formal e dupla aprovação de atendimentos em contingência operacional.',
      href: '/admin/contingencia',
      icon: AlertTriangle,
      enabled: canViewFinance,
    },
    {
      title: 'Integrações e APIs',
      description: 'Gateways de pagamento (Asaas/Mercado Pago), webhooks e status de conectores.',
      href: '/admin/integracoes',
      icon: PlugZap,
      enabled: isGeneralAdmin,
    },
  ];

  return (
    <div className="text-slate-900">
      <main className="mx-auto max-w-7xl space-y-8 px-5 py-8 md:px-8 md:py-10">
        <section
          className="relative overflow-hidden rounded-3xl p-7 text-white shadow-xl md:p-10"
          style={{ background: 'linear-gradient(135deg, var(--admin-secondary) 0%, var(--admin-primary) 100%)' }}
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/85">
                <LayoutDashboard className="h-4 w-4 text-white" />
                Central de gestão
              </div>
              <h2 className="text-3xl font-black tracking-tight md:text-4xl">Olá, {profile.full_name.split(' ')[0]}.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/80 md:text-base">
                Configure a operação e a experiência visual da MA Refeições em um único lugar.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-wider text-white/65">Perfil conectado</p>
              <p className="mt-1 font-black">{roleLabels[role]}</p>
              <p className="mt-0.5 text-xs text-white/65">{profile.email || user.email}</p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Configurações disponíveis</h2>
              <p className="mt-1 text-sm text-slate-500">Os módulos são apresentados conforme as permissões do seu perfil.</p>
            </div>
            <Settings2 className="h-6 w-6" style={{ color: 'var(--admin-primary)' }} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {modules.map((module) => {
              const Icon = module.icon;
              const content = (
                <>
                  <div
                    className="mb-5 grid h-12 w-12 place-items-center rounded-2xl border"
                    style={{
                      color: 'var(--admin-primary)',
                      borderColor: 'color-mix(in srgb, var(--admin-primary) 20%, white)',
                      backgroundColor: 'color-mix(in srgb, var(--admin-primary) 9%, white)',
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-black">{module.title}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{module.description}</p>
                  <div className="mt-5 flex items-center justify-between text-sm font-black">
                    <span>{module.enabled ? 'Acessar configuração' : 'Sem permissão'}</span>
                    {module.enabled && <ArrowRight className="h-4 w-4" />}
                  </div>
                </>
              );
              return module.enabled ? (
                <Link key={module.title} href={module.href} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                  {content}
                </Link>
              ) : (
                <div key={module.title} className="rounded-3xl border border-slate-200 bg-slate-100/70 p-6 opacity-60">{content}</div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
