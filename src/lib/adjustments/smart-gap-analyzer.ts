import type {
  DailyGapRecommendation,
  EligibleStudentCompetenceSummary,
  GapCandidate,
  SmartAnalysisResult,
  StudentCategoryHistoryEntry,
  UnitCalendarDay,
} from '@/types/adjustments';

export interface AnalyzerStudentRecord {
  id: string;
  registration_number: string;
  full_name: string;
  category_id: string;
  category_name: string;
  status: string;
  created_at?: string | null;
}

export interface AnalyzerRuleWindow {
  category_id: string;
  enabled: boolean;
  effective_from: string;
  effective_to?: string | null;
}

export interface AnalyzerConsumptionRecord {
  student_id: string;
  consumption_date: string;
  meal_type_id: string;
}

export interface AnalyzerBatchItemRecord {
  student_id: string;
  service_date: string;
  meal_type_id: string;
}

export interface SmartGapAnalyzerInput {
  competenceMonth: string; // 'YYYY-MM'
  todayDate: string; // 'YYYY-MM-DD'
  mealTypeId: string;
  categoryId?: string | null;
  categoryNamesById?: Record<string, string>;
  unitMealEnabled: boolean;
  provenTotalMeals: number;
  students: AnalyzerStudentRecord[];
  categoryHistory?: StudentCategoryHistoryEntry[];
  rules: AnalyzerRuleWindow[];
  calendarOverrides: UnitCalendarDay[];
  lookbackOperatingDates: string[];
  lookbackConsumptions: AnalyzerConsumptionRecord[];
  monthRegularConsumptions: AnalyzerConsumptionRecord[];
  monthOtherShiftConsumptions?: AnalyzerConsumptionRecord[];
  existingBatchItemsInMonth: AnalyzerBatchItemRecord[];
  existingBatchMealsByDate: Record<string, number>;
  dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
  closedDates?: string[];
  observedActivityDatesInMonth?: string[];
  allowClosedDates?: boolean;
  minAttendanceRate?: number;
  minPriorMeals?: number;
}

export function resolveStudentCategoryOnDate(
  studentId: string,
  fallbackCategoryId: string,
  serviceDate: string,
  historyByStudent: Map<string, StudentCategoryHistoryEntry[]>
): string {
  const entries = historyByStudent.get(studentId);
  if (!entries || entries.length === 0) return fallbackCategoryId;

  // Entries sorted by effective_from ASC, created_at ASC
  let latestEffective: StudentCategoryHistoryEntry | null = null;
  let firstFuture: StudentCategoryHistoryEntry | null = null;

  for (const entry of entries) {
    const effDate = entry.effective_from.slice(0, 10);
    if (effDate <= serviceDate) {
      latestEffective = entry;
    } else if (!firstFuture) {
      firstFuture = entry;
    }
  }

  if (latestEffective) return latestEffective.new_category_id;
  if (firstFuture && firstFuture.previous_category_id) return firstFuture.previous_category_id;
  return fallbackCategoryId;
}

function getMonthDatesUpTo(competenceMonth: string, todayDate: string): string[] {
  const [yearStr, monthStr] = competenceMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('INVALID_COMPETENCE_FORMAT: Competência deve estar no formato YYYY-MM.');
  }

  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates: string[] = [];
  for (let day = 1; day <= lastDayOfMonth; day += 1) {
    const iso = `${yearStr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso <= todayDate) {
      dates.push(iso);
    }
  }
  return dates;
}

function getDayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isRuleEffectiveOnDate(rule: AnalyzerRuleWindow, isoDate: string): boolean {
  if (!rule.enabled) return false;
  const fromDate = rule.effective_from.slice(0, 10);
  if (fromDate > isoDate) return false;
  if (rule.effective_to) {
    const toDate = rule.effective_to.slice(0, 10);
    if (toDate < isoDate) return false;
  }
  return true;
}

/**
 * Rateio inteiro determinístico pelo Método dos Maiores Restos (Hamilton).
 */
export function distributeByLargestRemainder(
  items: Array<{ key: string; weight: number; maxCap?: number }>,
  totalToDistribute: number
): Record<string, number> {
  const allocations: Record<string, number> = {};
  for (const item of items) allocations[item.key] = 0;

  if (totalToDistribute <= 0 || items.length === 0) {
    return allocations;
  }

  const eligible = items.filter((item) => item.weight > 0 && (item.maxCap === undefined || item.maxCap > 0));
  if (eligible.length === 0) {
    return allocations;
  }

  const totalWeight = eligible.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    return allocations;
  }

  const parts = eligible.map((item) => {
    const exact = (totalToDistribute * item.weight) / totalWeight;
    const floorVal = Math.floor(exact);
    const capped = item.maxCap !== undefined ? Math.min(floorVal, item.maxCap) : floorVal;
    return {
      key: item.key,
      base: capped,
      remainder: exact - capped,
      maxCap: item.maxCap,
    };
  });

  let allocated = parts.reduce((acc, p) => acc + p.base, 0);
  let remaining = totalToDistribute - allocated;

  const sortedByRemainder = [...parts].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) return b.remainder - a.remainder;
    return a.key.localeCompare(b.key);
  });

  while (remaining > 0) {
    let progressed = false;
    for (const part of sortedByRemainder) {
      if (remaining <= 0) break;
      if (part.maxCap !== undefined && part.base >= part.maxCap) continue;
      part.base += 1;
      allocated += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  for (const part of parts) {
    allocations[part.key] = part.base;
  }

  return allocations;
}

/**
 * Motor puro e determinístico de análise mensal de lacunas e conferência.
 * Nunca converte ausência estatística em consumo individual automático.
 */
export function analyzeMonthlyMealGaps(input: SmartGapAnalyzerInput): SmartAnalysisResult {
  const minAttendanceRate = input.minAttendanceRate ?? 0.4;
  const minPriorMeals = input.minPriorMeals ?? 3;
  const provenTotal = Math.max(0, Math.floor(input.provenTotalMeals));

  const monthDates = getMonthDatesUpTo(input.competenceMonth, input.todayDate);
  const closedSet = new Set(input.closedDates || []);
  const evidenceMap = input.dailyServedEvidence || {};
  const activitySet = new Set(input.observedActivityDatesInMonth || []);

  // Mapa de calendário: override específico de meal_type tem precedência sobre NULL (dia inteiro)
  const calendarMap = new Map<string, UnitCalendarDay>();
  for (const entry of input.calendarOverrides) {
    const existing = calendarMap.get(entry.calendar_date);
    if (!existing || (!existing.meal_type_id && entry.meal_type_id === input.mealTypeId)) {
      if (!entry.meal_type_id || entry.meal_type_id === input.mealTypeId) {
        calendarMap.set(entry.calendar_date, entry);
      }
    }
  }

  // Contagens regulares na competência
  const regularByDate: Record<string, number> = {};
  const regularStudentDateSet = new Set<string>();
  for (const c of input.monthRegularConsumptions) {
    if (c.meal_type_id !== input.mealTypeId) continue;
    regularByDate[c.consumption_date] = (regularByDate[c.consumption_date] || 0) + 1;
    regularStudentDateSet.add(`${c.student_id}|${c.consumption_date}`);
  }

  const otherShiftSet = new Set<string>();
  for (const c of input.monthOtherShiftConsumptions || []) {
    otherShiftSet.add(`${c.student_id}|${c.consumption_date}`);
  }

  const batchItemSet = new Set<string>();
  for (const item of input.existingBatchItemsInMonth) {
    if (item.meal_type_id === input.mealTypeId) {
      batchItemSet.add(`${item.student_id}|${item.service_date}`);
    }
  }

  // Determinação dos dias operacionais da unidade na competência
  const operatingDates: string[] = [];
  for (const d of monthDates) {
    if (!input.unitMealEnabled) continue;

    const cal = calendarMap.get(d);
    if (cal) {
      if (cal.is_operating) operatingDates.push(d);
      continue;
    }

    const dow = getDayOfWeek(d);
    const hasActivity =
      (regularByDate[d] || 0) > 0 ||
      (input.existingBatchMealsByDate[d] || 0) > 0 ||
      Boolean(evidenceMap[d]) ||
      activitySet.has(d);

    // Sem override explícito: opera em dias úteis (seg-sex) ou qualquer dia com atividade real observada
    if (hasActivity || (dow >= 1 && dow <= 5)) {
      operatingDates.push(d);
    }
  }

  // Histórico de frequência por aluno (janela anterior + dias já operacionais)
  const lookbackCountByStudent = new Map<string, number>();
  const lookbackRegularByDate: Record<string, number> = {};
  for (const c of input.lookbackConsumptions) {
    if (c.meal_type_id !== input.mealTypeId) continue;
    lookbackCountByStudent.set(c.student_id, (lookbackCountByStudent.get(c.student_id) || 0) + 1);
    lookbackRegularByDate[c.consumption_date] = (lookbackRegularByDate[c.consumption_date] || 0) + 1;
  }

  const lookbackDaysTotal = Math.max(1, input.lookbackOperatingDates.length);

  // Médias por dia da semana no histórico para detectar quedas anômalas
  const dowTotals: Record<number, { sum: number; count: number }> = {};
  for (const d of input.lookbackOperatingDates) {
    const dow = getDayOfWeek(d);
    if (!dowTotals[dow]) dowTotals[dow] = { sum: 0, count: 0 };
    dowTotals[dow].sum += lookbackRegularByDate[d] || 0;
    dowTotals[dow].count += 1;
  }

  const habitualStudentIds = new Set(
    input.students
      .filter((s) => {
        if (s.status !== 'active') return false;
        const priorMeals = lookbackCountByStudent.get(s.id) || 0;
        if (priorMeals < minPriorMeals) return false;
        const freq = priorMeals / lookbackDaysTotal;
        return freq >= minAttendanceRate;
      })
      .map((s) => s.id)
  );
  const habitualStudentsCount = habitualStudentIds.size;

  const historyByStudent = new Map<string, StudentCategoryHistoryEntry[]>();
  for (const h of input.categoryHistory || []) {
    const list = historyByStudent.get(h.student_id) || [];
    list.push(h);
    historyByStudent.set(h.student_id, list);
  }
  for (const list of historyByStudent.values()) {
    list.sort((a, b) => {
      const dateCmp = a.effective_from.localeCompare(b.effective_from);
      return dateCmp !== 0 ? dateCmp : a.created_at.localeCompare(b.created_at);
    });
  }

  const studentSummaryMap = new Map<string, EligibleStudentCompetenceSummary>();

  // Análise dia a dia
  let totalStatisticalGaps = 0;
  let excludedDuplicatesCount = 0;
  let existingRegularTotal = 0;
  let existingAdjustmentTotal = 0;
  let directDivergenceTotal = 0;
  let closedDaysCount = 0;

  const preDays: Array<DailyGapRecommendation> = operatingDates.map((d) => {
    const isClosedPeriod = closedSet.has(d);
    if (isClosedPeriod) closedDaysCount += 1;

    const regularCount = regularByDate[d] || 0;
    const existingAdjCount = input.existingBatchMealsByDate[d] || 0;
    existingRegularTotal += regularCount;
    existingAdjustmentTotal += existingAdjCount;
    const totalRecorded = regularCount + existingAdjCount;
    const ev = evidenceMap[d];
    const physicalServedCount = ev ? Math.max(0, Math.floor(ev.physicalTotalServed)) : null;
    const provenDivergence =
      physicalServedCount !== null ? Math.max(0, physicalServedCount - totalRecorded) : 0;

    directDivergenceTotal += provenDivergence;

    const dow = getDayOfWeek(d);
    const dowStat = dowTotals[dow];
    const expectedBaseline =
      dowStat && dowStat.count > 0 ? Math.round(dowStat.sum / dowStat.count) : regularCount;
    const anomalyDropPercent =
      expectedBaseline > 0 && regularCount < expectedBaseline
        ? Number((((expectedBaseline - regularCount) / expectedBaseline) * 100).toFixed(1))
        : 0;

    const candidates: GapCandidate[] = [];
    const eligibleNonConsumers: GapCandidate[] = [];
    let alreadyConsumedCount = 0;

    for (const s of input.students) {
      if (s.status !== 'active') continue;
      if (s.created_at && s.created_at.slice(0, 10) > d) continue;

      const resolvedCatId = resolveStudentCategoryOnDate(s.id, s.category_id, d, historyByStudent);
      if (input.categoryId && resolvedCatId !== input.categoryId) continue;

      const eligibleOnDate = input.rules.some(
        (r) => r.category_id === resolvedCatId && isRuleEffectiveOnDate(r, d)
      );
      if (!eligibleOnDate) continue;

      const isHabitual = habitualStudentIds.has(s.id);
      const priorMeals = lookbackCountByStudent.get(s.id) || 0;
      const freq = Number((priorMeals / lookbackDaysTotal).toFixed(2));
      const resolvedCatName = input.categoryNamesById?.[resolvedCatId] || s.category_name;

      let summaryEntry = studentSummaryMap.get(s.id);
      if (!summaryEntry) {
        summaryEntry = {
          student_id: s.id,
          registration_number: s.registration_number,
          full_name: s.full_name,
          category_name: resolvedCatName,
          historical_frequency: freq,
          prior_meals_count: priorMeals,
          is_habitual: isHabitual,
          available_dates: [],
          consumed_dates: [],
          batch_dates: [],
        };
        studentSummaryMap.set(s.id, summaryEntry);
      }

      const hasRegular = regularStudentDateSet.has(`${s.id}|${d}`);
      const hasBatch = batchItemSet.has(`${s.id}|${d}`);

      // Exclusão estrita de duplicidades (consumo regular OU lote ativo/aprovado no mesmo turno/data, independente de categoria)
      if (hasRegular || hasBatch) {
        excludedDuplicatesCount += 1;
        alreadyConsumedCount += 1;
        if (hasRegular) summaryEntry.consumed_dates.push(d);
        if (hasBatch) summaryEntry.batch_dates.push(d);
        continue;
      }

      summaryEntry.available_dates.push(d);
      const sameDayOtherShift = otherShiftSet.has(`${s.id}|${d}`);
      const reasonText = isHabitual
        ? sameDayOtherShift
          ? `Frequência ${Math.round(freq * 100)}% e presença em outro turno no mesmo dia`
          : `Frequência histórica de ${Math.round(freq * 100)}% no turno`
        : sameDayOtherShift
        ? 'Presença em outro turno no dia (sem consumo neste turno)'
        : 'Elegível na data sem registro de consumo ou lote';

      const entry: GapCandidate = {
        student_id: s.id,
        registration_number: s.registration_number,
        full_name: s.full_name,
        category_id: resolvedCatId,
        category_name: resolvedCatName,
        historical_frequency: freq,
        prior_meals_count: priorMeals,
        attended_other_shift_same_day: sameDayOtherShift,
        is_habitual: isHabitual,
        confidence_reason: reasonText,
      };

      eligibleNonConsumers.push(entry);
      if (isHabitual) {
        candidates.push(entry);
      }
    }

    const sortCandidates = (a: GapCandidate, b: GapCandidate) => {
      if (Boolean(a.is_habitual) !== Boolean(b.is_habitual)) {
        return a.is_habitual ? -1 : 1;
      }
      if (a.attended_other_shift_same_day !== b.attended_other_shift_same_day) {
        return a.attended_other_shift_same_day ? -1 : 1;
      }
      if (b.historical_frequency !== a.historical_frequency) {
        return b.historical_frequency - a.historical_frequency;
      }
      return a.full_name.localeCompare(b.full_name);
    };

    candidates.sort(sortCandidates);
    eligibleNonConsumers.sort(sortCandidates);

    totalStatisticalGaps += candidates.length;

    const reasons: string[] = [];
    if (provenDivergence > 0) {
      reasons.push(`Divergência física comprovada de +${provenDivergence} refeição(ões)`);
    }
    if (anomalyDropPercent >= 20) {
      reasons.push(`Queda de ${anomalyDropPercent}% frente à média histórica do dia`);
    }
    if (candidates.length > 0) {
      reasons.push(`${candidates.length} comensal(is) habitual(is) sem registro`);
    } else if (eligibleNonConsumers.length > 0) {
      reasons.push(`${eligibleNonConsumers.length} comensal(is) elegível(is) sem consumo no dia`);
    }
    if (isClosedPeriod) {
      reasons.push('Competência diária já possui fechamento persistido');
    }

    const anomalyGap = Math.max(0, expectedBaseline - totalRecorded);
    const conferenceWeight =
      provenDivergence * 10 +
      anomalyGap +
      candidates.length * 2 +
      (eligibleNonConsumers.length > 0 ? 1 : 0) +
      (anomalyDropPercent >= 20 ? 3 : 0);

    return {
      date: d,
      is_operating: true,
      is_closed_period: isClosedPeriod,
      regular_count: regularCount,
      existing_adjustment_count: existingAdjCount,
      total_recorded: totalRecorded,
      physical_served_count: physicalServedCount,
      proven_divergence: provenDivergence,
      habitual_gaps_count: candidates.length,
      already_consumed_count: alreadyConsumedCount,
      expected_baseline: expectedBaseline,
      anomaly_drop_percent: anomalyDropPercent,
      conference_weight: conferenceWeight,
      suggested_conference_qty: 0,
      auto_allocatable_qty: 0,
      reasons,
      gap_candidates: candidates,
      eligible_non_consumers: eligibleNonConsumers,
    };
  });

  // 1. Alocação automática apenas para dias com divergência diária comprovada (evidência física)
  const allowClosed = Boolean(input.allowClosedDates);
  const directItems = preDays
    .filter((d) => d.proven_divergence > 0 && (!d.is_closed_period || allowClosed))
    .map((d) => ({ key: d.date, weight: d.proven_divergence, maxCap: d.proven_divergence }));

  const targetDirect = Math.min(
    provenTotal,
    directItems.reduce((acc, item) => acc + item.maxCap, 0)
  );
  const directAllocations = distributeByLargestRemainder(directItems, targetDirect);

  // 2. Sugestão para conferência (não aplicada sem confirmação documental)
  const conferenceItems = preDays
    .filter((d) => (!d.is_closed_period || allowClosed) && d.conference_weight > 0)
    .map((d) => ({ key: d.date, weight: d.conference_weight }));

  const conferenceSuggestions =
    conferenceItems.length > 0 ? distributeByLargestRemainder(conferenceItems, provenTotal) : {};

  let recommendedAllocatedTotal = 0;
  let suggestedConferenceTotal = 0;

  for (const day of preDays) {
    const autoQty = directAllocations[day.date] || 0;
    const confQty = conferenceSuggestions[day.date] || 0;
    day.auto_allocatable_qty = autoQty;
    day.suggested_conference_qty = confQty;
    recommendedAllocatedTotal += autoQty;
    suggestedConferenceTotal += confQty;
  }

  const eligibleStudentsSummary = Array.from(studentSummaryMap.values()).sort((a, b) => {
    if (a.is_habitual !== b.is_habitual) return a.is_habitual ? -1 : 1;
    if (b.available_dates.length !== a.available_dates.length) {
      return b.available_dates.length - a.available_dates.length;
    }
    return a.full_name.localeCompare(b.full_name);
  });

  return {
    meal_type_id: input.mealTypeId,
    category_id: input.categoryId ?? null,
    competence_month: input.competenceMonth,
    operating_days_count: operatingDates.length,
    closed_days_count: closedDaysCount,
    habitual_students_count: habitualStudentsCount,
    total_statistical_gaps: totalStatisticalGaps,
    excluded_duplicates_count: excludedDuplicatesCount,
    existing_regular_count: existingRegularTotal,
    existing_adjustment_count: existingAdjustmentTotal,
    proven_total_meals: provenTotal,
    direct_divergence_total: directDivergenceTotal,
    recommended_allocated_total: recommendedAllocatedTotal,
    unallocated_pending_meals: Math.max(0, provenTotal - recommendedAllocatedTotal),
    suggested_conference_total: suggestedConferenceTotal,
    days: preDays,
    eligible_students_summary: eligibleStudentsSummary,
  };
}

