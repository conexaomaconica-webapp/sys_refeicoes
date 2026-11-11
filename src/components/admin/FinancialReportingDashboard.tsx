'use client';

import React, { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  FileSpreadsheet,
  Filter,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  ConsolidatedFinancialReport,
  ReportingInitialData,
} from '@/types/financial-reporting';
import { getConsolidatedFinancialReportAction } from '@/app/admin/relatorios/actions';

interface FinancialReportingDashboardProps {
  initialData: ReportingInitialData;
  initialReport: ConsolidatedFinancialReport;
}

export function FinancialReportingDashboard({
  initialData,
  initialReport,
}: FinancialReportingDashboardProps) {
  const [startDate, setStartDate] = useState(initialReport.period.start_date);
  const [endDate, setEndDate] = useState(initialReport.period.end_date);
  const [institutionId, setInstitutionId] = useState(
    initialReport.applied_filters.institution_id || ''
  );
  const [unitId, setUnitId] = useState(
    initialReport.applied_filters.unit_id || ''
  );
  const [categoryId, setCategoryId] = useState(
    initialReport.applied_filters.category_id || ''
  );

  const [report, setReport] = useState<ConsolidatedFinancialReport>(initialReport);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'categories' | 'units' | 'contingency' | 'notes'>('categories');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filtrar unidades pela instituição selecionada
  const filteredUnits = institutionId
    ? initialData.units.filter((u) => u.institutionId === institutionId)
    : initialData.units;

  const handleApplyFilters = () => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const updated = await getConsolidatedFinancialReportAction({
          startDate,
          endDate,
          institutionId: institutionId || undefined,
          unitId: unitId || undefined,
          categoryId: categoryId || undefined,
        });
        setReport(updated);
      } catch (err) {
        setErrorMessage((err as Error).message || 'Erro ao atualizar relatório.');
      }
    });
  };

  const handleSetQuickPeriod = (preset: 'current_month' | 'previous_month' | 'last_30') => {
    const today = new Date();
    if (preset === 'current_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'previous_month') {
      const firstDayPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDayPrev = new Date(today.getFullYear(), today.getMonth(), 0);
      setStartDate(firstDayPrev.toISOString().split('T')[0]);
      setEndDate(lastDayPrev.toISOString().split('T')[0]);
    } else if (preset === 'last_30') {
      const past30 = new Date(today);
      past30.setDate(today.getDate() - 30);
      setStartDate(past30.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    }
  };

  const handleExportExcel = () => {
    const params = new URLSearchParams({
      startDate,
      endDate,
    });
    if (institutionId) params.append('institutionId', institutionId);
    if (unitId) params.append('unitId', unitId);
    if (categoryId) params.append('categoryId', categoryId);

    window.open(`/api/admin/relatorios/export?${params.toString()}`, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(val);
  };

  const summary = report.summary;

  return (
    <div className="space-y-6 text-slate-900 print:text-black">
      {/* CABEÇALHO DO RELATÓRIO E AÇÕES */}
      <header className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm print:border-none print:shadow-none print:p-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-700 print:hidden">
                <Receipt className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 print:text-xl">
                  Relatório Fiscal e Faturamento Consolidado
                </h1>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Prestação de contas contratual, subsídios e segregação de custódia
                </p>
              </div>
            </div>
          </div>

          {/* Botões de Ação e Exportação */}
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isPending || !initialData.userCanExport}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar Excel (.xlsx)
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Imprimir / Salvar PDF
            </button>
          </div>
        </div>

        {/* BARRA DE FILTROS FISCAIS */}
        <div className="mt-6 border-t border-slate-100 pt-5 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-500">
              <Filter className="h-3.5 w-3.5" />
              Filtros de Apuração Contábil
            </span>

            {/* Atalhos de Período */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleSetQuickPeriod('current_month')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
              >
                Mês Atual
              </button>
              <button
                type="button"
                onClick={() => handleSetQuickPeriod('previous_month')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
              >
                Mês Anterior
              </button>
              <button
                type="button"
                onClick={() => handleSetQuickPeriod('last_30')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
              >
                Últimos 30 Dias
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {/* Data Inicial */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Data Inicial
              </label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
                />
              </div>
            </div>

            {/* Data Final */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Data Final
              </label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
                />
              </div>
            </div>

            {/* Instituição */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Instituição
              </label>
              <select
                value={institutionId}
                onChange={(e) => {
                  setInstitutionId(e.target.value);
                  setUnitId('');
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white"
              >
                <option value="">Todas as instituições</option>
                {initialData.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Unidade */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Unidade
              </label>
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white"
              >
                <option value="">Todas as unidades</option>
                {filteredUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Categoria */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Categoria
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs font-bold text-slate-800 outline-none transition focus:border-red-500 focus:bg-white"
              >
                <option value="">Todas as categorias</option>
                {initialData.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Botão de Filtrar */}
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-red-700 bg-red-700 py-2 px-4 text-xs font-black text-white shadow-sm transition hover:bg-red-800 active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
                Atualizar Relatório
              </button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 print:hidden">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </header>

      {/* CABEÇALHO EXCLUSIVO PARA IMPRESSÃO (PDF/PRINT) */}
      <div className="hidden border-b-2 border-slate-900 pb-4 print:block">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black uppercase">MA Refeições — Demonstrativo Financeiro e Fiscal</h2>
            <p className="text-xs text-slate-600">
              Período de Apuração: <strong>{report.period.start_date}</strong> até <strong>{report.period.end_date}</strong>
            </p>
          </div>
          <div className="text-right text-xs">
            <p>Gerado em: {new Date(report.generated_at).toLocaleString('pt-BR')}</p>
            <p className="font-mono text-[10px] text-slate-500">Documento Auditável — Sistema MA Refeições</p>
          </div>
        </div>
      </div>

      {/* CARDS DE SEGREGAÇÃO CONTÁBIL MANDATÓRIA */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-2">
        {/* Faturamento Bruto Total (Valor Facial) */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm print:border-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Faturamento Bruto
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 print:hidden">
              <Scale className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black tracking-tight text-slate-900">
              {formatCurrency(summary.total_gross_invoicing)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {summary.total_meals_delivered.toLocaleString('pt-BR')} refeições totais fornecidas
            </p>
            <div className="mt-2 text-[11px] font-bold text-slate-600">
              Regular: {formatCurrency(summary.gross_meal_amount)} | Contingência: {formatCurrency(summary.contingency_gross_amount)}
            </div>
          </div>
        </div>

        {/* Subsídios Devidos pela Instituição Contratante */}
        <div className="rounded-3xl border border-red-200/80 bg-red-50/40 p-5 shadow-sm print:border-slate-300 print:bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-red-800">
              Subsídio da Instituição
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-red-700 print:hidden">
              <Building2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black tracking-tight text-red-700">
              {formatCurrency(summary.total_institutional_subsidy)}
            </div>
            <p className="mt-1 text-xs text-red-900 font-bold">
              Faturável contra a instituição contratante
            </p>
            <div className="mt-2 text-[11px] font-bold text-slate-600">
              Parciais + Bolsistas Integrais (100%) + Lotes de Contingência
            </div>
          </div>
        </div>

        {/* Receita Realizada (Arrecadação Direta de Comensais) */}
        <div className="rounded-3xl border border-blue-200/80 bg-blue-50/40 p-5 shadow-sm print:border-slate-300 print:bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-blue-800">
              Receita dos Comensais
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700 print:hidden">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black tracking-tight text-blue-700">
              {formatCurrency(summary.student_paid_amount)}
            </div>
            <p className="mt-1 text-xs text-blue-900 font-bold">
              Receita operacional quitada via saldo
            </p>
            <div className="mt-2 text-[11px] font-bold text-slate-600">
              Débito definitivo no momento do consumo
            </div>
          </div>
        </div>

        {/* Saldo sob Custódia (Passivo Circulante das Carteiras) */}
        <div className="rounded-3xl border border-emerald-200/80 bg-emerald-50/40 p-5 shadow-sm print:border-slate-300 print:bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-800">
              Passivo sob Custódia
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 print:hidden">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black tracking-tight text-emerald-800">
              {formatCurrency(summary.current_custody_liability)}
            </div>
            <p className="mt-1 text-xs text-emerald-900 font-bold">
              Saldo total retido nas carteiras dos alunos
            </p>
            <div className="mt-2 text-[11px] font-bold text-slate-600">
              Recargas no período: {formatCurrency(summary.recharges_in_period)}
            </div>
          </div>
        </div>
      </section>

      {/* ABAS DE DETALHAMENTO */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm print:border-none print:p-0">
        {/* Navegação entre Abas */}
        <div className="flex border-b border-slate-200 pb-2 gap-4 text-xs font-black print:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`pb-2 border-b-2 transition ${
              activeTab === 'categories'
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Subsídios por Categoria ({report.category_breakdown.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('units')}
            className={`pb-2 border-b-2 transition ${
              activeTab === 'units'
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Consolidado por Unidade ({report.unit_breakdown.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contingency')}
            className={`pb-2 border-b-2 transition ${
              activeTab === 'contingency'
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Contingência e Ajustes ({report.contingency_breakdown.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`pb-2 border-b-2 transition ${
              activeTab === 'notes'
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Memória de Cálculo e Normas
          </button>
        </div>

        {/* CONTEÚDO DAS ABAS */}
        <div className="mt-5">
          {/* ABA 1: CATEGORIAS E SUBSÍDIOS */}
          {(activeTab === 'categories' || typeof window === 'undefined') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Discriminação por Categoria de Comensal
                  </h3>
                  <p className="text-xs text-slate-500">
                    Memória analítica separando coparticipação estudantil e faturamento de subsídios
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 px-3">Código</th>
                      <th className="py-3 px-3">Categoria</th>
                      <th className="py-3 px-3">Regime</th>
                      <th className="py-3 px-3 text-right">Refeições</th>
                      <th className="py-3 px-3 text-right">Valor Facial (Bruto)</th>
                      <th className="py-3 px-3 text-right">Subsídio Devido</th>
                      <th className="py-3 px-3 text-right">Pago pelo Aluno</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.category_breakdown.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          Nenhum consumo registrado com os filtros informados.
                        </td>
                      </tr>
                    ) : (
                      report.category_breakdown.map((c) => (
                        <tr key={c.category_id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-3 font-mono font-bold text-slate-600">{c.category_code}</td>
                          <td className="py-3 px-3 font-black text-slate-900">{c.category_name}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                                c.is_integral
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-blue-50 text-blue-800'
                              }`}
                            >
                              {c.is_integral ? 'Integral (100% Subsidiado)' : 'Parcial (Coparticipação)'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-black">{c.meals_count.toLocaleString('pt-BR')}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold">{formatCurrency(c.gross_amount)}</td>
                          <td className="py-3 px-3 text-right font-mono font-black text-red-700">{formatCurrency(c.subsidy_amount)}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-blue-700">{formatCurrency(c.student_paid_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {report.category_breakdown.length > 0 && (
                    <tfoot className="border-t-2 border-slate-300 bg-slate-50/80 font-black">
                      <tr>
                        <td colSpan={3} className="py-3 px-3 uppercase">Total Consolidado por Categoria</td>
                        <td className="py-3 px-3 text-right">{summary.regular_meals_served.toLocaleString('pt-BR')}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatCurrency(summary.gross_meal_amount)}</td>
                        <td className="py-3 px-3 text-right font-mono text-red-700">{formatCurrency(summary.regular_subsidy_amount)}</td>
                        <td className="py-3 px-3 text-right font-mono text-blue-700">{formatCurrency(summary.student_paid_amount)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ABA 2: CONSOLIDADO POR UNIDADE */}
          {activeTab === 'units' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Consolidado por Restaurante / Unidade
                  </h3>
                  <p className="text-xs text-slate-500">
                    Visão de faturamento por centro de custo e instituição contratante
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 px-3">Unidade / Restaurante</th>
                      <th className="py-3 px-3">Instituição</th>
                      <th className="py-3 px-3 text-right">Refeições</th>
                      <th className="py-3 px-3 text-right">Faturamento Bruto</th>
                      <th className="py-3 px-3 text-right">Subsídio Devido</th>
                      <th className="py-3 px-3 text-right">Arrecadação Direta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.unit_breakdown.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          Nenhum registro por unidade localizado no período.
                        </td>
                      </tr>
                    ) : (
                      report.unit_breakdown.map((u) => (
                        <tr key={u.unit_id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-3 font-black text-slate-900">{u.unit_name}</td>
                          <td className="py-3 px-3 font-bold text-slate-600">{u.institution_name}</td>
                          <td className="py-3 px-3 text-right font-black">{u.meals_count.toLocaleString('pt-BR')}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold">{formatCurrency(u.gross_amount)}</td>
                          <td className="py-3 px-3 text-right font-mono font-black text-red-700">{formatCurrency(u.subsidy_amount)}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-blue-700">{formatCurrency(u.student_paid_amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ABA 3: CONTINGÊNCIA AUDITADA (SPRINT 13 + SPRINT 20.13) */}
          {activeTab === 'contingency' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Refeições Servidas em Regime de Contingência e Ajustes
                  </h3>
                  <p className="text-xs text-slate-500">
                    Segregação entre regularizações individuais comprovadas, regularizações agregadas e pendências mensais sem alocação por data.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-900">
                    Individuais (Tipo A): {(summary.contingency_identified_meals ?? 0).toLocaleString('pt-BR')} un
                  </span>
                  <span className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">
                    Agregadas (B/C): {(summary.contingency_aggregated_meals ?? summary.contingency_meals_served).toLocaleString('pt-BR')} un
                  </span>
                </div>
              </div>

              {(summary.unallocated_pending_meals_total ?? 0) > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs font-semibold text-amber-950">
                  <strong>Informativo (Não Faturado):</strong> Existem{' '}
                  <strong>{summary.unallocated_pending_meals_total}</strong> refeição(ões) em campanhas mensais ainda pendentes de apuração por data. Esse saldo não compõe o faturamento bruto nem o subsídio devido até conciliação documental.
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 px-3">Data</th>
                      <th className="py-3 px-3">Unidade</th>
                      <th className="py-3 px-3">Turno</th>
                      <th className="py-3 px-3">Tipologia</th>
                      <th className="py-3 px-3 text-right">Refeições</th>
                      <th className="py-3 px-3 text-right">Valor Bruto</th>
                      <th className="py-3 px-3 text-right">Subsídio Aprovado</th>
                      <th className="py-3 px-3">Aprovador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.contingency_breakdown.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-400">
                          Nenhum lote de contingência aprovado no período.
                        </td>
                      </tr>
                    ) : (
                      report.contingency_breakdown.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-3 font-mono font-bold text-slate-600">{b.service_date}</td>
                          <td className="py-3 px-3 font-bold text-slate-900">{b.unit_name}</td>
                          <td className="py-3 px-3">{b.meal_type_name}</td>
                          <td className="py-3 px-3">
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">
                              {b.batch_type === 'type_a_identified'
                                ? 'Tipo A (Lista Identificada)'
                                : b.batch_type === 'type_b_unidentified_count'
                                ? 'Tipo B (Contagem Física)'
                                : 'Tipo C (Ajuste)'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-black">{b.total_meals_served}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold">{formatCurrency(b.total_amount)}</td>
                          <td className="py-3 px-3 text-right font-mono font-black text-red-700">{formatCurrency(b.total_subsidy_amount)}</td>
                          <td className="py-3 px-3 font-bold text-slate-700">{b.approved_by_name || 'Diretoria'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ABA 4: MEMÓRIA CONTÁBIL E NORMAS */}
          {activeTab === 'notes' && (
            <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-5 text-xs text-slate-700">
              <h3 className="font-black text-sm text-slate-900">Princípios Contábeis e Critérios de Apuração</h3>
              <ul className="space-y-3 list-disc pl-4 leading-relaxed">
                <li>
                  <strong>Passivo de Custódia vs Receita Operacional:</strong> Os valores depositados antecipadamente pelos comensais através de Pix, Cartão ou Dinheiro constituem estritamente um <em>Passivo Circulante sob Custódia</em> da MA Refeições. A receita operacional tributável é reconhecida no momento da prestação do serviço (débito em carteira no consumo da refeição).
                </li>
                <li>
                  <strong>Segregação dos Subsídios Devidos:</strong> O subsídio contratual a faturar contra a universidade/instituição corresponde à soma exata das parcelas subsidiadas das refeições consumidas por alunos parciais mais o valor integral das refeições de bolsistas 100% isentos, acrescido dos lotes formais de contingência auditados.
                </li>
                <li>
                  <strong>Contingência sem Comensais Fictícios:</strong> Em conformidade com a Sprint 13, refeições fornecidas durante falha técnica ou falta de energia são lançadas com tipologia própria (Tipo B - Contagem Física) e jamais atribuídas artificialmente a estudantes cadastrados.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* TERMO DE ENCERRAMENTO PARA IMPRESSÃO (PDF/PRINT) */}
      <div className="hidden pt-8 text-xs text-slate-600 print:block">
        <div className="border-t border-slate-300 pt-4">
          <p className="font-bold">Termo de Encerramento e Conformidade:</p>
          <p className="mt-1">
            Certifico que o presente demonstrativo de prestação de contas foi extraído diretamente da base de dados oficial da MA Refeições, refletindo fidedignamente o livro-razão e os consumos validados no período indicado.
          </p>
          <div className="mt-12 flex justify-between gap-12 text-center">
            <div className="flex-1 border-t border-slate-800 pt-1">
              <p className="font-bold text-slate-900">Gestor Operacional da Unidade</p>
              <p className="text-[10px]">MA Refeições</p>
            </div>
            <div className="flex-1 border-t border-slate-800 pt-1">
              <p className="font-bold text-slate-900">Fiscal do Contrato / Instituição</p>
              <p className="text-[10px]">Universidade / Contratante</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

