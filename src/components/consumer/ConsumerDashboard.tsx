'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Download,
  Home,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  Smartphone,
  User,
  Utensils,
  WalletCards,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import { ConsumerVirtualCard } from '@/components/cards/ConsumerVirtualCard';
import { createBrowserClient } from '@/lib/supabase/client';
import {
  createConsumerRecharge,
  saveConsumerPreferences,
  updateConsumerContact,
} from '@/app/consumer/actions';
import type { ConsumerPortalData } from '@/types/consumer';
import type { PaymentMethod } from '@/types/payment';

type ConsumerView =
  'home' | 'wallet' | 'recharge' | 'ledger' | 'card' | 'meals' | 'profile';

interface ConsumerDashboardProps {
  initialData: ConsumerPortalData;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

const transactionLabels: Record<string, string> = {
  recharge: 'Recarga',
  meal_debit: 'Refeição',
  refund: 'Estorno',
  reversal: 'Reversão',
  manual_adjustment: 'Ajuste',
};

export function ConsumerDashboard({ initialData }: ConsumerDashboardProps) {
  const router = useRouter();
  const { branding } = useBrand();
  const [view, setView] = useState<ConsumerView>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('20');
  const [rechargeMethod, setRechargeMethod] = useState<PaymentMethod>('pix');
  const [pixPayload, setPixPayload] = useState<{
    image?: string;
    copyPaste?: string;
  } | null>(null);
  const [preferences, setPreferences] = useState(initialData.preferences);
  const [email, setEmail] = useState(initialData.student.email || '');
  const [phone, setPhone] = useState(initialData.student.phone || '');
  const [isPending, startTransition] = useTransition();

  const isFinancial = initialData.student.category.requiresWallet;
  const balance = Number(initialData.wallet?.balance || 0);
  const lowBalance =
    isFinancial &&
    preferences.lowBalanceEnabled &&
    balance <= preferences.lowBalanceThreshold;

  const showNotification = useCallback(
    async (title: string, body: string, tag: string, url = '/consumer') => {
      setToast(body);
      if (
        !preferences.pushEnabled ||
        !('Notification' in window) ||
        Notification.permission !== 'granted'
      )
        return;
      const registration = await navigator.serviceWorker?.ready;
      registration?.active?.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body,
        tag,
        url,
      });
    },
    [preferences.pushEnabled]
  );

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (
      requestedView &&
      ['home', 'wallet', 'recharge', 'ledger', 'card', 'meals', 'profile'].includes(
        requestedView
      ) &&
      (isFinancial || !['wallet', 'recharge', 'ledger'].includes(requestedView))
    ) {
      setView(requestedView as ConsumerView);
    }

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
    };
  }, [isFinancial]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`consumer-${initialData.student.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'meal_consumptions',
          filter: `student_id=eq.${initialData.student.id}`,
        },
        () => {
          void showNotification(
            'Refeição registrada',
            'Seu consumo foi confirmado no terminal.',
            'meal-consumption',
            '/consumer?view=meals'
          );
          router.refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'wallet_transactions',
          filter: `student_id=eq.${initialData.student.id}`,
        },
        () => {
          void showNotification(
            'Saldo atualizado',
            'Uma nova movimentação foi registrada na sua carteira.',
            'wallet-update',
            '/consumer?view=ledger'
          );
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initialData.student.id, router, showNotification]);

  useEffect(() => {
    if (lowBalance) {
      void showNotification(
        'Saldo baixo',
        `Seu saldo está em ${formatCurrency(balance)}. Faça uma recarga para evitar interrupções.`,
        'low-balance',
        '/consumer?view=recharge'
      );
    }
  }, [balance, lowBalance, showNotification]);

  const navigation = useMemo(
    () => [
      { id: 'home' as const, label: 'Início', icon: Home },
      ...(isFinancial
        ? [
            { id: 'wallet' as const, label: 'Saldo disponível', icon: WalletCards },
            { id: 'recharge' as const, label: 'Recarga rápida', icon: CircleDollarSign },
            { id: 'ledger' as const, label: 'Extrato financeiro', icon: BookOpen },
          ]
        : []),
      { id: 'card' as const, label: 'Minha carteirinha', icon: CreditCard },
      { id: 'meals' as const, label: 'Histórico de refeições', icon: Utensils },
      { id: 'profile' as const, label: 'Meus dados', icon: User },
    ],
    [isFinancial]
  );

  const changeView = (nextView: ConsumerView) => {
    setView(nextView);
    setMenuOpen(false);
    setActionError(null);
    window.history.replaceState(null, '', `/consumer?view=${nextView}`);
  };

  const handleRecharge = () => {
    setActionError(null);
    setPixPayload(null);
    startTransition(async () => {
      const result = await createConsumerRecharge({
        studentId: initialData.student.id,
        method: rechargeMethod,
        amount: Number(rechargeAmount.replace(',', '.')),
      });
      if (!result.success) {
        setActionError(result.error || 'Não foi possível criar a recarga.');
        return;
      }
      if (result.pixCopyPaste || result.pixQrCode) {
        setPixPayload({ image: result.pixQrCode, copyPaste: result.pixCopyPaste });
      }
      void showNotification(
        result.status === 'confirmed' ? 'Recarga confirmada' : 'Cobrança criada',
        result.message || 'Acompanhe a atualização do seu saldo.',
        'recharge-status',
        '/consumer?view=wallet'
      );
      router.refresh();
    });
  };

  const handleNotificationPreference = async (enabled: boolean) => {
    setActionError(null);
    if (enabled) {
      if (!('Notification' in window)) {
        setActionError('Este navegador não oferece notificações PWA.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setActionError('Permissão de notificação não concedida pelo navegador.');
        return;
      }
    }

    const nextPreferences = { ...preferences, pushEnabled: enabled };
    setPreferences(nextPreferences);
    startTransition(async () => {
      const result = await saveConsumerPreferences(nextPreferences);
      if (!result.success) setActionError(result.error || 'Erro ao salvar preferências.');
      else setToast('Preferências de notificação atualizadas.');
    });
  };

  const handleSavePreferences = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await saveConsumerPreferences(preferences);
      if (!result.success) setActionError(result.error || 'Erro ao salvar preferências.');
      else setToast('Preferências atualizadas.');
    });
  };

  const handleSaveContact = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await updateConsumerContact({ email, phone });
      if (!result.success) setActionError(result.error || 'Erro ao atualizar dados.');
      else setToast('Dados de contato atualizados.');
    });
  };

  const handleSignOut = async () => {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.replace('/conta/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200 lg:hidden"
              aria-label="Abrir menu"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logo_url}
                alt={branding.app_name}
                className="h-9 max-w-32 object-contain"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
                <Utensils className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{branding.app_name}</p>
              <p className="truncate text-xs text-slate-400">Portal do consumidor</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`hidden items-center gap-1 rounded-full border px-2.5 py-1 text-xs sm:flex ${
                online
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {online ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {online ? 'Online' : 'Somente dados já carregados'}
            </span>
            {installPrompt && (
              <button
                type="button"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Instalar</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl lg:grid-cols-[260px_1fr]">
        <aside
          className={`${menuOpen ? 'block' : 'hidden'} fixed inset-x-0 top-16 z-30 border-b border-slate-800 bg-slate-950 p-4 shadow-2xl lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-64px)] lg:border-b-0 lg:border-r lg:p-5 lg:shadow-none`}
        >
          <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="truncate font-bold">{initialData.student.fullName}</p>
            <p className="mt-1 text-xs text-slate-400">
              {initialData.student.registrationNumber}
            </p>
            <span className="mt-3 inline-flex rounded-full bg-purple-500/10 px-2.5 py-1 text-[11px] font-bold text-purple-300">
              {initialData.student.category.name}
            </span>
          </div>

          <nav className="space-y-1" aria-label="Menu do consumidor">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeView(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    view === item.id
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-5 flex w-full items-center gap-3 rounded-xl border border-slate-800 px-3 py-2.5 text-sm font-semibold text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </aside>

        <main className="min-w-0 p-4 pb-24 sm:p-6 lg:p-8">
          {!online && (
            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <WifiOff className="mt-0.5 h-5 w-5 shrink-0" />
              <p>
                Sem conexão. Saldo, recarga, QR e históricos podem estar desatualizados ou
                indisponíveis.
              </p>
            </div>
          )}
          {toast && (
            <div
              className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
              role="status"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                {toast}
              </span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {actionError && (
            <div
              className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200"
              role="alert"
            >
              {actionError}
            </div>
          )}

          {view === 'home' && (
            <section className="space-y-6">
              <div>
                <p className="text-sm text-slate-400">Olá,</p>
                <h1 className="text-2xl font-black sm:text-3xl">
                  {initialData.student.fullName.split(' ')[0]}
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Acompanhe sua alimentação e seus acessos em um só lugar.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {isFinancial && (
                  <button
                    type="button"
                    onClick={() => changeView('wallet')}
                    className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-slate-900 p-5 text-left shadow-xl"
                  >
                    <div className="flex items-center justify-between text-emerald-300">
                      <WalletCards className="h-6 w-6" />
                      <ChevronRight className="h-5 w-5" />
                    </div>
                    <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">
                      Saldo disponível
                    </p>
                    <p className="mt-1 text-3xl font-black">{formatCurrency(balance)}</p>
                    {lowBalance && (
                      <p className="mt-2 text-xs font-semibold text-amber-300">
                        Saldo abaixo do limite configurado
                      </p>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => changeView('card')}
                  className="rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 to-slate-900 p-5 text-left shadow-xl"
                >
                  <div className="flex items-center justify-between text-cyan-300">
                    <CreditCard className="h-6 w-6" />
                    <ChevronRight className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Carteirinha digital
                  </p>
                  <p className="mt-1 text-lg font-black">
                    QR dinâmico para identificação
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => changeView('meals')}
                  className="rounded-3xl border border-purple-500/30 bg-gradient-to-br from-purple-500/15 to-slate-900 p-5 text-left shadow-xl"
                >
                  <div className="flex items-center justify-between text-purple-300">
                    <Utensils className="h-6 w-6" />
                    <ChevronRight className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Última refeição
                  </p>
                  <p className="mt-1 text-lg font-black">
                    {initialData.consumptions[0]?.mealTypeName ||
                      'Nenhum consumo registrado'}
                  </p>
                  {initialData.consumptions[0] && (
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDateTime(initialData.consumptions[0].consumedAt)}
                    </p>
                  )}
                </button>
              </div>

              {!isFinancial && (
                <div className="rounded-3xl border border-purple-500/30 bg-purple-500/10 p-5">
                  <h2 className="font-bold text-purple-200">Categoria integral</h2>
                  <p className="mt-2 text-sm text-purple-100/80">
                    Sua categoria possui isenção. Por isso, saldo, recarga e extrato
                    financeiro não fazem parte do seu portal.
                  </p>
                </div>
              )}
            </section>
          )}

          {view === 'wallet' && isFinancial && (
            <section className="space-y-5">
              <h1 className="text-2xl font-black">Saldo disponível</h1>
              <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-slate-900 p-6">
                <p className="text-sm text-emerald-200">Carteira ativa</p>
                <p className="mt-2 text-4xl font-black">{formatCurrency(balance)}</p>
                <button
                  type="button"
                  onClick={() => changeView('recharge')}
                  className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950"
                >
                  Fazer recarga
                </button>
              </div>
            </section>
          )}

          {view === 'recharge' && isFinancial && (
            <section className="max-w-2xl space-y-5">
              <div>
                <h1 className="text-2xl font-black">Recarga rápida</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Escolha o valor e a forma de pagamento.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
                <div className="grid grid-cols-4 gap-2">
                  {[10, 20, 30, 50].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setRechargeAmount(String(amount))}
                      className={`rounded-xl border py-2 text-sm font-bold ${Number(rechargeAmount) === amount ? 'border-emerald-500 bg-emerald-500 text-slate-950' : 'border-slate-700 bg-slate-950 text-slate-300'}`}
                    >
                      R$ {amount}
                    </button>
                  ))}
                </div>
                <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Outro valor
                </label>
                <input
                  type="number"
                  min="5"
                  max="500"
                  step="0.01"
                  value={rechargeAmount}
                  onChange={(event) => setRechargeAmount(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg font-bold outline-none focus:border-emerald-500"
                />
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRechargeMethod('pix')}
                    className={`rounded-xl border p-3 text-sm font-bold ${rechargeMethod === 'pix' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-300'}`}
                  >
                    Pix
                  </button>
                  <button
                    type="button"
                    onClick={() => setRechargeMethod('credit_card')}
                    className={`rounded-xl border p-3 text-sm font-bold ${rechargeMethod === 'credit_card' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-300'}`}
                  >
                    Cartão
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isPending || !online}
                  onClick={handleRecharge}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3.5 font-bold text-slate-950 disabled:opacity-50"
                >
                  {isPending ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <CircleDollarSign className="h-5 w-5" />
                  )}
                  {isPending
                    ? 'Criando cobrança...'
                    : `Recarregar ${formatCurrency(Number(rechargeAmount || 0))}`}
                </button>
              </div>
              {pixPayload && (
                <div className="rounded-3xl border border-cyan-500/30 bg-cyan-500/10 p-5">
                  <h2 className="font-bold text-cyan-200">Pix criado</h2>
                  {pixPayload.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pixPayload.image}
                      alt="QR Code Pix"
                      className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2"
                    />
                  )}
                  {pixPayload.copyPaste && (
                    <>
                      <textarea
                        readOnly
                        value={pixPayload.copyPaste}
                        className="mt-4 w-full rounded-xl border border-cyan-500/20 bg-slate-950 p-3 text-xs text-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(pixPayload.copyPaste || '')
                        }
                        className="mt-2 rounded-xl border border-cyan-500/30 px-4 py-2 text-xs font-bold text-cyan-200"
                      >
                        Copiar código Pix
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {view === 'ledger' && isFinancial && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Extrato financeiro</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Lançamentos imutáveis da sua carteira.
                </p>
              </div>
              <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                {initialData.transactions.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">
                    Nenhum lançamento encontrado.
                  </p>
                ) : (
                  initialData.transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between gap-4 border-b border-slate-800 p-4 last:border-0"
                    >
                      <div>
                        <p className="font-semibold">
                          {transactionLabels[transaction.type] || transaction.description}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDateTime(transaction.created_at)} · Saldo após:{' '}
                          {formatCurrency(Number(transaction.balance_after))}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-black ${Number(transaction.amount) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {Number(transaction.amount) >= 0 ? '+' : ''}
                        {formatCurrency(Number(transaction.amount))}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {view === 'card' && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Minha carteirinha</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Apresente o QR dinâmico ou informe sua matrícula no terminal.
                </p>
              </div>
              <ConsumerVirtualCard
                student={{
                  fullName: initialData.student.fullName,
                  registrationNumber: initialData.student.registrationNumber,
                  course: initialData.student.course,
                  photoPath: initialData.student.photoPath,
                  institutionName: initialData.student.institutionName,
                  status: initialData.student.status,
                  categoryName: initialData.student.category.name,
                }}
                card={initialData.card}
                balance={initialData.wallet?.balance ?? null}
                requiresWallet={isFinancial}
              />
            </section>
          )}

          {view === 'meals' && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Histórico de refeições</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Consumos registrados nos terminais.
                </p>
              </div>
              <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                {initialData.consumptions.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">
                    Nenhuma refeição encontrada.
                  </p>
                ) : (
                  initialData.consumptions.map((consumption) => (
                    <div
                      key={consumption.id}
                      className="flex items-center justify-between gap-4 border-b border-slate-800 p-4 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-purple-500/10 p-2 text-purple-300">
                          <Utensils className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold">{consumption.mealTypeName}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {consumption.unitName} ·{' '}
                            {formatDateTime(consumption.consumedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-bold ${consumption.status === 'cancelled_unserved' ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}
                        >
                          {consumption.status === 'cancelled_unserved'
                            ? 'Cancelada'
                            : 'Confirmada'}
                        </span>
                        {isFinancial && (
                          <p className="mt-1 text-xs text-slate-400">
                            {formatCurrency(consumption.studentPrice)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {view === 'profile' && (
            <section className="max-w-2xl space-y-5">
              <div>
                <h1 className="text-2xl font-black">Meus dados</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Dados acadêmicos são mantidos pela instituição; contatos podem ser
                  atualizados aqui.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Nome
                    </label>
                    <p className="mt-1 font-semibold">{initialData.student.fullName}</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Matrícula
                    </label>
                    <p className="mt-1 font-mono font-semibold">
                      {initialData.student.registrationNumber}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Instituição
                    </label>
                    <p className="mt-1 font-semibold">
                      {initialData.student.institutionName}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Categoria
                    </label>
                    <p className="mt-1 font-semibold">
                      {initialData.student.category.name}
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    E-mail
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-normal normal-case text-white outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Telefone
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-normal normal-case text-white outline-none focus:border-emerald-500"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleSaveContact}
                  disabled={isPending}
                  className="mt-4 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
                >
                  Salvar contatos
                </button>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-cyan-300" />
                  <h2 className="font-bold">Notificações</h2>
                </div>
                <label className="mt-5 flex items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold">Notificações PWA</span>
                    <span className="text-xs text-slate-500">
                      Recargas, refeições e saldo baixo
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.pushEnabled}
                    onChange={(event) =>
                      void handleNotificationPreference(event.target.checked)
                    }
                    className="h-5 w-5 accent-emerald-500"
                  />
                </label>
                {isFinancial && (
                  <>
                    <label className="mt-5 flex items-center justify-between gap-4">
                      <span>
                        <span className="block text-sm font-semibold">
                          Aviso de saldo baixo
                        </span>
                        <span className="text-xs text-slate-500">
                          Alertar quando atingir o limite
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={preferences.lowBalanceEnabled}
                        onChange={(event) =>
                          setPreferences((current) => ({
                            ...current,
                            lowBalanceEnabled: event.target.checked,
                          }))
                        }
                        className="h-5 w-5 accent-emerald-500"
                      />
                    </label>
                    <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                      Limite do aviso (R$)
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        step="0.01"
                        value={preferences.lowBalanceThreshold}
                        onChange={(event) =>
                          setPreferences((current) => ({
                            ...current,
                            lowBalanceThreshold: Number(event.target.value),
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-normal text-white outline-none focus:border-emerald-500"
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  disabled={isPending}
                  className="mt-5 flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Bell className="h-4 w-4" />
                  Salvar preferências
                </button>
              </div>

              <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5 text-sm text-cyan-100/80">
                <div className="flex items-center gap-2 font-bold text-cyan-200">
                  <Smartphone className="h-5 w-5" />
                  Aplicativo instalável
                </div>
                <p className="mt-2">
                  No iPhone, use “Adicionar à Tela de Início” no menu de compartilhamento.
                  No Android, use o botão Instalar quando disponível.
                </p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
