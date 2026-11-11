import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  analyzeMonthlyMealGaps,
  type AnalyzerBatchItemRecord,
  type AnalyzerConsumptionRecord,
  type AnalyzerRuleWindow,
  type AnalyzerStudentRecord,
} from '@/lib/adjustments/smart-gap-analyzer';
import {
  getContingencyManagementData,
  type ContingencyManagementData,
} from '@/server/contingency/contingency.service';
import type {
  DateContextPreview,
  MealAdjustmentCampaignSummary,
  MealRuleOption,
  SmartAnalysisResult,
  SmartDistributionLineInput,
  SmartMultiAnalysisResult,
  SmartMultiLineAnalysisItem,
  StudentCategoryHistoryEntry,
  SubmitRetroactiveDistributionInput,
  SubmitSmartCampaignInput,
  UnitCalendarDay,
  UnitMealTypeOption,
} from '@/types/adjustments';

type RpcCaller = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface MealAdjustmentsWorkspaceData extends ContingencyManagementData {
  institutions: Array<{ id: string; name: string }>;
  unitInstitutions: Record<string, string>;
  unitMealTypes: UnitMealTypeOption[];
  mealRules: MealRuleOption[];
  campaigns: MealAdjustmentCampaignSummary[];
  calendarOverrides: UnitCalendarDay[];
}

function getTodayIsoBr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export async function getMealAdjustmentsWorkspaceData(): Promise<MealAdjustmentsWorkspaceData> {
  const base = await getContingencyManagementData();
  const supabase = await createClient();

  const [institutionsRes, unitsMetaRes, unitMealTypesRes, mealRulesRes] = await Promise.all([
    supabase.from('institutions').select('id,name').eq('status', 'active').order('name'),
    supabase.from('units').select('id,institution_id').eq('status', 'active'),
    supabase
      .from('unit_meal_types')
      .select('unit_id,meal_type_id,enabled,start_time,end_time')
      .eq('enabled', true),
    supabase
      .from('meal_rules')
      .select('id,unit_id,meal_type_id,category_id,enabled,effective_from,effective_to,full_price,student_price,subsidy_amount')
      .eq('enabled', true),
  ]);

  const unitInstitutions: Record<string, string> = {};
  for (const row of (unitsMetaRes.data || []) as Array<{ id: string; institution_id: string }>) {
    unitInstitutions[row.id] = row.institution_id;
  }

  const unitMealTypes: UnitMealTypeOption[] = ((unitMealTypesRes.data || []) as Array<{
    unit_id: string;
    meal_type_id: string;
    enabled: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }>).map((r) => ({
    unit_id: r.unit_id,
    meal_type_id: r.meal_type_id,
    enabled: Boolean(r.enabled),
    start_time: r.start_time || null,
    end_time: r.end_time || null,
  }));

  const mealRules: MealRuleOption[] = ((mealRulesRes.data || []) as Array<{
    id: string;
    unit_id: string;
    meal_type_id: string;
    category_id: string;
    enabled: boolean;
    effective_from: string;
    effective_to?: string | null;
    full_price: number;
    student_price: number;
    subsidy_amount: number;
  }>).map((r) => ({
    id: r.id,
    unit_id: r.unit_id,
    meal_type_id: r.meal_type_id,
    category_id: r.category_id,
    enabled: Boolean(r.enabled),
    effective_from: r.effective_from,
    effective_to: r.effective_to || null,
    full_price: Number(r.full_price || 0),
    student_price: Number(r.student_price || 0),
    subsidy_amount: Number(r.subsidy_amount || 0),
  }));

  let campaigns: MealAdjustmentCampaignSummary[] = [];
  let calendarOverrides: UnitCalendarDay[] = [];

  try {
    const [campaignsRes, calendarRes] = await Promise.all([
      (supabase as unknown as { from: (t: string) => { select: (c: string) => { order: (col: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> } } } })
        .from('meal_adjustment_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      (supabase as unknown as { from: (t: string) => { select: (c: string) => { order: (col: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> } } } })
        .from('unit_operating_calendar')
        .select('id,unit_id,calendar_date,meal_type_id,is_operating,reason')
        .order('calendar_date', { ascending: false })
        .limit(200),
    ]);

    const unitNameById = new Map(base.units.map((u) => [u.id, u.name]));
    const mealNameById = new Map(base.mealTypes.map((m) => [m.id, m.name]));

    if (Array.isArray(campaignsRes.data)) {
      const userIds = new Set<string>();
      for (const raw of campaignsRes.data) {
        const r = raw as Record<string, unknown>;
        if (r.created_by) userIds.add(String(r.created_by));
        if (r.approved_by) userIds.add(String(r.approved_by));
      }
      const namesById = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id,full_name')
          .in('id', Array.from(userIds));
        for (const p of (profs || []) as Array<{ id: string; full_name: string }>) {
          namesById.set(p.id, p.full_name);
        }
      }

      campaigns = campaignsRes.data.map((raw) => {
        const r = raw as Record<string, unknown>;
        const uId = String(r.unit_id);
        const mId = r.meal_type_id ? String(r.meal_type_id) : null;
        const selectedIds = Array.isArray(r.selected_meal_type_ids)
          ? (r.selected_meal_type_ids as string[])
          : mId
          ? [mId]
          : [];
        const mealNames = selectedIds.map((id) => mealNameById.get(id) || 'Refeição');
        const distLines = Array.isArray(r.distribution_lines)
          ? (r.distribution_lines as Array<{ meal_type_id: string; category_id: string; quantity: number }>)
          : [];
        const cBy = String(r.created_by);
        const aBy = r.approved_by ? String(r.approved_by) : null;
        return {
          id: String(r.id),
          tenant_id: String(r.tenant_id),
          institution_id: String(r.institution_id),
          unit_id: uId,
          unit_name: unitNameById.get(uId) || 'Unidade',
          meal_type_id: mId,
          meal_type_name: mealNames.length > 0 ? mealNames.join(' + ') : 'Múltiplos Turnos',
          selected_meal_type_ids: selectedIds,
          meal_type_names: mealNames,
          distribution_lines: distLines,
          competence_month: String(r.competence_month),
          modality: String(r.modality) as MealAdjustmentCampaignSummary['modality'],
          proven_total_meals: Number(r.proven_total_meals || 0),
          allocated_meals_count: Number(r.allocated_meals_count || 0),
          unallocated_pending_meals: Number(r.unallocated_pending_meals || 0),
          allocation_status: String(r.allocation_status) as MealAdjustmentCampaignSummary['allocation_status'],
          justification: String(r.justification || ''),
          evidence_document_url: r.evidence_document_url ? String(r.evidence_document_url) : null,
          rejection_reason: r.rejection_reason ? String(r.rejection_reason) : null,
          created_by: cBy,
          creator_name: namesById.get(cBy) || 'Gestor',
          approved_by: aBy,
          approver_name: aBy ? namesById.get(aBy) || 'Aprovador' : null,
          approved_at: r.approved_at ? String(r.approved_at) : null,
          created_at: String(r.created_at),
        };
      });
    }

    if (Array.isArray(calendarRes.data)) {
      calendarOverrides = calendarRes.data.map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          id: String(r.id),
          unit_id: String(r.unit_id),
          calendar_date: String(r.calendar_date),
          meal_type_id: r.meal_type_id ? String(r.meal_type_id) : null,
          is_operating: Boolean(r.is_operating),
          reason: r.reason ? String(r.reason) : null,
        };
      });
    }
  } catch {
    // Tabelas opcionais caso Migration 84 ainda não esteja aplicada no ambiente conectado
  }

  return {
    ...base,
    institutions: (institutionsRes.data || []) as Array<{ id: string; name: string }>,
    unitInstitutions,
    unitMealTypes,
    mealRules,
    campaigns,
    calendarOverrides,
  };
}

export async function previewAdjustmentDateServer(
  unitId: string,
  mealTypeId: string,
  serviceDate: string
): Promise<DateContextPreview> {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { rpc: RpcCaller }).rpc(
    'preview_contingency_date_context',
    {
      p_unit_id: unitId,
      p_meal_type_id: mealTypeId,
      p_service_date: serviceDate,
    }
  );

  if (!error && data) {
    return data as DateContextPreview;
  }

  // Fallback leitura segura caso Migration 84 ainda não esteja aplicada no ambiente conectado
  const [regRes, adjRes, closeRes] = await Promise.all([
    supabase
      .from('meal_consumptions')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .eq('meal_type_id', mealTypeId)
      .eq('consumption_date', serviceDate)
      .eq('status', 'approved'),
    supabase
      .from('contingency_meal_batches')
      .select('total_meals_served')
      .eq('unit_id', unitId)
      .eq('meal_type_id', mealTypeId)
      .eq('service_date', serviceDate)
      .in('status', ['draft', 'pending_approval', 'approved']),
    supabase
      .from('financial_daily_closings')
      .select('id')
      .eq('closing_date', serviceDate)
      .or(`unit_id.is.null,unit_id.eq.${unitId}`)
      .limit(1),
  ]);

  const adjSum = ((adjRes.data || []) as Array<{ total_meals_served: number }>).reduce(
    (acc, item) => acc + Number(item.total_meals_served || 0),
    0
  );

  return {
    service_date: serviceDate,
    regular_meals_count: regRes.count || 0,
    existing_adjustment_meals_count: adjSum,
    is_operating: true,
    calendar_reason: null,
    is_closed_period: Array.isArray(closeRes.data) && closeRes.data.length > 0,
  };
}

export async function previewMultiShiftsDateServer(
  unitId: string,
  mealTypeIds: string[],
  serviceDate: string
): Promise<Array<{ meal_type_id: string; preview: DateContextPreview }>> {
  const uniqueIds = Array.from(new Set(mealTypeIds.filter(Boolean)));
  const results = await Promise.all(
    uniqueIds.map(async (mealTypeId) => ({
      meal_type_id: mealTypeId,
      preview: await previewAdjustmentDateServer(unitId, mealTypeId, serviceDate),
    }))
  );
  return results;
}

interface CompetenceAnalysisContext {
  unit: { id: string; tenant_id: string; institution_id: string; status: string };
  todayDate: string;
  monthStart: string;
  monthEnd: string;
  students: AnalyzerStudentRecord[];
  categoryHistory: StudentCategoryHistoryEntry[];
  categoryNamesById: Record<string, string>;
  mealNamesById: Record<string, string>;
  unitMealEnabledByMealType: Map<string, boolean>;
  rulesByMealType: Map<string, Array<AnalyzerRuleWindow & { student_price: number; subsidy_amount: number }>>;
  lookbackConsumptions: AnalyzerConsumptionRecord[];
  monthRegularConsumptions: AnalyzerConsumptionRecord[];
  existingBatchRows: Array<{ id: string; service_date: string; meal_type_id: string; total_meals_served: number }>;
  existingBatchItemsInMonth: AnalyzerBatchItemRecord[];
  calendarOverrides: UnitCalendarDay[];
  closedDates: string[];
}

async function loadCompetenceAnalysisContext(
  unitId: string,
  mealTypeIds: string[],
  competenceMonth: string
): Promise<CompetenceAnalysisContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('AUTH_REQUIRED: Sessão expirada.');

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status')
    .eq('id', user.id)
    .single();

  const profile = profileData as { id: string; tenant_id: string; role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    throw new Error('ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não autorizado.');
  }

  if (!['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(profile.role)) {
    throw new Error('PERMISSION_DENIED: Perfil sem permissão para análise de lacunas.');
  }

  if (!/^\d{4}-\d{2}$/.test(competenceMonth)) {
    throw new Error('INVALID_COMPETENCE: Competência deve estar no formato AAAA-MM.');
  }

  const [yearStr, monthStr] = competenceMonth.split('-');
  const monthStart = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0)).getUTCDate();
  const monthEnd = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const todayDate = getTodayIsoBr();

  if (monthStart > `${todayDate.slice(0, 7)}-01`) {
    throw new Error('INVALID_COMPETENCE: Não é permitido analisar competência futura.');
  }

  const { data: unitData, error: unitErr } = await supabase
    .from('units')
    .select('id,tenant_id,institution_id,status')
    .eq('id', unitId)
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .single();

  if (unitErr || !unitData) {
    throw new Error('UNIT_NOT_FOUND_OR_FORBIDDEN: Unidade inativa ou sem acesso.');
  }

  const unit = unitData as { id: string; tenant_id: string; institution_id: string; status: string };
  const lookbackStart = addDaysIso(monthStart, -60);
  const lookbackEnd = addDaysIso(monthStart, -1);

  const [
    unitMealsRes,
    mealTypesRes,
    categoriesRes,
    studentsRes,
    historyRes,
    rulesRes,
    lookbackConsRes,
    monthConsRes,
    existingBatchesRes,
    closingsRes,
  ] = await Promise.all([
    supabase
      .from('unit_meal_types')
      .select('meal_type_id,enabled')
      .eq('unit_id', unit.id)
      .in('meal_type_id', mealTypeIds),
    supabase.from('meal_types').select('id,name').eq('tenant_id', profile.tenant_id),
    supabase.from('student_categories').select('id,name').eq('tenant_id', profile.tenant_id),
    supabase
      .from('students')
      .select('id,registration_number,full_name,category_id,status,created_at,student_categories(name)')
      .eq('tenant_id', profile.tenant_id)
      .eq('institution_id', unit.institution_id)
      .eq('status', 'active'),
    supabase
      .from('student_category_history')
      .select('student_id,previous_category_id,new_category_id,effective_from,created_at')
      .eq('tenant_id', profile.tenant_id),
    supabase
      .from('meal_rules')
      .select('meal_type_id,category_id,enabled,effective_from,effective_to,student_price,subsidy_amount')
      .eq('tenant_id', profile.tenant_id)
      .eq('unit_id', unit.id)
      .in('meal_type_id', mealTypeIds),
    supabase
      .from('meal_consumptions')
      .select('student_id,consumption_date,meal_type_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('unit_id', unit.id)
      .gte('consumption_date', lookbackStart)
      .lte('consumption_date', lookbackEnd)
      .in('status', ['approved', 'financially_refunded']),
    supabase
      .from('meal_consumptions')
      .select('student_id,consumption_date,meal_type_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('unit_id', unit.id)
      .gte('consumption_date', monthStart)
      .lte('consumption_date', monthEnd)
      .eq('status', 'approved'),
    supabase
      .from('contingency_meal_batches')
      .select('id,service_date,meal_type_id,total_meals_served,status')
      .eq('tenant_id', profile.tenant_id)
      .eq('unit_id', unit.id)
      .in('meal_type_id', mealTypeIds)
      .gte('service_date', monthStart)
      .lte('service_date', monthEnd)
      .in('status', ['draft', 'pending_approval', 'approved']),
    supabase
      .from('financial_daily_closings')
      .select('closing_date,unit_id')
      .eq('tenant_id', profile.tenant_id)
      .gte('closing_date', monthStart)
      .lte('closing_date', monthEnd),
  ]);

  let calendarOverrides: UnitCalendarDay[] = [];
  try {
    const calRes = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            gte: (col: string, val: string) => {
              lte: (col: string, val: string) => Promise<{ data: unknown[] | null }>;
            };
          };
        };
      };
    })
      .from('unit_operating_calendar')
      .select('id,unit_id,calendar_date,meal_type_id,is_operating,reason')
      .eq('unit_id', unit.id)
      .gte('calendar_date', monthStart)
      .lte('calendar_date', monthEnd);

    if (Array.isArray(calRes.data)) {
      calendarOverrides = calRes.data.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          unit_id: String(row.unit_id),
          calendar_date: String(row.calendar_date),
          meal_type_id: row.meal_type_id ? String(row.meal_type_id) : null,
          is_operating: Boolean(row.is_operating),
          reason: row.reason ? String(row.reason) : null,
        };
      });
    }
  } catch {
    calendarOverrides = [];
  }

  const unitMealEnabledByMealType = new Map<string, boolean>();
  for (const row of (unitMealsRes.data || []) as Array<{ meal_type_id: string; enabled: boolean }>) {
    unitMealEnabledByMealType.set(row.meal_type_id, Boolean(row.enabled));
  }

  const mealNamesById: Record<string, string> = {};
  for (const m of (mealTypesRes.data || []) as Array<{ id: string; name: string }>) {
    mealNamesById[m.id] = m.name;
  }

  const categoryNamesById: Record<string, string> = {};
  for (const c of (categoriesRes.data || []) as Array<{ id: string; name: string }>) {
    categoryNamesById[c.id] = c.name;
  }

  const rulesByMealType = new Map<
    string,
    Array<AnalyzerRuleWindow & { student_price: number; subsidy_amount: number }>
  >();
  for (const r of (rulesRes.data || []) as Array<{
    meal_type_id: string;
    category_id: string;
    enabled: boolean;
    effective_from: string;
    effective_to?: string | null;
    student_price: number;
    subsidy_amount: number;
  }>) {
    const list = rulesByMealType.get(r.meal_type_id) || [];
    list.push({
      category_id: r.category_id,
      enabled: Boolean(r.enabled),
      effective_from: r.effective_from,
      effective_to: r.effective_to || null,
      student_price: Number(r.student_price || 0),
      subsidy_amount: Number(r.subsidy_amount || 0),
    });
    rulesByMealType.set(r.meal_type_id, list);
  }

  const existingBatchRows = (existingBatchesRes.data || []) as Array<{
    id: string;
    service_date: string;
    meal_type_id: string;
    total_meals_served: number;
  }>;

  let existingBatchItemsInMonth: AnalyzerBatchItemRecord[] = [];
  if (existingBatchRows.length > 0) {
    const batchMetaById = new Map(existingBatchRows.map((b) => [b.id, b]));
    const { data: itemRows } = await supabase
      .from('contingency_batch_items')
      .select('batch_id,student_id')
      .in(
        'batch_id',
        existingBatchRows.map((b) => b.id)
      );
    existingBatchItemsInMonth = ((itemRows || []) as Array<{ batch_id: string; student_id: string }>).map(
      (it) => {
        const meta = batchMetaById.get(it.batch_id);
        return {
          student_id: it.student_id,
          service_date: meta?.service_date || '',
          meal_type_id: meta?.meal_type_id || '',
        };
      }
    );
  }

  const students: AnalyzerStudentRecord[] = ((studentsRes.data || []) as Array<{
    id: string;
    registration_number: string;
    full_name: string;
    category_id: string;
    status: string;
    created_at?: string | null;
    student_categories?: { name?: string } | null;
  }>).map((s) => ({
    id: s.id,
    registration_number: s.registration_number,
    full_name: s.full_name,
    category_id: s.category_id,
    category_name: s.student_categories?.name || categoryNamesById[s.category_id] || 'Categoria',
    status: s.status,
    created_at: s.created_at,
  }));

  const closedDates = ((closingsRes.data || []) as Array<{ closing_date: string; unit_id: string | null }>)
    .filter((c) => !c.unit_id || c.unit_id === unit.id)
    .map((c) => c.closing_date);

  return {
    unit,
    todayDate,
    monthStart,
    monthEnd,
    students,
    categoryHistory: (historyRes.data || []) as StudentCategoryHistoryEntry[],
    categoryNamesById,
    mealNamesById,
    unitMealEnabledByMealType,
    rulesByMealType,
    lookbackConsumptions: (lookbackConsRes.data || []) as AnalyzerConsumptionRecord[],
    monthRegularConsumptions: (monthConsRes.data || []) as AnalyzerConsumptionRecord[],
    existingBatchRows,
    existingBatchItemsInMonth,
    calendarOverrides,
    closedDates,
  };
}

function runAnalysisFromContext(
  ctx: CompetenceAnalysisContext,
  opts: {
    mealTypeId: string;
    categoryId?: string | null;
    competenceMonth: string;
    provenTotalMeals: number;
    dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
    allowClosedDates?: boolean;
  }
): SmartAnalysisResult {
  const shiftLookbackCons = ctx.lookbackConsumptions.filter((c) => c.meal_type_id === opts.mealTypeId);
  const lookbackOpDatesSet = new Set(shiftLookbackCons.map((c) => c.consumption_date));
  const lookbackEnd = addDaysIso(ctx.monthStart, -1);
  const lookbackOperatingDates =
    lookbackOpDatesSet.size > 0
      ? Array.from(lookbackOpDatesSet).sort()
      : Array.from({ length: 20 }, (_, idx) => addDaysIso(lookbackEnd, -idx));

  const existingBatchMealsByDate: Record<string, number> = {};
  for (const b of ctx.existingBatchRows) {
    if (b.meal_type_id !== opts.mealTypeId) continue;
    existingBatchMealsByDate[b.service_date] =
      (existingBatchMealsByDate[b.service_date] || 0) + Number(b.total_meals_served || 0);
  }

  const unitMealEnabled = ctx.unitMealEnabledByMealType.get(opts.mealTypeId) === true;

  return analyzeMonthlyMealGaps({
    competenceMonth: opts.competenceMonth,
    todayDate: ctx.todayDate,
    mealTypeId: opts.mealTypeId,
    categoryId: opts.categoryId ?? null,
    categoryNamesById: ctx.categoryNamesById,
    unitMealEnabled,
    provenTotalMeals: opts.provenTotalMeals,
    students: ctx.students,
    categoryHistory: ctx.categoryHistory,
    rules: ctx.rulesByMealType.get(opts.mealTypeId) || [],
    calendarOverrides: ctx.calendarOverrides,
    lookbackOperatingDates,
    lookbackConsumptions: shiftLookbackCons,
    monthRegularConsumptions: ctx.monthRegularConsumptions.filter((c) => c.meal_type_id === opts.mealTypeId),
    monthOtherShiftConsumptions: ctx.monthRegularConsumptions.filter((c) => c.meal_type_id !== opts.mealTypeId),
    existingBatchItemsInMonth: ctx.existingBatchItemsInMonth.filter((it) => it.meal_type_id === opts.mealTypeId),
    existingBatchMealsByDate,
    dailyServedEvidence: opts.dailyServedEvidence,
    closedDates: ctx.closedDates,
    allowClosedDates: Boolean(opts.allowClosedDates),
  });
}

export async function analyzeMonthlySmartGapsServer(params: {
  unitId: string;
  mealTypeId: string;
  categoryId?: string | null;
  competenceMonth: string;
  provenTotalMeals: number;
  dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
  allowClosedDates?: boolean;
}): Promise<SmartAnalysisResult> {
  const ctx = await loadCompetenceAnalysisContext(params.unitId, [params.mealTypeId], params.competenceMonth);
  return runAnalysisFromContext(ctx, params);
}

export async function analyzeMonthlySmartMultiServer(params: {
  unitId: string;
  competenceMonth: string;
  provenTotalMeals: number;
  lines: SmartDistributionLineInput[];
  dailyServedEvidence?: Record<string, { physicalTotalServed: number; sourceRef: string }>;
  allowClosedDates?: boolean;
}): Promise<SmartMultiAnalysisResult> {
  if (!params.lines || params.lines.length === 0) {
    throw new Error('LINES_REQUIRED: Adicione ao menos uma linha (turno + categoria + quantidade).');
  }

  const linesTotal = params.lines.reduce((acc, l) => acc + Math.max(0, Math.floor(l.quantity || 0)), 0);
  if (linesTotal > params.provenTotalMeals) {
    throw new Error(
      `LINES_EXCEED_PROVEN_TOTAL: Soma das linhas (${linesTotal}) excede o total comprovado (${params.provenTotalMeals}).`
    );
  }

  const seenPairs = new Set<string>();
  for (const l of params.lines) {
    if (!l.meal_type_id) throw new Error('MEAL_TYPE_REQUIRED: Turno obrigatório em todas as linhas.');
    if (!l.category_id) throw new Error('CATEGORY_REQUIRED: Categoria obrigatória em todas as linhas.');
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) {
      throw new Error('INVALID_LINE_QUANTITY: Quantidade da linha deve ser maior que zero.');
    }
    const pairKey = `${l.meal_type_id}|${l.category_id}`;
    if (seenPairs.has(pairKey)) {
      throw new Error('DUPLICATE_DISTRIBUTION_LINE: Não repita o mesmo par Turno + Categoria nas linhas.');
    }
    seenPairs.add(pairKey);
  }

  const mealTypeIds = Array.from(new Set(params.lines.map((l) => l.meal_type_id)));
  const ctx = await loadCompetenceAnalysisContext(params.unitId, mealTypeIds, params.competenceMonth);

  const analyzedLines: SmartMultiLineAnalysisItem[] = params.lines.map((line) => {
    if (ctx.unitMealEnabledByMealType.get(line.meal_type_id) !== true) {
      const mName = ctx.mealNamesById[line.meal_type_id] || line.meal_type_id;
      throw new Error(`UNIT_MEAL_TYPE_DISABLED: Turno "${mName}" não está habilitado para esta unidade.`);
    }

    const rulesForShift = ctx.rulesByMealType.get(line.meal_type_id) || [];
    const activeCatRule = rulesForShift.find(
      (r) => r.category_id === line.category_id && r.enabled
    );
    if (!activeCatRule) {
      const cName = ctx.categoryNamesById[line.category_id] || line.category_id;
      const mName = ctx.mealNamesById[line.meal_type_id] || line.meal_type_id;
      throw new Error(
        `RULE_NOT_EFFECTIVE: Não há regra tarifária habilitada para "${cName}" no turno "${mName}" nesta unidade.`
      );
    }

    const lineAnalysis = runAnalysisFromContext(ctx, {
      mealTypeId: line.meal_type_id,
      categoryId: line.category_id,
      competenceMonth: params.competenceMonth,
      provenTotalMeals: line.quantity,
      dailyServedEvidence: params.dailyServedEvidence,
      allowClosedDates: params.allowClosedDates,
    });

    return {
      line_id: line.line_id,
      meal_type_id: line.meal_type_id,
      meal_type_name: ctx.mealNamesById[line.meal_type_id] || 'Turno',
      category_id: line.category_id,
      category_name: ctx.categoryNamesById[line.category_id] || 'Categoria',
      requested_quantity: line.quantity,
      rule_student_price: activeCatRule.student_price,
      rule_subsidy_amount: activeCatRule.subsidy_amount,
      analysis: lineAnalysis,
    };
  });

  return {
    competence_month: params.competenceMonth,
    proven_total_meals: params.provenTotalMeals,
    lines_requested_total: linesTotal,
    unallocated_to_lines_meals: Math.max(0, params.provenTotalMeals - linesTotal),
    operating_days_max: Math.max(0, ...analyzedLines.map((l) => l.analysis.operating_days_count)),
    total_statistical_gaps: analyzedLines.reduce((acc, l) => acc + l.analysis.total_statistical_gaps, 0),
    total_excluded_duplicates: analyzedLines.reduce((acc, l) => acc + l.analysis.excluded_duplicates_count, 0),
    lines: analyzedLines,
  };
}

export async function upsertUnitCalendarServer(input: UnitCalendarDay) {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { rpc: RpcCaller }).rpc(
    'upsert_unit_operating_calendar',
    {
      p_unit_id: input.unit_id,
      p_calendar_date: input.calendar_date,
      p_is_operating: input.is_operating,
      p_meal_type_id: input.meal_type_id || null,
      p_reason: input.reason?.trim() || null,
    }
  );
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, data };
}

export async function submitSmartAdjustmentCampaignServer(input: SubmitSmartCampaignInput) {
  const supabase = await createClient();
  const competenceDate = `${input.competence_month}-01`;
  const mealTypeIds = Array.from(
    new Set(
      (input.meal_type_ids && input.meal_type_ids.length > 0
        ? input.meal_type_ids
        : input.meal_type_id
        ? [input.meal_type_id]
        : []
      ).filter(Boolean)
    )
  );
  const { data, error } = await (supabase as unknown as { rpc: RpcCaller }).rpc(
    'submit_smart_adjustment_campaign',
    {
      p_unit_id: input.unit_id,
      p_meal_type_id: mealTypeIds.length === 1 ? mealTypeIds[0] : null,
      p_competence_month: competenceDate,
      p_modality: input.modality,
      p_proven_total_meals: input.proven_total_meals,
      p_allocations: input.allocations,
      p_analysis_snapshot: input.analysis_snapshot || {},
      p_justification: input.justification.trim(),
      p_evidence_document_url: input.evidence_document_url || null,
      p_allow_closed_period: Boolean(input.allow_closed_period),
      p_meal_type_ids: mealTypeIds,
      p_distribution_lines: input.distribution_lines || [],
    }
  );

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, result: data };
}

export async function submitRetroactiveDateDistributionServer(
  input: SubmitRetroactiveDistributionInput
) {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { rpc: RpcCaller }).rpc(
    'submit_retroactive_date_distribution',
    {
      p_unit_id: input.unit_id,
      p_service_date: input.service_date,
      p_lines: input.lines,
      p_justification: input.justification.trim(),
      p_evidence_document_url: input.evidence_document_url || null,
      p_allow_closed_period: Boolean(input.allow_closed_period),
    }
  );

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, result: data };
}

export async function reviewSmartAdjustmentCampaignServer(
  campaignId: string,
  action: 'approve' | 'reject',
  reason?: string
) {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { rpc: RpcCaller }).rpc(
    'review_smart_adjustment_campaign',
    {
      p_campaign_id: campaignId,
      p_action: action,
      p_reason: reason?.trim() || null,
    }
  );

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, result: data };
}

