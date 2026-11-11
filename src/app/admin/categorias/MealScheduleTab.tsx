'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, RefreshCw, Save, UtensilsCrossed } from 'lucide-react';
import {
  loadMealScheduleAction,
  saveMealScheduleAction,
  type MealScheduleData,
} from './actions';

interface ScheduleDraft {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

const draftKey = (unitId: string, mealTypeId: string) => `${unitId}:${mealTypeId}`;
const normalizeTime = (value: string | null) => value?.slice(0, 5) || '';

function getMinutesInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function isCurrentSchedule(draft: ScheduleDraft, currentMinutes: number) {
  if (!draft.enabled || !draft.startTime || !draft.endTime) return false;
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(draft.startTime);
  const end = toMinutes(draft.endTime);
  return start <= end
    ? currentMinutes >= start && currentMinutes <= end
    : currentMinutes >= start || currentMinutes <= end;
}

export function MealScheduleTab() {
  const [data, setData] = useState<MealScheduleData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    const result = await loadMealScheduleAction();
    if (!result.success) {
      setFeedback({ type: 'error', message: result.error });
      setLoading(false);
      return;
    }

    const nextDrafts: Record<string, ScheduleDraft> = {};
    for (const unit of result.data.units) {
      for (const mealType of result.data.mealTypes) {
        const configuration = result.data.configurations.find(
          (item) => item.unitId === unit.id && item.mealTypeId === mealType.id
        );
        nextDrafts[draftKey(unit.id, mealType.id)] = {
          enabled: configuration?.enabled ?? false,
          startTime: normalizeTime(configuration?.startTime ?? null),
          endTime: normalizeTime(configuration?.endTime ?? null),
        };
      }
    }
    setData(result.data);
    setDrafts(nextDrafts);
    setSelectedUnitId((current) =>
      result.data.units.some((unit) => unit.id === current)
        ? current
        : result.data.units[0]?.id || ''
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick((current) => current + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedUnit = data?.units.find((unit) => unit.id === selectedUnitId);
  const currentMinutes = useMemo(
    () => {
      void clockTick;
      return selectedUnit ? getMinutesInTimezone(selectedUnit.timezone) : 0;
    },
    [clockTick, selectedUnit]
  );

  const updateDraft = (mealTypeId: string, patch: Partial<ScheduleDraft>) => {
    const key = draftKey(selectedUnitId, mealTypeId);
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const saveDraft = async (mealTypeId: string) => {
    const key = draftKey(selectedUnitId, mealTypeId);
    const draft = drafts[key];
    if (!draft || savingKey) return;
    setSavingKey(key);
    setFeedback(null);
    const result = await saveMealScheduleAction({
      unitId: selectedUnitId,
      mealTypeId,
      enabled: draft.enabled,
      startTime: draft.startTime,
      endTime: draft.endTime,
    });
    setSavingKey(null);
    setFeedback(
      result.success
        ? { type: 'success', message: result.message }
        : { type: 'error', message: result.error }
    );
    if (result.success) await loadSchedules();
  };

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white">
        <div className="text-center text-slate-500">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          <p className="mt-3 text-sm font-bold">Carregando turnos das unidades...</p>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      {feedback && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
          feedback.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-red-200 bg-red-50 text-red-900'
        }`}>
          {feedback.message}
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <UtensilsCrossed className="h-6 w-6 text-rose-700" />
              <h2 className="text-xl font-black">Refeições e turnos</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Defina a janela operacional de cada refeição. O terminal em caixa diário troca o turno automaticamente.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Unidade
              <select
                value={selectedUnitId}
                onChange={(event) => setSelectedUnitId(event.target.value)}
                className="mt-1 block min-w-64 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-slate-900 outline-none focus:border-rose-600"
              >
                {(data?.units || []).map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadSchedules()}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
        </div>

        {selectedUnit && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 font-bold">Fuso: {selectedUnit.timezone}</span>
            {!selectedUnit.canEdit && (
              <span className="rounded-full bg-amber-100 px-3 py-1.5 font-bold text-amber-900">Somente leitura</span>
            )}
          </div>
        )}
      </div>

      {!data?.units.length ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-900">
          Nenhuma unidade disponível para o seu perfil.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {(data?.mealTypes || []).map((mealType) => {
            const key = draftKey(selectedUnitId, mealType.id);
            const draft = drafts[key] || { enabled: false, startTime: '', endTime: '' };
            const activeNow = isCurrentSchedule(draft, currentMinutes);
            const canEdit = Boolean(selectedUnit?.canEdit);
            return (
              <article key={mealType.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${activeNow ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">{mealType.code}</p>
                    <h3 className="mt-1 text-lg font-black text-slate-900">{mealType.name}</h3>
                  </div>
                  {activeNow && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Ativa agora
                    </span>
                  )}
                </div>

                <label className="mt-5 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700">
                  Refeição habilitada
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={!canEdit}
                    onChange={(event) => updateDraft(mealType.id, { enabled: event.target.checked })}
                    className="h-5 w-5 accent-rose-700"
                  />
                </label>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Início
                    <input
                      type="time"
                      value={draft.startTime}
                      disabled={!canEdit || !draft.enabled}
                      onChange={(event) => updateDraft(mealType.id, { startTime: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-rose-600 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                  <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Fim
                    <input
                      type="time"
                      value={draft.endTime}
                      disabled={!canEdit || !draft.enabled}
                      onChange={(event) => updateDraft(mealType.id, { endTime: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-rose-600 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => void saveDraft(mealType.id)}
                  disabled={!canEdit || savingKey !== null || (draft.enabled && (!draft.startTime || !draft.endTime))}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar turno
                </button>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
        <p><strong>Importante:</strong> para manter o mesmo caixa aberto durante a troca automática, configure a unidade como <strong>Caixa diário</strong> em Administração → Caixas e turnos.</p>
      </div>
    </section>
  );
}
