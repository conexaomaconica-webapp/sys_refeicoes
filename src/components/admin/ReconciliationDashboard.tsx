'use client';

import React, { useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  DollarSign,
  FileCheck2,
  Filter,
  Info,
  Lock,
  Printer,
  RefreshCw,
  Scale,
  ShieldAlert,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  closeDailyFinancialPeriodAction,
  getReconciliationDashboardAction,
  resolveDivergenceAction,
  runReconciliationAuditAction,
} from '@/app/admin/conciliacao/actions';
import type {
  DivergenceStatus,
  ReconciliationDashboardData,
  ReconciliationDivergence,
  ReconciliationFilters,
} from '@/types/reconciliation';

interface Props {
  initialData: ReconciliationDashboardData;
}

export function ReconciliationDashboard({ initialData }: Props) {
  const [data, setData] = useState<ReconciliationDashboardData>(initialData);
  const [activeTab, setActiveTab] = useState<'overview' | 'divergences' | 'closings' | 'audit'>('overview');
  const [startDate, setStartDate] = useState(initialData.period.startDate);
  const [endDate, setEndDate] = useState(initialData.period.endDate);
  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [isPending, startTransition] = useTransition();
  const [auditMessage, setAuditMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal de resolução
  const [resolvingDivergence, setResolvingDivergence] = useState<ReconciliationDivergence | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<DivergenceStatus>('resolved');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Modal de fechamento diário persistido (Etapa 20.6)
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [closingDateInput, setClosingDateInput] = useState(initialData.period.endDate);
  const [closingUnitInput, setClosingUnitInput] = useState('');
  const [closingNotesInput, setClosingNotesInput] = useState('');
  const [closingError, setClosingError] = useState<string | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);

  const handleOpenClosingModal = () => {
    setClosingDateInput(endDate);
    setClosingUnitInput(selectedUnit);
    setClosingNotesInput('');
    setClosingError(null);
    setShowClosingModal(true);
  };

  const handleConfirmDailyClosing = async () => {
    setClosingError(null);
    if (!closingDateInput) {
      setClosingError('Informe a data do fechamento.');
      return;
    }
    if (closingNotesInput.trim().length < 5) {
      setClosingError('Informe a justificativa ou observação de conferência (mínimo 5 caracteres).');
      return;
    }
    setIsClosingDay(true);
    try {
      const res = await closeDailyFinancialPeriodAction({
        closingDate: closingDateInput,
        unitId: closingUnitInput || null,
        notes: closingNotesInput.trim(),
      });
      if (res.success) {
        setShowClosingModal(false);
        setAuditMessage({
          text: `Fechamento financeiro de ${closingDateInput} persistido com sucesso na trilha de auditoria!`,
          type: 'success',
        });
        const updated = await getReconciliationDashboardAction({
          startDate,
          endDate,
          unitId: selectedUnit || undefined,
        });
        setData(updated);
      } else {
        setClosingError(res.error || 'Erro ao consolidar fechamento diário.');
      }
    } catch (err) {
      setClosingError((err as Error).message);
    } finally {
      setIsClosingDay(false);
    }
  };

  const handleFilter = () => {
    startTransition(async () => {
      try {
        const filters: ReconciliationFilters = {
          startDate,
          endDate,
          unitId: selectedUnit || undefined,
        };
        const updated = await getReconciliationDashboardAction(filters);
        setData(updated);
        setAuditMessage(null);
      } catch (err) {
        setAuditMessage({ text: (err as Error).message, type: 'error' });
      }
    });
  };

  const handleRunAudit = () => {
    if (!confirm(`Deseja disparar auditoria de conciliação para o período de ${startDate} a ${endDate}?`)) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await runReconciliationAuditAction(startDate, endDate);
        if (res.success) {
          setAuditMessage({ text: 'Auditoria de conciliação concluída e registrada no histórico!', type: 'success' });
          const updated = await getReconciliationDashboardAction({ startDate, endDate, unitId: selectedUnit || undefined });
          setData(updated);
        } else {
          setAuditMessage({ text: res.error || 'Erro ao processar auditoria', type: 'error' });
        }
      } catch (err) {
        setAuditMessage({ text: (err as Error).message, type: 'error' });
      }
    });
  };

  const handleConfirmResolution = async () => {
    if (!resolvingDivergence) return;
    setResolutionError(null);
    if (!resolutionNotes || resolutionNotes.trim().length < 5) {
      setResolutionError('A justificativa deve conter no mínimo 5 caracteres.');
      return;
    }
    setIsResolving(true);
    try {
      const res = await resolveDivergenceAction({
        divergenceId: resolvingDivergence.id,
        resolutionStatus: resolutionStatus as 'resolved' | 'acknowledged_manual' | 'under_review',
        resolutionNotes,
      });

      if (res.success) {
        setResolvingDivergence(null);
        setResolutionNotes('');
        setAuditMessage({ text: 'Divergência resolvida e registrada na trilha auditável!', type: 'success' });
        const updated = await getReconciliationDashboardAction({ startDate, endDate, unitId: selectedUnit || undefined });
        setData(updated);
      } else {
        setResolutionError(res.error || 'Erro ao salvar resolução.');
      }
    } catch (err) {
      setResolutionError((err as Error).message);
    } finally {
      setIsResolving(false);
    }
  };

  const filteredDivergences = data.divergences.filter((d) => {
    if (severityFilter !== 'all' && d.severity !== severityFilter) return false;
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    return true;
  });

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Crítica</span>;
      case 'high':
        return <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">Alta</span>;
      case 'medium':
        return <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-800">Média</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">Baixa</span>;
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'resolved':
        return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">Resolvida</span>;
      case 'under_review':
        return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800">Em Análise</span>;
      case 'acknowledged_manual':
        return <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800">Ciente Manual</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Aberta</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Conciliação Financeira Automática</h1>
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
              Sprint 16 • Auditoria Contábil
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Batimento contínuo entre pagamentos, créditos em carteira, consumo e livro-razão imutável.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunAudit}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
            Executar Auditoria
          </button>

          <a
            href={`/api/admin/conciliacao/export?startDate=${startDate}&endDate=${endDate}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition"
          >
            <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
            Exportar Excel
          </a>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition"
            title="Imprimir ou Salvar PDF"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>
      </div>

      {auditMessage && (
        <div
          className={`flex items-center gap-3 rounded-2xl border p-4 text-sm ${
            auditMessage.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {auditMessage.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
          )}
          <span>{auditMessage.text}</span>
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <label className="block text-xs font-bold text-gray-700">Data Inicial</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700">Data Final</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700">Unidade / Restaurante</label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Todas as Unidades</option>
              {data.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleFilter}
              disabled={isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-black disabled:opacity-50 transition"
            >
              <Filter className="h-4 w-4" />
              Filtrar Dados
            </button>
          </div>
        </div>
      </div>

      {/* Cards de KPIs Principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Volume Auditado</span>
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <Scale className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-gray-900">
              R$ {data.kpis.totalAuditedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
            <p className="mt-1 text-xs text-gray-500">
              Total analisado no período
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Taxa de Conciliação</span>
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-emerald-600">
              {data.kpis.reconciliationRatePercent.toFixed(2)}%
            </span>
            <p className="mt-1 text-xs text-gray-500">
              R$ {data.kpis.matchedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} casados
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Divergências Abertas</span>
            <div className={`rounded-xl p-2 ${data.kpis.openDivergencesCount > 0 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
              <ShieldAlert className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-black ${data.kpis.openDivergencesCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {data.kpis.openDivergencesCount}
            </span>
            <p className="mt-1 text-xs text-red-500 font-medium">
              {data.kpis.criticalDivergencesCount} de gravidade crítica
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Passivo sob Custódia</span>
            <div className={`rounded-xl p-2 ${data.kpis.isCustodyBalanced ? 'bg-purple-50 text-purple-600' : 'bg-red-50 text-red-600'}`}>
              <Wallet className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-gray-900">
              R$ {data.kpis.totalCustodyBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
            <p className={`mt-1 text-xs font-medium ${data.kpis.isCustodyBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
              {data.kpis.isCustodyBalanced
                ? 'Patrimônio equilibrado 1:1 com ledger'
                : `Deriva detectada: R$ ${data.kpis.custodyLedgerDrift.toFixed(2)}`}
            </p>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`whitespace-nowrap pb-4 px-1 border-b-2 font-bold text-sm flex items-center gap-2 ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FileCheck2 className="h-4 w-4" />
            Visão Executiva & Lotes
          </button>

          <button
            onClick={() => setActiveTab('divergences')}
            className={`whitespace-nowrap pb-4 px-1 border-b-2 font-bold text-sm flex items-center gap-2 ${
              activeTab === 'divergences'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Divergências Auditadas ({data.divergences.length})
          </button>

          <button
            onClick={() => setActiveTab('closings')}
            className={`whitespace-nowrap pb-4 px-1 border-b-2 font-bold text-sm flex items-center gap-2 ${
              activeTab === 'closings'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <DollarSign className="h-4 w-4" />
            Fechamento Diário Consolidado
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`whitespace-nowrap pb-4 px-1 border-b-2 font-bold text-sm flex items-center gap-2 ${
              activeTab === 'audit'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Info className="h-4 w-4" />
            Normas & Idempotência
          </button>
        </nav>
      </div>

      {/* Conteúdo das Abas */}

      {/* ABA 1: Visão Executiva & Lotes */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">Status do Último Lote de Conciliação</h2>
            <p className="text-xs text-gray-500 mt-1">
              Registro auditável com verificação atômica de cobranças versus lançamentos no ledger.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <span className="text-xs text-gray-500">Transações Analisadas</span>
                <p className="mt-1 text-xl font-black text-gray-900">
                  {data.latestBatch?.total_payments_analyzed || 0} cobranças / {data.latestBatch?.total_credits_analyzed || 0} créditos
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <span className="text-xs text-gray-500">Casamentos Perfeitos (Matched)</span>
                <p className="mt-1 text-xl font-black text-emerald-600">
                  {data.latestBatch?.matched_count || 0} eventos
                </p>
                <span className="text-xs text-gray-500">
                  R$ {(data.latestBatch?.matched_amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <span className="text-xs text-gray-500">Divergências no Período</span>
                <p className={`mt-1 text-xl font-black ${(data.latestBatch?.divergences_count || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {data.latestBatch?.divergences_count || 0} inconsistências
                </p>
                <span className="text-xs text-gray-500">
                  R$ {(data.latestBatch?.divergences_amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} sob divergência
                </span>
              </div>
            </div>
          </div>

          {/* Segregação de Contas */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-6">
            <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2">
              <Scale className="h-4 w-4 text-blue-700" />
              Equação Contábil Homologada (Sprints 15 & 16)
            </h3>
            <div className="mt-3 text-xs text-blue-800 space-y-2">
              <p>
                <strong>1. Receita Realizada:</strong> Reconhecida exclusivamente no consumo da refeição (<code className="bg-blue-100 px-1 py-0.5 rounded">student_price</code> debitado na catraca). Recargas financeiras são passivo circulante sob custódia.
              </p>
              <p>
                <strong>2. Subsídios Faturáveis:</strong> Apurados por categoria contratual (<code className="bg-blue-100 px-1 py-0.5 rounded">subsidy_amount</code>) e somados aos lotes aprovados de contingência (<code className="bg-blue-100 px-1 py-0.5 rounded">total_subsidy_amount</code>).
              </p>
              <p>
                <strong>3. Bloqueio de Compensações Automáticas:</strong> Proibido gerar créditos artificiais no ledger sem aprovação e auditoria formal prévia.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: Divergências Detectadas */}
      {activeTab === 'divergences' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200">
            <div>
              <label className="text-xs font-bold text-gray-600">Filtrar por Severidade:</label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="ml-2 rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
              >
                <option value="all">Todas as Severidades</option>
                <option value="critical">Crítica</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600">Filtrar por Status:</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="ml-2 rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
              >
                <option value="all">Todos os Status</option>
                <option value="open">Abertas</option>
                <option value="under_review">Em Análise</option>
                <option value="resolved">Resolvidas</option>
                <option value="acknowledged_manual">Ciente Manual</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
              <thead className="bg-gray-50 text-gray-700 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tipo / Severidade</th>
                  <th className="px-4 py-3">Comensal / Aluno</th>
                  <th className="px-4 py-3 text-right">Esperado</th>
                  <th className="px-4 py-3 text-right">Apurado</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                  <th className="px-4 py-3">Descrição da Divergência</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredDivergences.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                      Nenhuma divergência financeira encontrada para os critérios selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredDivergences.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900">{d.divergence_type}</div>
                        <div className="mt-1">{getSeverityBadge(d.severity)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{d.student_name || 'Comensal não identificado'}</div>
                        <div className="text-gray-500 text-[11px]">{d.student_registration || d.student_id || '---'}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        R$ {d.expected_amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        R$ {d.actual_amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        R$ {d.difference_amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={d.description}>
                        {d.description}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(d.status)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.id.startsWith('dyn-div-') ? (
                          <button
                            type="button"
                            onClick={handleRunAudit}
                            title="Clique para gerar um lote oficial no banco antes de registrar resoluções."
                            className="rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 transition"
                          >
                            Persistir Lote
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setResolutionError(null);
                              setResolvingDivergence(d);
                              setResolutionNotes(d.resolution_notes || '');
                            }}
                            className="rounded-lg bg-gray-100 hover:bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-800 transition"
                          >
                            Auditar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 3: Fechamento Diário Consolidado */}
      {activeTab === 'closings' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                Histórico e Consolidação de Fechamentos Diários
              </h3>
              <p className="text-xs text-gray-600">
                Snapshots imutáveis em <code className="rounded bg-gray-100 px-1 py-0.5">financial_daily_closings</code> sem ajustes automáticos no ledger.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenClosingModal}
              disabled={isPending || !data.userCanManage}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              <Lock className="h-4 w-4" />
              Fechar Dia / Persistir Fechamento
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
              <thead className="bg-gray-50 text-gray-700 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Data / Escopo</th>
                  <th className="px-4 py-3 text-right">Pix (R$)</th>
                  <th className="px-4 py-3 text-right">Cartão (R$)</th>
                  <th className="px-4 py-3 text-right">Dinheiro (R$)</th>
                  <th className="px-4 py-3 text-right bg-blue-50 text-blue-900">Recebimentos Brutos (R$)</th>
                  <th className="px-4 py-3 text-right bg-purple-50 text-purple-900">Créditos Ledger (+)</th>
                  <th className="px-4 py-3 text-right bg-purple-50 text-purple-900">Saldo Custódia (R$)</th>
                  <th className="px-4 py-3 text-right bg-emerald-50 text-emerald-900">Receita Realizada (R$)</th>
                  <th className="px-4 py-3 text-right">Subsídio Regular (R$)</th>
                  <th className="px-4 py-3 text-right">Subsídio Contingência (R$)</th>
                  <th className="px-4 py-3 text-center">Status / Auditoria</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.dailyClosings.map((c, i) => {
                  const isBalanced = c.is_persisted
                    ? c.health_status !== 'divergent'
                    : c.status === 'balanced';
                  return (
                    <tr key={c.id || `preview-${c.closing_date}-${i}`} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-bold text-gray-900">
                        <div>{c.closing_date}</div>
                        <div className="text-[11px] font-medium text-gray-500">
                          {c.unit_name || 'Consolidado'}
                        </div>
                        {c.closing_notes && (
                          <div className="mt-1 max-w-[200px] truncate text-[11px] font-normal text-gray-500" title={c.closing_notes}>
                            Obs: {c.closing_notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{c.pix_receipts_amount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{c.card_receipts_amount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{c.cash_receipts_amount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700 bg-blue-50/50">
                        {c.total_receipts_by_method.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-purple-700 bg-purple-50/30">
                        {c.wallet_credits_added.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-purple-900 bg-purple-50/50">
                        {c.closing_custody_balance.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700 bg-emerald-50/50">
                        {c.realized_student_revenue.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{c.contractual_subsidies.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{c.contingency_subsidies.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              c.is_persisted
                                ? 'bg-slate-800 text-white'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {c.is_persisted ? 'Fechamento Persistido' : 'Prévia Dinâmica'}
                          </span>
                          {isBalanced ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                              Equilibrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                              Divergente ({c.unresolved_divergences_count})
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 4: Normas & Idempotência */}
      {activeTab === 'audit' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-blue-600" />
              Princípios Inegociáveis da Sprint 16
            </h3>
            <ul className="text-xs text-gray-600 space-y-3">
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 shrink-0">1.</span>
                <span><strong>Idempotência Absoluta:</strong> Nenhum webhook repetido, reprocessado ou enviado em atraso pode provocar duplo crédito na carteira do aluno.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 shrink-0">2.</span>
                <span><strong>Proibição de Ajustes Ocultos:</strong> Divergências devem ser listadas e justificadas com assinatura do auditor. O sistema não altera o ledger de forma silenciosa.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 shrink-0">3.</span>
                <span><strong>Segregação de Custódia:</strong> O montante financeiro recebido em Pix/Cartão de recargas não é faturamento da empresa fornecedora; permanece sob custódia até o débito na refeição.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600 shrink-0">4.</span>
                <span><strong>Imutabilidade do Ledger:</strong> Todos os créditos e débitos residem na tabela <code className="bg-gray-100 px-1 py-0.5 rounded">wallet_transactions</code> sem operações de DELETE ou UPDATE.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-emerald-600" />
              Critérios de Resolução de Divergências
            </h3>
            <div className="text-xs text-gray-600 space-y-3">
              <p>
                <strong>Em Análise (under_review):</strong> Notificada à equipe de suporte/financeiro para investigação com o gateway de pagamentos.
              </p>
              <p>
                <strong>Resolvida (resolved):</strong> Problema sanado por estorno no gateway ou lançamento auditado regular no livro-razão.
              </p>
              <p>
                <strong>Ciente Manual (acknowledged_manual):</strong> Situação identificada de menor relevância (ex.: atraso de webhook tolerado) documentada sem necessidade de intervenção patrimonial.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Auditoria e Resolução de Divergência */}
      {resolvingDivergence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-gray-900">Auditoria de Divergência</h3>
              <button
                onClick={() => {
                  setResolutionError(null);
                  setResolvingDivergence(null);
                }}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {resolutionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                {resolutionError}
              </div>
            )}

            <div className="text-xs text-gray-600 space-y-2 bg-gray-50 p-3 rounded-xl">
              <div><strong>Tipo:</strong> {resolvingDivergence.divergence_type}</div>
              <div><strong>Comensal:</strong> {resolvingDivergence.student_name || 'N/A'} ({resolvingDivergence.student_registration || 'N/A'})</div>
              <div><strong>Esperado:</strong> R$ {resolvingDivergence.expected_amount.toFixed(2)}</div>
              <div><strong>Apurado:</strong> R$ {resolvingDivergence.actual_amount.toFixed(2)}</div>
              <div><strong>Diferença:</strong> R$ {resolvingDivergence.difference_amount.toFixed(2)}</div>
              <div><strong>Descrição:</strong> {resolvingDivergence.description}</div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700">Status de Resolução</label>
              <select
                value={resolutionStatus}
                onChange={(e) => setResolutionStatus(e.target.value as DivergenceStatus)}
                className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-xs shadow-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="resolved">Resolvida</option>
                <option value="under_review">Em Análise</option>
                <option value="acknowledged_manual">Ciente Manual</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700">
                Justificativa Contábil Obrigatória <span className="text-red-500">*</span>
              </label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Insira os detalhes do parecer técnico ou número do comprovante bancário..."
                rows={3}
                className="mt-1 block w-full rounded-xl border border-gray-300 p-3 text-xs shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setResolvingDivergence(null)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmResolution}
                disabled={isResolving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isResolving ? 'Salvando...' : 'Salvar Resolução'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Fechamento Financeiro Diário */}
      {showClosingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-gray-900">
              Consolidar e Persistir Fechamento Diário
            </h3>
            <p className="text-xs text-gray-600">
              Este registro grava uma fotografia contábil imutável em <code className="rounded bg-gray-100 px-1 py-0.5">financial_daily_closings</code> com sua identificação e justificativa. Nenhum lançamento automático é criado no livro-razão.
            </p>

            {closingError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {closingError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Data do Fechamento <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={closingDateInput}
                  onChange={(e) => setClosingDateInput(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Escopo / Unidade</label>
                <select
                  value={closingUnitInput}
                  onChange={(e) => setClosingUnitInput(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">Consolidado (Todas as Unidades)</option>
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700">
                Justificativa / Parecer de Fechamento <span className="text-red-500">*</span>
              </label>
              <textarea
                value={closingNotesInput}
                onChange={(e) => setClosingNotesInput(e.target.value)}
                placeholder="Ex: Conferência diária de recebimentos, custódia e consumos concluída sem pendências operacionais."
                rows={3}
                className="mt-1 block w-full rounded-xl border border-gray-300 p-3 text-xs shadow-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setShowClosingModal(false)}
                disabled={isClosingDay}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDailyClosing}
                disabled={isClosingDay}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isClosingDay ? 'Persistindo...' : 'Confirmar Fechamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

