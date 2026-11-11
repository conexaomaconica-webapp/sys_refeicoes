'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  CalendarOff,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck,
  FileText,
  Layers,
  Lock,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { MealAdjustmentsWorkspaceData } from '@/server/adjustments/smart-adjustment.service';
import type {
  ContingencyBatchItem,
  ContingencyBatchType,
  ContingencyMealBatch,
  IdentifiedStudentInput,
} from '@/types/contingency';
import type {
  DateContextPreview,
  MealAdjustmentCampaignSummary,
  MealRuleOption,
  SmartAllocationInputItem,
  SmartDistributionLineInput,
  SmartMultiAnalysisResult,
} from '@/types/adjustments';
import {
  loadBatchItemsAction,
  reviewContingencyBatchAction,
  searchStudentsForContingencyAction,
  uploadContingencyEvidenceAction,
} from '@/app/admin/contingencia/actions';
import {
  analyzeMonthlySmartMultiAction,
  previewMultiShiftsDateAction,
  reviewSmartAdjustmentCampaignAction,
  submitRetroactiveDateDistributionAction,
  submitSmartAdjustmentCampaignAction,
  upsertUnitCalendarAction,
} from './actions';

interface Props {
  data: MealAdjustmentsWorkspaceData;
}

const BATCH_TYPE_LABELS: Record<ContingencyBatchType, { title: string; badge: string }> = {
  type_a_identified: {
    title: 'Individual (Lista Comprovada)',
    badge: 'bg-blue-100 text-blue-900 border-blue-200',
  },
  type_b_unidentified_count: {
    title: 'Agregada (Contagem Comprovada)',
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  type_c_administrative_adjustment: {
    title: 'Ajuste Administrativo',
    badge: 'bg-purple-100 text-purple-900 border-purple-200',
  },
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  partially_allocated_pending: {
    label: 'Com Pendência Mensal',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  submitted_for_approval: {
    label: 'Aguardando Aprovação',
    className: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  pending_approval: {
    label: 'Pendente de Aprovação',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  approved: { label: 'Aprovado', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Rejeitado', className: 'bg-rose-50 text-rose-800 border-rose-200' },
  cancelled: { label: 'Cancelado', className: 'bg-slate-100 text-slate-500 border-slate-200' },
};

interface SingleDistributionRow {
  row_id: string;
  meal_type_id: string;
  category_id: string;
  batch_type: ContingencyBatchType;
  quantity: number;
  selectedStudents: Array<IdentifiedStudentInput & { fullName: string; categoryName: string; categoryId: string }>;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

export function MealAdjustmentsManager({ data }: Props) {
  const [activeTab, setActiveTab] = useState<'single_date' | 'smart_monthly'>('single_date');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filtros do Histórico Único
  const [filterUnit, setFilterUnit] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Helpers dinâmicos de turnos habilitados e categorias com regras ativas
  const getEnabledMealTypesForUnit = (unitId: string) => {
    const enabledIds = new Set(
      data.unitMealTypes.filter((u) => u.unit_id === unitId && u.enabled).map((u) => u.meal_type_id)
    );
    return data.mealTypes.filter((m) => enabledIds.has(m.id));
  };

  const getEffectiveRule = (
    unitId: string,
    mealTypeId: string,
    categoryId: string,
    referenceDate?: string
  ): MealRuleOption | null => {
    const matches = data.mealRules.filter(
      (r) => r.unit_id === unitId && r.meal_type_id === mealTypeId && r.category_id === categoryId && r.enabled
    );
    if (matches.length === 0) return null;
    if (!referenceDate) {
      return [...matches].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
    }
    const effective = matches
      .filter((r) => {
        const from = r.effective_from.slice(0, 10);
        const to = r.effective_to ? r.effective_to.slice(0, 10) : null;
        return from <= referenceDate && (!to || to >= referenceDate);
      })
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return effective[0] || null;
  };

  const getPermittedCategoriesForUnitShift = (
    unitId: string,
    mealTypeId: string,
    referenceDate?: string
  ) => {
    const allowedIds = new Set(
      data.mealRules
        .filter((r) => {
          if (r.unit_id !== unitId || r.meal_type_id !== mealTypeId || !r.enabled) return false;
          if (!referenceDate) return true;
          const from = r.effective_from.slice(0, 10);
          const to = r.effective_to ? r.effective_to.slice(0, 10) : null;
          return from <= referenceDate && (!to || to >= referenceDate);
        })
        .map((r) => r.category_id)
    );
    return data.categories.filter((c) => allowedIds.has(c.id));
  };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialUnitId = data.units[0]?.id || '';
  const initialEnabledShifts = useMemo(
    () => getEnabledMealTypesForUnit(initialUnitId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialUnitId]
  );

  // --- ABA 1: RETROATIVO POR DATA ESPECÍFICA (MULTI-TURNO E CATEGORIA OBRIGATÓRIA) ---
  const [singleUnitId, setSingleUnitId] = useState(initialUnitId);
  const [singleSelectedMealTypeIds, setSingleSelectedMealTypeIds] = useState<string[]>(
    initialEnabledShifts[0] ? [initialEnabledShifts[0].id] : []
  );
  const [singleDate, setSingleDate] = useState(todayIso);
  const [singleProvenTotal, setSingleProvenTotal] = useState(1);
  const [singleRows, setSingleRows] = useState<SingleDistributionRow[]>(() => {
    const mtId = initialEnabledShifts[0]?.id || '';
    const cats = mtId ? getPermittedCategoriesForUnitShift(initialUnitId, mtId, todayIso) : [];
    if (!mtId || cats.length === 0) return [];
    return [
      {
        row_id: 'single-row-1',
        meal_type_id: mtId,
        category_id: cats[0].id,
        batch_type: 'type_b_unidentified_count',
        quantity: 1,
        selectedStudents: [],
      },
    ];
  });
  const [singleAllowClosed, setSingleAllowClosed] = useState(false);
  const [singleJustification, setSingleJustification] = useState('');
  const [singleEvidenceUrl, setSingleEvidenceUrl] = useState('');
  const [uploadingSingle, setUploadingSingle] = useState(false);
  const [datePreviews, setDatePreviews] = useState<Array<{ meal_type_id: string; preview: DateContextPreview }>>([]);
  const [showSinglePreviewModal, setShowSinglePreviewModal] = useState(false);

  // Busca de alunos por linha Tipo A na Modalidade 1
  const [activeStudentRowId, setActiveStudentRowId] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; fullName: string; registrationNumber: string; categoryId: string; categoryName: string }>
  >([]);
  const [searchingStudents, setSearchingStudents] = useState(false);

  // --- ABA 2: AJUSTE INTELIGENTE MENSAL (MÚLTIPLOS TURNOS E LINHAS POR CATEGORIA) ---
  const [smartUnitId, setSmartUnitId] = useState(initialUnitId);
  const [smartSelectedMealTypeIds, setSmartSelectedMealTypeIds] = useState<string[]>(
    initialEnabledShifts[0] ? [initialEnabledShifts[0].id] : []
  );
  const [smartCompetence, setSmartCompetence] = useState(todayIso.slice(0, 7));
  const [smartProvenTotal, setSmartProvenTotal] = useState(10);
  const [smartLines, setSmartLines] = useState<SmartDistributionLineInput[]>(() => {
    const mtId = initialEnabledShifts[0]?.id || '';
    const cats = mtId ? getPermittedCategoriesForUnitShift(initialUnitId, mtId) : [];
    if (!mtId || cats.length === 0) return [];
    return [
      {
        line_id: 'smart-line-1',
        meal_type_id: mtId,
        category_id: cats[0].id,
        quantity: 10,
      },
    ];
  });
  const [smartSubmode, setSmartSubmode] = useState<
    'smart_quantity_distribution' | 'smart_individual_reconciliation'
  >('smart_quantity_distribution');
  const [smartJustification, setSmartJustification] = useState('');
  const [smartEvidenceUrl, setSmartEvidenceUrl] = useState('');
  const [uploadingSmart, setUploadingSmart] = useState(false);
  const [allowClosedDates, setAllowClosedDates] = useState(false);
  const [physicalInputs, setPhysicalInputs] = useState<Record<string, string>>({});
  const [multiAnalysis, setMultiAnalysis] = useState<SmartMultiAnalysisResult | null>(null);
  const [activeLineId, setActiveLineId] = useState<string>('');
  const [lineDateAllocations, setLineDateAllocations] = useState<Record<string, Record<string, number>>>({});
  const [selectedDateByLine, setSelectedDateByLine] = useState<Record<string, string>>({});
  const [confirmedByLine, setConfirmedByLine] = useState<
    Record<string, Record<string, Record<string, { checked: boolean; notes: string; registration_number: string }>>>
  >({});
  const [showSmartConfirmModal, setShowSmartConfirmModal] = useState(false);

  // --- MODAL: CALENDÁRIO OPERACIONAL ---
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calUnitId, setCalUnitId] = useState(initialUnitId);
  const [calDate, setCalDate] = useState(todayIso);
  const [calMealTypeId, setCalMealTypeId] = useState('');
  const [calOperating, setCalOperating] = useState(false);
  const [calReason, setCalReason] = useState('');

  // --- MODAIS DE REVISÃO E ITENS ---
  const [reviewBatch, setReviewBatch] = useState<ContingencyMealBatch | null>(null);
  const [reviewCampaign, setReviewCampaign] = useState<MealAdjustmentCampaignSummary | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewReason, setReviewReason] = useState('');
  const [viewItemsBatch, setViewItemsBatch] = useState<ContingencyMealBatch | null>(null);
  const [batchItems, setBatchItems] = useState<ContingencyBatchItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const singleEnabledMealTypes = useMemo(
    () => getEnabledMealTypesForUnit(singleUnitId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [singleUnitId, data.unitMealTypes]
  );

  const smartEnabledMealTypes = useMemo(
    () => getEnabledMealTypesForUnit(smartUnitId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [smartUnitId, data.unitMealTypes]
  );

  const singleRowsTotal = useMemo(
    () =>
      singleRows.reduce(
        (acc, r) =>
          acc + (r.batch_type === 'type_a_identified' ? r.selectedStudents.length : Math.max(0, r.quantity || 0)),
        0
      ),
    [singleRows]
  );

  const smartLinesRequestedTotal = useMemo(
    () => smartLines.reduce((acc, l) => acc + Math.max(0, Math.floor(l.quantity || 0)), 0),
    [smartLines]
  );

  const handleUploadEvidence = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'single' | 'smart'
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (target === 'single') setUploadingSingle(true);
    else setUploadingSmart(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await uploadContingencyEvidenceAction(formData);
      if (res.success && res.url) {
        if (target === 'single') setSingleEvidenceUrl(res.url);
        else setSmartEvidenceUrl(res.url);
        setFeedback({ type: 'success', message: 'Evidência anexada ao storage com segurança.' });
      } else {
        setFeedback({ type: 'error', message: res.error || 'Falha no upload de evidência.' });
      }
    } finally {
      if (target === 'single') setUploadingSingle(false);
      else setUploadingSmart(false);
    }
  };

  // --- HANDLERS MODALIDADE 1 ---
  const handleToggleSingleShift = (mealTypeId: string) => {
    setDatePreviews([]);
    setSingleSelectedMealTypeIds((prev) => {
      const next = prev.includes(mealTypeId) ? prev.filter((id) => id !== mealTypeId) : [...prev, mealTypeId];
      setSingleRows((rows) => {
        const filtered = rows.filter((r) => next.includes(r.meal_type_id));
        if (next.length > 0 && filtered.length === 0) {
          const cats = getPermittedCategoriesForUnitShift(singleUnitId, next[0], singleDate);
          if (cats.length > 0) {
            return [
              {
                row_id: `single-row-${Date.now()}`,
                meal_type_id: next[0],
                category_id: cats[0].id,
                batch_type: 'type_b_unidentified_count',
                quantity: 1,
                selectedStudents: [],
              },
            ];
          }
        }
        return filtered;
      });
      return next;
    });
  };

  const handleAddSingleRow = () => {
    const availableShift = singleSelectedMealTypeIds[0];
    if (!availableShift) {
      setFeedback({ type: 'error', message: 'Selecione ao menos um turno habilitado acima.' });
      return;
    }
    // Procura primeiro par (turno, categoria) ainda não utilizado
    for (const mtId of singleSelectedMealTypeIds) {
      const cats = getPermittedCategoriesForUnitShift(singleUnitId, mtId, singleDate);
      for (const c of cats) {
        if (!singleRows.some((r) => r.meal_type_id === mtId && r.category_id === c.id)) {
          setSingleRows((prev) => [
            ...prev,
            {
              row_id: `single-row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              meal_type_id: mtId,
              category_id: c.id,
              batch_type: 'type_b_unidentified_count',
              quantity: 1,
              selectedStudents: [],
            },
          ]);
          return;
        }
      }
    }
    setFeedback({
      type: 'error',
      message: 'Todos os pares Turno × Categoria com regra ativa na data já foram adicionados.',
    });
  };

  const handleLoadDatePreview = () => {
    setFeedback(null);
    if (singleSelectedMealTypeIds.length === 0) {
      setFeedback({ type: 'error', message: 'Marque ao menos um turno para consultar a prévia da data.' });
      return;
    }
    startTransition(async () => {
      const res = await previewMultiShiftsDateAction(singleUnitId, singleSelectedMealTypeIds, singleDate);
      if (res.success && res.previews) {
        setDatePreviews(res.previews);
      } else {
        setFeedback({ type: 'error', message: res.error || 'Erro ao gerar prévia da data.' });
      }
    });
  };

  const handleSearchStudentsForRow = async (rowId: string, query: string, categoryId: string) => {
    setActiveStudentRowId(rowId);
    setStudentQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchingStudents(true);
    try {
      const list = await searchStudentsForContingencyAction(query, categoryId || undefined);
      setSearchResults(list);
    } finally {
      setSearchingStudents(false);
    }
  };

  const validateSingleRowsBeforePreview = (): string | null => {
    if (singleSelectedMealTypeIds.length === 0) {
      return 'Selecione ao menos um turno habilitado.';
    }
    if (singleRows.length === 0) {
      return 'Adicione ao menos uma linha de distribuição (Turno + Categoria + Quantidade).';
    }
    if (singleRowsTotal > singleProvenTotal) {
      return `Soma das linhas (${singleRowsTotal}) excede o total comprovado informado (${singleProvenTotal}).`;
    }
    const seenPairs = new Set<string>();
    const studentShiftSet = new Set<string>();
    for (const r of singleRows) {
      if (!r.meal_type_id || !r.category_id) {
        return 'Toda linha exige turno e categoria administrativa selecionados.';
      }
      const pairKey = `${r.meal_type_id}|${r.category_id}`;
      if (seenPairs.has(pairKey)) {
        return 'Não repita o mesmo par Turno + Categoria nas linhas da data.';
      }
      seenPairs.add(pairKey);

      const rule = getEffectiveRule(singleUnitId, r.meal_type_id, r.category_id, singleDate);
      if (!rule) {
        const cName = data.categories.find((c) => c.id === r.category_id)?.name || 'Categoria';
        return `Categoria "${cName}" não possui regra tarifária vigente em ${singleDate} para este turno.`;
      }

      if (r.batch_type === 'type_a_identified') {
        if (r.selectedStudents.length === 0) {
          return 'Linhas individuais exigem ao menos um comensal identificado.';
        }
        for (const st of r.selectedStudents) {
          const stKey = `${st.student_id}|${r.meal_type_id}`;
          if (studentShiftSet.has(stKey)) {
            return `Estudante ${st.fullName} (${st.registration_number}) selecionado em duplicidade para o mesmo turno na data.`;
          }
          studentShiftSet.add(stKey);
        }
      } else if (r.quantity <= 0) {
        return 'A quantidade de cada linha deve ser maior que zero.';
      }
    }
    if (singleJustification.trim().length < 10) {
      return 'Justificativa operacional obrigatória (mínimo 10 caracteres).';
    }
    return null;
  };

  const handleOpenSinglePreview = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const err = validateSingleRowsBeforePreview();
    if (err) {
      setFeedback({ type: 'error', message: err });
      return;
    }
    setShowSinglePreviewModal(true);
  };

  const handleConfirmSubmitSingleDate = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await submitRetroactiveDateDistributionAction({
        unit_id: singleUnitId,
        service_date: singleDate,
        justification: singleJustification,
        evidence_document_url: singleEvidenceUrl || undefined,
        allow_closed_period: singleAllowClosed,
        lines: singleRows.map((r) => ({
          meal_type_id: r.meal_type_id,
          category_id: r.category_id,
          batch_type: r.batch_type,
          quantity: r.batch_type === 'type_a_identified' ? r.selectedStudents.length : r.quantity,
          identified_students:
            r.batch_type === 'type_a_identified'
              ? r.selectedStudents.map((s) => ({
                  student_id: s.student_id || '',
                  registration_number: s.registration_number,
                  notes: s.notes || 'Lista física conferida',
                }))
              : undefined,
        })),
      });

      if (res.success) {
        setShowSinglePreviewModal(false);
        setFeedback({
          type: 'success',
          message: `${singleRows.length} lote(s) retroativo(s) em ${singleDate} submetido(s) para aprovação gerencial.`,
        });
        setSingleJustification('');
        setSingleEvidenceUrl('');
        setDatePreviews([]);
        setSingleRows((prev) =>
          prev.map((r) => ({ ...r, quantity: 1, selectedStudents: [] }))
        );
      } else {
        setFeedback({ type: 'error', message: ('error' in res && res.error) || 'Erro ao submeter lotes.' });
      }
    });
  };

  // --- HANDLERS MODALIDADE 2 ---
  const handleToggleSmartShift = (mealTypeId: string) => {
    setMultiAnalysis(null);
    setSmartSelectedMealTypeIds((prev) => {
      const next = prev.includes(mealTypeId) ? prev.filter((id) => id !== mealTypeId) : [...prev, mealTypeId];
      setSmartLines((lines) => {
        const filtered = lines.filter((l) => next.includes(l.meal_type_id));
        if (next.length > 0 && filtered.length === 0) {
          const cats = getPermittedCategoriesForUnitShift(smartUnitId, next[0]);
          if (cats.length > 0) {
            return [
              {
                line_id: `smart-line-${Date.now()}`,
                meal_type_id: next[0],
                category_id: cats[0].id,
                quantity: smartProvenTotal,
              },
            ];
          }
        }
        return filtered;
      });
      return next;
    });
  };

  const handleAddSmartLine = () => {
    setMultiAnalysis(null);
    if (smartSelectedMealTypeIds.length === 0) {
      setFeedback({ type: 'error', message: 'Selecione ao menos um turno habilitado acima.' });
      return;
    }
    const remaining = Math.max(1, smartProvenTotal - smartLinesRequestedTotal);
    for (const mtId of smartSelectedMealTypeIds) {
      const cats = getPermittedCategoriesForUnitShift(smartUnitId, mtId);
      for (const c of cats) {
        if (!smartLines.some((l) => l.meal_type_id === mtId && l.category_id === c.id)) {
          setSmartLines((prev) => [
            ...prev,
            {
              line_id: `smart-line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              meal_type_id: mtId,
              category_id: c.id,
              quantity: remaining,
            },
          ]);
          return;
        }
      }
    }
    setFeedback({
      type: 'error',
      message: 'Todos os pares Turno × Categoria permitidos para esta unidade já estão nas linhas.',
    });
  };

  const handleRunSmartAnalysis = () => {
    setFeedback(null);
    if (smartSelectedMealTypeIds.length === 0) {
      setFeedback({ type: 'error', message: 'Marque ao menos um turno habilitado na unidade.' });
      return;
    }
    if (smartLines.length === 0) {
      setFeedback({ type: 'error', message: 'Adicione ao menos uma linha (Turno + Categoria + Quantidade).' });
      return;
    }
    if (smartLinesRequestedTotal > smartProvenTotal) {
      setFeedback({
        type: 'error',
        message: `Soma das linhas (${smartLinesRequestedTotal}) ultrapassa o total comprovado (${smartProvenTotal}).`,
      });
      return;
    }

    const parsedDailyEvidence: Record<string, { physicalTotalServed: number; sourceRef: string }> = {};
    for (const [dt, val] of Object.entries(physicalInputs)) {
      const num = Number(val);
      if (val.trim() !== '' && Number.isFinite(num) && num >= 0) {
        parsedDailyEvidence[dt] = { physicalTotalServed: Math.floor(num), sourceRef: 'Informado na conferência' };
      }
    }

    startTransition(async () => {
      const res = await analyzeMonthlySmartMultiAction({
        unitId: smartUnitId,
        competenceMonth: smartCompetence,
        provenTotalMeals: smartProvenTotal,
        lines: smartLines,
        dailyServedEvidence: Object.keys(parsedDailyEvidence).length > 0 ? parsedDailyEvidence : undefined,
        allowClosedDates,
      });

      if (!res.success || !res.analysis) {
        setFeedback({ type: 'error', message: res.error || 'Erro ao analisar competência.' });
        return;
      }

      setMultiAnalysis(res.analysis);
      setActiveLineId(res.analysis.lines[0]?.line_id || '');
      const nextAlloc: Record<string, Record<string, number>> = {};
      const nextDates: Record<string, string> = {};
      for (const line of res.analysis.lines) {
        nextAlloc[line.line_id] = {};
        for (const day of line.analysis.days) {
          nextAlloc[line.line_id][day.date] = day.auto_allocatable_qty;
        }
        const firstWithStudents = line.analysis.days.find(
          (d) => (d.eligible_non_consumers || d.gap_candidates).length > 0
        );
        nextDates[line.line_id] = firstWithStudents?.date || line.analysis.days[0]?.date || '';
      }
      setLineDateAllocations(nextAlloc);
      setSelectedDateByLine(nextDates);
      setConfirmedByLine({});
    });
  };

  const handleApplySuggestedConferenceLine = (lineId: string) => {
    const lineItem = multiAnalysis?.lines.find((l) => l.line_id === lineId);
    if (!lineItem) return;
    const next: Record<string, number> = {};
    for (const day of lineItem.analysis.days) {
      next[day.date] = day.suggested_conference_qty;
    }
    setLineDateAllocations((prev) => ({ ...prev, [lineId]: next }));
  };

  const handleClearLineAllocationsToPending = (lineId: string) => {
    const lineItem = multiAnalysis?.lines.find((l) => l.line_id === lineId);
    if (!lineItem) return;
    const next: Record<string, number> = {};
    for (const day of lineItem.analysis.days) {
      next[day.date] = 0;
    }
    setLineDateAllocations((prev) => ({ ...prev, [lineId]: next }));
  };

  const allocatedByLineMap = useMemo(() => {
    const result: Record<string, number> = {};
    if (!multiAnalysis) return result;

    for (const line of multiAnalysis.lines) {
      if (smartSubmode === 'smart_quantity_distribution') {
        const map = lineDateAllocations[line.line_id] || {};
        result[line.line_id] = Object.values(map).reduce(
          (acc, val) => acc + Math.max(0, Math.floor(val || 0)),
          0
        );
      } else {
        let count = 0;
        const lineDays = confirmedByLine[line.line_id] || {};
        for (const dayMap of Object.values(lineDays)) {
          for (const entry of Object.values(dayMap)) {
            if (entry.checked) count += 1;
          }
        }
        result[line.line_id] = count;
      }
    }
    return result;
  }, [multiAnalysis, smartSubmode, lineDateAllocations, confirmedByLine]);

  const smartAllocatedSum = useMemo(
    () => Object.values(allocatedByLineMap).reduce((acc, v) => acc + v, 0),
    [allocatedByLineMap]
  );

  const smartPendingUnallocated = Math.max(0, smartProvenTotal - smartAllocatedSum);

  const handleSubmitSmartCampaign = () => {
    if (!multiAnalysis) return;
    setFeedback(null);

    if (smartAllocatedSum > smartProvenTotal) {
      setFeedback({
        type: 'error',
        message: `Total distribuído (${smartAllocatedSum}) não pode ultrapassar o comprovado (${smartProvenTotal}).`,
      });
      return;
    }

    const allocations: SmartAllocationInputItem[] = [];
    const seenStudentShiftDate = new Set<string>();

    for (const line of multiAnalysis.lines) {
      const lineAllocated = allocatedByLineMap[line.line_id] || 0;
      if (lineAllocated > line.requested_quantity) {
        setFeedback({
          type: 'error',
          message: `A distribuição de ${line.meal_type_name} (${line.category_name}) excedeu o solicitado na linha (${lineAllocated} > ${line.requested_quantity}).`,
        });
        return;
      }

      if (smartSubmode === 'smart_quantity_distribution') {
        const dayMap = lineDateAllocations[line.line_id] || {};
        for (const day of line.analysis.days) {
          const qty = Math.max(0, Math.floor(dayMap[day.date] || 0));
          if (qty <= 0) continue;
          allocations.push({
            service_date: day.date,
            meal_type_id: line.meal_type_id,
            category_id: line.category_id,
            quantity: qty,
            notes: `${smartJustification.trim()} [${line.meal_type_name} • ${line.category_name} | Base: ${
              day.reasons.join('; ') || 'Conferência mensal'
            }]`,
          });
        }
      } else {
        const lineDays = confirmedByLine[line.line_id] || {};
        for (const [dt, studentMap] of Object.entries(lineDays)) {
          const items = Object.entries(studentMap)
            .filter(([, entry]) => entry.checked)
            .map(([studentId, entry]) => ({
              student_id: studentId,
              registration_number: entry.registration_number,
              notes: entry.notes.trim(),
            }));

          if (items.length === 0) continue;
          if (items.some((it) => it.notes.length < 3)) {
            setFeedback({
              type: 'error',
              message: `Em ${dt} (${line.meal_type_name}), todo estudante marcado exige referência documental (mínimo 3 caracteres).`,
            });
            return;
          }
          for (const it of items) {
            const key = `${it.student_id}|${dt}|${line.meal_type_id}`;
            if (seenStudentShiftDate.has(key)) {
              setFeedback({
                type: 'error',
                message: `Estudante ${it.registration_number} duplicado no mesmo turno (${line.meal_type_name}) e data (${dt}).`,
              });
              return;
            }
            seenStudentShiftDate.add(key);
          }

          allocations.push({
            service_date: dt,
            meal_type_id: line.meal_type_id,
            category_id: line.category_id,
            quantity: items.length,
            notes: `${smartJustification.trim()} [${line.meal_type_name} • ${line.category_name}]`,
            identified_students: items,
          });
        }
      }
    }

    startTransition(async () => {
      const mealTypeIds = Array.from(new Set(multiAnalysis.lines.map((l) => l.meal_type_id)));
      const res = await submitSmartAdjustmentCampaignAction({
        unit_id: smartUnitId,
        meal_type_id: mealTypeIds.length === 1 ? mealTypeIds[0] : null,
        meal_type_ids: mealTypeIds,
        distribution_lines: multiAnalysis.lines.map((l) => ({
          meal_type_id: l.meal_type_id,
          category_id: l.category_id,
          quantity: l.requested_quantity,
        })),
        competence_month: smartCompetence,
        modality: smartSubmode,
        proven_total_meals: smartProvenTotal,
        allocations,
        analysis_snapshot: {
          operating_days_max: multiAnalysis.operating_days_max,
          total_statistical_gaps: multiAnalysis.total_statistical_gaps,
          total_excluded_duplicates: multiAnalysis.total_excluded_duplicates,
          lines: multiAnalysis.lines.map((l) => ({
            meal_type_id: l.meal_type_id,
            meal_type_name: l.meal_type_name,
            category_id: l.category_id,
            category_name: l.category_name,
            requested_quantity: l.requested_quantity,
            allocated_quantity: allocatedByLineMap[l.line_id] || 0,
            statistical_gaps: l.analysis.total_statistical_gaps,
            excluded_duplicates: l.analysis.excluded_duplicates_count,
          })),
        },
        justification: smartJustification,
        evidence_document_url: smartEvidenceUrl || undefined,
        allow_closed_period: allowClosedDates,
      });

      if (res.success) {
        setShowSmartConfirmModal(false);
        setFeedback({
          type: 'success',
          message:
            smartPendingUnallocated > 0
              ? `Campanha registrada com ${smartAllocatedSum} refeições em lotes para aprovação e ${smartPendingUnallocated} mantidas como Pendência Mensal sem alocação por data.`
              : `Campanha registrada com sucesso (${smartAllocatedSum} refeições enviadas para aprovação gerencial).`,
        });
        setMultiAnalysis(null);
        setSmartJustification('');
      } else {
        setFeedback({ type: 'error', message: res.error || 'Erro ao salvar campanha.' });
      }
    });
  };

  const handleSaveCalendar = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await upsertUnitCalendarAction({
        unit_id: calUnitId,
        calendar_date: calDate,
        meal_type_id: calMealTypeId || null,
        is_operating: calOperating,
        reason: calReason,
      });
      if (res.success) {
        setShowCalendarModal(false);
        setCalReason('');
        setFeedback({
          type: 'success',
          message: `Calendário atualizado para ${calDate} (${calOperating ? 'Em funcionamento' : 'Sem funcionamento'}).`,
        });
      } else {
        setFeedback({ type: 'error', message: res.error || 'Falha ao atualizar calendário.' });
      }
    });
  };

  const handleConfirmReview = () => {
    if (!reviewBatch && !reviewCampaign) return;
    setFeedback(null);
    startTransition(async () => {
      const res = reviewCampaign
        ? await reviewSmartAdjustmentCampaignAction(reviewCampaign.id, reviewAction, reviewReason)
        : await reviewContingencyBatchAction({
            batch_id: reviewBatch!.id,
            action: reviewAction,
            reason: reviewReason,
          });

      if (res.success) {
        setReviewBatch(null);
        setReviewCampaign(null);
        setReviewReason('');
        setFeedback({
          type: 'success',
          message: 'Deliberação registrada com sucesso na trilha de auditoria.',
        });
      } else {
        setFeedback({ type: 'error', message: ('error' in res && res.error) || 'Erro na deliberação.' });
      }
    });
  };

  const handleViewBatchItems = async (batch: ContingencyMealBatch) => {
    setViewItemsBatch(batch);
    setLoadingItems(true);
    try {
      const res = await loadBatchItemsAction(batch.id);
      setBatchItems(res.success && res.items ? res.items : []);
    } finally {
      setLoadingItems(false);
    }
  };

  const filteredBatches = useMemo(() => {
    return data.batches.filter((b) => {
      if (filterUnit !== 'all' && b.unit_id !== filterUnit) return false;
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      return true;
    });
  }, [data.batches, filterUnit, filterStatus]);

  const pendingMonthlyCampaigns = useMemo(
    () =>
      data.campaigns.filter(
        (c) =>
          c.unallocated_pending_meals > 0 &&
          ['partially_allocated_pending', 'submitted_for_approval', 'approved'].includes(c.allocation_status)
      ),
    [data.campaigns]
  );

  const activeSmartLine = useMemo(
    () =>
      multiAnalysis?.lines.find((l) => l.line_id === activeLineId) ||
      multiAnalysis?.lines[0] ||
      null,
    [multiAnalysis, activeLineId]
  );

  const activeLineSelectedDate = activeSmartLine
    ? selectedDateByLine[activeSmartLine.line_id] || activeSmartLine.analysis.days[0]?.date || ''
    : '';

  const selectedDayObj = useMemo(
    () => activeSmartLine?.analysis.days.find((d) => d.date === activeLineSelectedDate) || null,
    [activeSmartLine, activeLineSelectedDate]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 text-slate-900">
      {/* CABEÇALHO UNIFICADO */}
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                <Layers className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">
                  Ajustes e Regularizações de Refeições
                </h1>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Retroativo por Data • Ajuste Inteligente Mensal • Dupla Aprovação Auditável
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {data.canCreate && (
              <button
                type="button"
                onClick={() => setShowCalendarModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <CalendarOff className="h-4 w-4 text-amber-600" />
                Calendário Operacional ({data.calendarOverrides.length})
              </button>
            )}
          </div>
        </div>

        {/* ABAS DAS DUAS MODALIDADES */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab('single_date')}
            className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeTab === 'single_date'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Calendar className="h-4 w-4" />
            Modalidade 1: Retroativo por Data Específica
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('smart_monthly')}
            className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeTab === 'smart_monthly'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Modalidade 2: Ajuste Inteligente Mensal
          </button>
        </div>

        {feedback && (
          <div
            className={`mt-4 flex items-center gap-2.5 rounded-2xl border p-3.5 text-xs font-bold ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}
      </header>

      {/* ABA 1: RETROATIVO POR DATA ESPECÍFICA */}
      {activeTab === 'single_date' && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900">
                Lançamento Retroativo por Data Específica (Múltiplos Turnos e Categorias)
              </h2>
              <p className="text-xs text-slate-600">
                Selecione um ou mais turnos habilitados na unidade, escolha obrigatoriamente a categoria com regra tarifária vigente na data e gere os lotes auditáveis.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadDatePreview}
              disabled={isPending || !singleUnitId || singleSelectedMealTypeIds.length === 0 || !singleDate}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              Consultar Prévia da Data ({singleSelectedMealTypeIds.length} turno{singleSelectedMealTypeIds.length === 1 ? '' : 's'})
            </button>
          </div>

          {datePreviews.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {datePreviews.map(({ meal_type_id, preview }) => {
                const shiftName = data.mealTypes.find((m) => m.id === meal_type_id)?.name || 'Turno';
                const warn = !preview.is_operating || preview.is_closed_period;
                return (
                  <div
                    key={meal_type_id}
                    className={`rounded-2xl border p-4 text-xs space-y-1.5 ${
                      warn
                        ? 'border-amber-300 bg-amber-50 text-amber-950'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    }`}
                  >
                    <div className="font-black">
                      Prévia — {shiftName} ({preview.service_date})
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <span>
                        Regulares aprovados: <strong>{preview.regular_meals_count}</strong>
                      </span>
                      <span>
                        Ajustes ativos: <strong>{preview.existing_adjustment_meals_count}</strong>
                      </span>
                      <span>
                        Calendário:{' '}
                        <strong>
                          {preview.is_operating
                            ? 'Em funcionamento'
                            : `Sem funcionamento (${preview.calendar_reason || 'Feriado/Recesso'})`}
                        </strong>
                      </span>
                      <span>
                        Fechamento: <strong>{preview.is_closed_period ? 'Período fechado' : 'Em aberto'}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleOpenSinglePreview} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs font-bold text-slate-700">Unidade</label>
                <select
                  value={singleUnitId}
                  onChange={(e) => {
                    const nextUnit = e.target.value;
                    setSingleUnitId(nextUnit);
                    setDatePreviews([]);
                    const enabled = getEnabledMealTypesForUnit(nextUnit);
                    const nextShiftIds = enabled[0] ? [enabled[0].id] : [];
                    setSingleSelectedMealTypeIds(nextShiftIds);
                    if (nextShiftIds[0]) {
                      const cats = getPermittedCategoriesForUnitShift(nextUnit, nextShiftIds[0], singleDate);
                      setSingleRows(
                        cats[0]
                          ? [
                              {
                                row_id: `single-row-${Date.now()}`,
                                meal_type_id: nextShiftIds[0],
                                category_id: cats[0].id,
                                batch_type: 'type_b_unidentified_count',
                                quantity: 1,
                                selectedStudents: [],
                              },
                            ]
                          : []
                      );
                    } else {
                      setSingleRows([]);
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                >
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Data da Refeição</label>
                <input
                  type="date"
                  max={todayIso}
                  value={singleDate}
                  onChange={(e) => {
                    setSingleDate(e.target.value);
                    setDatePreviews([]);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Quantidade Comprovada Total (Limite das Linhas)
                </label>
                <input
                  type="number"
                  min={1}
                  value={singleProvenTotal}
                  onChange={(e) => setSingleProvenTotal(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="mt-1 w-full rounded-xl border border-indigo-300 bg-indigo-50/40 px-3 py-2 text-xs font-black text-indigo-950"
                />
              </div>
            </div>

            {/* CHECKBOXES DINÂMICOS DE TURNOS HABILITADOS */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
              <div className="text-xs font-black text-slate-800">
                Turnos Habilitados na Unidade (Selecione 1 ou mais turnos)
              </div>
              {singleEnabledMealTypes.length === 0 ? (
                <p className="text-xs text-rose-700 font-semibold">
                  Nenhum turno habilitado em unit_meal_types para esta unidade. Configure em Administração → Categorias e Regras.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {singleEnabledMealTypes.map((m) => {
                    const checked = singleSelectedMealTypeIds.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                          checked
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleSingleShift(m.id)}
                          className="rounded border-slate-300"
                        />
                        <span>{m.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* LINHAS DE DISTRIBUIÇÃO (TURNO x CATEGORIA x QUANTIDADE) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Distribuição por Turno e Categoria Administrativa (Obrigatória)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Alocado nas linhas: <strong>{singleRowsTotal}</strong> / <strong>{singleProvenTotal}</strong> comprovada(s)
                    {singleRowsTotal > singleProvenTotal && (
                      <span className="ml-2 font-bold text-rose-700">• Excede o total comprovado!</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSingleRow}
                  disabled={singleSelectedMealTypeIds.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar Linha (Turno + Categoria)
                </button>
              </div>

              {singleRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                  Nenhuma linha adicionada. Selecione um turno habilitado e clique em &ldquo;Adicionar Linha&rdquo;.
                </div>
              ) : (
                <div className="space-y-3">
                  {singleRows.map((row) => {
                    const permittedCats = getPermittedCategoriesForUnitShift(
                      singleUnitId,
                      row.meal_type_id,
                      singleDate
                    );
                    const rule = getEffectiveRule(singleUnitId, row.meal_type_id, row.category_id, singleDate);
                    const qtyEff =
                      row.batch_type === 'type_a_identified' ? row.selectedStudents.length : row.quantity;
                    return (
                      <div key={row.row_id} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
                          <div className="lg:col-span-3">
                            <label className="block text-[11px] font-bold text-slate-600">Turno</label>
                            <select
                              value={row.meal_type_id}
                              onChange={(e) => {
                                const nextMt = e.target.value;
                                const cats = getPermittedCategoriesForUnitShift(singleUnitId, nextMt, singleDate);
                                setSingleRows((prev) =>
                                  prev.map((item) =>
                                    item.row_id === row.row_id
                                      ? {
                                          ...item,
                                          meal_type_id: nextMt,
                                          category_id: cats[0]?.id || '',
                                          selectedStudents: [],
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                            >
                              {singleEnabledMealTypes
                                .filter((m) => singleSelectedMealTypeIds.includes(m.id))
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="lg:col-span-3">
                            <label className="block text-[11px] font-bold text-slate-600">
                              Categoria Permitida *
                            </label>
                            <select
                              required
                              value={row.category_id}
                              onChange={(e) => {
                                const nextCat = e.target.value;
                                setSingleRows((prev) =>
                                  prev.map((item) =>
                                    item.row_id === row.row_id
                                      ? { ...item, category_id: nextCat, selectedStudents: [] }
                                      : item
                                  )
                                );
                              }}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                            >
                              {permittedCats.length === 0 ? (
                                <option value="">Sem regra ativa nesta data</option>
                              ) : (
                                permittedCats.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} ({c.code})
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div className="lg:col-span-3">
                            <label className="block text-[11px] font-bold text-slate-600">Modalidade do Lote</label>
                            <select
                              value={row.batch_type}
                              onChange={(e) =>
                                setSingleRows((prev) =>
                                  prev.map((item) =>
                                    item.row_id === row.row_id
                                      ? {
                                          ...item,
                                          batch_type: e.target.value as ContingencyBatchType,
                                          selectedStudents: [],
                                        }
                                      : item
                                  )
                                )
                              }
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                            >
                              <option value="type_b_unidentified_count">Agregado (Contagem Comprovada)</option>
                              <option value="type_a_identified">Individual (Lista Assinada)</option>
                              <option value="type_c_administrative_adjustment">Ajuste Administrativo</option>
                            </select>
                          </div>

                          <div className="lg:col-span-2">
                            <label className="block text-[11px] font-bold text-slate-600">Quantidade</label>
                            <input
                              type="number"
                              min={1}
                              disabled={row.batch_type === 'type_a_identified'}
                              value={qtyEff}
                              onChange={(e) =>
                                setSingleRows((prev) =>
                                  prev.map((item) =>
                                    item.row_id === row.row_id
                                      ? { ...item, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) }
                                      : item
                                  )
                                )
                              }
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-black disabled:bg-slate-100"
                            />
                          </div>

                          <div className="flex justify-end lg:col-span-1">
                            <button
                              type="button"
                              onClick={() =>
                                setSingleRows((prev) => prev.filter((item) => item.row_id !== row.row_id))
                              }
                              title="Remover linha"
                              className="rounded-xl border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          {rule ? (
                            <span className="font-semibold text-emerald-800">
                              Regra vigente em {singleDate}: Aluno {formatCurrency(rule.student_price)} • Subsídio{' '}
                              {formatCurrency(rule.subsidy_amount)} • Subtotal subsídio:{' '}
                              <strong>{formatCurrency(rule.subsidy_amount * qtyEff)}</strong>
                            </span>
                          ) : (
                            <span className="font-bold text-rose-700">
                              Atenção: nenhuma regra tarifária ativa encontrada em {singleDate} para este turno e categoria.
                            </span>
                          )}
                        </div>

                        {row.batch_type === 'type_a_identified' && (
                          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2">
                            <div className="text-[11px] font-black text-blue-950">
                              Comensais desta linha ({row.selectedStudents.length} selecionado(s) — filtrados pela categoria escolhida)
                            </div>
                            <input
                              type="text"
                              value={activeStudentRowId === row.row_id ? studentQuery : ''}
                              onChange={(e) =>
                                handleSearchStudentsForRow(row.row_id, e.target.value, row.category_id)
                              }
                              placeholder="Buscar estudante da categoria por nome ou matrícula (mín. 2 caracteres)..."
                              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs"
                            />
                            {activeStudentRowId === row.row_id && searchingStudents && (
                              <span className="block text-[11px] text-slate-500">Buscando...</span>
                            )}
                            {activeStudentRowId === row.row_id && searchResults.length > 0 && (
                              <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow">
                                {searchResults.map((st) => (
                                  <button
                                    key={st.id}
                                    type="button"
                                    onClick={() => {
                                      const dupInSameShift = singleRows.some(
                                        (other) =>
                                          other.meal_type_id === row.meal_type_id &&
                                          other.selectedStudents.some((s) => s.student_id === st.id)
                                      );
                                      if (dupInSameShift) {
                                        setFeedback({
                                          type: 'error',
                                          message: `${st.fullName} já foi selecionado neste mesmo turno na data ${singleDate}.`,
                                        });
                                        return;
                                      }
                                      setSingleRows((prev) =>
                                        prev.map((item) =>
                                          item.row_id === row.row_id
                                            ? {
                                                ...item,
                                                selectedStudents: [
                                                  ...item.selectedStudents,
                                                  {
                                                    student_id: st.id,
                                                    registration_number: st.registrationNumber,
                                                    fullName: st.fullName,
                                                    categoryName: st.categoryName,
                                                    categoryId: st.categoryId,
                                                  },
                                                ],
                                              }
                                            : item
                                        )
                                      );
                                      setStudentQuery('');
                                      setSearchResults([]);
                                    }}
                                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-blue-50"
                                  >
                                    <span className="font-bold">
                                      {st.fullName} ({st.registrationNumber})
                                    </span>
                                    <span className="text-[11px] text-slate-500">{st.categoryName}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {row.selectedStudents.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {row.selectedStudents.map((st) => (
                                  <span
                                    key={st.student_id}
                                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-slate-800"
                                  >
                                    {st.fullName} ({st.registration_number})
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSingleRows((prev) =>
                                          prev.map((item) =>
                                            item.row_id === row.row_id
                                              ? {
                                                  ...item,
                                                  selectedStudents: item.selectedStudents.filter(
                                                    (s) => s.student_id !== st.student_id
                                                  ),
                                                }
                                              : item
                                          )
                                        )
                                      }
                                      className="text-rose-600 hover:text-rose-800"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700">Evidência Documental (Opcional)</label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                  <Upload className="h-4 w-4 text-slate-500" />
                  <span>
                    {uploadingSingle
                      ? 'Enviando...'
                      : singleEvidenceUrl
                      ? 'Arquivo anexado (substituir)'
                      : 'Anexar ata/folha (PDF/IMG)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleUploadEvidence(e, 'single')}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={singleAllowClosed}
                    onChange={(e) => setSingleAllowClosed(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Autorizar lançamento em fechamento diário já encerrado (Diretoria/Master)
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">
                Justificativa Operacional Obrigatória (mínimo 10 caracteres)
              </label>
              <textarea
                rows={3}
                value={singleJustification}
                onChange={(e) => setSingleJustification(e.target.value)}
                placeholder="Descreva o motivo operacional, documento de conferência e turnos regularizados..."
                className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-xs"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isPending || !data.canCreate || singleRows.length === 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-xs font-black text-white shadow hover:bg-slate-800 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Gerar Prévia e Submeter Lotes ({singleRows.length})
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ABA 2: AJUSTE INTELIGENTE MENSAL */}
      {activeTab === 'smart_monthly' && (
        <section className="space-y-5">
          <div className="rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900">
                  1. Parâmetros da Competência, Turnos e Distribuição por Categoria
                </h2>
                <p className="text-xs text-slate-600">
                  O motor analisa cada linha (Turno × Categoria) com base no histórico, categoria vigente na data, regras tarifárias ativas e exclusão automática de duplicidades.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5" />
                Lacunas são indícios estatísticos, nunca prova de consumo
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-bold text-slate-700">Unidade</label>
                <select
                  value={smartUnitId}
                  onChange={(e) => {
                    const nextUnit = e.target.value;
                    setSmartUnitId(nextUnit);
                    setMultiAnalysis(null);
                    const enabled = getEnabledMealTypesForUnit(nextUnit);
                    const nextShiftIds = enabled[0] ? [enabled[0].id] : [];
                    setSmartSelectedMealTypeIds(nextShiftIds);
                    if (nextShiftIds[0]) {
                      const cats = getPermittedCategoriesForUnitShift(nextUnit, nextShiftIds[0]);
                      setSmartLines(
                        cats[0]
                          ? [
                              {
                                line_id: `smart-line-${Date.now()}`,
                                meal_type_id: nextShiftIds[0],
                                category_id: cats[0].id,
                                quantity: smartProvenTotal,
                              },
                            ]
                          : []
                      );
                    } else {
                      setSmartLines([]);
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                >
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Competência (Mês)</label>
                <input
                  type="month"
                  max={todayIso.slice(0, 7)}
                  value={smartCompetence}
                  onChange={(e) => {
                    setSmartCompetence(e.target.value);
                    setMultiAnalysis(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Quantidade Comprovada Total (Teto da Campanha)
                </label>
                <input
                  type="number"
                  min={1}
                  value={smartProvenTotal}
                  onChange={(e) => setSmartProvenTotal(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="mt-1 w-full rounded-xl border border-indigo-300 bg-indigo-50/40 px-3 py-2 text-xs font-black text-indigo-950"
                />
              </div>
            </div>

            {/* CHECKBOXES DE TURNOS HABILITADOS */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-2">
              <div className="text-xs font-black text-indigo-950">
                Turnos Habilitados na Unidade (Selecione 1 ou mais turnos simultaneamente)
              </div>
              {smartEnabledMealTypes.length === 0 ? (
                <p className="text-xs font-semibold text-rose-700">
                  Esta unidade não possui turnos habilitados em unit_meal_types.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {smartEnabledMealTypes.map((m) => {
                    const checked = smartSelectedMealTypeIds.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                          checked
                            ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleSmartShift(m.id)}
                          className="rounded border-indigo-300"
                        />
                        <span>{m.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CONSTRUTOR DE LINHAS (TURNO + CATEGORIA PERMITIDA + QUANTIDADE) */}
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Linhas de Distribuição Solicitada (Turno × Categoria × Quantidade)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Alocado nas linhas: <strong>{smartLinesRequestedTotal}</strong> / <strong>{smartProvenTotal}</strong> •
                    Saldo livre fora das linhas:{' '}
                    <strong className={smartLinesRequestedTotal > smartProvenTotal ? 'text-rose-700' : 'text-amber-700'}>
                      {smartProvenTotal - smartLinesRequestedTotal}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSmartLine}
                  disabled={smartSelectedMealTypeIds.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar Linha (Turno + Categoria)
                </button>
              </div>

              {smartLines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                  Adicione ao menos uma linha (Turno + Categoria + Quantidade) para iniciar a análise.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {smartLines.map((line) => {
                    const cats = getPermittedCategoriesForUnitShift(smartUnitId, line.meal_type_id);
                    const rule = getEffectiveRule(smartUnitId, line.meal_type_id, line.category_id);
                    return (
                      <div
                        key={line.line_id}
                        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-12 sm:items-end"
                      >
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-bold text-slate-600">Turno</label>
                          <select
                            value={line.meal_type_id}
                            onChange={(e) => {
                              setMultiAnalysis(null);
                              const nextMt = e.target.value;
                              const nextCats = getPermittedCategoriesForUnitShift(smartUnitId, nextMt);
                              setSmartLines((prev) =>
                                prev.map((it) =>
                                  it.line_id === line.line_id
                                    ? { ...it, meal_type_id: nextMt, category_id: nextCats[0]?.id || '' }
                                    : it
                                )
                              );
                            }}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                          >
                            {smartEnabledMealTypes
                              .filter((m) => smartSelectedMealTypeIds.includes(m.id))
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-bold text-slate-600">Categoria Permitida *</label>
                          <select
                            required
                            value={line.category_id}
                            onChange={(e) => {
                              setMultiAnalysis(null);
                              const nextCat = e.target.value;
                              setSmartLines((prev) =>
                                prev.map((it) =>
                                  it.line_id === line.line_id ? { ...it, category_id: nextCat } : it
                                )
                              );
                            }}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                          >
                            {cats.length === 0 ? (
                              <option value="">Sem categoria com regra ativa</option>
                            ) : (
                              cats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({c.code})
                                </option>
                              ))
                            )}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600">Qtd da Linha</label>
                          <input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => {
                              setMultiAnalysis(null);
                              const nextQty = Math.max(1, Math.floor(Number(e.target.value) || 1));
                              setSmartLines((prev) =>
                                prev.map((it) =>
                                  it.line_id === line.line_id ? { ...it, quantity: nextQty } : it
                                )
                              );
                            }}
                            className="mt-1 w-full rounded-xl border border-indigo-300 bg-white px-2.5 py-2 text-xs font-black text-indigo-950"
                          />
                        </div>

                        <div className="sm:col-span-2 text-[11px] text-slate-600">
                          {rule ? (
                            <span className="font-semibold text-emerald-800">
                              Subsídio: {formatCurrency(rule.subsidy_amount)}
                              <br />
                              Aluno: {formatCurrency(rule.student_price)}
                            </span>
                          ) : (
                            <span className="font-bold text-rose-700">Sem regra ativa</span>
                          )}
                        </div>

                        <div className="flex justify-end sm:col-span-1">
                          <button
                            type="button"
                            onClick={() => {
                              setMultiAnalysis(null);
                              setSmartLines((prev) => prev.filter((it) => it.line_id !== line.line_id));
                            }}
                            title="Remover linha"
                            className="rounded-xl border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={allowClosedDates}
                  onChange={(e) => setAllowClosedDates(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Incluir datas já fechadas em <code className="rounded bg-slate-100 px-1">financial_daily_closings</code> (restrito a Diretoria/Master)
              </label>

              <button
                type="button"
                onClick={handleRunSmartAnalysis}
                disabled={
                  isPending ||
                  !smartUnitId ||
                  smartLines.length === 0 ||
                  smartLinesRequestedTotal > smartProvenTotal
                }
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {isPending ? 'Analisando linhas...' : 'Analisar Competência por Turno e Categoria'}
              </button>
            </div>
          </div>

          {multiAnalysis && activeSmartLine && (
            <div className="space-y-5">
              {/* KPIs CONSOLIDADOS DA ANÁLISE MULTI-LINHA */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="text-[11px] font-bold uppercase text-slate-500">Dias Operacionais</span>
                  <p className="mt-1 text-2xl font-black text-slate-900">{multiAnalysis.operating_days_max}</p>
                  <p className="text-[11px] text-slate-500">{multiAnalysis.lines.length} linha(s) analisada(s)</p>
                </div>

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
                  <span className="text-[11px] font-bold uppercase text-indigo-800">
                    Lacunas Elegíveis (Soma)
                  </span>
                  <p className="mt-1 text-2xl font-black text-indigo-950">
                    {multiAnalysis.total_statistical_gaps}
                  </p>
                  <p className="text-[11px] text-indigo-700">Filtradas por categoria vigente</p>
                </div>

                <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 shadow-sm">
                  <span className="text-[11px] font-bold uppercase text-rose-800">
                    Duplicidades Excluídas
                  </span>
                  <p className="mt-1 text-2xl font-black text-rose-950">
                    {multiAnalysis.total_excluded_duplicates}
                  </p>
                  <p className="text-[11px] text-rose-700">Consumo normal ou lote prévio</p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
                  <span className="text-[11px] font-bold uppercase text-amber-800">
                    Saldo Sem Base Diária
                  </span>
                  <p className="mt-1 text-2xl font-black text-amber-950">{smartPendingUnallocated}</p>
                  <p className="text-[11px] text-amber-800">
                    Distribuído: {smartAllocatedSum} / Comprovado: {smartProvenTotal}
                  </p>
                </div>
              </div>

              {/* RESUMO POR LINHA (TURNO x CATEGORIA) + SELETOR */}
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    2. Resultado por Turno e Categoria (Clique para inspecionar e confirmar datas)
                  </h3>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-50 font-bold uppercase text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Turno • Categoria</th>
                          <th className="px-3 py-2 text-right">Solicitada</th>
                          <th className="px-3 py-2 text-right">Existentes (Reg + Aj)</th>
                          <th className="px-3 py-2 text-right">Lacunas</th>
                          <th className="px-3 py-2 text-right">Duplic. Excluídas</th>
                          <th className="px-3 py-2 text-right">Confirmada</th>
                          <th className="px-3 py-2 text-right">Pendente</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {multiAnalysis.lines.map((line) => {
                          const isSelected = line.line_id === activeSmartLine.line_id;
                          const confirmedLineQty = allocatedByLineMap[line.line_id] || 0;
                          const pendingLineQty = Math.max(0, line.requested_quantity - confirmedLineQty);
                          const existingLineTotal =
                            line.analysis.existing_regular_count + line.analysis.existing_adjustment_count;
                          return (
                            <tr
                              key={line.line_id}
                              onClick={() => setActiveLineId(line.line_id)}
                              className={`cursor-pointer transition ${
                                isSelected ? 'bg-indigo-50/70 font-semibold' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="px-3 py-2.5 font-black text-slate-900">
                                {line.meal_type_name} • {line.category_name}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold">{line.requested_quantity}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">
                                {existingLineTotal} ({line.analysis.existing_regular_count}+
                                {line.analysis.existing_adjustment_count})
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-indigo-800">
                                {line.analysis.total_statistical_gaps}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-rose-700">
                                {line.analysis.excluded_duplicates_count}
                              </td>
                              <td className="px-3 py-2.5 text-right font-black text-emerald-700">
                                {confirmedLineQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-amber-700">
                                {pendingLineQty}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SUBMODALIDADES DE CONFERÊNCIA PARA A LINHA SELECIONADA */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSmartSubmode('smart_quantity_distribution')}
                      className={`rounded-xl px-3.5 py-2 text-xs font-black transition ${
                        smartSubmode === 'smart_quantity_distribution'
                          ? 'bg-amber-600 text-white shadow'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Submodo A: Distribuição Agregada por Data
                    </button>
                    <button
                      type="button"
                      onClick={() => setSmartSubmode('smart_individual_reconciliation')}
                      className={`rounded-xl px-3.5 py-2 text-xs font-black transition ${
                        smartSubmode === 'smart_individual_reconciliation'
                          ? 'bg-blue-600 text-white shadow'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Submodo B: Reconciliação Individual Assistida
                    </button>
                  </div>

                  {smartSubmode === 'smart_quantity_distribution' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleApplySuggestedConferenceLine(activeSmartLine.line_id)}
                        className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
                      >
                        Aplicar Sugestão Indicativa ({activeSmartLine.meal_type_name})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleClearLineAllocationsToPending(activeSmartLine.line_id)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Manter Linha como Pendência Mensal
                      </button>
                    </div>
                  )}
                </div>

                {smartSubmode === 'smart_quantity_distribution' ? (
                  <div className="space-y-4">
                    <div className="overflow-x-auto rounded-2xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                        <thead className="bg-slate-50 font-bold uppercase text-slate-600">
                          <tr>
                            <th className="px-3 py-2.5">Data Operacional</th>
                            <th className="px-3 py-2.5 text-right">Regulares</th>
                            <th className="px-3 py-2.5 text-right">Ajustes</th>
                            <th className="px-3 py-2.5 text-right">Contagem Física</th>
                            <th className="px-3 py-2.5">Alunos Aptos s/ Consumo (Nomes)</th>
                            <th className="px-3 py-2.5">Motivo / Evidência</th>
                            <th className="px-3 py-2.5 text-right">Sugestão Conf.</th>
                            <th className="px-3 py-2.5 text-right">Qtd Confirmada</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {activeSmartLine.analysis.days.map((day) => {
                            const blocked = day.is_closed_period && !allowClosedDates;
                            const lineAllocMap = lineDateAllocations[activeSmartLine.line_id] || {};
                            const nonConsumers = day.eligible_non_consumers || day.gap_candidates;
                            const isInspected = selectedDayObj?.date === day.date;
                            return (
                              <tr
                                key={day.date}
                                className={
                                  blocked
                                    ? 'bg-slate-50 text-slate-400'
                                    : isInspected
                                    ? 'bg-blue-50/50'
                                    : 'hover:bg-slate-50'
                                }
                              >
                                <td className="px-3 py-2 font-bold">
                                  <div>{day.date}</div>
                                  {day.is_closed_period && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
                                      <Lock className="h-3 w-3" /> Fechamento Diário
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">{day.regular_count}</td>
                                <td className="px-3 py-2 text-right">{day.existing_adjustment_count}</td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    placeholder="-"
                                    value={physicalInputs[day.date] ?? ''}
                                    onChange={(e) =>
                                      setPhysicalInputs((prev) => ({
                                        ...prev,
                                        [day.date]: e.target.value,
                                      }))
                                    }
                                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedDateByLine((prev) => ({
                                        ...prev,
                                        [activeSmartLine.line_id]: day.date,
                                      }))
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                                      isInspected
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                                    }`}
                                  >
                                    <Search className="h-3 w-3" />
                                    {nonConsumers.length} apto(s) • Ver Nomes
                                  </button>
                                  <div className="mt-0.5 text-[10px] text-slate-500">
                                    {day.habitual_gaps_count} habituais · {day.already_consumed_count || 0} bloqueado(s)/consumido(s)
                                  </div>
                                </td>
                                <td className="px-3 py-2 max-w-xs text-[11px]">
                                  {day.reasons.join(' · ') || 'Dia operacional padrão'}
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-indigo-700">
                                  {day.suggested_conference_qty}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    disabled={blocked}
                                    value={lineAllocMap[day.date] ?? 0}
                                    onChange={(e) => {
                                      const val = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                      setLineDateAllocations((prev) => ({
                                        ...prev,
                                        [activeSmartLine.line_id]: {
                                          ...(prev[activeSmartLine.line_id] || {}),
                                          [day.date]: val,
                                        },
                                      }));
                                    }}
                                    className="w-20 rounded-lg border border-amber-300 px-2 py-1 text-right text-xs font-black text-slate-900 disabled:bg-slate-100"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* CONFERÊNCIA NOMINAL IMEDIATA DOS ALUNOS APTOS NA DATA SELECIONADA */}
                    {selectedDayObj && (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-xs font-black text-blue-950">
                              Alunos Elegíveis SEM CONSUMO em {selectedDayObj.date} — {activeSmartLine.meal_type_name} ({activeSmartLine.category_name})
                            </h4>
                            <p className="text-[11px] text-blue-900">
                              Estes comensais pertencem à categoria na data, têm regra vigente e{' '}
                              <strong>não consumiram nem constam em nenhum lote</strong> neste turno/dia ({selectedDayObj.already_consumed_count || 0} já consumido(s)/excluído(s)).
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSmartSubmode('smart_individual_reconciliation')}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700"
                          >
                            Confirmar Alunos Nominalmente (Submodo B)
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {(selectedDayObj.eligible_non_consumers || selectedDayObj.gap_candidates).length === 0 ? (
                          <div className="rounded-xl border border-blue-100 bg-white p-3 text-xs text-slate-500">
                            Todos os alunos desta categoria já possuem consumo/lote registrado em {selectedDayObj.date} ou não há comensais elegíveis nesta data.
                          </div>
                        ) : (
                          <div className="max-h-60 overflow-y-auto rounded-xl border border-blue-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                              <thead className="bg-slate-50 font-bold uppercase text-slate-600 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2">Matrícula</th>
                                  <th className="px-3 py-2">Nome do Aluno</th>
                                  <th className="px-3 py-2">Categoria na Data</th>
                                  <th className="px-3 py-2">Classificação / Motivo</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {(selectedDayObj.eligible_non_consumers || selectedDayObj.gap_candidates).map((cand) => (
                                  <tr key={cand.student_id}>
                                    <td className="px-3 py-1.5 font-mono font-bold">{cand.registration_number}</td>
                                    <td className="px-3 py-1.5 font-bold text-slate-900">{cand.full_name}</td>
                                    <td className="px-3 py-1.5">{cand.category_name}</td>
                                    <td className="px-3 py-1.5 text-[11px]">
                                      <span
                                        className={`mr-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          cand.is_habitual
                                            ? 'bg-indigo-100 text-indigo-800'
                                            : 'bg-emerald-100 text-emerald-800'
                                        }`}
                                      >
                                        {cand.is_habitual ? 'Habitual sem registro' : 'Apto s/ consumo'}
                                      </span>
                                      <span className="text-slate-600">{cand.confidence_reason}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* VISÃO CONSOLIDADA POR ALUNO NA COMPETÊNCIA */}
                    {(activeSmartLine.analysis.eligible_students_summary || []).length > 0 && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-xs font-black text-slate-800">
                            Resumo por Estudante na Competência ({(activeSmartLine.analysis.eligible_students_summary || []).length} comensal(is) elegível(is) em {activeSmartLine.meal_type_name} • {activeSmartLine.category_name})
                          </h4>
                          <span className="text-[11px] text-slate-500">
                            Consumo normal ou lote prévio nunca é duplicado
                          </span>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                            <thead className="bg-slate-50 font-bold uppercase text-slate-600 sticky top-0">
                              <tr>
                                <th className="px-3 py-2">Matrícula</th>
                                <th className="px-3 py-2">Nome do Aluno</th>
                                <th className="px-3 py-2 text-right">Dias s/ Consumo (Aptos)</th>
                                <th className="px-3 py-2 text-right">Já Consumidos (Bloq.)</th>
                                <th className="px-3 py-2 text-right">Em Lotes (Bloq.)</th>
                                <th className="px-3 py-2">Datas sem consumo disponíveis</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {(activeSmartLine.analysis.eligible_students_summary || []).map((st) => (
                                <tr key={st.student_id}>
                                  <td className="px-3 py-1.5 font-mono font-bold">{st.registration_number}</td>
                                  <td className="px-3 py-1.5 font-bold text-slate-900">
                                    {st.full_name}
                                    {st.is_habitual && (
                                      <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                        Habitual
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-black text-emerald-700">
                                    {st.available_dates.length}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-slate-600">
                                    {st.consumed_dates.length}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-amber-700">
                                    {st.batch_dates.length}
                                  </td>
                                  <td className="px-3 py-1.5 text-[11px] text-slate-600">
                                    {st.available_dates.length === 0
                                      ? 'Nenhum dia disponível (100% atendido)'
                                      : `${st.available_dates.slice(0, 5).map((d) => d.slice(5)).join(', ')}${
                                          st.available_dates.length > 5
                                            ? ` (+${st.available_dates.length - 5} dias)`
                                            : ''
                                        }`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs font-bold text-slate-700">
                        Dia para Conferência Nominal ({activeSmartLine.meal_type_name} • {activeSmartLine.category_name}):
                      </label>
                      <select
                        value={activeLineSelectedDate}
                        onChange={(e) =>
                          setSelectedDateByLine((prev) => ({
                            ...prev,
                            [activeSmartLine.line_id]: e.target.value,
                          }))
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
                      >
                        {activeSmartLine.analysis.days.map((d) => {
                          const aptCount = (d.eligible_non_consumers || d.gap_candidates).length;
                          return (
                            <option key={d.date} value={d.date}>
                              {d.date} — {aptCount} apto(s) sem consumo ({d.already_consumed_count || 0} já consumiram)
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {selectedDayObj && (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                          <thead className="bg-slate-50 font-bold uppercase text-slate-600">
                            <tr>
                              <th className="px-3 py-2.5">Confirmar</th>
                              <th className="px-3 py-2.5">Matrícula</th>
                              <th className="px-3 py-2.5">Comensal</th>
                              <th className="px-3 py-2.5">Categoria Vigente</th>
                              <th className="px-3 py-2.5">Indício / Elegibilidade</th>
                              <th className="px-3 py-2.5">Referência Documental Obrigatória</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {(selectedDayObj.eligible_non_consumers || selectedDayObj.gap_candidates).length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                                  Nenhum candidato elegível desta categoria sem consumo ou lote prévio neste turno/dia.
                                </td>
                              </tr>
                            ) : (
                              (selectedDayObj.eligible_non_consumers || selectedDayObj.gap_candidates).map((cand) => {
                                const dayMap =
                                  (confirmedByLine[activeSmartLine.line_id] || {})[selectedDayObj.date] || {};
                                const current = dayMap[cand.student_id] || {
                                  checked: false,
                                  notes: '',
                                  registration_number: cand.registration_number,
                                };
                                return (
                                  <tr key={cand.student_id} className="hover:bg-blue-50/40">
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        checked={current.checked}
                                        disabled={selectedDayObj.is_closed_period && !allowClosedDates}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          setConfirmedByLine((prev) => ({
                                            ...prev,
                                            [activeSmartLine.line_id]: {
                                              ...(prev[activeSmartLine.line_id] || {}),
                                              [selectedDayObj.date]: {
                                                ...((prev[activeSmartLine.line_id] || {})[selectedDayObj.date] || {}),
                                                [cand.student_id]: {
                                                  ...current,
                                                  checked,
                                                  registration_number: cand.registration_number,
                                                },
                                              },
                                            },
                                          }));
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2 font-mono font-bold">{cand.registration_number}</td>
                                    <td className="px-3 py-2 font-bold">{cand.full_name}</td>
                                    <td className="px-3 py-2">{cand.category_name}</td>
                                    <td className="px-3 py-2 text-[11px] text-slate-600">
                                      <span
                                        className={`mr-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          cand.is_habitual
                                            ? 'bg-indigo-100 text-indigo-800'
                                            : 'bg-emerald-100 text-emerald-800'
                                        }`}
                                      >
                                        {cand.is_habitual ? 'Habitual' : 'Apto s/ consumo'}
                                      </span>
                                      {cand.confidence_reason}
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="text"
                                        disabled={!current.checked}
                                        value={current.notes}
                                        placeholder="Ex: Folha assinada p. 02 / Catraca #4"
                                        onChange={(e) => {
                                          const notes = e.target.value;
                                          setConfirmedByLine((prev) => ({
                                            ...prev,
                                            [activeSmartLine.line_id]: {
                                              ...(prev[activeSmartLine.line_id] || {}),
                                              [selectedDayObj.date]: {
                                                ...((prev[activeSmartLine.line_id] || {})[selectedDayObj.date] || {}),
                                                [cand.student_id]: {
                                                  ...current,
                                                  notes,
                                                  registration_number: cand.registration_number,
                                                },
                                              },
                                            },
                                          }));
                                        }}
                                        className="w-full min-w-[200px] rounded-lg border border-slate-300 px-2.5 py-1 text-xs disabled:bg-slate-100"
                                      />
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
                )}

                {/* EVIDÊNCIA E JUSTIFICATIVA DA CAMPANHA */}
                <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Evidência da Campanha Mensal</label>
                    <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                      <Upload className="h-4 w-4 text-slate-500" />
                      <span>
                        {uploadingSmart
                          ? 'Enviando...'
                          : smartEvidenceUrl
                          ? 'Evidência anexada (substituir)'
                          : 'Anexar ata/planilha mensal (PDF/IMG)'}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleUploadEvidence(e, 'smart')}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      Justificativa Contábil da Competência (mínimo 10 caracteres)
                    </label>
                    <textarea
                      rows={2}
                      value={smartJustification}
                      onChange={(e) => setSmartJustification(e.target.value)}
                      placeholder="Descreva a origem da diferença comprovada e os documentos conferidos..."
                      className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs font-semibold text-slate-600">
                    Resumo Consolidado: <strong>{smartAllocatedSum}</strong> refeição(ões) em lotes diários +{' '}
                    <strong className="text-amber-700">{smartPendingUnallocated}</strong> pendente(s) sem base de data.
                  </div>
                  <button
                    type="button"
                    disabled={isPending || !data.canCreate}
                    onClick={() => setShowSmartConfirmModal(true)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Gerar Prévia Consolidada e Submeter
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* PENDÊNCIAS MENSAIS NÃO ALOCADAS */}
      {pendingMonthlyCampaigns.length > 0 && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-black text-amber-950 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            Pendências Mensais em Apuração (Não Distribuídas por Data / Não Faturadas)
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-amber-200 bg-white">
            <table className="min-w-full divide-y divide-amber-100 text-left text-xs">
              <thead className="bg-amber-50 font-bold uppercase text-amber-900">
                <tr>
                  <th className="px-4 py-2.5">Competência / Unidade</th>
                  <th className="px-4 py-2.5 text-right">Comprovadas</th>
                  <th className="px-4 py-2.5 text-right">Distribuídas</th>
                  <th className="px-4 py-2.5 text-right">Pendentes sem Data</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {pendingMonthlyCampaigns.map((camp) => {
                  const st = STATUS_BADGES[camp.allocation_status] || STATUS_BADGES.submitted_for_approval;
                  const canApproveCamp =
                    data.canReview &&
                    ['partially_allocated_pending', 'submitted_for_approval'].includes(camp.allocation_status) &&
                    (camp.created_by !== data.currentUser.id || data.currentUser.role === 'admin_general');
                  return (
                    <tr key={camp.id}>
                      <td className="px-4 py-2.5 font-bold">
                        <div>{camp.competence_month.slice(0, 7)}</div>
                        <div className="text-[11px] font-normal text-slate-500">
                          {camp.unit_name} • {camp.meal_type_name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold">{camp.proven_total_meals}</td>
                      <td className="px-4 py-2.5 text-right">{camp.allocated_meals_count}</td>
                      <td className="px-4 py-2.5 text-right font-black text-amber-700">
                        {camp.unallocated_pending_meals}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${st.className}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canApproveCamp && (
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setReviewCampaign(camp);
                                setReviewBatch(null);
                                setReviewAction('reject');
                                setReviewReason('');
                              }}
                              className="rounded-lg border border-rose-300 px-2.5 py-1 text-[11px] font-bold text-rose-700"
                            >
                              Rejeitar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewCampaign(camp);
                                setReviewBatch(null);
                                setReviewAction('approve');
                                setReviewReason('');
                              }}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white"
                            >
                              Aprovar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* HISTÓRICO ÚNICO DE AJUSTES E APROVAÇÕES */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">
              Histórico Único de Lotes e Aprovações ({filteredBatches.length})
            </h2>
            <p className="text-xs text-slate-500">
              Unifica regularizações manuais por data e lotes gerados por campanhas inteligentes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filterUnit}
              onChange={(e) => setFilterUnit(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              <option value="all">Todas as unidades</option>
              {data.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              <option value="all">Todos os status</option>
              <option value="pending_approval">Pendente de Aprovação</option>
              <option value="approved">Aprovado</option>
              <option value="rejected">Rejeitado</option>
            </select>
          </div>
        </div>

        {filteredBatches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-500">
            <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            Nenhum lote de ajuste encontrado para os filtros aplicados.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBatches.map((batch) => {
              const st = STATUS_BADGES[batch.status] || STATUS_BADGES.pending_approval;
              const tp = BATCH_TYPE_LABELS[batch.batch_type];
              const canDeliberate =
                data.canReview &&
                batch.status === 'pending_approval' &&
                (batch.operator_id !== data.currentUser.id || data.currentUser.role === 'admin_general');

              return (
                <article key={batch.id} className="rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${st.className}`}>
                        {st.label}
                      </span>
                      <span className={`rounded-lg border px-2.5 py-0.5 text-[11px] font-bold ${tp.badge}`}>
                        {tp.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <Calendar className="h-3.5 w-3.5" />
                      <strong>{batch.service_date}</strong>
                      <span>•</span>
                      <Building2 className="h-3.5 w-3.5" />
                      <strong>{batch.unit_name}</strong>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Refeição / Categoria</span>
                      <p className="font-bold text-slate-900">{batch.meal_type_name}</p>
                      <p className="text-slate-500">{batch.category_name}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Quantidade</span>
                      <p className="text-lg font-black text-slate-900">{batch.total_meals_served} un</p>
                      {batch.batch_type === 'type_a_identified' && (
                        <button
                          type="button"
                          onClick={() => handleViewBatchItems(batch)}
                          className="inline-flex items-center gap-1 font-bold text-blue-600 hover:underline"
                        >
                          Ver lista comprovada
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Impacto Contratual</span>
                      <p className="font-bold">Total: R$ {batch.total_amount.toFixed(2)}</p>
                      <p className="text-slate-500">Subsídio: R$ {batch.total_subsidy_amount.toFixed(2)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold uppercase text-slate-400">Auditoria</span>
                      <p>Solicitante: <strong>{batch.operator_name}</strong></p>
                      {batch.approver_name && (
                        <p>Revisor: <strong>{batch.approver_name}</strong></p>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700">
                    <strong>Justificativa:</strong> {batch.justification}
                  </p>

                  {batch.rejection_reason && (
                    <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
                      <strong>Motivo da rejeição:</strong> {batch.rejection_reason}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <div>
                      {batch.evidence_document_url ? (
                        <a
                          href={batch.evidence_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          <FileCheck className="h-3.5 w-3.5 text-emerald-600" />
                          Ver Evidência
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs italic text-slate-400">Sem anexo</span>
                      )}
                    </div>

                    {canDeliberate && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setReviewBatch(batch);
                            setReviewCampaign(null);
                            setReviewAction('reject');
                            setReviewReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Rejeitar
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setReviewBatch(batch);
                            setReviewCampaign(null);
                            setReviewAction('approve');
                            setReviewReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Aprovar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* MODAL PRÉVIA RETROATIVO POR DATA (MULTI-LINHA) */}
      {showSinglePreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-slate-900">
              Prévia Final — Lotes Retroativos em {singleDate}
            </h3>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Turno</th>
                    <th className="px-3 py-2">Categoria</th>
                    <th className="px-3 py-2">Modalidade</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Subsídio Est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {singleRows.map((row) => {
                    const mName = data.mealTypes.find((m) => m.id === row.meal_type_id)?.name || 'Turno';
                    const cName = data.categories.find((c) => c.id === row.category_id)?.name || 'Categoria';
                    const qtyEff =
                      row.batch_type === 'type_a_identified' ? row.selectedStudents.length : row.quantity;
                    const rule = getEffectiveRule(singleUnitId, row.meal_type_id, row.category_id, singleDate);
                    return (
                      <tr key={row.row_id}>
                        <td className="px-3 py-2 font-bold">{mName}</td>
                        <td className="px-3 py-2">{cName}</td>
                        <td className="px-3 py-2">{BATCH_TYPE_LABELS[row.batch_type].title}</td>
                        <td className="px-3 py-2 text-right font-black">{qtyEff}</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-700">
                          {formatCurrency((rule?.subsidy_amount || 0) * qtyEff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-xs space-y-1">
              <div>
                <strong>Total a regularizar nesta data:</strong> {singleRowsTotal} refeição(ões) em{' '}
                {singleRows.length} lote(s) • <strong>Saldo não alocado do comprovado:</strong>{' '}
                {Math.max(0, singleProvenTotal - singleRowsTotal)}
              </div>
              <div className="text-emerald-800 font-bold">
                Cada estudante só pode ter no máximo 1 consumo por turno e data; carteiras individuais permanecem intactas.
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSinglePreviewModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleConfirmSubmitSingleDate}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? 'Submetendo...' : 'Confirmar e Submeter Lotes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PRÉVIA CAMPANHA INTELIGENTE */}
      {showSmartConfirmModal && multiAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-slate-900">
              Prévia Final Consolidada — Ajuste Inteligente Mensal
            </h3>
            <div className="rounded-2xl bg-slate-50 p-4 text-xs space-y-1.5">
              <div><strong>Competência:</strong> {smartCompetence}</div>
              <div>
                <strong>Submodalidade:</strong>{' '}
                {smartSubmode === 'smart_quantity_distribution'
                  ? 'Distribuição Inteligente Agregada (sem alteração de matrículas)'
                  : 'Reconciliação Individual Assistida (com referência documental por estudante)'}
              </div>
              <div><strong>Total Comprovado:</strong> {smartProvenTotal} refeições</div>
              <div><strong>Distribuído em Lotes Diários:</strong> {smartAllocatedSum} refeições</div>
              <div className="text-amber-800">
                <strong>Mantido como Pendência Mensal (sem data):</strong> {smartPendingUnallocated} refeições
              </div>
              <div className="text-emerald-800 font-bold pt-1">
                Carteiras e wallet_transactions permanecerão intactos.
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-64 overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-bold uppercase text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Turno • Categoria</th>
                    <th className="px-3 py-2 text-right">Solicitado</th>
                    <th className="px-3 py-2 text-right">Distribuído</th>
                    <th className="px-3 py-2 text-right">Pendente</th>
                    <th className="px-3 py-2 text-right">Subsídio Est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {multiAnalysis.lines.map((line) => {
                    const allocQty = allocatedByLineMap[line.line_id] || 0;
                    const pendQty = Math.max(0, line.requested_quantity - allocQty);
                    return (
                      <tr key={line.line_id}>
                        <td className="px-3 py-2 font-bold">
                          {line.meal_type_name} • {line.category_name}
                        </td>
                        <td className="px-3 py-2 text-right">{line.requested_quantity}</td>
                        <td className="px-3 py-2 text-right font-black text-emerald-700">{allocQty}</td>
                        <td className="px-3 py-2 text-right font-bold text-amber-700">{pendQty}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {formatCurrency(line.rule_subsidy_amount * allocQty)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSmartConfirmModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSubmitSmartCampaign}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? 'Gravando...' : 'Confirmar Submissão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CALENDÁRIO OPERACIONAL */}
      {showCalendarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveCalendar}
            className="my-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">Calendário Operacional da Unidade</h3>
              <button
                type="button"
                onClick={() => setShowCalendarModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700">Unidade</label>
                <select
                  value={calUnitId}
                  onChange={(e) => setCalUnitId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                >
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700">Data</label>
                <input
                  type="date"
                  value={calDate}
                  onChange={(e) => setCalDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700">Escopo de Refeição</label>
                <select
                  value={calMealTypeId}
                  onChange={(e) => setCalMealTypeId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                >
                  <option value="">Dia inteiro (todos os turnos)</option>
                  {data.mealTypes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700">Situação Operacional</label>
                <select
                  value={calOperating ? 'true' : 'false'}
                  onChange={(e) => setCalOperating(e.target.value === 'true')}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                >
                  <option value="false">Sem funcionamento (Feriado / Recesso / Manutenção)</option>
                  <option value="true">Funcionamento excepcional (Ex: Sábado letivo)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700">Motivo</label>
                <input
                  type="text"
                  value={calReason}
                  onChange={(e) => setCalReason(e.target.value)}
                  placeholder="Ex: Feriado Proclamação da República"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCalendarModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
              >
                {isPending ? 'Salvando...' : 'Salvar Calendário'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DELIBERAÇÃO DE LOTE OU CAMPANHA */}
      {(reviewBatch || reviewCampaign) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-black text-slate-900">
              {reviewAction === 'approve' ? 'Confirmar Aprovação Auditável' : 'Registrar Rejeição'}
            </h3>
            <p className="text-xs text-slate-600">
              {reviewCampaign
                ? `Campanha mensal ${reviewCampaign.competence_month.slice(0, 7)} (${reviewCampaign.unit_name}) com ${reviewCampaign.allocated_meals_count} refeições alocadas.`
                : `Lote de ${reviewBatch?.service_date} (${reviewBatch?.unit_name}) com ${reviewBatch?.total_meals_served} refeições.`}
            </p>
            {reviewAction === 'reject' && (
              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Motivo da Rejeição (mínimo 5 caracteres)
                </label>
                <textarea
                  rows={3}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-xs"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setReviewBatch(null);
                  setReviewCampaign(null);
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleConfirmReview}
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white ${
                  reviewAction === 'approve' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {isPending ? 'Processando...' : reviewAction === 'approve' ? 'Aprovar' : 'Rejeitar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ITENS COMPROVADOS TIPO A */}
      {viewItemsBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-auto flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Estudantes Confirmados no Lote
                </h3>
                <p className="text-xs text-slate-500">
                  {viewItemsBatch.unit_name} • {viewItemsBatch.service_date} • {viewItemsBatch.meal_type_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewItemsBatch(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loadingItems ? (
                <p className="py-6 text-center text-xs text-slate-500">Carregando...</p>
              ) : batchItems.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">Nenhum estudante listado.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {batchItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2.5 text-xs">
                      <div>
                        <p className="font-bold text-slate-900">{item.student_name}</p>
                        <p className="font-mono text-slate-500">
                          {item.registration_number} {item.notes ? `• Ref: ${item.notes}` : ''}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                        {item.category_name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
