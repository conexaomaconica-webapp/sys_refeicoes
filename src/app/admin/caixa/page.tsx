'use strict';
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Lock,
  Unlock,
  AlertTriangle,
  Filter,
  RefreshCw,
  Eye,
  ArrowLeft,
  X,
} from 'lucide-react';
import { cashShiftService } from '@/services/cash-shift.service';
import { listMealTypes, type MealTypeOption } from '@/services/categories.service';
import type { CashShift, CashMovement } from '@/types/cash-shift';

export default function AdminCaixaPage() {
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [mealTypes, setMealTypes] = useState<MealTypeOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtros
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMealType, setFilterMealType] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  // Modal de Detalhes de um Caixa Selecionado
  const [selectedShift, setSelectedShift] = useState<CashShift | null>(null);
  const [shiftMovements, setShiftMovements] = useState<CashMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [shiftsData, mtRes] = await Promise.all([
        cashShiftService.listShifts({
          status: (filterStatus as 'opened' | 'closed') || undefined,
          mealTypeId: filterMealType || undefined,
          startDate: filterStartDate || undefined,
          endDate: filterEndDate || undefined,
        }),
        listMealTypes(),
      ]);

      setShifts(shiftsData);
      if (mtRes.success) {
        setMealTypes(mtRes.mealTypes);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao carregar turnos de caixa.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterMealType, filterStartDate, filterEndDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Carrega movimentações de um caixa selecionado
  const handleOpenDetails = async (shift: CashShift) => {
    setSelectedShift(shift);
    setLoadingMovements(true);
    try {
      const res = await cashShiftService.getActiveShift(shift.unit_id, shift.terminal_id);
      // Se for o mesmo caixa, aproveita ou busca as movimentações
      setShiftMovements(res.movements || []);
    } catch {
      setShiftMovements([]);
    } finally {
      setLoadingMovements(false);
    }
  };

  // Cálculos consolidados para os cards de topo
  const totalArrecadadoVisitantes = shifts.reduce(
    (acc, s) => acc + Number(s.total_visitors_amount || 0),
    0
  );
  const totalVisitantesQtd = shifts.reduce(
    (acc, s) => acc + Number(s.total_visitors_count || 0),
    0
  );
  const totalSangrias = shifts.reduce((acc, s) => acc + Number(s.total_bleed_amount || 0), 0);
  const totalSuprimentos = shifts.reduce(
    (acc, s) => acc + Number(s.total_supplies_amount || 0),
    0
  );
  const totalDivergencia = shifts.reduce(
    (acc, s) => acc + Number(s.difference_amount || 0),
    0
  );

  return (
    <div className="theme-light-page min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/terminal"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition"
              title="Voltar ao Terminal"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white flex items-center gap-3">
                Gestão e Auditoria de Caixa (PDV)
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {shifts.length} Caixas
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                Controle de abertura de turnos, sangrias, suprimentos de troco e conferência cega de valores.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white font-medium text-xs transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Atualizar</span>
          </button>
          <Link
            href="/terminal"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/30 transition"
          >
            <Unlock className="w-4 h-4" />
            <span>Ir para o Terminal</span>
          </Link>
        </div>
      </div>

      {/* Alerta de Erro */}
      {errorMsg && (
        <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Métricas Consolidadas de Topo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Arrecadado Visitantes */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Arrecadação Visitantes</span>
            <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-white">
            R$ {totalArrecadadoVisitantes.toFixed(2)}
          </div>
          <p className="text-[11px] text-slate-400">
            {totalVisitantesQtd} refeições avulsas pagas na entrada
          </p>
        </div>

        {/* Total Sangrias */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Sangrias Realizadas</span>
            <span className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
              <TrendingDown className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-rose-400">
            -R$ {totalSangrias.toFixed(2)}
          </div>
          <p className="text-[11px] text-slate-400">
            Cédulas recolhidas para o cofre central
          </p>
        </div>

        {/* Total Suprimentos */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Suprimentos de Troco</span>
            <span className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-cyan-400">
            +R$ {totalSuprimentos.toFixed(2)}
          </div>
          <p className="text-[11px] text-slate-400">
            Reforço de moeda/troco nos guichês
          </p>
        </div>

        {/* Divergência Acumulada */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Divergência Total</span>
            <span
              className={`p-2 rounded-xl ${
                totalDivergencia === 0
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : totalDivergencia > 0
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-rose-500/10 text-rose-400'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div
            className={`text-2xl font-black ${
              totalDivergencia === 0
                ? 'text-emerald-400'
                : totalDivergencia > 0
                ? 'text-blue-400'
                : 'text-rose-400'
            }`}
          >
            {totalDivergencia === 0
              ? 'R$ 0,00'
              : totalDivergencia > 0
              ? `+R$ ${totalDivergencia.toFixed(2)}`
              : `-R$ ${Math.abs(totalDivergencia).toFixed(2)}`}
          </div>
          <p className="text-[11px] text-slate-400">
            {totalDivergencia === 0
              ? 'Caixas conferidos sem quebras'
              : totalDivergencia > 0
              ? 'Sobra total apurada'
              : 'Falta total apurada'}
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold uppercase tracking-wider mr-2">
          <Filter className="w-4 h-4 text-emerald-400" />
          <span>Filtros:</span>
        </div>

        {/* Filtro Status */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="">Todos os Status</option>
          <option value="opened">Apenas Abertos</option>
          <option value="closed">Apenas Fechados</option>
        </select>

        {/* Filtro Turno / Refeição */}
        <select
          value={filterMealType}
          onChange={(e) => setFilterMealType(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="">Todos os Turnos</option>
          {mealTypes.map((mt) => (
            <option key={mt.id} value={mt.id}>
              {mt.name}
            </option>
          ))}
        </select>

        {/* Limpar Filtros */}
        {(filterStatus || filterMealType || filterStartDate || filterEndDate) && (
          <button
            onClick={() => {
              setFilterStatus('');
              setFilterMealType('');
              setFilterStartDate('');
              setFilterEndDate('');
            }}
            className="text-xs text-slate-400 hover:text-white underline ml-auto"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela de Turnos de Caixa */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Abertura / Turno</th>
                <th className="py-3.5 px-4">Unidade / Terminal</th>
                <th className="py-3.5 px-4">Operador</th>
                <th className="py-3.5 px-4 text-right">Troco Inicial</th>
                <th className="py-3.5 px-4 text-right">Visitantes</th>
                <th className="py-3.5 px-4 text-right">Sangrias</th>
                <th className="py-3.5 px-4 text-right">Esperado</th>
                <th className="py-3.5 px-4 text-right">Contado</th>
                <th className="py-3.5 px-4 text-center">Divergência</th>
                <th className="py-3.5 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-slate-500">
                    Nenhum turno de caixa encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                shifts.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition">
                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          s.status === 'opened'
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {s.status === 'opened' ? (
                          <>
                            <Unlock className="w-3 h-3" />
                            Aberto
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3" />
                            Fechado
                          </>
                        )}
                      </span>
                    </td>

                    {/* Abertura / Turno */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">
                        {new Date(s.opened_at).toLocaleDateString('pt-BR')} &bull;{' '}
                        {new Date(s.opened_at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="text-[11px] text-emerald-400">
                        {s.meal_type_name || 'Almoço'}
                      </div>
                    </td>

                    {/* Unidade / Terminal */}
                    <td className="py-3.5 px-4">
                      <div className="text-slate-200">{s.unit_name || 'RU Central'}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Terminal: {s.terminal_id}
                      </div>
                    </td>

                    {/* Operador */}
                    <td className="py-3.5 px-4">
                      <div className="text-slate-300">{s.operator_name || 'Operador'}</div>
                      {s.closed_at && (
                        <div className="text-[10px] text-slate-500">
                          Fechado às{' '}
                          {new Date(s.closed_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </td>

                    {/* Troco Inicial */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      R$ {Number(s.initial_float_amount).toFixed(2)}
                    </td>

                    {/* Visitantes */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      <div className="font-bold text-emerald-400">
                        +R$ {Number(s.total_visitors_amount).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        ({s.total_visitors_count} vds)
                      </div>
                    </td>

                    {/* Sangrias */}
                    <td className="py-3.5 px-4 text-right font-mono text-rose-400">
                      {Number(s.total_bleed_amount) > 0
                        ? `-R$ ${Number(s.total_bleed_amount).toFixed(2)}`
                        : 'R$ 0,00'}
                    </td>

                    {/* Esperado */}
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
                      R$ {Number(s.expected_cash_balance ?? s.system_expected_balance).toFixed(2)}
                    </td>

                    {/* Contado */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      {s.counted_closing_balance !== null
                        ? `R$ ${Number(s.counted_closing_balance).toFixed(2)}`
                        : '-'}
                    </td>

                    {/* Divergência */}
                    <td className="py-3.5 px-4 text-center font-mono">
                      {s.status === 'opened' ? (
                        <span className="text-slate-500 text-[11px]">Em andamento</span>
                      ) : Number(s.difference_amount) === 0 ? (
                        <span className="text-emerald-400 font-bold">Batido</span>
                      ) : Number(s.difference_amount) > 0 ? (
                        <span className="text-blue-400 font-bold">
                          +R$ {Number(s.difference_amount).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-rose-400 font-bold">
                          -R$ {Math.abs(Number(s.difference_amount)).toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => handleOpenDetails(s)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                        title="Ver Detalhes do Caixa"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal / Drawer de Detalhes do Turno de Caixa */}
      {selectedShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Auditoria de Turno #{selectedShift.id.slice(0, 8)}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedShift.unit_name || 'Unidade'} &bull; {selectedShift.meal_type_name || 'Turno'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedShift(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Resumo Financeiro */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Fundo de Troco Inicial</span>
                  <span className="font-bold text-white text-sm font-mono">
                    R$ {Number(selectedShift.initial_float_amount).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Visitantes</span>
                  <span className="font-bold text-emerald-400 text-sm font-mono">
                    +R$ {Number(selectedShift.total_visitors_amount).toFixed(2)} ({selectedShift.total_visitors_count} vds)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Sangrias Realizadas</span>
                  <span className="font-bold text-rose-400 text-sm font-mono">
                    -R$ {Number(selectedShift.total_bleed_amount).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Saldo Esperado Sistema</span>
                  <span className="font-bold text-white text-sm font-mono">
                    R$ {Number(selectedShift.expected_cash_balance ?? selectedShift.system_expected_balance).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Informações do Fechamento Cego */}
              {selectedShift.status === 'closed' && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Valor Físico Contado na Gaveta:</span>
                    <span className="font-bold text-white text-sm font-mono">
                      R$ {Number(selectedShift.counted_closing_balance || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Divergência / Quebra:</span>
                    <span
                      className={`font-bold font-mono ${
                        Number(selectedShift.difference_amount) === 0
                          ? 'text-emerald-400'
                          : Number(selectedShift.difference_amount) > 0
                          ? 'text-blue-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {Number(selectedShift.difference_amount) === 0
                        ? 'Caixa Batido (R$ 0,00)'
                        : Number(selectedShift.difference_amount) > 0
                        ? `Sobra de R$ ${Number(selectedShift.difference_amount).toFixed(2)}`
                        : `Falta de R$ ${Math.abs(Number(selectedShift.difference_amount)).toFixed(2)}`}
                    </span>
                  </div>
                  {selectedShift.closing_notes && (
                    <div className="pt-2 border-t border-slate-900 text-slate-400">
                      <strong>Observações do Operador:</strong> {selectedShift.closing_notes}
                    </div>
                  )}
                </div>
              )}

              {/* Histórico de Movimentos */}
              <div>
                <h4 className="font-bold text-slate-300 text-xs mb-2 uppercase tracking-wider">
                  Movimentações Registradas
                </h4>
                {loadingMovements ? (
                  <div className="text-center py-6 text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-400" />
                    Carregando movimentações...
                  </div>
                ) : shiftMovements.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 bg-slate-950 rounded-xl">
                    Nenhuma movimentação detalhada encontrada.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {shiftMovements.map((m) => (
                      <div
                        key={m.id}
                        className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-200">
                            {['visitor_sale', 'meal_sale'].includes(m.type)
                              ? 'Venda de Visitante (Entrada)'
                              : m.type === 'supply'
                              ? 'Suprimento de Caixa'
                              : m.type === 'bleed'
                              ? 'Sangria de Caixa'
                              : m.type === 'initial_float'
                              ? 'Troco Inicial'
                              : 'Ajuste'}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {new Date(m.created_at).toLocaleTimeString('pt-BR')} &bull;{' '}
                            {m.description || m.payment_method?.toUpperCase()}
                          </p>
                        </div>
                        <span
                          className={`font-bold font-mono ${
                            m.type === 'bleed' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {m.type === 'bleed' ? '-' : '+'}R$ {Number(m.amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-800/80 px-6 py-3 border-t border-slate-700 flex justify-end">
              <button
                onClick={() => setSelectedShift(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-semibold text-xs transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
