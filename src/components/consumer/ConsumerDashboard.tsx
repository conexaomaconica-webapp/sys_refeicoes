'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Download,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Smartphone,
  Sun,
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
  updateConsumerPhotoAction,
} from '@/app/consumer/actions';
import type { ConsumerPortalData } from '@/types/consumer';
import type { PaymentMethod } from '@/types/payment';

type ConsumerView =
  | 'home'
  | 'wallet'
  | 'recharge'
  | 'ledger'
  | 'card'
  | 'meals'
  | 'profile';

interface ConsumerDashboardProps {
  initialData: ConsumerPortalData;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const getInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

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

  // Modo claro como padrão conforme solicitação
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState<ConsumerView>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('20');
  const [rechargeMethod, setRechargeMethod] = useState<PaymentMethod>('pix');
  const [pixPayload, setPixPayload] = useState<{
    image?: string;
    copyPaste?: string;
  } | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [preferences, setPreferences] = useState(initialData.preferences);
  const [email, setEmail] = useState(initialData.student.email || '');
  const [phone, setPhone] = useState(initialData.student.phone || '');
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(initialData.student.photoPath || null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    setPhotoFeedback(null);

    const formData = new FormData();
    formData.append('file', file);

    const res = await updateConsumerPhotoAction(formData);
    setUploadingPhoto(false);

    if (res.success && res.photoUrl) {
      setCurrentPhoto(res.photoUrl);
      setPhotoFeedback({ type: 'success', message: 'Sua foto foi atualizada com sucesso!' });
    } else {
      setPhotoFeedback({ type: 'error', message: res.error || 'Erro ao atualizar a foto.' });
    }
  };

  const isDark = theme === 'dark';
  const primaryColor = branding.primary_color || '#C5161D';

  useEffect(() => {
    const saved = localStorage.getItem('ma-consumer-theme') as 'light' | 'dark' | null;
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
    }
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem('ma-consumer-theme', next);
      return next;
    });
  };

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
        '/consumer?view=ledger'
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
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-[#FAFAF9] text-slate-800'
      }`}
    >
      {/* Cabeçalho */}
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-colors ${
          isDark
            ? 'border-slate-800 bg-slate-950/95 text-white'
            : 'border-slate-200 bg-white/95 text-slate-900 shadow-sm'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className={`rounded-xl border p-2 transition lg:hidden ${
                isDark
                  ? 'border-slate-700 bg-slate-900 text-slate-200'
                  : 'border-slate-200 bg-slate-100 text-slate-700'
              }`}
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
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ backgroundColor: primaryColor }}
              >
                <Utensils className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-black tracking-tight">{branding.app_name}</p>
              <p
                className={`truncate text-xs ${
                  isDark ? 'text-slate-400' : 'text-slate-500 font-medium'
                }`}
              >
                Portal do consumidor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Botão de Alternância Claro / Escuro */}
            <button
              type="button"
              onClick={toggleTheme}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                isDark
                  ? 'border-slate-700 bg-slate-900 text-amber-300 hover:bg-slate-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
              title={isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
              aria-label={isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4 text-slate-600" />}
              <span className="hidden sm:inline">{isDark ? 'Claro' : 'Escuro'}</span>
            </button>

            {/* Status Online */}
            <span
              className={`hidden items-center gap-1 rounded-full border px-2.5 py-1 text-xs sm:flex ${
                online
                  ? isDark
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold'
                  : isDark
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border-amber-200 bg-amber-50 text-amber-700 font-semibold'
              }`}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? 'Online' : 'Offline'}
            </span>

            {/* Botão Instalar PWA */}
            {installPrompt && (
              <button
                type="button"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
                style={{ backgroundColor: primaryColor }}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Instalar</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Conteúdo Principal com Barra Lateral */}
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[260px_1fr]">
        <aside
          className={`${
            menuOpen ? 'block' : 'hidden'
          } fixed inset-x-0 top-16 z-30 border-b p-4 shadow-2xl transition-colors lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-64px)] lg:border-b-0 lg:border-r lg:p-5 lg:shadow-none ${
            isDark
              ? 'border-slate-800 bg-slate-950 text-slate-200'
              : 'border-slate-200 bg-white text-slate-700 shadow-sm'
          }`}
        >
          {/* Card do Usuário Logado */}
          <div
            className={`mb-5 rounded-2xl border p-4 transition ${
              isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50 text-slate-900 shadow-sm'
            }`}
          >
            <p className="truncate font-bold text-sm">{initialData.student.fullName}</p>
            <p className={`mt-0.5 text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Matrícula: {initialData.student.registrationNumber}
            </p>
            <span
              className={`mt-2.5 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                isDark
                  ? 'bg-purple-500/15 text-purple-300'
                  : 'bg-red-50 text-[#C5161D] border border-red-100'
              }`}
            >
              {initialData.student.category.name}
            </span>
          </div>

          {/* Navegação */}
          <nav className="space-y-1" aria-label="Menu do consumidor">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeView(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
                    isActive
                      ? 'text-white shadow-md'
                      : isDark
                      ? 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                  style={isActive ? { backgroundColor: primaryColor } : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Atalho Alterar Senha */}
          <Link
            href="/conta/alterar-senha"
            className={`mt-5 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              isDark
                ? 'border-slate-800 text-slate-400 hover:border-amber-500/40 hover:text-amber-300'
                : 'border-slate-200 text-slate-600 hover:border-amber-400 hover:bg-amber-50/50 hover:text-amber-700'
            }`}
          >
            <KeyRound className="h-4 w-4" />
            Alterar senha
          </Link>

          {/* Sair */}
          <button
            type="button"
            onClick={handleSignOut}
            className={`mt-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              isDark
                ? 'border-slate-800 text-slate-400 hover:border-rose-500/40 hover:text-rose-300'
                : 'border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50/50 hover:text-rose-700'
            }`}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </aside>

        {/* Área Principal de Exibição */}
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

          {/* VIEW: HOME */}
          {view === 'home' && (
            <section className="space-y-6">
              <div>
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Bem-vindo(a),
                </p>
                <h1 className="text-2xl font-black sm:text-3xl tracking-tight">
                  {initialData.student.fullName.split(' ')[0]}
                </h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Acompanhe sua alimentação e sua carteirinha em um só lugar.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {isFinancial && (
                  <button
                    type="button"
                    onClick={() => changeView('wallet')}
                    className={`rounded-3xl border p-5 text-left shadow-lg transition hover:scale-[1.01] ${
                      isDark
                        ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-slate-900 text-white'
                        : 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white text-slate-900 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between text-emerald-600">
                      <WalletCards className="h-6 w-6" />
                      <ChevronRight className="h-5 w-5" />
                    </div>
                    <p
                      className={`mt-5 text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Saldo disponível
                    </p>
                    <p className="mt-1 text-3xl font-black">{formatCurrency(balance)}</p>
                    {lowBalance && (
                      <p className="mt-2 text-xs font-semibold text-amber-500">
                        Saldo abaixo do limite configurado
                      </p>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => changeView('card')}
                  className={`rounded-3xl border p-5 text-left shadow-lg transition hover:scale-[1.01] ${
                    isDark
                      ? 'border-red-500/30 bg-gradient-to-br from-red-500/15 to-slate-900 text-white'
                      : 'border-red-200 bg-gradient-to-br from-red-50/70 via-white to-white text-slate-900 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between text-[#C5161D]">
                    <CreditCard className="h-6 w-6" />
                    <ChevronRight className="h-5 w-5" />
                  </div>
                  <p
                    className={`mt-5 text-xs font-bold uppercase tracking-wider ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    Carteirinha digital
                  </p>
                  <p className="mt-1 text-lg font-black">
                    Identificação rápida no restaurante
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => changeView('meals')}
                  className={`rounded-3xl border p-5 text-left shadow-lg transition hover:scale-[1.01] ${
                    isDark
                      ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-slate-900 text-white'
                      : 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white text-slate-900 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between text-amber-600">
                    <Utensils className="h-6 w-6" />
                    <ChevronRight className="h-5 w-5" />
                  </div>
                  <p
                    className={`mt-5 text-xs font-bold uppercase tracking-wider ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    Última refeição
                  </p>
                  <p className="mt-1 text-lg font-black truncate">
                    {initialData.consumptions[0]?.mealTypeName || 'Nenhum consumo registrado'}
                  </p>
                  {initialData.consumptions[0] && (
                    <p
                      className={`mt-1 text-xs ${
                        isDark ? 'text-slate-400' : 'text-slate-500 font-medium'
                      }`}
                    >
                      {formatDateTime(initialData.consumptions[0].consumedAt)}
                    </p>
                  )}
                </button>
              </div>

              {!isFinancial && (
                <div
                  className={`rounded-3xl border p-5 ${
                    isDark
                      ? 'border-purple-500/30 bg-purple-500/10 text-purple-200'
                      : 'border-purple-200 bg-purple-50 text-purple-950 shadow-sm'
                  }`}
                >
                  <h2 className="font-black text-base">Benefício Integral</h2>
                  <p
                    className={`mt-1 text-sm ${
                      isDark ? 'text-purple-100/80' : 'text-purple-800'
                    }`}
                  >
                    Sua categoria possui gratuidade integral. Saldo e recargas financeiras não
                    são necessários.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* VIEW: WALLET */}
          {view === 'wallet' && isFinancial && (
            <section className="space-y-5">
              <h1 className="text-2xl font-black">Saldo disponível</h1>
              <div
                className={`rounded-3xl border p-6 shadow-md ${
                  isDark
                    ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-slate-900'
                    : 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-slate-900'
                }`}
              >
                <p className={`text-sm ${isDark ? 'text-emerald-200' : 'text-emerald-700 font-bold'}`}>
                  Carteira ativa
                </p>
                <p className="mt-2 text-4xl font-black">{formatCurrency(balance)}</p>
                <button
                  type="button"
                  onClick={() => changeView('recharge')}
                  className="mt-6 rounded-xl px-5 py-3 text-sm font-black text-white shadow-md transition hover:brightness-110"
                  style={{ backgroundColor: primaryColor }}
                >
                  Fazer recarga
                </button>
              </div>
            </section>
          )}

          {/* VIEW: RECHARGE */}
          {view === 'recharge' && isFinancial && (
            <section className="max-w-2xl space-y-5">
              <div>
                <h1 className="text-2xl font-black">Recarga rápida</h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Escolha o valor e a forma de pagamento.
                </p>
              </div>
              <div
                className={`rounded-3xl border p-5 sm:p-6 shadow-md ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="grid grid-cols-4 gap-2">
                  {[10, 20, 30, 50].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setRechargeAmount(String(amount))}
                      className={`rounded-xl border py-2.5 text-sm font-bold transition ${
                        Number(rechargeAmount) === amount
                          ? 'text-white shadow-sm'
                          : isDark
                          ? 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                      style={
                        Number(rechargeAmount) === amount
                          ? { backgroundColor: primaryColor, borderColor: primaryColor }
                          : undefined
                      }
                    >
                      R$ {amount}
                    </button>
                  ))}
                </div>
                <label
                  className={`mt-5 block text-xs font-bold uppercase tracking-wider ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  Outro valor
                </label>
                <input
                  type="number"
                  min="5"
                  max="500"
                  step="0.01"
                  value={rechargeAmount}
                  onChange={(event) => setRechargeAmount(event.target.value)}
                  className={`mt-2 w-full rounded-xl border px-4 py-3 text-lg font-bold outline-none transition ${
                    isDark
                      ? 'border-slate-700 bg-slate-950 text-white focus:border-red-500'
                      : 'border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                  }`}
                />
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRechargeMethod('pix')}
                    className={`rounded-xl border p-3 text-sm font-bold transition ${
                      rechargeMethod === 'pix'
                        ? isDark
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                          : 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : isDark
                        ? 'border-slate-700 text-slate-300'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Pix
                  </button>
                  <button
                    type="button"
                    onClick={() => setRechargeMethod('credit_card')}
                    className={`rounded-xl border p-3 text-sm font-bold transition ${
                      rechargeMethod === 'credit_card'
                        ? isDark
                          ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                          : 'border-amber-500 bg-amber-50 text-amber-800'
                        : isDark
                        ? 'border-slate-700 text-slate-300'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    Cartão
                  </button>
                </div>
                {rechargeMethod === 'credit_card' && (
                  <div
                    className={`mt-4 rounded-xl border p-3.5 text-xs font-medium ${
                      isDark
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    Recarga online via cartão depende da homologação do gateway externo (tokenização segura). Utilize o pagamento via <strong>Pix</strong> ou realize recarga presencial no caixa da unidade.
                  </div>
                )}
                <button
                  type="button"
                  disabled={isPending || !online || rechargeMethod === 'credit_card'}
                  onClick={handleRecharge}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-black text-white shadow-md transition disabled:opacity-50 hover:brightness-110 active:scale-[0.99]"
                  style={{ backgroundColor: primaryColor }}
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
                <div
                  className={`rounded-3xl border p-5 ${
                    isDark
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                      : 'border-cyan-200 bg-cyan-50 text-cyan-900 shadow-sm'
                  }`}
                >
                  <h2 className="font-bold">Pix criado</h2>
                  {pixPayload.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pixPayload.image}
                      alt="QR Code Pix"
                      className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2 shadow"
                    />
                  )}
                  {pixPayload.copyPaste && (
                    <>
                      <textarea
                        readOnly
                        value={pixPayload.copyPaste}
                        className={`mt-4 w-full rounded-xl border p-3 text-xs ${
                          isDark
                            ? 'border-cyan-500/20 bg-slate-950 text-slate-300'
                            : 'border-cyan-200 bg-white text-slate-700'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(pixPayload.copyPaste || '');
                            setPixCopied(true);
                            setTimeout(() => setPixCopied(false), 3000);
                          } catch {
                            setActionError('Não foi possível copiar automaticamente. Selecione e copie o código manualmente.');
                          }
                        }}
                        className="mt-2 rounded-xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-xs font-bold transition hover:bg-cyan-500/30"
                      >
                        {pixCopied ? 'Código Pix copiado!' : 'Copiar código Pix'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {/* VIEW: LEDGER */}
          {view === 'ledger' && isFinancial && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Extrato financeiro</h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Lançamentos imutáveis da sua carteira.
                </p>
              </div>
              <div
                className={`overflow-hidden rounded-3xl border shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                }`}
              >
                {initialData.transactions.length === 0 ? (
                  <p className={`p-6 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Nenhum lançamento encontrado.
                  </p>
                ) : (
                  initialData.transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className={`flex items-center justify-between gap-4 border-b p-4 last:border-0 ${
                        isDark ? 'border-slate-800' : 'border-slate-100 hover:bg-slate-50/50'
                      }`}
                    >
                      <div>
                        <p className="font-bold text-sm">
                          {transactionLabels[transaction.type] || transaction.description}
                        </p>
                        <p
                          className={`mt-0.5 text-xs ${
                            isDark ? 'text-slate-500' : 'text-slate-400'
                          }`}
                        >
                          {formatDateTime(transaction.created_at)} · Saldo após:{' '}
                          {formatCurrency(Number(transaction.balance_after))}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-black text-sm ${
                          Number(transaction.amount) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
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

          {/* VIEW: CARD */}
          {view === 'card' && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Minha carteirinha</h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Apresente sua carteirinha ou informe sua matrícula no terminal.
                </p>
              </div>
              <div className="py-2">
                <ConsumerVirtualCard
                  student={{
                    fullName: initialData.student.fullName,
                    registrationNumber: initialData.student.registrationNumber,
                    course: initialData.student.course,
                    photoPath: currentPhoto || initialData.student.photoPath,
                    institutionName: initialData.student.institutionName,
                    status: initialData.student.status,
                    categoryName: initialData.student.category.name,
                    qrPayload: initialData.student.qrPayload,
                  }}
                  card={initialData.card}
                  balance={initialData.wallet?.balance ?? null}
                  requiresWallet={isFinancial}
                />
              </div>
            </section>
          )}

          {/* VIEW: MEALS */}
          {view === 'meals' && (
            <section className="space-y-5">
              <div>
                <h1 className="text-2xl font-black">Histórico de refeições</h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Consumos registrados nos terminais de atendimento.
                </p>
              </div>
              <div
                className={`overflow-hidden rounded-3xl border shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                }`}
              >
                {initialData.consumptions.length === 0 ? (
                  <p className={`p-6 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Nenhuma refeição encontrada.
                  </p>
                ) : (
                  initialData.consumptions.map((consumption) => (
                    <div
                      key={consumption.id}
                      className={`flex items-center justify-between gap-4 border-b p-4 last:border-0 ${
                        isDark ? 'border-slate-800' : 'border-slate-100 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`rounded-xl p-2 ${
                            isDark
                              ? 'bg-purple-500/10 text-purple-300'
                              : 'bg-red-50 text-[#C5161D]'
                          }`}
                        >
                          <Utensils className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">{consumption.mealTypeName}</p>
                          <p
                            className={`mt-0.5 text-xs ${
                              isDark ? 'text-slate-500' : 'text-slate-400'
                            }`}
                          >
                            {consumption.unitName} · {formatDateTime(consumption.consumedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            consumption.status === 'cancelled_unserved'
                              ? 'bg-rose-500/10 text-rose-500'
                              : 'bg-emerald-500/10 text-emerald-600'
                          }`}
                        >
                          {consumption.status === 'cancelled_unserved'
                            ? 'Cancelada'
                            : 'Confirmada'}
                        </span>
                        {isFinancial && (
                          <p
                            className={`mt-1 text-xs font-bold ${
                              isDark ? 'text-slate-300' : 'text-slate-700'
                            }`}
                          >
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

          {/* VIEW: PROFILE */}
          {view === 'profile' && (
            <section className="max-w-2xl space-y-5">
              <div>
                <h1 className="text-2xl font-black">Meus dados</h1>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Dados acadêmicos são mantidos pela instituição; contatos podem ser atualizados
                  aqui.
                </p>
              </div>

              {/* Foto da Carteirinha e Perfil */}
              <div
                className={`rounded-3xl border p-5 sm:p-6 shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                  <div className="relative group shrink-0">
                    <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border-4 border-white bg-slate-800 text-white shadow-xl ring-2 ring-slate-200">
                      {currentPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={currentPhoto}
                          alt={initialData.student.fullName}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-2xl font-black">
                          {getInitials(initialData.student.fullName)}
                        </span>
                      )}
                    </div>
                    {uploadingPhoto && (
                      <div className="absolute inset-0 grid place-items-center rounded-full bg-black/60 text-white">
                        <RefreshCw className="h-6 w-6 animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 text-center sm:text-left">
                    <h2 className="text-base font-black">Foto da carteirinha</h2>
                    <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      Sua foto é exibida na carteirinha digital e no terminal no momento do consumo.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-50">
                        <Camera className="h-4 w-4" />
                        <span>{uploadingPhoto ? 'Enviando foto...' : 'Alterar foto'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePhotoUpload}
                          disabled={uploadingPhoto}
                          className="hidden"
                        />
                      </label>
                      <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        Formatos JPG, PNG ou WEBP (máx. 5MB)
                      </span>
                    </div>

                    {photoFeedback && (
                      <p
                        className={`mt-2 text-xs font-semibold ${
                          photoFeedback.type === 'success' ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {photoFeedback.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Informações Pessoais */}
              <div
                className={`rounded-3xl border p-5 sm:p-6 shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Nome
                    </label>
                    <p className="mt-1 font-bold text-sm">{initialData.student.fullName}</p>
                  </div>
                  <div>
                    <label
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Matrícula
                    </label>
                    <p className="mt-1 font-mono font-bold text-sm">
                      {initialData.student.registrationNumber}
                    </p>
                  </div>
                  <div>
                    <label
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Instituição
                    </label>
                    <p className="mt-1 font-semibold text-sm">
                      {initialData.student.institutionName}
                    </p>
                  </div>
                  <div>
                    <label
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Categoria
                    </label>
                    <p className="mt-1 font-semibold text-sm">
                      {initialData.student.category.name}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    E-mail
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className={`mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-normal normal-case outline-none transition ${
                        isDark
                          ? 'border-slate-700 bg-slate-950 text-white focus:border-red-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                      }`}
                    />
                  </label>
                  <label
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    Telefone
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className={`mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-normal normal-case outline-none transition ${
                        isDark
                          ? 'border-slate-700 bg-slate-950 text-white focus:border-red-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                      }`}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleSaveContact}
                  disabled={isPending}
                  className="mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-50 hover:brightness-110"
                  style={{ backgroundColor: primaryColor }}
                >
                  Salvar contatos
                </button>
              </div>

              {/* Notificações */}
              <div
                className={`rounded-3xl border p-5 sm:p-6 shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-amber-500" />
                  <h2 className="font-bold text-base">Notificações</h2>
                </div>
                <label className="mt-5 flex items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold">Notificações PWA</span>
                    <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      Recargas, refeições e saldo baixo
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.pushEnabled}
                    onChange={(event) =>
                      void handleNotificationPreference(event.target.checked)
                    }
                    className="h-5 w-5 accent-red-600"
                  />
                </label>
                {isFinancial && (
                  <>
                    <label className="mt-5 flex items-center justify-between gap-4">
                      <span>
                        <span className="block text-sm font-semibold">
                          Aviso de saldo baixo
                        </span>
                        <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
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
                        className="h-5 w-5 accent-red-600"
                      />
                    </label>
                    <label
                      className={`mt-5 block text-xs font-bold uppercase tracking-wider ${
                        isDark ? 'text-slate-400' : 'text-slate-600'
                      }`}
                    >
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
                        className={`mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-normal outline-none transition ${
                          isDark
                            ? 'border-slate-700 bg-slate-950 text-white focus:border-red-500'
                            : 'border-slate-300 bg-white text-slate-900 focus:border-red-600 focus:ring-2 focus:ring-red-100'
                        }`}
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  disabled={isPending}
                  className={`mt-5 flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                    isDark
                      ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Bell className="h-4 w-4" />
                  Salvar preferências
                </button>
              </div>

              {/* Segurança e Troca de Senha */}
              <div
                className={`rounded-3xl border p-5 sm:p-6 shadow-sm ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-amber-500" />
                  <h2 className="font-bold text-base">Segurança de acesso</h2>
                </div>
                <p className={`mt-2 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Altere sua senha pessoal de acesso ao portal do consumidor a qualquer momento.
                </p>
                <div className="mt-5">
                  <Link
                    href="/conta/alterar-senha"
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition shadow-sm ${
                      isDark
                        ? 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-amber-500/50 hover:bg-slate-800 hover:text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-400 hover:bg-amber-50/50 hover:text-amber-800'
                    }`}
                  >
                    <KeyRound className="h-4 w-4 text-amber-500" />
                    Alterar minha senha
                  </Link>
                </div>
              </div>

              {/* Card PWA */}
              <div
                className={`rounded-3xl border p-5 text-sm ${
                  isDark
                    ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-100/80'
                    : 'border-slate-200 bg-slate-100/70 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-cyan-200">
                  <Smartphone className="h-5 w-5 text-[#C5161D]" />
                  Aplicativo instalável
                </div>
                <p className="mt-2 text-xs leading-relaxed">
                  No iPhone, use “Adicionar à Tela de Início” no menu de compartilhamento do Safari.
                  No Android, clique no botão <strong>Instalar</strong> no topo da página.
                </p>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Barra de Navegação Inferior Mobile (PWA) */}
      <nav
        aria-label="Navegação rápida mobile"
        className={`fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t px-2 py-1.5 backdrop-blur-md lg:hidden ${
          isDark
            ? 'border-slate-800 bg-slate-950/95 text-slate-300'
            : 'border-slate-200 bg-white/95 text-slate-600 shadow-[0_-4px_16px_rgba(15,23,42,0.06)]'
        }`}
      >
        {navigation.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => changeView(item.id)}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-bold transition"
              style={active ? { color: primaryColor } : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate max-w-full">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
