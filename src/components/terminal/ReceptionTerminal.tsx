'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Maximize2,
  Minimize2,
  HardDrive,
  ShieldCheck,
  Zap,
  Activity,
  RefreshCw,
  ArrowRight,
  DollarSign,
  Layers,
  FileSpreadsheet,
  ShieldAlert,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Banknote,
  CreditCard,
  QrCode,
  Palette,
} from 'lucide-react';
import { useBrand } from '@/components/branding/BrandProvider';
import { CashShiftModal } from '@/components/terminal/CashShiftModal';
import { ShiftReportsModal } from '@/components/terminal/ShiftReportsModal';
import { cashShiftService } from '@/services/cash-shift.service';
import type { CashShift } from '@/types/cash-shift';
import {
  confirmTerminalMealPayment,
  executeConsumeMeal,
  executeRegisterVisitorEntry,
  generateIdempotencyKey,
  previewTerminalMeal,
} from '@/services/consumption.service';
import type { ConsumeMealResult } from '@/types/consumption';
import { terminalAudio } from '@/lib/offline/audio';
import { requestPersistentStorage, getStorageDiagnostics } from '@/lib/offline/storage-persistence';
import { globalNetworkMonitor } from '@/lib/offline/network-monitor';
import {
  hasPendingUnknownTimeout,
  recordUnknownTimeout,
  getAllPendingTimeouts,
} from '@/lib/offline/timeout-lock';
import type { OperationalState } from '@/types/offline';
import type { ConnectivityState, ConnectivityMetrics } from '@/types/connectivity';

export interface ReceptionTerminalProps {
  tenantId: string;
  unitId: string;
  unitName?: string;
  terminalId?: string;
  operatorId: string;
  operatorName?: string;
  operatorRole?: string;
  mealTypeId: string;
  mealTypeName?: string;
  studentPrice?: number;
  onSignOut?: () => void;
}

interface ActiveDisplayState {
  state: OperationalState;
  student?: {
    name_display: string;
    registration_number: string;
    category_code: string;
    is_integral: boolean;
    estimated_balance?: number;
    photo_path?: string | null;
  };
  attempted_identifier?: string;
  reason_code?: string;
  reason_message?: string;
  timestamp: string;
}

// Códigos que indicam identificador/matrícula não encontrada (não devem inflar estatísticas de bloqueio de alunos)
const NOT_FOUND_REASONS = new Set([
  'STUDENT_NOT_FOUND',
  'STUDENT_NOT_FOUND_OR_TENANT_MISMATCH',
  'INVALID_IDENTIFIER',
  'INVALID_IDENTIFIER_FORMAT',
  'TOKEN_NOT_FOUND',
  'PHYSICAL_CARD_NOT_FOUND',
]);

const isNotFoundError = (code?: string): boolean => {
  if (!code) return false;
  return NOT_FOUND_REASONS.has(code);
};

export function ReceptionTerminal({
  tenantId,
  unitId,
  unitName = 'RU Central',
  terminalId = 'Terminal 01',
  operatorName = 'Operador Caixa',
  operatorRole = 'operator_reception',
  mealTypeId,
  mealTypeName = 'Almoço',
  studentPrice = 3.5,
  onSignOut,
}: ReceptionTerminalProps) {
  const { branding } = useBrand();
  // Estados de Interface e Entrada
  const [inputValue, setInputValue] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeDisplay, setActiveDisplay] = useState<ActiveDisplayState | null>(null);
  const [terminalTheme, setTerminalTheme] = useState<'light' | 'dark'>(branding.terminal_theme);
  const [showKpiValues, setShowKpiValues] = useState<boolean>(branding.terminal_show_kpi_values);
  const [paymentPending, setPaymentPending] = useState<{
    identifier: string;
    preview: ConsumeMealResult;
    idempotencyKey: string;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pix' | 'card'>('cash');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [visitorPaymentPending, setVisitorPaymentPending] = useState<boolean>(false);
  const [visitorPaymentError, setVisitorPaymentError] = useState<string | null>(null);
  const isDark = terminalTheme === 'dark';

  useEffect(() => {
    setTerminalTheme(branding.terminal_theme);
    setShowKpiValues(branding.terminal_show_kpi_values);
  }, [branding.terminal_theme, branding.terminal_show_kpi_values]);

  // Monitor de Conectividade com Histerese (Módulo 10.3)
  const [connectivityState, setConnectivityState] = useState<ConnectivityState>('ONLINE');
  const [networkMetrics, setNetworkMetrics] = useState<ConnectivityMetrics>({
    currentLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    samplesCount: 0,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  });

  // Modo de Contingência Forçada para Testes (Restrito)
  const [forceOfflineMode, setForceOfflineMode] = useState<boolean>(false);
  const canSimulateOffline =
    process.env.NODE_ENV !== 'production' ||
    ['admin_general', 'operations_director'].includes(operatorRole);

  // Métricas do Turno
  const [liberadasCount, setLiberadasCount] = useState<number>(0);
  const [regularesCount, setRegularesCount] = useState<number>(0);
  const [visitantesCount, setVisitantesCount] = useState<number>(0);
  const [visitantesTotalValor, setVisitantesTotalValor] = useState<number>(0);
  const [bloqueadasCount, setBloqueadasCount] = useState<number>(0);
  const [pendingTimeoutsCount, setPendingTimeoutsCount] = useState<number>(0);
  const pendentesQueueCount = 0;
  const isSyncing = false;
  const syncFeedback: string | null = null;

  // Controle de Caixa & PDV
  const [showCashModal, setShowCashModal] = useState<boolean>(false);
  const [activeCashShift, setActiveCashShift] = useState<CashShift | null>(null);
  const [cashShiftChecked, setCashShiftChecked] = useState<boolean>(false);
  const [signOutRequested, setSignOutRequested] = useState<boolean>(false);
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [pixReceived, setPixReceived] = useState<number>(0);
  const [cardReceived, setCardReceived] = useState<number>(0);

  // Relatórios de Refeições e Bloqueios do Turno (F7)
  const [showReportsModal, setShowReportsModal] = useState<boolean>(false);
  const [reportInitialTab, setReportInitialTab] = useState<'approved' | 'blocked'>('approved');

  const loadActiveCashShift = useCallback(async () => {
    if (!unitId || !terminalId) return;
    try {
      const res = await cashShiftService.getActiveShift(unitId, terminalId);
      setActiveCashShift(res.shift);
      const confirmedSales = res.movements.filter(
        (movement) => ['visitor_sale', 'meal_sale'].includes(movement.type) && movement.status !== 'refunded'
      );
      setCashReceived(confirmedSales.filter((movement) => movement.payment_method === 'cash').reduce((sum, movement) => sum + Number(movement.amount), 0));
      setPixReceived(confirmedSales.filter((movement) => movement.payment_method === 'pix').reduce((sum, movement) => sum + Number(movement.amount), 0));
      setCardReceived(confirmedSales.filter((movement) => movement.payment_method === 'card').reduce((sum, movement) => sum + Number(movement.amount), 0));
    } catch {
      // Ignora erro silenciosamente se offline
    } finally {
      setCashShiftChecked(true);
    }
  }, [unitId, terminalId]);

  useEffect(() => {
    loadActiveCashShift();
  }, [loadActiveCashShift]);

  useEffect(() => {
    if (cashShiftChecked && !activeCashShift && !signOutRequested) {
      setShowCashModal(true);
    }
  }, [activeCashShift, cashShiftChecked, signOutRequested]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!activeCashShift) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [activeCashShift]);

  // Diagnóstico e Persistência
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [storageInfo, setStorageInfo] = useState<{ persisted: boolean; quotaMb?: number; usageMb?: number }>({
    persisted: false,
  });

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Refs de controle de buffer e timer
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBipRef = useRef<{ code: string; timestamp: number } | null>(null);

  // 1. Manter foco absoluto no campo de scanner/digitação
  const keepFocus = useCallback(() => {
    if (!paymentPending && !visitorPaymentPending && !showCashModal && activeCashShift && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeCashShift, paymentPending, visitorPaymentPending, showCashModal]);

  useEffect(() => {
    keepFocus();
    const interval = setInterval(keepFocus, 1000);
    return () => clearInterval(interval);
  }, [keepFocus]);

  // A fonte de verdade do MVP e online-first/fail-safe. Eventos legados de
  // contingencia permanecem apenas para auditoria e nao sao sincronizados pela UI.
  const handleTriggerSync = useCallback(() => undefined, []);

  useEffect(() => {
    setPendingTimeoutsCount(getAllPendingTimeouts().length);
  }, []);

  // 3. Monitor de Conectividade com Histerese e Telemetria
  useEffect(() => {
    // Iniciar probe do network monitor
    globalNetworkMonitor.start(5000);

    const unsubscribe = globalNetworkMonitor.subscribe((state, metrics) => {
      setConnectivityState(state);
      setNetworkMetrics(metrics);
    });

    // Diagnóstico inicial de storage persistente
    getStorageDiagnostics().then((diag) => {
      setStorageInfo({
        persisted: diag.persisted,
        quotaMb: diag.quotaMb,
        usageMb: diag.usageMb,
      });
    });

    return () => {
      unsubscribe();
      globalNetworkMonitor.stop();
    };
  }, []);

  const clearActiveDisplay = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setActiveDisplay(null);
    setInputValue('');
    keepFocus();
  }, [keepFocus]);

  // 4. Atalhos de Teclado Operacionais (F2 Fullscreen, F4 Visitante, F8 Diagnósticos, ESC Limpar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setVisitorPaymentError(null);
        setVisitorPaymentPending(true);
      } else if (e.key === 'F7') {
        e.preventDefault();
        setShowReportsModal((prev) => !prev);
      } else if (e.key === 'F8') {
        e.preventDefault();
        setShowDiagnostics((prev) => !prev);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setShowCashModal((prev) => activeCashShift ? !prev : true);
      } else if (e.key === 'Escape') {
        clearActiveDisplay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // O atalho F4 usa o handler do mesmo ciclo de renderização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearActiveDisplay]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // 5. Agendador do Auto-Reset (1.5 segundos)
  const scheduleAutoReset = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setActiveDisplay(null);
      setInputValue('');
      keepFocus();
    }, 1500);
  };

  // 6. Processamento da Matrícula / Scanner USB
  const handleProcessIdentifier = async (rawIdentifier: string) => {
    const cleanId = rawIdentifier.trim();
    if (!cleanId || isProcessing) return;
    if (!activeCashShift) {
      setShowCashModal(true);
      return;
    }

    // Proteção Anti-Rebound (Evita duplo bip acidental do mesmo código em menos de 1,5s)
    const now = Date.now();
    if (lastBipRef.current && lastBipRef.current.code === cleanId && now - lastBipRef.current.timestamp < 1500) {
      return;
    }
    lastBipRef.current = { code: cleanId, timestamp: now };

    setIsProcessing(true);
    setInputValue('');

    const todayDate = new Date().toISOString().split('T')[0];

    // =========================================================================
    // REGRA DE OURO (MÓDULO 10.3): BLOQUEIO DE TIMEOUT PENDENTE
    // Se o estudante possui transação remota indeterminada de hoje, bloqueia nova liberação
    // =========================================================================
    if (hasPendingUnknownTimeout(cleanId, mealTypeId, todayDate)) {
      terminalAudio.playTimeoutSound();
      setBloqueadasCount((prev) => prev + 1);
      setActiveDisplay({
        state: 'REMOTE_UNKNOWN_TIMEOUT',
        reason_code: 'TIMEOUT_LOCK_ACTIVE',
        reason_message: 'Operação anterior com resultado pendente no servidor. Bloqueio preventivo de duplicidade ativo.',
        timestamp: new Date().toLocaleTimeString(),
      });
      scheduleAutoReset();
      setIsProcessing(false);
      return;
    }

    // Determina se deve tentar online com base na máquina de estados com histerese
    const effectiveOnline =
      (connectivityState === 'ONLINE' || connectivityState === 'DEGRADED') && !forceOfflineMode;

    if (effectiveOnline) {
      // ==========================================
      // FLUXO A: TENTATIVA ONLINE CENTRALIZADA
      // ==========================================
      const idempotencyKey = generateIdempotencyKey(unitId, terminalId);

      try {
        // Pré-validação sem efeito colateral: integrais seguem em liberação automática;
        // categorias pagantes abrem a etapa de recebimento antes do COMMIT.
        const preview = await previewTerminalMeal({
          unit_id: unitId,
          identifier: cleanId,
          meal_type_id: mealTypeId,
          terminal_id: terminalId,
        });

        if (!preview.success) {
          if (preview.error_code === 'CLIENT_ERROR') {
            throw new Error(preview.message || 'Falha ao consultar a pre-validacao remota.');
          }

          terminalAudio.playBlockedSound();
          if (!isNotFoundError(preview.error_code)) {
            setBloqueadasCount((prev) => prev + 1);
          }
          setActiveDisplay({
            state: 'BLOCKED',
            student: preview.student
              ? {
                  name_display: preview.student.full_name,
                  registration_number: preview.student.registration_number,
                  category_code: preview.student.category_code,
                  is_integral: preview.student.is_integral,
                  photo_path: preview.student.photo_path,
                }
              : undefined,
            attempted_identifier: cleanId,
            reason_code: preview.error_code || 'BLOCKED',
            reason_message: preview.message || 'Identificacao nao autorizada.',
            timestamp: new Date().toLocaleTimeString(),
          });
          setIsProcessing(false);
          scheduleAutoReset();
          return;
        }

        if (
          preview.student &&
          (preview.payment_mode === 'on_entry' || preview.requires_counter_payment) &&
          !preview.student.is_integral &&
          Number(preview.financial?.student_price || 0) > 0
        ) {
          const defaultMethod = 'cash' as const;
          setPaymentMethod(defaultMethod);
          setAmountReceived(
            defaultMethod === 'cash' ? Number(preview.financial?.student_price || 0).toFixed(2) : ''
          );
          setPaymentError(null);
          setPaymentPending({ identifier: cleanId, preview, idempotencyKey });
          setIsProcessing(false);
          return;
        }

        const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
          setTimeout(() => resolve({ isTimeout: true }), 2500)
        );

        const rpcPromise = executeConsumeMeal({
          unit_id: unitId,
          identifier: cleanId,
          meal_type_id: mealTypeId,
          terminal_id: terminalId,
          idempotency_key: idempotencyKey,
        });

        const raceResult = await Promise.race([rpcPromise, timeoutPromise]);

        if ('isTimeout' in raceResult) {
          // Timeout de rede -> Bloqueia novas passagens e classifica como REMOTE_UNKNOWN_TIMEOUT
          recordUnknownTimeout({
            identifier: cleanId,
            mealTypeId,
            consumptionDate: todayDate,
            idempotencyKey,
            terminalId,
            unitId,
            timeoutAt: new Date().toISOString(),
          });
          setPendingTimeoutsCount(getAllPendingTimeouts().length);

          terminalAudio.playTimeoutSound();
          setBloqueadasCount((prev) => prev + 1);
          setActiveDisplay({
            state: 'REMOTE_UNKNOWN_TIMEOUT',
            reason_code: 'NETWORK_TIMEOUT',
            reason_message: 'Tempo limite da chamada remota excedido. Operação retida para evitar duplicação.',
            timestamp: new Date().toLocaleTimeString(),
          });
          scheduleAutoReset();
          setIsProcessing(false);
          return;
        }

        const res = raceResult;

        if (res.success && res.student) {
          // 🟢 LIBERADO ONLINE
          terminalAudio.playSuccessSound();
          if (res.student.category_code === 'visitante') {
            setVisitantesCount((prev) => prev + 1);
            setVisitantesTotalValor((prev) => prev + (res.financial?.charged_amount || studentPrice || 0));
          } else {
            setRegularesCount((prev) => prev + 1);
          }
          setLiberadasCount((prev) => prev + 1);
          setActiveDisplay({
            state: 'ONLINE_CONFIRMED',
            student: {
              name_display: res.student.full_name,
              registration_number: res.student.registration_number,
              category_code: res.student.category_code,
              is_integral: res.student.is_integral,
              estimated_balance: res.financial?.balance_remaining ?? undefined,
              photo_path: res.student.photo_path,
            },
            timestamp: new Date().toLocaleTimeString(),
          });
        } else if (
          ['INSUFFICIENT_FUNDS', 'WALLET_NOT_FOUND'].includes(res.error_code || '') &&
          preview.student &&
          Number(preview.financial?.student_price || 0) > 0
        ) {
          setPaymentMethod('cash');
          setAmountReceived(Number(preview.financial?.student_price || 0).toFixed(2));
          setPaymentError('Saldo insuficiente. Receba o pagamento ou oriente a recarga do cartão.');
          setPaymentPending({ identifier: cleanId, preview, idempotencyKey });
          setIsProcessing(false);
          return;
        } else {
          // 🔴 NÃO LIBERADO
          terminalAudio.playBlockedSound();
          if (!isNotFoundError(res.error_code)) {
            setBloqueadasCount((prev) => prev + 1);
          }
          setActiveDisplay({
            state: 'BLOCKED',
            student: res.student
              ? {
                  name_display: res.student.full_name,
                  registration_number: res.student.registration_number,
                  category_code: res.student.category_code,
                  is_integral: res.student.is_integral,
                  photo_path: res.student.photo_path,
                }
              : undefined,
            attempted_identifier: cleanId,
            reason_code: res.error_code || 'BLOCKED',
            reason_message: res.message || 'Consumo não autorizado.',
            timestamp: new Date().toLocaleTimeString(),
          });
        }
      } catch {
        // Falha de conexão imediata: fail-safe, sem autorização local.
        blockWhenBackendUnavailable(cleanId);
      }
    } else {
      blockWhenBackendUnavailable(cleanId);
    }

    setIsProcessing(false);
    scheduleAutoReset();
  };

  const blockWhenBackendUnavailable = (cleanId: string) => {
    terminalAudio.playBlockedSound();
    setBloqueadasCount((previous) => previous + 1);
    setActiveDisplay({
      state: 'BLOCKED',
      attempted_identifier: cleanId,
      reason_code: 'SYSTEM_UNAVAILABLE',
      reason_message: 'Sistema temporariamente indisponível. A refeição não foi liberada nem cobrada.',
      timestamp: new Date().toLocaleTimeString(),
    });
  };

  // Liberação direta de 1 refeição avulsa de visitante paga na entrada (sem necessidade de saldo)
  const handleRegisterVisitorDirect = async (visitorPaymentMethod: 'cash' | 'pix' | 'card') => {
    if (isProcessing) return;
    if (!activeCashShift) {
      setVisitorPaymentPending(false);
      setVisitorPaymentError(null);
      setShowCashModal(true);
      return;
    }
    setIsProcessing(true);
    setVisitorPaymentError(null);
    setInputValue('');

    try {
      const res = await executeRegisterVisitorEntry({
        unitId,
        mealTypeId,
        terminalId,
        paymentMethod: visitorPaymentMethod,
      });

      if (res.success && res.student) {
        terminalAudio.playSuccessSound();
        const charged = res.financial?.charged_amount ?? res.financial?.total_price ?? studentPrice ?? 6.0;
        setVisitantesCount((prev) => prev + 1);
        setVisitantesTotalValor((prev) => prev + charged);
        setLiberadasCount((prev) => prev + 1);
        setVisitorPaymentPending(false);
        setVisitorPaymentError(null);
        loadActiveCashShift();
        setActiveDisplay({
          state: 'ONLINE_CONFIRMED',
          student: {
            name_display: res.student.full_name || 'Visitante Avulso (Entrada)',
            registration_number: res.student.registration_number || 'VISITANTE',
            category_code: 'visitante',
            is_integral: true,
            photo_path: null,
          },
          timestamp: new Date().toLocaleTimeString(),
        });
        setIsProcessing(false);
        scheduleAutoReset();
        return;
      } else {
        terminalAudio.playBlockedSound();
        setVisitorPaymentError(res.message || 'Falha ao registrar entrada de visitante.');
      }
    } catch (err) {
      terminalAudio.playBlockedSound();
      setVisitorPaymentError((err as Error).message || 'Falha inesperada ao registrar o pagamento do visitante.');
    }

    setIsProcessing(false);
  };

  const handleConfirmPayment = async () => {
    if (!paymentPending || isProcessing) return;
    const charged = Number(paymentPending.preview.financial?.student_price || 0);
    const received = paymentMethod === 'cash' ? Number(amountReceived.replace(',', '.')) : charged;
    if (paymentMethod === 'cash' && (!Number.isFinite(received) || received < charged)) {
      setPaymentError('O valor recebido deve ser igual ou maior que o valor cobrado.');
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);
    const result = await confirmTerminalMealPayment({
      unit_id: unitId,
      identifier: paymentPending.identifier,
      meal_type_id: mealTypeId,
      terminal_id: terminalId,
      idempotency_key: paymentPending.idempotencyKey,
      payment_method: paymentMethod,
      amount_received: received,
    });

    if (result.success && result.student) {
      terminalAudio.playSuccessSound();
      setLiberadasCount((previous) => previous + 1);
      setRegularesCount((previous) => previous + 1);
      setActiveDisplay({
        state: 'ONLINE_CONFIRMED',
        student: {
          name_display: result.student.full_name,
          registration_number: result.student.registration_number,
          category_code: result.student.category_code,
          is_integral: result.student.is_integral,
          estimated_balance: result.financial?.balance_remaining ?? undefined,
          photo_path: result.student.photo_path,
        },
        timestamp: new Date().toLocaleTimeString(),
      });
      setPaymentPending(null);
      await loadActiveCashShift();
      scheduleAutoReset();
    } else {
      terminalAudio.playBlockedSound();
      setPaymentError(result.message || 'Não foi possível confirmar o pagamento e liberar a refeição.');
    }
    setIsProcessing(false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      handleProcessIdentifier(inputValue);
    }
  };

  const handleOperatorSignOutRequest = useCallback(() => {
    if (activeCashShift) {
      setSignOutRequested(true);
      setShowCashModal(true);
      return;
    }
    onSignOut?.();
  }, [activeCashShift, onSignOut]);

  const handleShiftStatusChange = useCallback((shift: CashShift | null) => {
    setActiveCashShift(shift);
    if (!shift && signOutRequested) {
      setSignOutRequested(false);
      setShowCashModal(false);
      onSignOut?.();
    }
  }, [onSignOut, signOutRequested]);

  return (
    <div
      onClick={keepFocus}
      style={{
        '--terminal-primary-local': branding.terminal_primary_color,
        '--terminal-accent-local': branding.terminal_accent_color,
        '--terminal-surface-local': branding.terminal_surface_color,
      } as React.CSSProperties}
      className={`h-dvh min-h-0 w-full flex flex-col overflow-hidden select-none transition-colors duration-300 ${isDark ? 'terminal-theme-dark' : 'terminal-theme-light terminal-light-surface'} ${
        isDark
          ? activeDisplay?.state === 'ONLINE_CONFIRMED'
            ? 'bg-emerald-950/40 text-emerald-100'
            : activeDisplay?.state === 'OFFLINE_CONTINGENCY_LOGGED'
            ? 'bg-amber-950/40 text-amber-100'
            : activeDisplay?.state === 'REMOTE_UNKNOWN_TIMEOUT'
            ? 'bg-orange-950/40 text-orange-100'
            : activeDisplay?.state === 'BLOCKED'
            ? 'bg-red-950/50 text-red-100'
            : 'bg-slate-950 text-slate-100'
          : 'bg-white text-slate-900'
      }`}
    >
      {/* 1. BARRA SUPERIOR (HEADER INTEGRADO COM MÁQUINA DE ESTADOS) */}
      <header className={`grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 backdrop-blur-md md:px-6 ${isDark ? 'border-white/10 bg-slate-950/95' : 'border-slate-200 bg-white/95 shadow-sm'}`}>
        <div className="flex min-w-0 items-center gap-3">
          {branding.logo_url ? (
            <img /* eslint-disable-line @next/next/no-img-element */ src={branding.logo_url} alt={branding.app_name} className="h-12 w-20 object-contain" />
          ) : (
            <div className="grid h-12 w-16 place-items-center rounded-xl text-sm font-black text-white" style={{ backgroundColor: branding.terminal_primary_color }}>MA</div>
          )}
          <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black tracking-wider" style={{ color: branding.terminal_primary_color }}>{branding.app_name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-md font-mono ${isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
              {unitName} · {terminalId} · {mealTypeName}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-slate-400">Operador: {operatorName}</p>
            {onSignOut && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOperatorSignOutRequest();
                }}
                className="text-[11px] text-sky-400/80 hover:text-sky-300 underline cursor-pointer ml-1"
                title="Encerrar turno e trocar operador autenticado"
              >
                ({activeCashShift ? 'Fechar caixa e sair' : 'Trocar Operador'})
              </button>
            )}
          </div>
          </div>
        </div>

        {/* Status de Conexão com Histerese (5 Estados) */}
        <div className="terminal-scrollbar-hidden flex max-w-[64vw] flex-nowrap items-center gap-2.5 overflow-x-auto">
          {/* Botão de Caixa / PDV (F9) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCashModal(true);
            }}
            className={`text-xs px-3 py-1 rounded-full border transition-all cursor-pointer flex items-center gap-1.5 ${
              activeCashShift
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold hover:bg-emerald-500/25'
                : 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold hover:bg-amber-500/30 animate-pulse'
            }`}
            title="Abrir controle de caixa e turno do PDV (F9)"
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>
              {activeCashShift
                ? `Caixa: R$ ${Number(activeCashShift.expected_cash_balance ?? activeCashShift.system_expected_balance ?? 0).toFixed(2)}`
                : 'Abrir Caixa (F9)'}
            </span>
          </button>

          {['admin_general', 'operations_director', 'unit_manager', 'supervisor', 'finance'].includes(operatorRole) && (
            <Link
              href="/admin/caixa"
              onClick={(e) => e.stopPropagation()}
              className="text-xs px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
              title="Auditoria e Histórico de Fechamentos de Caixa"
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>Auditoria Caixas</span>
            </Link>
          )}

          {['admin_general', 'operations_director', 'unit_manager', 'supervisor'].includes(operatorRole) && (
            <Link
              href="/admin/categorias"
              onClick={(e) => e.stopPropagation()}
              className="text-xs px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 hover:border-sky-500 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
              title="Gerenciar Categorias, Regras de Preço e Subsídios"
            >
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Categorias</span>
            </Link>
          )}

          {/* Toggle de Simulação de Contingência (Permissão Restrita) */}
          {canSimulateOffline && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setForceOfflineMode(!forceOfflineMode);
              }}
              title="Alternar Modo Offline para testes e simulações operacionais"
              className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer flex items-center gap-1.5 ${
                forceOfflineMode
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{forceOfflineMode ? 'Modo Offline' : 'Auto Rede'}</span>
            </button>
          )}

          {/* Badge Trimodal dos 5 Estados de Conectividade */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all ${
              forceOfflineMode
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                : connectivityState === 'ONLINE'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                : connectivityState === 'DEGRADED'
                ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300'
                : connectivityState === 'RECOVERING'
                ? 'bg-sky-500/10 border-sky-500/40 text-sky-300 animate-pulse'
                : connectivityState === 'SYNCING'
                ? 'bg-purple-500/10 border-purple-500/40 text-purple-300 animate-pulse'
                : 'bg-red-500/10 border-red-500/40 text-red-400'
            }`}
          >
            {forceOfflineMode ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>OFFLINE</span>
              </>
            ) : connectivityState === 'ONLINE' ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>ONLINE · {networkMetrics.p50LatencyMs || 25}ms</span>
              </>
            ) : connectivityState === 'DEGRADED' ? (
              <>
                <Activity className="w-3.5 h-3.5" />
                <span>INSTÁVEL ({networkMetrics.currentLatencyMs}ms)</span>
              </>
            ) : connectivityState === 'RECOVERING' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>ESTABILIZANDO ({networkMetrics.consecutiveSuccesses}/3)</span>
              </>
            ) : connectivityState === 'SYNCING' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>SINCRONIZANDO FILA</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>OFFLINE</span>
              </>
            )}
          </div>

          {operatorRole === 'admin_general' && (
            <Link
              href="/admin/identidade"
              onClick={(e) => e.stopPropagation()}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1.5 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-600 hover:border-red-400'}`}
              title="Configurar logomarca, cores e tema do terminal"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Identidade</span>
            </Link>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              setTerminalTheme(isDark ? 'light' : 'dark');
            }}
            className={`p-1.5 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-amber-300' : 'bg-white border-slate-300 text-slate-600'}`}
            title={isDark ? 'Usar tema claro' : 'Usar tema escuro'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Botão Fullscreen */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Tela Cheia (F2)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 2. ÁREA CENTRAL DE ATENDIMENTO CONTÍNUO */}
      <main className="terminal-scrollbar-hidden min-h-0 flex-1 overflow-y-auto flex flex-col items-center justify-center p-4 md:p-6 text-center max-w-4xl mx-auto w-full">
        {/* ESTADO A: AGUARDANDO MATRÍCULA (TELA PADRÃO) */}
        {!activeDisplay && (
          <div className="w-full max-w-xl flex flex-col items-center space-y-6 animate-in fade-in duration-200">
            <div className="w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center shadow-lg animate-pulse" style={{ borderColor: `${branding.terminal_primary_color}66`, backgroundColor: `${branding.terminal_primary_color}0D` }}>
              <Zap className="w-8 h-8" style={{ color: branding.terminal_primary_color }} />
            </div>

            <div>
              <h2 className={`text-3xl md:text-4xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Aguardando Identificação
              </h2>
              <p className="text-sm md:text-base text-slate-400 font-light mt-1">
                Aproxime o cartão no leitor USB ou digite a matrícula/código:
              </p>
            </div>

            {/* FORMULÁRIO VISÍVEL COM CAMPO DE DIGITAÇÃO / SCANNER */}
            <form onSubmit={handleFormSubmit} className="w-full space-y-3">
              <div className="relative flex items-center">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                  disabled={isProcessing}
                  placeholder="DIGITE A MATRÍCULA OU CÓDIGO"
                  autoFocus
                  className={`w-full border-2 text-center font-mono text-xl sm:text-2xl font-bold tracking-widest placeholder:text-slate-400 rounded-2xl py-4 px-6 shadow-lg transition-all outline-none ${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}
                  style={{ borderColor: `${branding.terminal_primary_color}99` }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="submit"
                  disabled={isProcessing || !inputValue.trim()}
                  className="sm:col-span-2 py-3.5 px-6 rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-wider shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                  style={{ backgroundColor: branding.terminal_primary_color }}
                >
                  <span>{isProcessing ? 'Processando...' : 'Liberar Refeição (Enter)'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVisitorPaymentError(null);
                    setVisitorPaymentPending(true);
                  }}
                  disabled={isProcessing}
                  className="py-3.5 px-4 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-purple-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer border border-purple-400/30"
                  title="Liberar refeição avulsa de visitante paga na hora na entrada (Atalho F4)"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>Visitante (F4)</span>
                </button>
              </div>
            </form>

            {/* Sugestões Rápidas de Homologação */}
            <div className="hidden w-full pt-2 border-t border-slate-800/80">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Atalhos rápidos para teste de homologação:
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('RA900001');
                    handleProcessIdentifier('RA900001');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-mono cursor-pointer transition-all"
                  title="Bolsista Integral (R$ 0,00)"
                >
                  RA900001 (Bolsista)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('RA900002');
                    handleProcessIdentifier('RA900002');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-mono cursor-pointer transition-all"
                  title="Comensal Pagante com Saldo R$ 50"
                >
                  RA900002 (Saldo R$50)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('VISITANTE01');
                    handleProcessIdentifier('VISITANTE01');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-mono cursor-pointer transition-all"
                  title="Visitante (Multi-refeição sem trava de duplicidade - Valor integral)"
                >
                  VISITANTE01 (Multi-Refeição)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('RA100001');
                    handleProcessIdentifier('RA100001');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-mono cursor-pointer transition-all"
                  title="Já Consumiu Hoje"
                >
                  RA100001 (Duplicado)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('RA101451');
                    handleProcessIdentifier('RA101451');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-mono cursor-pointer transition-all"
                  title="Saldo Insuficiente R$ 1,00"
                >
                  RA101451 (Sem Saldo)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('RA101481');
                    handleProcessIdentifier('RA101481');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-mono cursor-pointer transition-all"
                  title="Matrícula Suspensa"
                >
                  RA101481 (Suspenso)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Leitor USB / Teclado pronto para recepção contínua</span>
            </div>
          </div>
        )}

        {/* ESTADO B: LIBERADO ONLINE (VERDE) */}
        {activeDisplay?.state === 'ONLINE_CONFIRMED' && (
          <div className="terminal-status-card terminal-status-success w-full p-8 md:p-12 rounded-3xl bg-emerald-900/60 border-2 border-emerald-400 shadow-[0_0_80px_rgba(16,185,129,0.3)] flex flex-col items-center space-y-6 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 font-black text-sm tracking-widest border border-emerald-400/40 uppercase">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>LIBERADO ONLINE</span>
            </div>

            <div className="flex flex-col items-center space-y-2">
              <h2 className="text-3xl md:text-5xl font-black text-white">
                {activeDisplay.student?.name_display}
              </h2>
              <p className="text-xl font-mono text-emerald-200 font-bold">
                Identificação: {activeDisplay.student?.registration_number}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <span
                className={`px-4 py-1.5 rounded-xl font-extrabold text-sm uppercase ${
                  activeDisplay.student?.is_integral
                    ? 'bg-emerald-500 text-slate-950 shadow-lg'
                    : 'bg-white/10 text-emerald-200 border border-emerald-400/30'
                }`}
              >
                {activeDisplay.student?.category_code}
              </span>
              {activeDisplay.student?.estimated_balance !== undefined && (
                <span className="px-4 py-1.5 rounded-xl bg-black/40 border border-emerald-400/30 font-mono text-emerald-300 text-sm font-bold">
                  Saldo: R$ {activeDisplay.student.estimated_balance.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ESTADO C: LIBERADO EM CONTINGÊNCIA OFFLINE (AMARELO / ÂMBAR) */}
        {activeDisplay?.state === 'OFFLINE_CONTINGENCY_LOGGED' && (
          <div className="terminal-status-card terminal-status-warning w-full p-8 md:p-12 rounded-3xl bg-amber-900/60 border-2 border-amber-400 shadow-[0_0_80px_rgba(245,158,11,0.3)] flex flex-col items-center space-y-6 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-amber-500/20 text-amber-300 font-black text-sm tracking-widest border border-amber-400/40 uppercase">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span>LIBERADO EM CONTINGÊNCIA (OFFLINE)</span>
            </div>

            <div className="flex flex-col items-center space-y-2">
              <h2 className="text-3xl md:text-5xl font-black text-white">
                {activeDisplay.student?.name_display}
              </h2>
              <p className="text-xl font-mono text-amber-200 font-bold">
                Identificação: {activeDisplay.student?.registration_number}
              </p>
            </div>

            <p className="text-xs text-amber-300 bg-black/40 px-3 py-1.5 rounded-lg border border-amber-500/30">
              ⚠️ Registro provisório salvo na fila criptografada local. Reconciliação central pendente.
            </p>
          </div>
        )}

        {/* ESTADO D: TIMEOUT DE REDE (LARANJA ALERTA) */}
        {activeDisplay?.state === 'REMOTE_UNKNOWN_TIMEOUT' && (
          <div className="terminal-status-card terminal-status-timeout w-full p-8 md:p-12 rounded-3xl bg-orange-950/70 border-2 border-orange-500 shadow-[0_0_80px_rgba(249,115,22,0.3)] flex flex-col items-center space-y-6 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-orange-500/20 text-orange-300 font-black text-sm tracking-widest border border-orange-500/40 uppercase">
              <Clock className="w-5 h-5 text-orange-400" />
              <span>TIMEOUT DE REDE — ESTADO INCERTO</span>
            </div>

            <h2 className="text-2xl md:text-4xl font-black text-white max-w-lg">
              {activeDisplay.reason_message}
            </h2>

            <p className="text-sm text-orange-200 bg-black/50 px-4 py-2 rounded-xl border border-orange-500/40">
              Trava de segurança ativa: não realize uma segunda liberação sem confirmação.
            </p>
          </div>
        )}

        {/* ESTADO E: NÃO LIBERADO / BLOQUEADO (VERMELHO) */}
        {activeDisplay?.state === 'BLOCKED' && (
          <div className="terminal-status-card terminal-status-error w-full p-8 md:p-12 rounded-3xl bg-red-950/70 border-2 border-red-500 shadow-[0_0_80px_rgba(239,68,68,0.3)] flex flex-col items-center space-y-6 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-red-500/20 text-red-300 font-black text-sm tracking-widest border border-red-500/40 uppercase">
              <XCircle className="w-5 h-5 text-red-400" />
              <span>NÃO LIBERADO</span>
            </div>

            {/* Identificação do Usuário com Nome em Destaque */}
            <div className="flex flex-col items-center space-y-2">
              <h2 className="text-3xl md:text-5xl font-black text-white">
                {activeDisplay.student?.name_display || (
                  <span className="text-slate-300 font-mono text-2xl md:text-4xl">
                    Identificação: {activeDisplay.attempted_identifier || 'Não Cadastrado'}
                  </span>
                )}
              </h2>
              {activeDisplay.student && (
                <div className="flex items-center gap-2 text-red-200 font-mono text-base font-semibold">
                  <span>Matrícula: {activeDisplay.student.registration_number}</span>
                  {activeDisplay.student.category_code && (
                    <>
                      <span>&bull;</span>
                      <span className="uppercase text-xs px-2.5 py-0.5 rounded-full bg-red-900/60 border border-red-500/40">
                        {activeDisplay.student.category_code}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Motivo do Bloqueio em Destaque Amigável */}
            <div className="bg-black/60 border border-red-500/40 rounded-2xl px-6 py-4 max-w-lg w-full text-center space-y-1 shadow-2xl">
              <p className="text-xs font-bold uppercase tracking-wider text-red-400">Motivo do Bloqueio</p>
              <p className="text-lg md:text-xl font-bold text-red-100">
                {activeDisplay.reason_message || 'Consumo não autorizado.'}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* 3. BARRA INFERIOR (MÉTRICAS DO TURNO E ATALHOS) */}
      <footer className={`grid w-full shrink-0 gap-2 border-t px-4 py-3 backdrop-blur-md md:px-6 ${isDark ? 'border-white/10 bg-slate-950/95' : 'border-slate-200 bg-slate-50/95 shadow-[0_-8px_24px_rgba(15,23,42,0.06)]'}`}>
        <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Refeições liberadas', value: String(liberadasCount), financial: false },
            { label: 'Dinheiro em caixa', value: `R$ ${cashReceived.toFixed(2)}`, financial: true },
            { label: 'PIX recebido', value: `R$ ${pixReceived.toFixed(2)}`, financial: true },
            { label: 'Total recebido', value: `R$ ${(cashReceived + pixReceived + cardReceived).toFixed(2)}`, financial: true },
          ].map((kpi) => (
            <div key={kpi.label} className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white shadow-sm'}`} style={kpi.label === 'Total recebido' ? { backgroundColor: branding.terminal_accent_color, color: '#3F2F00', borderColor: branding.terminal_accent_color } : undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider opacity-60">{kpi.label}</span>
                {kpi.financial && kpi.label === 'Total recebido' && (
                  <button type="button" onClick={(event) => { event.stopPropagation(); setShowKpiValues((current) => !current); }} className="rounded-lg p-1 hover:bg-black/10" title={showKpiValues ? 'Ocultar valores' : 'Mostrar valores'}>
                    {showKpiValues ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-lg md:text-xl font-black">{kpi.financial && !showKpiValues ? '••••••' : kpi.value}</p>
            </div>
          ))}
        </div>
        {/* Contadores da Operação no Turno (Clicáveis para Relatórios) */}
        <div className="grid w-full grid-cols-3 items-center gap-2 border-t border-slate-200/70 pt-2 text-center md:grid-cols-6 dark:border-white/10 [&>.h-8]:hidden">
          {/* Total Refeições Liberadas */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReportInitialTab('approved');
              setShowReportsModal(true);
            }}
            className="p-1.5 -m-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer text-center sm:text-left group"
            title="Clique para ver o relatório detalhado de refeições aprovadas"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-2xl md:text-3xl font-black text-emerald-400 group-hover:scale-105 transition-transform">
                {liberadasCount}
              </span>
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400/60 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold group-hover:text-emerald-300 transition-colors">
              Total Refeições
            </p>
          </button>

          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* Regulares (Estudantes / Servidores) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReportInitialTab('approved');
              setShowReportsModal(true);
            }}
            className="p-1.5 -m-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer text-center sm:text-left group"
            title="Clique para ver o relatório de refeições de alunos/servidores"
          >
            <span className="text-2xl md:text-3xl font-black text-sky-400 group-hover:scale-105 transition-transform">
              {regularesCount}
            </span>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold group-hover:text-sky-300 transition-colors">
              Regulares
            </p>
          </button>

          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* Visitantes no Turno (Qtd + R$ Arrecadado) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReportInitialTab('approved');
              setShowReportsModal(true);
            }}
            className="p-1.5 -m-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer text-center sm:text-left group"
            title="Clique para ver refeições de visitantes e vendas de PDV"
          >
            <div className="flex items-baseline gap-1.5 justify-center sm:justify-start">
              <span className="text-2xl md:text-3xl font-black text-amber-400 group-hover:scale-105 transition-transform">
                {visitantesCount}
              </span>
              <span className="text-xs font-bold text-amber-300/90 font-mono">
                (R$ {visitantesTotalValor.toFixed(2)})
              </span>
            </div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold group-hover:text-amber-300 transition-colors">
              Visitantes (PDV)
            </p>
          </button>

          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* Bloqueadas */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReportInitialTab('blocked');
              setShowReportsModal(true);
            }}
            className="p-1.5 -m-1.5 rounded-xl hover:bg-rose-500/10 transition cursor-pointer text-center sm:text-left group"
            title="Clique para ver o relatório de bloqueios e motivos"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-2xl md:text-3xl font-black text-red-400 group-hover:scale-105 transition-transform">
                {bloqueadasCount}
              </span>
              <ShieldAlert className="w-3.5 h-3.5 text-red-400/60 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold group-hover:text-red-300 transition-colors">
              Bloqueadas
            </p>
          </button>

          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* Pendentes Fila Offline */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-2xl md:text-3xl font-black ${
                  pendentesQueueCount > 0 ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {pendentesQueueCount}
              </span>
              {pendentesQueueCount > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTriggerSync();
                  }}
                  disabled={isSyncing || forceOfflineMode || connectivityState !== 'ONLINE'}
                  className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-bold text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 transition-all"
                  title="Sincronizar fila offline agora"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
                </button>
              )}
            </div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Fila Offline</p>
            {syncFeedback && (
              <p className="text-[10px] text-sky-400 font-mono mt-0.5 animate-pulse">{syncFeedback}</p>
            )}
          </div>

          <div>
            <span className={`text-2xl md:text-3xl font-black ${pendingTimeoutsCount > 0 ? 'text-orange-400 animate-pulse' : 'text-slate-400'}`}>
              {pendingTimeoutsCount}
            </span>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Timeouts Retidos</p>
          </div>
        </div>

        {/* Rodapé de Ajuda e Diagnóstico */}
        <div className="terminal-scrollbar-hidden flex min-h-8 items-center gap-2.5 overflow-x-auto whitespace-nowrap text-xs text-slate-400">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReportInitialTab('approved');
              setShowReportsModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/40 hover:bg-sky-500/25 text-sky-300 font-bold transition-all cursor-pointer"
            title="Abrir relatório de consumos e bloqueios do turno (F7)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>F7: Relatório Turno</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCashModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300 font-bold transition-all cursor-pointer"
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>F9: Controle Caixa</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDiagnostics(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>F8: Diagnóstico</span>
          </button>
          <span className="hidden sm:inline text-slate-600">|</span>
          <span className="hidden sm:inline">F4: Visitante</span>
          <span className="hidden sm:inline text-slate-600">|</span>
          <span className="hidden sm:inline">ESC: Limpar tela</span>
        </div>
      </footer>

      {/* 4. MODAL DE DIAGNÓSTICO, STORAGE E TELEMETRIA DE REDE (F8) */}
      {showDiagnostics && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className={`${!isDark ? 'terminal-light-surface' : ''} bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl text-slate-100 space-y-5`}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base">Diagnóstico de Rede & Contingência</h3>
              </div>
              <button
                onClick={() => setShowDiagnostics(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Telemetria de Rede e Percentis */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sky-400">Telemetria de Rede (Histerese Ativa)</p>
                  <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[10px] uppercase font-bold text-slate-300">
                    {connectivityState}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-2 bg-slate-900 rounded-lg">
                    <p className="text-[10px] text-slate-500 uppercase">Latência p50</p>
                    <p className="text-sm font-bold text-emerald-400 font-mono">{networkMetrics.p50LatencyMs}ms</p>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg">
                    <p className="text-[10px] text-slate-500 uppercase">Latência p95</p>
                    <p className="text-sm font-bold text-amber-400 font-mono">{networkMetrics.p95LatencyMs}ms</p>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg">
                    <p className="text-[10px] text-slate-500 uppercase">Latência p99</p>
                    <p className="text-sm font-bold text-orange-400 font-mono">{networkMetrics.p99LatencyMs}ms</p>
                  </div>
                </div>
                <p className="text-slate-500 text-[11px]">
                  Amostras coletadas: {networkMetrics.samplesCount} | Sucessos consecutivos: {networkMetrics.consecutiveSuccesses} | Falhas: {networkMetrics.consecutiveFailures}
                </p>
              </div>

              {/* Persistência de Armazenamento Local */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <p className="font-semibold text-slate-300">Persistência do Armazenamento Local</p>
                <p className="text-slate-400">
                  Status: {storageInfo.persisted ? (
                    <span className="text-emerald-400 font-bold">Concedida (StorageManager)</span>
                  ) : (
                    <span className="text-amber-400 font-bold">Padrão do Navegador</span>
                  )}
                </p>
                {storageInfo.quotaMb && (
                  <p className="text-slate-500">
                    Cota: {storageInfo.usageMb || 0} MB usados de {storageInfo.quotaMb} MB disponíveis.
                  </p>
                )}
                {!storageInfo.persisted && (
                  <button
                    onClick={async () => {
                      const res = await requestPersistentStorage();
                      setStorageInfo({
                        persisted: res.persisted,
                        quotaMb: res.quotaMb,
                        usageMb: res.usageMb,
                      });
                    }}
                    className="mt-2 px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white font-bold cursor-pointer"
                  >
                    Solicitar Persistência Estrita
                  </button>
                )}
              </div>

              {/* Fila Criptografada e Timeouts Retidos */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <p className="font-semibold text-slate-300">Fila Local e Travas de Timeout</p>
                <p className="text-slate-400">
                  Eventos pendentes de sincronização: <span className="font-mono text-amber-400 font-bold">{pendentesQueueCount}</span>
                </p>
                <p className="text-slate-400">
                  Operações com timeout retidas preventivamente: <span className="font-mono text-orange-400 font-bold">{pendingTimeoutsCount}</span>
                </p>
                <p className="text-slate-500">
                  Autorização offline desativada: operação online-first e fail-safe.
                </p>
                {pendentesQueueCount > 0 && (
                  <button
                    onClick={handleTriggerSync}
                    disabled={isSyncing || forceOfflineMode || connectivityState !== 'ONLINE'}
                    className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded font-bold cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Fila Agora'}</span>
                  </button>
                )}
              </div>

              {/* Contexto Operacional */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <p className="font-semibold text-slate-300">Contexto Operacional</p>
                <p className="text-slate-400">Unidade: {unitId}</p>
                <p className="text-slate-400">Terminal: {terminalId}</p>
                <p className="text-slate-400">Tenant: {tenantId}</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowDiagnostics(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-white cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentPending && paymentPending.preview.student && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <div className={`w-full max-w-2xl rounded-3xl border p-6 shadow-2xl md:p-8 ${isDark ? 'border-slate-700 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
            <div className="mb-6 text-center">
              <p className="text-xs font-black uppercase tracking-[0.22em]" style={{ color: branding.terminal_primary_color }}>Recebimento e troco</p>
              <h2 className="mt-2 text-2xl font-black">{paymentPending.preview.student.full_name}</h2>
              <p className="text-sm opacity-60">{paymentPending.preview.student.registration_number} • {paymentPending.preview.student.category_code}</p>
            </div>

            <div className="mb-5 grid grid-cols-3 gap-3">
              {([
                ['cash', 'Dinheiro', Banknote],
                ['pix', 'PIX', QrCode],
                ['card', 'Cartão', CreditCard],
              ] as const).map(([method, label, Icon]) => {
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(method);
                      setPaymentError(null);
                      if (method === 'cash') setAmountReceived(Number(paymentPending.preview.financial?.student_price || 0).toFixed(2));
                    }}
                    className={`rounded-2xl border p-4 text-center font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${paymentMethod === method ? 'text-white shadow-lg' : isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'}`}
                    style={paymentMethod === method ? { backgroundColor: branding.terminal_primary_color, borderColor: branding.terminal_primary_color } : undefined}
                  >
                    <Icon className="mx-auto mb-2 h-6 w-6" />
                    {label}
                  </button>
                );
              })}
            </div>

            <div className={`grid gap-3 rounded-2xl p-5 sm:grid-cols-3 ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
              <div><p className="text-xs font-bold uppercase opacity-55">Valor da refeição</p><p className="mt-1 text-2xl font-black">R$ {Number(paymentPending.preview.financial?.student_price || 0).toFixed(2)}</p></div>
              <label><span className="text-xs font-bold uppercase opacity-55">Valor recebido</span>
                <input
                  value={paymentMethod === 'cash' ? amountReceived : Number(paymentPending.preview.financial?.student_price || 0).toFixed(2)}
                  onChange={(event) => setAmountReceived(event.target.value)}
                  disabled={paymentMethod !== 'cash'}
                  inputMode="decimal"
                  autoFocus
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-xl font-black outline-none disabled:opacity-60 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-300 bg-white'}`}
                />
              </label>
              <div className="rounded-xl p-3" style={{ backgroundColor: branding.terminal_accent_color, color: '#3F2F00' }}><p className="text-xs font-bold uppercase opacity-70">Troco a devolver</p><p className="mt-1 text-2xl font-black">R$ {Math.max(0, Number((amountReceived || '0').replace(',', '.')) - Number(paymentPending.preview.financial?.student_price || 0)).toFixed(2)}</p></div>
            </div>

            {paymentError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{paymentError}</p>}
            <button
              type="button"
              onClick={handleConfirmPayment}
              disabled={isProcessing}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black uppercase tracking-wider text-white disabled:opacity-60"
              style={{ backgroundColor: branding.terminal_primary_color }}
            >
              <CheckCircle2 className="h-5 w-5" />
              {isProcessing ? 'Confirmando...' : 'Confirmar pagamento e liberar'}
            </button>
          </div>
        </div>
      )}

      {visitorPaymentPending && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className={`w-full max-w-lg rounded-3xl border p-6 shadow-2xl ${isDark ? 'border-slate-700 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
            <h2 className="text-center text-xl font-black">Pagamento do visitante</h2>
            <p className="mt-2 text-center text-sm text-slate-400">Selecione a forma efetivamente recebida antes de liberar.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {(['cash', 'pix', 'card'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleRegisterVisitorDirect(method)}
                  className="rounded-2xl border border-slate-600 px-3 py-4 font-black uppercase hover:border-emerald-400 disabled:opacity-40"
                >
                  {method === 'cash' ? 'Dinheiro' : method === 'pix' ? 'Pix' : 'Cartão'}
                </button>
              ))}
            </div>
            {visitorPaymentError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{visitorPaymentError}</span>
              </div>
            )}
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                setVisitorPaymentError(null);
                setVisitorPaymentPending(false);
              }}
              className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* 5. MODAL DE CONTROLE DE CAIXA E TURNO DO PDV (F9) */}
      <CashShiftModal
        isOpen={showCashModal}
        onClose={() => {
          if (!activeCashShift) return;
          setSignOutRequested(false);
          setShowCashModal(false);
        }}
        unitId={unitId}
        terminalId={terminalId}
        mealTypeId={mealTypeId}
        mealTypeName={mealTypeName}
        unitName={unitName}
        operatorName={operatorName}
        onShiftStatusChange={handleShiftStatusChange}
        theme={terminalTheme}
        requireOpenShift={!activeCashShift}
        requestCloseShift={signOutRequested}
        onExitWithoutShift={onSignOut}
      />

      {/* 6. MODAL DE RELATÓRIO DO TURNO (F7) */}
      <ShiftReportsModal
        isOpen={showReportsModal}
        onClose={() => setShowReportsModal(false)}
        initialTab={reportInitialTab}
        unitId={unitId}
        mealTypeId={mealTypeId}
        terminalId={terminalId}
        unitName={unitName}
        mealTypeName={mealTypeName}
        theme={terminalTheme}
      />
    </div>
  );
}
