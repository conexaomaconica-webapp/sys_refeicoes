'use strict';
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  TrendingUp,
  TrendingDown,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Printer,
} from 'lucide-react';
import {
  cashShiftService,
  type ActiveShiftResult,
  type CloseShiftResult,
} from '@/services/cash-shift.service';
import type { CashShift, CashMovement } from '@/types/cash-shift';

interface CashShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  unitId: string;
  terminalId: string;
  mealTypeId: string;
  mealTypeName?: string;
  unitName?: string;
  operatorName?: string;
  onShiftStatusChange?: (activeShift: CashShift | null) => void;
  theme?: 'light' | 'dark';
  requireOpenShift?: boolean;
  requestCloseShift?: boolean;
  onExitWithoutShift?: () => void;
}

export const CashShiftModal: React.FC<CashShiftModalProps> = ({
  isOpen,
  onClose,
  unitId,
  terminalId,
  mealTypeId,
  mealTypeName,
  unitName,
  operatorName,
  onShiftStatusChange,
  theme = 'light',
  requireOpenShift = false,
  requestCloseShift = false,
  onExitWithoutShift,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado do Caixa
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);

  // Abas quando aberto: 'summary' | 'supply' | 'bleed' | 'history' | 'close'
  const [tab, setTab] = useState<'summary' | 'supply' | 'bleed' | 'history' | 'close'>('summary');

  // Formulário Abertura
  const [openInitialFloat, setOpenInitialFloat] = useState<string>('100.00');

  // Formulário Suprimento / Sangria
  const [movementAmount, setMovementAmount] = useState<string>('');
  const [movementDescription, setMovementDescription] = useState<string>('');

  // Formulário Fechamento
  const [countedAmount, setCountedAmount] = useState<string>('');
  const [closingNotes, setClosingNotes] = useState<string>('');
  const [closedResult, setClosedResult] = useState<CloseShiftResult | null>(null);

  const fetchActiveShift = useCallback(async () => {
    if (!unitId || !terminalId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res: ActiveShiftResult = await cashShiftService.getActiveShift(unitId, terminalId);
      setActiveShift(res.shift);
      setMovements(res.movements || []);
      if (onShiftStatusChange) {
        onShiftStatusChange(res.shift);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao consultar turno do caixa.');
    } finally {
      setLoading(false);
    }
  }, [unitId, terminalId, onShiftStatusChange]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setClosedResult(null);
      setTab(requestCloseShift ? 'close' : 'summary');
      fetchActiveShift();
    }
  }, [isOpen, fetchActiveShift, requestCloseShift]);

  // Handler de Abertura
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const floatNum = parseFloat(openInitialFloat.replace(',', '.'));
    if (isNaN(floatNum) || floatNum < 0) {
      setErrorMsg('Informe um valor de fundo de troco válido.');
      return;
    }

    setLoading(true);
    try {
      await cashShiftService.openShift({
        unitId,
        terminalId,
        mealTypeId,
        initialFloat: floatNum,
      });
      setSuccessMsg('Caixa aberto com sucesso! Turno de PDV iniciado.');
      await fetchActiveShift();
      setTab('summary');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao abrir caixa.');
    } finally {
      setLoading(false);
    }
  };

  // Handler de Sangria / Suprimento
  const handleRecordMovement = async (type: 'supply' | 'bleed') => {
    if (!activeShift) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const amountNum = parseFloat(movementAmount.replace(',', '.'));
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg('Informe um valor válido maior que zero.');
      return;
    }

    if (!movementDescription.trim()) {
      setErrorMsg(`Informe a justificativa / motivo do ${type === 'bleed' ? 'sangria' : 'suprimento'}.`);
      return;
    }

    const expectedCash = Number(activeShift.expected_cash_balance ?? activeShift.system_expected_balance);
    if (type === 'bleed' && amountNum > expectedCash) {
      setErrorMsg(
        `Valor da sangria (R$ ${amountNum.toFixed(2)}) é maior que o saldo em caixa (R$ ${expectedCash.toFixed(2)}).`
      );
      return;
    }

    setLoading(true);
    try {
      await cashShiftService.recordMovement({
        cashShiftId: activeShift.id,
        type,
        amount: amountNum,
        description: movementDescription.trim(),
      });
      setSuccessMsg(
        type === 'bleed'
          ? `Sangria de R$ ${amountNum.toFixed(2)} lançada com sucesso.`
          : `Suprimento de R$ ${amountNum.toFixed(2)} adicionado com sucesso.`
      );
      setMovementAmount('');
      setMovementDescription('');
      await fetchActiveShift();
      setTab('summary');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar movimentação.');
    } finally {
      setLoading(false);
    }
  };

  // Handler de Fechamento de Caixa (Conferência Cega)
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const countedNum = parseFloat(countedAmount.replace(',', '.'));
    if (isNaN(countedNum) || countedNum < 0) {
      setErrorMsg('Informe o valor físico total apurado na gaveta.');
      return;
    }

    setLoading(true);
    try {
      const result = await cashShiftService.closeShift({
        cashShiftId: activeShift.id,
        countedAmount: countedNum,
        closingNotes: closingNotes.trim(),
      });
      setClosedResult(result);
      setSuccessMsg('Turno de caixa encerrado com sucesso!');
      await fetchActiveShift();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao fechar caixa.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className={`${theme === 'light' ? 'terminal-light-surface' : ''} bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}>
        {/* Modal Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                activeShift
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              }`}
            >
              {activeShift ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Controle de Caixa & PDV
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                    activeShift
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {activeShift ? 'Caixa Aberto' : 'Caixa Fechado'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {unitName || 'Unidade'} &bull; Turno: {mealTypeName || 'Atual'} &bull; Terminal:{' '}
                {terminalId.slice(0, 8)}
              </p>
            </div>
          </div>
          {(!requireOpenShift || activeShift) && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50 transition-colors"
              title="Fechar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Status Alerts */}
        {requestCloseShift && activeShift && (
          <div className={`mx-6 mt-4 p-3 border rounded-xl flex items-center gap-2 text-sm font-semibold ${theme === 'light' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-amber-500/15 border-amber-500/30 text-amber-200'}`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Para encerrar a sessÃ£o do operador, confira e feche o caixa deste terminal.</span>
          </div>
        )}
        {errorMsg && (
          <div className={`mx-6 mt-4 p-3 border rounded-xl flex items-center gap-2 text-sm ${theme === 'light' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/15 border-rose-500/30 text-rose-300'}`}>
            <AlertTriangle className={`w-4 h-4 shrink-0 ${theme === 'light' ? 'text-rose-600' : 'text-rose-400'}`} />
            <span className="flex-1">{errorMsg}</span>
            {!activeShift && onExitWithoutShift && (
              <button type="button" onClick={onExitWithoutShift} className="shrink-0 rounded-lg border border-current px-3 py-1.5 text-xs font-bold">
                Sair do terminal
              </button>
            )}
          </div>
        )}
        {successMsg && (
          <div className={`mx-6 mt-4 p-3 border rounded-xl flex items-center gap-2 text-sm ${theme === 'light' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'}`}>
            <CheckCircle className={`w-4 h-4 shrink-0 ${theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'}`} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {!activeShift && !closedResult && (
            /* Formulário de Abertura do Caixa */
            <form onSubmit={handleOpenShift} className="space-y-4">
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-sm text-slate-300 space-y-2">
                <p className="font-semibold text-slate-200">Requisitos para Abertura de PDV:</p>
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-400">
                  <li>O operador deve conferir as cédulas e moedas físicas na gaveta.</li>
                  <li>Informe o Fundo de Troco inicial que está disponível para o turno.</li>
                  <li>Todas as vendas de visitantes e movimentações serão consolidadas neste turno.</li>
                </ul>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Fundo de Troco Inicial (R$)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-400 font-bold">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={openInitialFloat}
                    onChange={(e) => setOpenInitialFloat(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white text-lg font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Botões rápidos de Troco */}
              <div className="flex gap-2">
                {['50.00', '100.00', '150.00', '200.00'].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setOpenInitialFloat(val)}
                    className="flex-1 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                  >
                    R$ {Number(val).toFixed(2)}
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-50"
                >
                  <Unlock className="w-5 h-5" />
                  {loading ? 'Abrindo Caixa...' : 'Confirmar e Abrir Caixa'}
                </button>
              </div>
            </form>
          )}

          {closedResult && (
            /* Recibo de Fechamento de Caixa */
            <div className="space-y-4">
              <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 space-y-4 text-center">
                <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-white">Turno Encerrado</h3>
                <p className="text-xs text-slate-400">
                  O caixa foi fechado e os valores foram consolidados para auditoria.
                </p>

                <div className="grid grid-cols-2 gap-3 text-left pt-2">
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">Saldo Esperado (Sistema)</span>
                    <span className="text-base font-bold text-white">
                      R$ {Number(closedResult.system_expected_balance).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">Valor Contado (Gaveta)</span>
                    <span className="text-base font-bold text-white">
                      R$ {Number(closedResult.counted_closing_balance).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border flex items-center justify-between text-sm font-semibold ${
                    closedResult.difference_amount === 0
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : closedResult.difference_amount > 0
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  <span>Divergência de Caixa:</span>
                  <span>
                    {closedResult.difference_amount === 0
                      ? 'Caixa Batido (R$ 0,00)'
                      : closedResult.difference_amount > 0
                      ? `Sobra de R$ ${Number(closedResult.difference_amount).toFixed(2)}`
                      : `Falta de R$ ${Math.abs(Number(closedResult.difference_amount)).toFixed(2)}`}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl flex items-center justify-center gap-2 border border-slate-700 transition"
                >
                  <Printer className="w-4 h-4" />
                  Imprimir Comprovante
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClosedResult(null);
                    onClose();
                  }}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition"
                >
                  Concluir
                </button>
              </div>
            </div>
          )}

          {activeShift && !closedResult && (
            /* Visualização do Caixa Ativo com Navegação */
            <div className="space-y-4">
              {/* Barra de Abas */}
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setTab('summary')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                    tab === 'summary'
                      ? 'bg-slate-800 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Visão Geral
                </button>
                <button
                  type="button"
                  onClick={() => setTab('bleed')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                    tab === 'bleed'
                      ? 'bg-slate-800 text-rose-400 shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Sangria
                </button>
                <button
                  type="button"
                  onClick={() => setTab('supply')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                    tab === 'supply'
                      ? 'bg-slate-800 text-emerald-400 shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Suprimento
                </button>
                <button
                  type="button"
                  onClick={() => setTab('history')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                    tab === 'history'
                      ? 'bg-slate-800 text-indigo-400 shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Movimentos ({movements.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('close')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                    tab === 'close'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fechar Caixa
                </button>
              </div>

              {/* Aba: Visão Geral */}
              {tab === 'summary' && (
                <div className="space-y-4">
                  {/* Saldo Atual em Destaque */}
                  <div className="bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 p-5 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-xs uppercase tracking-wider text-emerald-400 font-bold block mb-1">
                        Saldo Esperado na Gaveta
                      </span>
                      <span className="text-3xl font-extrabold text-white tracking-tight">
                        R$ {Number(activeShift.expected_cash_balance ?? activeShift.system_expected_balance ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={fetchActiveShift}
                      disabled={loading}
                      title="Atualizar Saldo"
                      className="p-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/20 transition"
                    >
                      <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Cards de Métricas do Turno */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                      <span className="text-[11px] text-slate-400 block font-medium">Troco Inicial</span>
                      <span className="text-base font-bold text-white">
                        R$ {Number(activeShift.initial_float_amount || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                      <span className="text-[11px] text-slate-400 block font-medium">
                        Visitantes ({activeShift.total_visitors_count || 0})
                      </span>
                      <span className="text-base font-bold text-emerald-400">
                        +R$ {Number(activeShift.total_visitors_amount || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                      <span className="text-[11px] text-slate-400 block font-medium">Suprimentos</span>
                      <span className="text-base font-bold text-cyan-400">
                        +R$ {Number(activeShift.total_supplies_amount || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                      <span className="text-[11px] text-slate-400 block font-medium">Sangrias (Cofre)</span>
                      <span className="text-base font-bold text-rose-400">
                        -R$ {Number(activeShift.total_bleed_amount || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Informações de Abertura */}
                  <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-400 flex justify-between items-center">
                    <span>
                      Aberto em:{' '}
                      <strong className="text-slate-300">
                        {new Date(activeShift.opened_at).toLocaleTimeString('pt-BR')}
                      </strong>
                    </span>
                    <span>
                      Operador: <strong className="text-slate-300">{operatorName || 'Operador'}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Aba: Sangria */}
              {tab === 'bleed' && (
                <div className="space-y-4">
                  <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex items-start gap-3">
                    <ArrowDownCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-rose-300 space-y-1">
                      <p className="font-bold text-sm">Realizar Sangria de Caixa</p>
                      <p>
                        Retirada de cédulas em excesso para o cofre da unidade ou malote de segurança,
                        reduzindo o risco operacional no balcão.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Valor da Sangria (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={movementAmount}
                      onChange={(e) => setMovementAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-lg font-bold focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Motivo / Destino do Recolhimento
                    </label>
                    <input
                      type="text"
                      value={movementDescription}
                      onChange={(e) => setMovementDescription(e.target.value)}
                      placeholder="Ex: Recolhimento de excesso para cofre central - Gerente Marcos"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleRecordMovement('bleed')}
                    className="w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30 transition disabled:opacity-50"
                  >
                    <ArrowDownCircle className="w-5 h-5" />
                    Confirmar Sangria
                  </button>
                </div>
              )}

              {/* Aba: Suprimento */}
              {tab === 'supply' && (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-start gap-3">
                    <ArrowUpCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-300 space-y-1">
                      <p className="font-bold text-sm">Adicionar Suprimento de Caixa</p>
                      <p>
                        Entrada de valores extras durante o turno (ex: reforço de moedas ou troco adicional
                        trazido da tesouraria).
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Valor do Suprimento (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={movementAmount}
                      onChange={(e) => setMovementAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-lg font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Justificativa / Origem
                    </label>
                    <input
                      type="text"
                      value={movementDescription}
                      onChange={(e) => setMovementDescription(e.target.value)}
                      placeholder="Ex: Reforço de troco em moedas de 1 real"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleRecordMovement('supply')}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition disabled:opacity-50"
                  >
                    <ArrowUpCircle className="w-5 h-5" />
                    Confirmar Suprimento
                  </button>
                </div>
              )}

              {/* Aba: Histórico de Movimentos */}
              {tab === 'history' && (
                <div className="space-y-3">
                  {movements.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                      Nenhuma movimentação registrada neste turno.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {movements.map((m) => (
                        <div
                          key={m.id}
                          className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`p-1.5 rounded-lg ${
                                ['visitor_sale', 'meal_sale'].includes(m.type)
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : m.type === 'supply'
                                  ? 'bg-cyan-500/20 text-cyan-400'
                                  : m.type === 'bleed'
                                  ? 'bg-rose-500/20 text-rose-400'
                                  : 'bg-indigo-500/20 text-indigo-400'
                              }`}
                            >
                              {m.type === 'bleed' ? (
                                <TrendingDown className="w-3.5 h-3.5" />
                              ) : (
                                <TrendingUp className="w-3.5 h-3.5" />
                              )}
                            </span>
                            <div>
                              <p className="font-semibold text-slate-200">
                                {['visitor_sale', 'meal_sale'].includes(m.type)
                                  ? 'Refeição Visitante (Entrada)'
                                  : m.type === 'supply'
                                  ? 'Suprimento de Troco'
                                  : m.type === 'bleed'
                                  ? 'Sangria de Caixa'
                                  : m.type === 'initial_float'
                                  ? 'Fundo de Troco Inicial'
                                  : 'Ajuste de Caixa'}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {new Date(m.created_at).toLocaleTimeString('pt-BR')} &bull;{' '}
                                {m.description || (m.payment_method ? `Pagamento: ${m.payment_method.toUpperCase()}` : '')}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`font-bold text-sm ${
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
              )}

              {/* Aba: Fechamento de Caixa */}
              {tab === 'close' && (
                <form onSubmit={handleCloseShift} className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/25 p-4 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-300 space-y-1">
                      <p className="font-bold text-sm">Conferência Cega de Caixa</p>
                      <p>
                        Conte todas as cédulas e moedas físicas na gaveta e informe o total real abaixo. O
                        sistema comparará com as vendas e calculará sobras ou faltas para auditoria.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Valor Físico Apurado na Gaveta (R$)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-slate-400 font-bold">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={countedAmount}
                        onChange={(e) => setCountedAmount(e.target.value)}
                        placeholder="0,00"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white text-lg font-bold focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Observações / Justificativas do Fechamento
                    </label>
                    <textarea
                      rows={2}
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      placeholder="Ex: Turno encerrado sem intercorrências; envelopes de sangria entregues ao gerente."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-xs focus:outline-none focus:border-slate-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30 transition disabled:opacity-50"
                  >
                    <Lock className="w-5 h-5" />
                    Encerrar e Fechar Turno de Caixa
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
