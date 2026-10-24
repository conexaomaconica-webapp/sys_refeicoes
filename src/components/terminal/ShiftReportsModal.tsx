'use strict';
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  Printer,
  FileSpreadsheet,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import {
  shiftReportsService,
  type ShiftApprovedMeal,
  type ShiftBlockedAttempt,
} from '@/services/shift-reports.service';
import { useBrand } from '@/components/branding/brand-context';
import { PrintDocument } from '@/components/printing/PrintDocument';
import { openPrintDialog } from '@/lib/print-document';

interface ShiftReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'approved' | 'blocked';
  unitId: string;
  mealTypeId?: string;
  terminalId?: string;
  unitName?: string;
  mealTypeName?: string;
  theme?: 'light' | 'dark';
}

export const ShiftReportsModal: React.FC<ShiftReportsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'approved',
  unitId,
  mealTypeId,
  terminalId,
  unitName,
  mealTypeName,
  theme = 'light',
}) => {
  const { branding } = useBrand();
  const [tab, setTab] = useState<'approved' | 'blocked'>(initialTab);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [printIssuedAt, setPrintIssuedAt] = useState<Date>(() => new Date());

  const [approvedMeals, setApprovedMeals] = useState<ShiftApprovedMeal[]>([]);
  const [blockedAttempts, setBlockedAttempts] = useState<ShiftBlockedAttempt[]>([]);

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const fetchData = useCallback(async () => {
    if (!unitId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await shiftReportsService.getShiftReports(unitId, mealTypeId, terminalId);
      setApprovedMeals(res.approved_meals);
      setBlockedAttempts(res.blocked_attempts);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar relatório do turno.');
    } finally {
      setLoading(false);
    }
  }, [unitId, mealTypeId, terminalId]);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setSearchTerm('');
      setFilterCategory('all');
      fetchData();
    }
  }, [isOpen, initialTab, fetchData]);

  // Filtro de Busca nas Aprovadas
  const filteredApproved = useMemo(() => {
    return approvedMeals.filter((m) => {
      const matchesSearch =
        m.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.registration_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.category_name.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCat =
        filterCategory === 'all' ||
        (filterCategory === 'visitante' && m.category_code === 'visitante') ||
        (filterCategory === 'regular' && m.category_code !== 'visitante');

      return matchesSearch && matchesCat;
    });
  }, [approvedMeals, searchTerm, filterCategory]);

  // Filtro de Busca nas Bloqueadas
  const filteredBlocked = useMemo(() => {
    return blockedAttempts.filter((b) => {
      const name = b.full_name || '';
      return (
        name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.registration_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.reason_message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.reason_code.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [blockedAttempts, searchTerm]);

  // Exportar CSV simples
  const handleExportCSV = () => {
    let csvContent = '';
    if (tab === 'approved') {
      csvContent = 'Data,Horario,Nome,Matricula,Categoria,ValorPago,Status\n';
      filteredApproved.forEach((m) => {
        const dt = new Date(m.consumed_at);
        csvContent += `"${dt.toLocaleDateString('pt-BR')}","${dt.toLocaleTimeString('pt-BR')}","${m.full_name}","${m.registration_number}","${m.category_name}","R$ ${Number(m.student_price).toFixed(2)}","${m.status}"\n`;
      });
    } else {
      csvContent = 'Data,Horario,Nome,Matricula,MotivoBloqueio,CodigoErro\n';
      filteredBlocked.forEach((b) => {
        const dt = new Date(b.attempted_at);
        csvContent += `"${dt.toLocaleDateString('pt-BR')}","${dt.toLocaleTimeString('pt-BR')}","${b.full_name || 'N/A'}","${b.registration_number}","${b.reason_message}","${b.reason_code}"\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `relatorio_${tab}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    setPrintIssuedAt(new Date());
    openPrintDialog(
      `${tab === 'approved' ? 'Refeições aprovadas' : 'Tentativas bloqueadas'} - ${unitName || 'Unidade'}`
    );
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className={`${theme === 'light' ? 'terminal-light-surface' : ''} bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}>
        {/* Header do Modal */}
        <div className="bg-slate-800/90 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Relatório Operacional do Turno
              </h2>
              <p className="text-xs text-slate-400">
                {unitName || 'Unidade'} &bull; Turno: {mealTypeName || 'Atual'} &bull; Terminal:{' '}
                {terminalId || 'Geral'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/50 transition"
            title="Fechar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Abas e Ações */}
        <div className="px-6 pt-4 pb-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {/* Abas */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setTab('approved')}
              className={`flex items-center gap-2 py-2 px-4 text-xs font-bold rounded-lg transition ${
                tab === 'approved'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Aprovadas ({approvedMeals.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('blocked')}
              className={`flex items-center gap-2 py-2 px-4 text-xs font-bold rounded-lg transition ${
                tab === 'blocked'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-950/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <XCircle className="w-4 h-4" />
              <span>Bloqueadas ({blockedAttempts.length})</span>
            </button>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              title="Atualizar lista"
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
              title="Exportar dados filtrados para CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Exportar</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
              title="Imprimir relatório"
            >
              <Printer className="w-4 h-4 text-slate-400" />
              <span>Imprimir</span>
            </button>
          </div>
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="px-6 py-3 bg-slate-950/50 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                tab === 'approved'
                  ? 'Buscar por nome, matrícula ou categoria...'
                  : 'Buscar por nome, matrícula ou motivo de bloqueio...'
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {tab === 'approved' && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
            >
              <option value="all">Todas as Categorias</option>
              <option value="regular">Apenas Regulares (Alunos/Servidores)</option>
              <option value="visitante">Apenas Visitantes (PDV)</option>
            </select>
          )}
        </div>

        {/* Mensagem de Erro */}
        {errorMsg && (
          <div className="mx-6 my-2 p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Tabela de Dados */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <div className="text-center py-16 text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-sky-400" />
              <p className="text-xs">Carregando relatório do turno...</p>
            </div>
          ) : tab === 'approved' ? (
            /* Tabela de Refeições Aprovadas */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Horário</th>
                    <th className="py-2.5 px-3">Comensal</th>
                    <th className="py-2.5 px-3">Matrícula / Código</th>
                    <th className="py-2.5 px-3">Categoria</th>
                    <th className="py-2.5 px-3 text-right">Valor Pago</th>
                    <th className="py-2.5 px-3">Terminal / Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredApproved.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500">
                        Nenhuma refeição aprovada encontrada para os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    filteredApproved.map((m) => {
                      const dt = new Date(m.consumed_at);
                      const isVisitor = m.category_code === 'visitante';
                      return (
                        <tr key={m.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">
                            {dt.toLocaleTimeString('pt-BR')}
                            <span className="text-[10px] text-slate-600 block">
                              {dt.toLocaleDateString('pt-BR')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-bold text-white block">{m.full_name}</span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">
                            {m.registration_number}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                                isVisitor
                                  ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                                  : Number(m.student_price) === 0
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                  : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                              }`}
                            >
                              {m.category_name}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {Number(m.student_price) === 0 ? (
                              <span className="text-emerald-400">Gratuito</span>
                            ) : (
                              <span className="text-slate-100">
                                R$ {Number(m.student_price).toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">
                            {m.terminal_id || 'Terminal'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Tabela de Tentativas Bloqueadas */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Horário</th>
                    <th className="py-2.5 px-3">Comensal Identificado</th>
                    <th className="py-2.5 px-3">Código Bipado</th>
                    <th className="py-2.5 px-3">Motivo do Bloqueio</th>
                    <th className="py-2.5 px-3">Método / Terminal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredBlocked.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-500">
                        Nenhuma tentativa bloqueada registrada neste turno.
                      </td>
                    </tr>
                  ) : (
                    filteredBlocked.map((b) => {
                      const dt = new Date(b.attempted_at);
                      return (
                        <tr key={b.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">
                            {dt.toLocaleTimeString('pt-BR')}
                            <span className="text-[10px] text-slate-600 block">
                              {dt.toLocaleDateString('pt-BR')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {b.full_name ? (
                              <span className="font-bold text-white block">{b.full_name}</span>
                            ) : (
                              <span className="text-slate-500 italic">Não identificado</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-rose-300">
                            {b.registration_number}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="text-rose-200 text-xs font-semibold">
                              {b.reason_message}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {b.reason_code}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">
                            {b.verification_method || 'leitor'} &bull; {b.terminal_id || 'Terminal'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="bg-slate-950 px-6 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Mostrando{' '}
            <strong className="text-slate-200">
              {tab === 'approved' ? filteredApproved.length : filteredBlocked.length}
            </strong>{' '}
            registros de{' '}
            <strong className="text-slate-200">
              {tab === 'approved' ? approvedMeals.length : blockedAttempts.length}
            </strong>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition"
          >
            Fechar
          </button>
        </div>
      </div>

      <PrintDocument
        title={tab === 'approved' ? 'Refeições aprovadas no turno' : 'Tentativas bloqueadas no turno'}
        companyName={branding.app_name}
        logoUrl={branding.logo_url}
        primaryColor={branding.primary_color || branding.terminal_primary_color}
        issuedAt={printIssuedAt}
        metadata={[
          { label: 'Unidade', value: unitName || 'Unidade não informada' },
          { label: 'Turno / refeição', value: mealTypeName || 'Todos' },
          { label: 'Terminal', value: terminalId || 'Todos' },
          {
            label: 'Tipo de relatório',
            value: tab === 'approved' ? 'Refeições aprovadas' : 'Tentativas bloqueadas',
          },
          {
            label: 'Registros exibidos',
            value: tab === 'approved' ? filteredApproved.length : filteredBlocked.length,
          },
          { label: 'Filtro de busca', value: searchTerm.trim() || 'Sem filtro textual' },
        ]}
      >
        {tab === 'approved' ? (
          filteredApproved.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Data e horário</th>
                  <th>Comensal</th>
                  <th>Matrícula / código</th>
                  <th>Categoria</th>
                  <th>Valor pago</th>
                  <th>Subsídio</th>
                  <th>Terminal</th>
                </tr>
              </thead>
              <tbody>
                {filteredApproved.map((meal) => (
                  <tr key={meal.id}>
                    <td>{new Date(meal.consumed_at).toLocaleString('pt-BR')}</td>
                    <td>{meal.full_name}</td>
                    <td>{meal.registration_number}</td>
                    <td>{meal.category_name}</td>
                    <td>R$ {Number(meal.student_price).toFixed(2)}</td>
                    <td>R$ {Number(meal.subsidy_amount).toFixed(2)}</td>
                    <td>{meal.terminal_id || 'Terminal'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="print-empty">Nenhuma refeição aprovada para os filtros aplicados.</div>
          )
        ) : filteredBlocked.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Data e horário</th>
                <th>Comensal</th>
                <th>Código informado</th>
                <th>Motivo do bloqueio</th>
                <th>Método</th>
                <th>Terminal</th>
              </tr>
            </thead>
            <tbody>
              {filteredBlocked.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{new Date(attempt.attempted_at).toLocaleString('pt-BR')}</td>
                  <td>{attempt.full_name || 'Não identificado'}</td>
                  <td>{attempt.registration_number}</td>
                  <td>
                    {attempt.reason_message} ({attempt.reason_code})
                  </td>
                  <td>{attempt.verification_method || 'Leitor'}</td>
                  <td>{attempt.terminal_id || 'Terminal'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="print-empty">Nenhuma tentativa bloqueada para os filtros aplicados.</div>
        )}
      </PrintDocument>
    </div>
  );
};
