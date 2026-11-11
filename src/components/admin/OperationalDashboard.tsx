'use client';

import React, { useEffect, useState, useTransition, useCallback, useRef } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Building2,
  Calendar,
  Clock,
  Flame,
  Gauge,
  Monitor,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
  Utensils,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { fetchOperationalDashboardSnapshot } from '@/services/operational-dashboard.service';
import type { OperationalDashboardInitialData } from '@/server/dashboard/operational-dashboard.server';
import type { OperationalDashboardSnapshot } from '@/types/operational-dashboard';

interface OperationalDashboardProps {
  initialData: OperationalDashboardInitialData;
}

const REASON_LABELS: Record<string, string> = {
  ALREADY_CONSUMED_TODAY: 'Segunda passagem / Cota diária esgotada',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente na carteira',
  STUDENT_NOT_FOUND: 'Matrícula ou comensal não localizado',
  STUDENT_INACTIVE: 'Matrícula/cadastro inativo',
  OUT_OF_SCHEDULE: 'Fora do horário de serviço',
  TOKEN_ALREADY_USED: 'QR Code dinâmico já utilizado',
  TOKEN_EXPIRED: 'QR Code dinâmico expirado',
  NO_PRICE_RULE_CONFIGURED: 'Tabela de preços não configurada',
  MEAL_NOT_ENABLED_FOR_UNIT: 'Refeição não habilitada na unidade',
  CONCURRENT_CONSUMPTION_CONFLICT: 'Conflito de concorrência simultânea',
};

export function OperationalDashboard({ initialData }: OperationalDashboardProps) {
  const [unitId, setUnitId] = useState<string>(initialData.selectedUnitId);
  const [serviceDate, setServiceDate] = useState<string>(initialData.serviceDate);
  const [mealTypeId, setMealTypeId] = useState<string>(initialData.selectedMealTypeId || '');
  const [snapshot, setSnapshot] = useState<OperationalDashboardSnapshot | null>(
    initialData.initialSnapshot
  );
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<Date>(new Date());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Carregar dados atualizados
  const refreshSnapshot = useCallback(async (isSilent = false) => {
    if (!unitId) return;
    if (!isSilent) setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const data = await fetchOperationalDashboardSnapshot({
        unitId,
        serviceDate,
        mealTypeId: mealTypeId || null,
      });
      setSnapshot(data);
      setLastEventAt(new Date());
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      if (!isSilent) setIsRefreshing(false);
    }
  }, [unitId, serviceDate, mealTypeId]);

  // Recarregar quando filtros mudarem
  useEffect(() => {
    startTransition(() => {
      refreshSnapshot(false);
    });
  }, [unitId, serviceDate, mealTypeId, refreshSnapshot]);

  // Agendador com Debounce (1.500ms) para proteger contra rajadas de eventos
  const scheduleDebouncedRefresh = useCallback(() => {
    setLastEventAt(new Date());
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      refreshSnapshot(true);
    }, 1500);
  }, [refreshSnapshot]);

  // Limpeza de timer no unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Inscrição em tempo real no Supabase Realtime com tratamento de resiliência
  useEffect(() => {
    if (!unitId) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channelName = `realtime-ops-${unitId}-${serviceDate}`;
    const channel = supabase.channel(channelName);

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'operational_dashboard_signals',
          filter: `unit_id=eq.${unitId}`,
        },
        () => {
          scheduleDebouncedRefresh();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeActive(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeActive(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [unitId, serviceDate, scheduleDebouncedRefresh]);

  // Fallback de Polling Suave (30 segundos) quando Realtime estiver desconectado
  useEffect(() => {
    if (realtimeActive) return;

    const interval = setInterval(() => {
      refreshSnapshot(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [realtimeActive, refreshSnapshot]);

  const summary = snapshot?.summary || {
    total_meals: 0,
    integral_meals: 0,
    partial_meals: 0,
    recent_5m_meals: 0,
    speed_per_minute: 0,
    total_blocked: 0,
    total_attempts: 0,
    block_rate_percentage: 0,
    peak_interval: null,
    peak_volume: 0,
  };

  const idleTerminals =
    snapshot?.terminal_statuses.filter((t) => t.is_idle_alert) || [];

  return (
    <div className="space-y-6 text-slate-900">
      {/* CABEÇALHO DO DASHBOARD E FILTROS */}
      <header className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                <Gauge className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">
                  Dashboard Operacional
                </h1>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Monitoramento em tempo real de fluxo, picos e terminais
                </p>
              </div>
            </div>
          </div>

          {/* Status Realtime & Atualização */}
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-black transition ${
                realtimeActive
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {realtimeActive ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-amber-600" />
              )}
              <span className="relative flex h-2 w-2">
                {realtimeActive && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    realtimeActive ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </span>
              {realtimeActive ? 'Ao Vivo (Realtime)' : 'Modo Resiliente (Polling 30s)'}
              <span className="text-[10px] font-medium opacity-75">
                {lastEventAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>

            <button
              type="button"
              onClick={() => refreshSnapshot(false)}
              disabled={isRefreshing || isPending}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-red-600' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        {/* BARRA DE FILTROS */}
        <div className="mt-6 grid grid-cols-1 gap-3.5 pt-5 border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-4">
          {/* Seletor de Unidade */}
          <div>
            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500">
              Unidade / Restaurante
            </label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-8 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
              >
                {initialData.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Seletor de Data */}
          <div>
            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500">
              Data do Serviço
            </label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
              />
            </div>
          </div>

          {/* Seletor de Refeição / Turno */}
          <div>
            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500">
              Tipo de Refeição
            </label>
            <div className="relative">
              <Utensils className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={mealTypeId}
                onChange={(e) => setMealTypeId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-8 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
              >
                <option value="">Todos os turnos do dia</option>
                {initialData.mealTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Botão de Hoje */}
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setServiceDate(new Date().toISOString().split('T')[0])}
              className="w-full rounded-2xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-200 active:scale-95"
            >
              Redefinir para Hoje
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </header>

      {/* ALERTA DE TERMINAL OCIOSO EM HORÁRIO DE PICO (Requisito Sprint 14: > 2 minutos sem registros) */}
      {idleTerminals.length > 0 && (
        <section className="animate-pulse rounded-3xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black text-amber-900">
                Alerta Operacional: Terminal sem registros há mais de 2 minutos
              </h2>
              <p className="mt-0.5 text-xs text-amber-800">
                Durante o fluxo ativo, os seguintes postos de recepção estão inativos. Verifique possíveis travamentos de leitor, rede ou ausência de operador:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {idleTerminals.map((t) => (
                  <span
                    key={t.terminal_id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1 text-xs font-black text-amber-900 shadow-xs"
                  >
                    <Monitor className="h-3.5 w-3.5 text-amber-600" />
                    {t.terminal_id} ({t.operator_name || 'Operador'}) —{' '}
                    <span className="text-red-700">
                      {Math.floor((t.seconds_since_last_activity || 0) / 60)}m {((t.seconds_since_last_activity || 0) % 60)}s sem registro
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CARDS DE MÉTRICAS OPERACIONAIS PRINCIPAIS (KPIS) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total de Refeições Servidas */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Refeições Servidas
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-red-50 text-red-700">
              <Utensils className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-black tracking-tight text-slate-900">
              {summary.total_meals.toLocaleString('pt-BR')}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800">
                {summary.integral_meals} Integrais (
                {summary.total_meals > 0
                  ? Math.round((summary.integral_meals / summary.total_meals) * 100)
                  : 0}
                %)
              </span>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-800">
                {summary.partial_meals} Parciais (
                {summary.total_meals > 0
                  ? Math.round((summary.partial_meals / summary.total_meals) * 100)
                  : 0}
                %)
              </span>
            </div>
          </div>
        </div>

        {/* Velocidade de Linha (Refeições / Minuto) */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Velocidade de Linha
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tight text-slate-900">
                {summary.speed_per_minute.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-500">ref / min</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Últimos 5 minutos: <strong className="text-slate-700">{summary.recent_5m_meals}</strong> validações
            </p>
          </div>
        </div>

        {/* Taxa de Bloqueios e Tentativas Rejeitadas */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Tentativas Rejeitadas
            </span>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                summary.block_rate_percentage > 5
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tight text-slate-900">
                {summary.total_blocked}
              </span>
              <span
                className={`text-xs font-extrabold ${
                  summary.block_rate_percentage > 5 ? 'text-rose-700' : 'text-slate-500'
                }`}
              >
                ({summary.block_rate_percentage.toFixed(1)}% rejeições)
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Total de tentativas: <strong className="text-slate-700">{summary.total_attempts}</strong>
            </p>
          </div>
        </div>

        {/* Pico do Turno (Intervalo de 15 Minutos) */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Pico de Atendimento
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
              <Flame className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-3xl font-black tracking-tight text-slate-900">
              {summary.peak_interval || '--:--'}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Volume no intervalo: <strong className="text-slate-700">{summary.peak_volume}</strong> refeições
            </p>
          </div>
        </div>
      </section>

      {/* PAINEL DE PICOS: DISTRIBUIÇÃO HORÁRIA EM BLOCOS DE 15 MINUTOS */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-700" />
              <h2 className="text-base font-black text-slate-900">
                Painel de Picos e Distribuição Horária (Blocos de 15 Minutos)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Curva de vazão para planejamento e dimensionamento de equipe, buffet e reposição
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-bold">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Bolsista Integral
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Parcial / Pagante
            </span>
          </div>
        </div>

        {/* Gráfico de Barras Responsivo */}
        <div className="mt-6">
          {(!snapshot?.hourly_flow || snapshot.hourly_flow.length === 0) ? (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-400">
              Nenhuma refeição registrada na data/filtro selecionado.
            </div>
          ) : (
            <div className="relative pt-6">
              {/* Barra Máxima de Referência */}
              {(() => {
                const maxInFlow = Math.max(
                  ...snapshot.hourly_flow.map((b) => b.total),
                  1
                );
                return (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12">
                    {snapshot.hourly_flow.map((bucket) => {
                      const heightPercent = Math.max(
                        Math.round((bucket.total / maxInFlow) * 100),
                        8
                      );
                      const isPeak = bucket.interval === summary.peak_interval;
                      const integralHeight =
                        bucket.total > 0
                          ? Math.round((bucket.integral / bucket.total) * 100)
                          : 0;

                      return (
                        <div
                          key={bucket.interval}
                          className="group flex flex-col items-center"
                        >
                          {/* Dica / Tooltip Flutuante */}
                          <div className="mb-1 text-center opacity-85 transition group-hover:scale-105">
                            <span
                              className={`text-[11px] font-black ${
                                isPeak ? 'text-orange-600' : 'text-slate-700'
                              }`}
                            >
                              {bucket.total}
                            </span>
                          </div>

                          {/* Barra do Bloco */}
                          <div className="relative flex h-36 w-full max-w-[28px] items-end justify-center rounded-xl bg-slate-100 p-0.5">
                            <div
                              className={`relative w-full overflow-hidden rounded-lg transition-all duration-300 ${
                                isPeak
                                  ? 'ring-2 ring-orange-400 ring-offset-1'
                                  : ''
                              }`}
                              style={{ height: `${heightPercent}%` }}
                            >
                              {/* Divisão Integral (Verde) vs Parcial (Azul) */}
                              <div
                                className="w-full bg-emerald-500"
                                style={{ height: `${integralHeight}%` }}
                                title={`Integral: ${bucket.integral}`}
                              />
                              <div
                                className="w-full bg-blue-600"
                                style={{ height: `${100 - integralHeight}%` }}
                                title={`Parcial: ${bucket.partial}`}
                              />
                            </div>
                          </div>

                          {/* Rótulo do Horário */}
                          <span
                            className={`mt-2 block truncate text-[10px] font-bold ${
                              isPeak
                                ? 'rounded-md bg-orange-100 px-1 py-0.5 text-orange-950 font-black'
                                : 'text-slate-500'
                            }`}
                          >
                            {bucket.interval}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </section>

      {/* MONITORAMENTO DE TERMINAIS E POSTOS DE ATENDIMENTO */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-red-700" />
              <h2 className="text-base font-black text-slate-900">
                Terminais e Postos Operacionais
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Desempenho individual, velocidade por catraca e verificação de inatividade
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {snapshot?.terminal_statuses.length || 0} terminal(is) registrado(s)
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(!snapshot?.terminal_statuses || snapshot.terminal_statuses.length === 0) ? (
            <div className="col-span-full py-8 text-center text-xs font-bold text-slate-400">
              Nenhum terminal com atividade registrada no período.
            </div>
          ) : (
            snapshot.terminal_statuses.map((terminal) => {
              const seconds = terminal.seconds_since_last_activity ?? 9999;
              const isRecent = seconds < 60;
              const isIdle = terminal.is_idle_alert;

              return (
                <div
                  key={terminal.terminal_id}
                  className={`rounded-2xl border p-4.5 transition ${
                    isIdle
                      ? 'border-amber-300 bg-amber-50/60 shadow-xs'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-sm font-black text-slate-900">
                        {terminal.terminal_id}
                      </span>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Operador: <strong className="text-slate-700">{terminal.operator_name || 'Não identificado'}</strong>
                      </p>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                        isIdle
                          ? 'bg-amber-100 text-amber-900'
                          : isRecent
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isIdle
                            ? 'bg-amber-500 animate-ping'
                            : isRecent
                            ? 'bg-emerald-500 animate-pulse'
                            : 'bg-slate-400'
                        }`}
                      />
                      {isIdle ? 'Ocioso (>2m)' : isRecent ? 'Ativo' : 'Aguardando'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Total Servido
                      </span>
                      <p className="text-base font-black text-slate-900">
                        {terminal.total_served}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Velocidade (5m)
                      </span>
                      <p className="text-base font-black text-slate-900">
                        {terminal.speed_per_minute.toFixed(1)} <span className="text-xs font-normal text-slate-500">ref/min</span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      Última leitura:
                    </span>
                    <strong className="text-slate-700">
                      {terminal.last_consumed_at
                        ? new Date(terminal.last_consumed_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '--:--'}
                    </strong>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* AUDITORIA DE REJEIÇÕES E CONSUMO POR CATEGORIA */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Motivos de Bloqueio (Top Rejections) */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-700" />
            <div>
              <h2 className="text-base font-black text-slate-900">
                Detalhamento de Tentativas Bloqueadas
              </h2>
              <p className="text-xs text-slate-500">
                Auditoria de recusas para identificação de inconsistências de cadastro ou fraude
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(!snapshot?.blocked_reasons || snapshot.blocked_reasons.length === 0) ? (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                Nenhum bloqueio registrado no período. Operação 100% liberada.
              </div>
            ) : (
              snapshot.blocked_reasons.map((reason) => (
                <div
                  key={reason.reason_code}
                  className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-black text-slate-900">
                        {REASON_LABELS[reason.reason_code] || reason.reason_message || reason.reason_code}
                      </span>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {reason.reason_code}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-slate-900">
                        {reason.count}
                      </span>
                      <span className="block text-[10px] font-bold text-slate-500">
                        {reason.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Barra Percentual */}
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-rose-600"
                      style={{ width: `${Math.min(reason.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Consumo por Categoria */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-red-700" />
            <div>
              <h2 className="text-base font-black text-slate-900">
                Consumo por Categoria de Comensal
              </h2>
              <p className="text-xs text-slate-500">
                Proporção entre modalidades de bolsa, regular e visitantes
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(!snapshot?.category_breakdown || snapshot.category_breakdown.length === 0) ? (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                Nenhum consumo categorizado no período.
              </div>
            ) : (
              snapshot.category_breakdown.map((cat) => (
                <div
                  key={cat.category_id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            cat.is_integral ? 'bg-emerald-600' : 'bg-blue-600'
                          }`}
                        />
                        <span className="text-xs font-black text-slate-900">
                          {cat.category_name}
                        </span>
                        <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {cat.category_code}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Subsídio total apurado:{' '}
                        <strong className="text-slate-700">
                          R$ {Number(cat.total_subsidy).toFixed(2)}
                        </strong>
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-black text-slate-900">
                        {cat.count}
                      </span>
                      <span className="block text-[10px] font-bold text-slate-500">
                        {cat.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${
                        cat.is_integral ? 'bg-emerald-600' : 'bg-blue-600'
                      }`}
                      style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

