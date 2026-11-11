'use client';

import React, { useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Upload,
  Plus,
  Search,
  Building2,
  Calendar,
  AlertCircle,
  FileCheck,
  X,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
import type { ContingencyManagementData } from '@/server/contingency/contingency.service';
import type {
  ContingencyMealBatch,
  ContingencyBatchItem,
  ContingencyBatchType,
  IdentifiedStudentInput,
} from '@/types/contingency';
import {
  submitContingencyBatchAction,
  reviewContingencyBatchAction,
  loadBatchItemsAction,
  searchStudentsForContingencyAction,
  uploadContingencyEvidenceAction,
} from './actions';

interface ContingencyManagerProps {
  data: ContingencyManagementData;
}

const BATCH_TYPE_LABELS: Record<ContingencyBatchType, { title: string; desc: string; badge: string }> = {
  type_a_identified: {
    title: 'Tipo A — Lista Física Assinada',
    desc: 'Comensais reais que assinaram na folha de papel na portaria.',
    badge: 'bg-blue-100 text-blue-900 border-blue-200',
  },
  type_b_unidentified_count: {
    title: 'Tipo B — Contagem Física (Apagão/Sem Matrícula)',
    desc: 'Refeições servidas sem identificação individualizada (apuração contábil institucional).',
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  type_c_administrative_adjustment: {
    title: 'Tipo C — Ajuste Administrativo',
    desc: 'Correções contábeis e compensações auditadas no livro-razão.',
    badge: 'bg-purple-100 text-purple-900 border-purple-200',
  },
};

const STATUS_BADGES: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  pending_approval: {
    label: 'Pendente de Aprovação',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: Clock,
  },
  approved: {
    label: 'Aprovado',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejeitado',
    className: 'bg-rose-50 text-rose-800 border-rose-200',
    icon: XCircle,
  },
  draft: {
    label: 'Rascunho',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: Clock,
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: XCircle,
  },
};

export function ContingencyManager({ data }: ContingencyManagerProps) {
  const batches = data.batches;
  const [selectedUnit, setSelectedUnit] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [reviewModalBatch, setReviewModalBatch] = useState<ContingencyMealBatch | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewReason, setReviewReason] = useState('');
  const [viewItemsBatch, setViewItemsBatch] = useState<ContingencyMealBatch | null>(null);
  const [batchItems, setBatchItems] = useState<ContingencyBatchItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Estados do formulário de novo lote
  const [unitId, setUnitId] = useState(data.units[0]?.id || '');
  const [mealTypeId, setMealTypeId] = useState(data.mealTypes[0]?.id || '');
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [batchType, setBatchType] = useState<ContingencyBatchType>('type_b_unidentified_count');
  const [totalMeals, setTotalMeals] = useState<number>(1);
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id || '');
  const [justification, setJustification] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  // Busca e lista de alunos para Tipo A
  const [studentSearch, setStudentSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; fullName: string; registrationNumber: string; categoryName: string }>>([]);
  const [identifiedList, setIdentifiedList] = useState<Array<{ studentId: string; registrationNumber: string; fullName: string; notes?: string }>>([]);

  const filteredBatches = batches.filter((b) => {
    if (selectedUnit !== 'all' && b.unit_id !== selectedUnit) return false;
    if (selectedStatus !== 'all' && b.status !== selectedStatus) return false;
    return true;
  });

  const handleSearchStudents = async (query: string) => {
    setStudentSearch(query);
    if (query.trim().length >= 2) {
      const results = await searchStudentsForContingencyAction(query);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleAddStudent = (student: { id: string; fullName: string; registrationNumber: string }) => {
    if (identifiedList.some((s) => s.studentId === student.id)) return;
    const nextList = [...identifiedList, { studentId: student.id, registrationNumber: student.registrationNumber, fullName: student.fullName }];
    setIdentifiedList(nextList);
    setTotalMeals(nextList.length);
    setStudentSearch('');
    setSearchResults([]);
  };

  const handleRemoveStudent = (studentId: string) => {
    const nextList = identifiedList.filter((s) => s.studentId !== studentId);
    setIdentifiedList(nextList);
    setTotalMeals(Math.max(1, nextList.length));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingEvidence(true);
    setFeedback(null);

    const formData = new FormData();
    formData.append('file', file);

    const res = await uploadContingencyEvidenceAction(formData);
    setUploadingEvidence(false);

    if (res.success && res.url) {
      setEvidenceUrl(res.url);
      setFeedback({ type: 'success', message: 'Documento comprobatório anexado com sucesso.' });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Erro ao fazer upload do arquivo.' });
    }
  };

  const handleSubmitBatch = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const payloadStudents: IdentifiedStudentInput[] =
        batchType === 'type_a_identified'
          ? identifiedList.map((s) => ({
              student_id: s.studentId,
              registration_number: s.registrationNumber,
              notes: s.notes,
            }))
          : [];

      const res = await submitContingencyBatchAction({
        unit_id: unitId,
        meal_type_id: mealTypeId,
        service_date: serviceDate,
        batch_type: batchType,
        total_meals_served: batchType === 'type_a_identified' ? identifiedList.length : totalMeals,
        category_id: categoryId || undefined,
        justification,
        evidence_document_url: evidenceUrl || undefined,
        identified_students: payloadStudents,
      });

      if (res.success) {
        setFeedback({ type: 'success', message: res.message });
        setIsNewModalOpen(false);
        // Atualiza a visualização local
        window.location.reload();
      } else {
        setFeedback({ type: 'error', message: res.error });
      }
    });
  };

  const handleOpenReview = (batch: ContingencyMealBatch, action: 'approve' | 'reject') => {
    setReviewModalBatch(batch);
    setReviewAction(action);
    setReviewReason('');
  };

  const handleConfirmReview = () => {
    if (!reviewModalBatch) return;

    startTransition(async () => {
      const res = await reviewContingencyBatchAction({
        batch_id: reviewModalBatch.id,
        action: reviewAction,
        reason: reviewAction === 'reject' ? reviewReason : undefined,
      });

      if (res.success) {
        setFeedback({ type: 'success', message: res.message });
        setReviewModalBatch(null);
        window.location.reload();
      } else {
        setFeedback({ type: 'error', message: res.error });
      }
    });
  };

  const handleViewItems = async (batch: ContingencyMealBatch) => {
    setViewItemsBatch(batch);
    setLoadingItems(true);
    const res = await loadBatchItemsAction(batch.id);
    setLoadingItems(false);
    if (res.success && res.items) {
      setBatchItems(res.items);
    } else {
      setBatchItems([]);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-red-100 p-2 text-red-700">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight sm:text-3xl">
              Contingência e Regularização Retroativa
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Sprint 13 — Apuração de refeições servidas em pane ou apagão sem criação de comensais fictícios.
          </p>
        </div>

        {data.canCreate && (
          <button
            type="button"
            onClick={() => {
              setIsNewModalOpen(true);
              setFeedback(null);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-red-800 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Lançar Lote de Contingência
          </button>
        )}
      </div>

      {/* Alertas e feedback */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-2xl border p-4 shadow-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-3">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            )}
            <p className="text-sm font-semibold">{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Regra de Ouro da Sprint 13 */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-amber-950 shadow-sm">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong className="font-bold text-amber-900">Princípio Inegociável de Auditoria:</strong>{' '}
            Em caso de apagão ou pane geral (Tipo B), as refeições são faturadas como{' '}
            <em>&quot;Refeições Fornecidas em Regime de Contingência&quot;</em>. É expressamente proibido vincular consumos não
            identificados a matrículas reais aleatórias ou comensais fictícios. O fluxo exige duplo nível de aprovação
            (Gerente lança, Direção de Operações ou Financeiro aprova).
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500">Unidade</label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todas as unidades</option>
              {data.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500">Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todos os status</option>
              <option value="pending_approval">Pendentes de aprovação</option>
              <option value="approved">Aprovados</option>
              <option value="rejected">Rejeitados</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-semibold text-slate-500">
          Mostrando <strong className="text-slate-900">{filteredBatches.length}</strong> lote(s)
        </div>
      </div>

      {/* Lista de Lotes */}
      {filteredBatches.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-600">
          <FileText className="mx-auto h-12 w-12 text-slate-400" />
          <h3 className="mt-3 text-base font-bold text-slate-900">Nenhum lote de contingência registrado</h3>
          <p className="mt-1 text-sm text-slate-500">
            Utilize o botão acima para lançar um registro de contingência física com upload de ata comprobatória.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {filteredBatches.map((batch) => {
            const statusConfig = STATUS_BADGES[batch.status] || STATUS_BADGES.draft;
            const StatusIcon = statusConfig.icon;
            const typeConfig = BATCH_TYPE_LABELS[batch.batch_type];
            const isCreator = batch.operator_id === data.currentUser.id;
            const canDeliberate = data.canReview && batch.status === 'pending_approval' && (!isCreator || data.currentUser.role === 'admin_general');

            return (
              <div
                key={batch.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex flex-col justify-between gap-4 border-b border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${statusConfig.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {statusConfig.label}
                    </span>
                    <span className={`rounded-lg border px-2.5 py-0.5 text-xs font-bold ${typeConfig.badge}`}>
                      {typeConfig.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Data do serviço: <strong className="text-slate-800">{batch.service_date}</strong>
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      <strong className="text-slate-800">{batch.unit_name}</strong>
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Refeição / Turno</span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">{batch.meal_type_name}</p>
                      <p className="text-xs text-slate-500">{batch.category_name}</p>
                    </div>

                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Total Servidas</span>
                      <p className="mt-0.5 text-xl font-black text-slate-900">{batch.total_meals_served} un</p>
                      {batch.batch_type === 'type_a_identified' && (
                        <button
                          type="button"
                          onClick={() => handleViewItems(batch)}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
                        >
                          Ver comensais da lista
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Valores Contratuais</span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">
                        Total: R$ {batch.total_amount.toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Subsídio: R$ {batch.total_subsidy_amount.toFixed(2)}
                      </p>
                    </div>

                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Responsáveis</span>
                      <p className="mt-0.5 text-xs text-slate-700">
                        Lançado por: <strong className="font-semibold">{batch.operator_name}</strong>
                      </p>
                      {batch.approver_name && (
                        <p className="mt-0.5 text-xs text-slate-700">
                          Revisado por: <strong className="font-semibold">{batch.approver_name}</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Justificativa */}
                  <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <strong className="font-bold text-slate-900">Justificativa operacional:</strong>{' '}
                    {batch.justification}
                  </div>

                  {/* Motivo de rejeição */}
                  {batch.rejection_reason && (
                    <div className="mt-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-900 border border-rose-200">
                      <strong className="font-bold">Motivo da Rejeição:</strong> {batch.rejection_reason}
                    </div>
                  )}

                  {/* Rodapé e Ações */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <div>
                      {batch.evidence_document_url ? (
                        <a
                          href={batch.evidence_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          <FileCheck className="h-4 w-4 text-emerald-600" />
                          Ver Ata / Evidência Anexa
                          <ExternalLink className="h-3 w-3 text-slate-400" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Sem evidência anexa</span>
                      )}
                    </div>

                    {/* Botões de deliberação */}
                    <div className="flex items-center gap-2">
                      {isCreator && batch.status === 'pending_approval' && !data.canReview && (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md">
                          Aguardando aprovação da Diretoria / Financeiro
                        </span>
                      )}

                      {canDeliberate && (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleOpenReview(batch, 'reject')}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-300 bg-white px-3.5 py-2 text-xs font-bold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            <XCircle className="h-4 w-4" />
                            Rejeitar
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleOpenReview(batch, 'approve')}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Aprovar Lote
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: NOVO LOTE DE CONTINGÊNCIA */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-red-100 p-2 text-red-700">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <h2 className="text-xl font-black text-slate-900">Novo Lote de Contingência</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitBatch} className="mt-5 space-y-5">
              {/* Tipo de contingência */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-700">Tipo de Contingência</label>
                <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {(Object.keys(BATCH_TYPE_LABELS) as ContingencyBatchType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setBatchType(type)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        batchType === type
                          ? 'border-red-600 bg-red-50 text-red-950 ring-2 ring-red-500/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <strong className="block text-xs font-bold">{BATCH_TYPE_LABELS[type].title}</strong>
                      <span className="mt-1 block text-[11px] text-slate-500 leading-tight">
                        {BATCH_TYPE_LABELS[type].desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Unidade e Turno */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700">Unidade Operacional</label>
                  <select
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    required
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                  >
                    {data.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700">Turno / Refeição</label>
                  <select
                    value={mealTypeId}
                    onChange={(e) => setMealTypeId(e.target.value)}
                    required
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                  >
                    {data.mealTypes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Data e Categoria */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700">Data do Serviço</label>
                  <input
                    type="date"
                    value={serviceDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setServiceDate(e.target.value)}
                    required
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700">Categoria Contratual</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                  >
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Se Tipo A: Busca e Seleção de Alunos Reais da Folha Física */}
              {batchType === 'type_a_identified' ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-blue-950">
                      Comensais que Assinaram a Folha ({identifiedList.length})
                    </label>
                    <span className="text-[11px] font-semibold text-blue-700">
                      Total de refeições calculado automaticamente
                    </span>
                  </div>

                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nome ou matrícula para adicionar..."
                      value={studentSearch}
                      onChange={(e) => handleSearchStudents(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                    />

                    {searchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                        {searchResults.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleAddStudent(s)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-blue-50"
                          >
                            <div>
                              <strong className="block text-slate-900">{s.fullName}</strong>
                              <span className="text-slate-500 font-mono">Matrícula: {s.registrationNumber}</span>
                            </div>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              {s.categoryName}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {identifiedList.length > 0 && (
                    <div className="mt-3 max-h-40 overflow-y-auto space-y-1.5">
                      {identifiedList.map((item) => (
                        <div
                          key={item.studentId}
                          className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 border border-slate-200 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-800">{item.fullName}</span>{' '}
                            <span className="text-slate-500 font-mono">({item.registrationNumber})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveStudent(item.studentId)}
                            className="text-rose-600 hover:text-rose-800 font-bold text-[11px]"
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Se Tipo B ou C: Contagem direta de refeições */
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700">
                    Total de Refeições Servidas
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={totalMeals}
                    onChange={(e) => setTotalMeals(Math.max(1, parseInt(e.target.value) || 1))}
                    required
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Contagem física apurada pela equipe de cozinha ou fiscais de linha.
                  </p>
                </div>
              )}

              {/* Justificativa Detalhada */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-700">
                  Justificativa Operacional (Obrigatória)
                </label>
                <textarea
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  required
                  placeholder="Descreva o incidente que causou o regime de contingência (ex: apagão de energia elétrica às 12h15, catraca 02 travada com fila de 200 alunos)..."
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                />
              </div>

              {/* Upload de Ata / Documento de Evidência */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-700">
                  Documento Comprobatório (Ata de Ocorrência, Foto da Folha ou Laudo)
                </label>
                <div className="mt-1 flex items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50">
                    <Upload className="h-4 w-4 text-slate-500" />
                    <span>{uploadingEvidence ? 'Enviando...' : 'Anexar Documento / Foto'}</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.pdf"
                      onChange={handleFileUpload}
                      disabled={uploadingEvidence}
                      className="hidden"
                    />
                  </label>
                  {evidenceUrl && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Documento anexado
                    </span>
                  )}
                </div>
              </div>

              {/* Ações do Modal */}
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending || uploadingEvidence}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-red-800 disabled:opacity-50"
                >
                  {isPending ? 'Submetendo...' : 'Submeter para Aprovação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELIBERAÇÃO / REVISÃO DO LOTE */}
      {reviewModalBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">
              {reviewAction === 'approve' ? 'Aprovar Lote de Contingência' : 'Rejeitar Lote de Contingência'}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              {reviewAction === 'approve'
                ? 'Ao aprovar, as refeições serão integradas ao faturamento institucional como "Refeições Fornecidas em Regime de Contingência".'
                : 'Informe o motivo detalhado para a rejeição do lote.'}
            </p>

            {reviewAction === 'reject' && (
              <div className="mt-4">
                <label className="block text-xs font-bold uppercase text-slate-700">Motivo da Rejeição</label>
                <textarea
                  rows={3}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  required
                  placeholder="Justifique o motivo da não aprovação..."
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-900 shadow-sm focus:border-red-500 focus:outline-none"
                />
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setReviewModalBatch(null)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleConfirmReview}
                className={`rounded-xl px-5 py-2 text-sm font-bold text-white shadow-md disabled:opacity-50 ${
                  reviewAction === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isPending ? 'Processando...' : reviewAction === 'approve' ? 'Confirmar Aprovação' : 'Confirmar Rejeição'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VER ITENS DO TIPO A */}
      {viewItemsBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative max-h-[85vh] w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Comensais Identificados da Lista Física
                </h3>
                <p className="text-xs text-slate-500">
                  {viewItemsBatch.unit_name} • {viewItemsBatch.service_date} • {viewItemsBatch.meal_type_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewItemsBatch(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {loadingItems ? (
                <div className="py-8 text-center text-xs font-semibold text-slate-500">
                  Carregando comensais da lista...
                </div>
              ) : batchItems.length === 0 ? (
                <div className="py-8 text-center text-xs font-semibold text-slate-500">
                  Nenhum comensal encontrado neste lote.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {batchItems.map((item, idx) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{item.student_name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            Matrícula: {item.registration_number}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {item.category_name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 p-4 text-right">
              <button
                type="button"
                onClick={() => setViewItemsBatch(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
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
