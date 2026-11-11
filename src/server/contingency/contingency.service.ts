import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  ContingencyMealBatch,
  ContingencyBatchItem,
  SubmitContingencyBatchInput,
  ReviewContingencyBatchInput,
} from '@/types/contingency';

export interface ContingencyManagementData {
  batches: ContingencyMealBatch[];
  units: Array<{ id: string; name: string }>;
  mealTypes: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; code: string }>;
  currentUser: {
    id: string;
    role: string;
    fullName: string;
  };
  canReview: boolean;
  canCreate: boolean;
}

export async function getContingencyManagementData(): Promise<ContingencyManagementData> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id,tenant_id,role,status,full_name')
    .eq('id', user.id)
    .single();

  const profile = profileData as {
    id: string;
    tenant_id: string;
    role: string;
    status: string;
    full_name: string;
  } | null;

  if (!profile || profile.status !== 'active') {
    throw new Error('Perfil de usuário inativo ou não autorizado.');
  }

  const allowedRoles = ['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'];
  if (!allowedRoles.includes(profile.role)) {
    throw new Error('PERMISSION_DENIED: Perfil sem permissão para acessar lotes de contingência.');
  }

  const canReview = ['admin_general', 'operations_director', 'finance'].includes(profile.role);
  const canCreate = ['admin_general', 'operations_director', 'supervisor', 'unit_manager'].includes(profile.role);

  const [batchesRes, unitsRes, mealTypesRes, categoriesRes] = await Promise.all([
    supabase
      .from('contingency_meal_batches')
      .select(`
        *,
        units(name),
        meal_types(name),
        student_categories(name)
      `)
      .order('service_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('units')
      .select('id,name')
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('meal_types')
      .select('id,name')
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('student_categories')
      .select('id,name,code')
      .order('name'),
  ]);

  if (batchesRes.error) {
    console.error('Erro ao consultar lotes de contingência:', batchesRes.error);
  }

  const rawBatches = batchesRes.data || [];

  // Obter nomes dos operadores e aprovadores
  const userIds = new Set<string>();
  rawBatches.forEach((b: { operator_id?: string; approved_by?: string }) => {
    if (b.operator_id) userIds.add(b.operator_id);
    if (b.approved_by) userIds.add(b.approved_by);
  });

  const profilesMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profilesList } = await supabase
      .from('profiles')
      .select('id,full_name')
      .in('id', Array.from(userIds));

    (profilesList || []).forEach((p: { id: string; full_name: string }) => {
      profilesMap.set(p.id, p.full_name);
    });
  }

  const batches: ContingencyMealBatch[] = rawBatches.map((b: {
    id: string;
    tenant_id: string;
    unit_id: string;
    units?: { name?: string } | null;
    meal_type_id: string;
    meal_types?: { name?: string } | null;
    service_date: string;
    batch_type: string;
    total_meals_served: number;
    category_id?: string | null;
    student_categories?: { name?: string } | null;
    unit_price: number;
    subsidy_price: number;
    total_amount: number;
    total_subsidy_amount: number;
    justification: string;
    evidence_document_url?: string | null;
    operator_id: string;
    status: string;
    rejection_reason?: string | null;
    approved_by?: string | null;
    approved_at?: string | null;
    created_at: string;
    updated_at: string;
  }) => ({
    id: b.id,
    tenant_id: b.tenant_id,
    unit_id: b.unit_id,
    unit_name: b.units?.name || 'Unidade',
    meal_type_id: b.meal_type_id,
    meal_type_name: b.meal_types?.name || 'Refeição',
    service_date: b.service_date,
    batch_type: b.batch_type as ContingencyMealBatch['batch_type'],
    total_meals_served: b.total_meals_served,
    category_id: b.category_id,
    category_name: b.student_categories?.name || 'Geral / Mista',
    unit_price: Number(b.unit_price || 0),
    subsidy_price: Number(b.subsidy_price || 0),
    total_amount: Number(b.total_amount || 0),
    total_subsidy_amount: Number(b.total_subsidy_amount || 0),
    justification: b.justification,
    evidence_document_url: b.evidence_document_url,
    operator_id: b.operator_id,
    operator_name: profilesMap.get(b.operator_id) || 'Operador',
    status: b.status as ContingencyMealBatch['status'],
    rejection_reason: b.rejection_reason,
    approved_by: b.approved_by,
    approver_name: b.approved_by ? profilesMap.get(b.approved_by) || 'Revisor' : null,
    approved_at: b.approved_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
  }));

  return {
    batches,
    units: unitsRes.data || [],
    mealTypes: mealTypesRes.data || [],
    categories: categoriesRes.data || [],
    currentUser: {
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name,
    },
    canReview,
    canCreate,
  };
}

export async function getContingencyBatchDetails(batchId: string): Promise<{
  items: ContingencyBatchItem[];
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contingency_batch_items')
    .select(`
      *,
      student_categories(name)
    `)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Falha ao buscar itens do lote: ${error.message}`);
  }

  const items: ContingencyBatchItem[] = (data || []).map((item: {
    id: string;
    batch_id: string;
    student_id: string;
    registration_number: string;
    student_name: string;
    category_id: string;
    student_categories?: { name?: string } | null;
    notes?: string | null;
    created_at: string;
  }) => ({
    id: item.id,
    batch_id: item.batch_id,
    student_id: item.student_id,
    registration_number: item.registration_number,
    student_name: item.student_name,
    category_id: item.category_id,
    category_name: item.student_categories?.name || 'Categoria',
    notes: item.notes,
    created_at: item.created_at,
  }));

  return { items };
}

export async function submitContingencyBatchServer(
  input: SubmitContingencyBatchInput
): Promise<{ success: boolean; message: string; batch_id?: string }> {
  const supabase = await createClient();

  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('submit_contingency_batch', {
    p_unit_id: input.unit_id,
    p_meal_type_id: input.meal_type_id,
    p_service_date: input.service_date,
    p_batch_type: input.batch_type,
    p_total_meals_served: input.total_meals_served,
    p_category_id: input.category_id || null,
    p_justification: input.justification.trim(),
    p_evidence_document_url: input.evidence_document_url || null,
    p_identified_students: input.identified_students || [],
  });

  if (error) {
    return { success: false, message: error.message };
  }

  const result = data as { success: boolean; message: string; batch_id?: string; error?: string };
  if (!result.success) {
    return { success: false, message: result.message || result.error || 'Erro ao submeter lote.' };
  }

  return { success: true, message: result.message, batch_id: result.batch_id };
}

export async function reviewContingencyBatchServer(
  input: ReviewContingencyBatchInput
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('review_contingency_batch', {
    p_batch_id: input.batch_id,
    p_action: input.action,
    p_reason: input.reason?.trim() || null,
  });

  if (error) {
    return { success: false, message: error.message };
  }

  const result = data as { success: boolean; message: string; error?: string };
  if (!result.success) {
    return { success: false, message: result.message || result.error || 'Erro ao revisar lote.' };
  }

  return { success: true, message: result.message };
}
