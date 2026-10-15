import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { MealRule, MealType, SetMealRuleInput, ToggleUnitMealTypeInput, UnitMealType } from '@/types/meal';

/**
 * ==============================================================================
 * Serviço Administrativo de Gestão de Refeições e Preços (Server-Side Exclusivo)
 * Operações com service_role após autorização estrita por perfil no banco.
 * ==============================================================================
 */

/**
 * Obtém o ID do usuário autenticado no servidor diretamente da sessão Supabase Auth (Cookies).
 */
export async function getAuthenticatedUserServer(): Promise<{ userId: string | null; tenantId: string | null; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { userId: null, tenantId: null, error: 'Sessão inválida ou usuário não autenticado.' };
    }

    const adminClient = getAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('tenant_id, status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status !== 'active') {
      return { userId: null, tenantId: null, error: 'Perfil de usuário inativo ou não cadastrado.' };
    }

    return { userId: user.id, tenantId: profile.tenant_id };
  } catch (e) {
    return { userId: null, tenantId: null, error: `Erro ao validar sessão server-side: ${(e as Error).message}` };
  }
}

/**
 * Valida se o usuário solicitante é gestor administrativo ativo no tenant.
 */
async function validateStaffRequester(
  requestingUserId: string,
  tenantId: string,
  allowedRoles: string[] = ['admin_general', 'operations_director']
): Promise<boolean> {
  const adminClient = getAdminClient();
  const { data: requester, error } = await adminClient
    .from('profiles')
    .select('tenant_id, role, status')
    .eq('id', requestingUserId)
    .single();

  if (error || !requester) return false;
  return (
    requester.tenant_id === tenantId &&
    allowedRoles.includes(requester.role) &&
    requester.status === 'active'
  );
}

/**
 * Lista todos os tipos de refeição cadastrados para o tenant.
 */
export async function getMealTypesServer(
  requestingUserId: string,
  tenantId: string
): Promise<{ data: MealType[] | null; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId, [
    'admin_general',
    'operations_director',
    'unit_manager',
    'finance',
    'supervisor',
  ]);
  if (!isAuthorized) {
    return { data: null, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from('meal_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    return { data: null, error: `Erro ao listar tipos de refeição: ${error.message}` };
  }

  return { data: data as MealType[] };
}

/**
 * Lista as refeições ativas e seus horários para uma unidade específica.
 */
export async function getUnitMealTypesServer(
  requestingUserId: string,
  tenantId: string,
  unitId: string
): Promise<{ data: UnitMealType[] | null; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId, [
    'admin_general',
    'operations_director',
    'unit_manager',
    'finance',
    'supervisor',
  ]);
  if (!isAuthorized) {
    return { data: null, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from('unit_meal_types')
    .select('*, meal_types (*)')
    .eq('tenant_id', tenantId)
    .eq('unit_id', unitId);

  if (error) {
    return { data: null, error: `Erro ao buscar refeições da unidade: ${error.message}` };
  }

  return { data: data as UnitMealType[] };
}

/**
 * Habilita/desabilita um tipo de refeição em uma unidade e define os horários.
 */
export async function configureUnitMealTypeServer(
  requestingUserId: string,
  tenantId: string,
  params: ToggleUnitMealTypeInput
): Promise<{ success: boolean; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId, [
    'admin_general',
    'operations_director',
    'unit_manager',
  ]);
  if (!isAuthorized) {
    return { success: false, error: 'Acesso negado. Apenas gestores podem alterar horários por unidade.' };
  }

  const adminClient = getAdminClient();
  const { unit_id, meal_type_id, enabled, start_time, end_time } = params;

  const { error } = await adminClient
    .from('unit_meal_types')
    .upsert(
      {
        tenant_id: tenantId,
        unit_id,
        meal_type_id,
        enabled,
        start_time: start_time || null,
        end_time: end_time || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'unit_id, meal_type_id' }
    );

  if (error) {
    return { success: false, error: `Erro ao salvar configuração da refeição: ${error.message}` };
  }

  return { success: true };
}

/**
 * Lista as regras financeiras de preço ativas de uma unidade.
 */
export async function getMealRulesServer(
  requestingUserId: string,
  tenantId: string,
  unitId?: string
): Promise<{ data: MealRule[] | null; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId, [
    'admin_general',
    'operations_director',
    'unit_manager',
    'finance',
    'supervisor',
  ]);
  if (!isAuthorized) {
    return { data: null, error: 'Acesso negado.' };
  }

  const adminClient = getAdminClient();
  let query = adminClient
    .from('meal_rules')
    .select('*, meal_types (*)')
    .eq('tenant_id', tenantId)
    .eq('enabled', true)
    .is('effective_to', null);

  if (unitId) {
    query = query.eq('unit_id', unitId);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: `Erro ao buscar regras de preço: ${error.message}` };
  }

  return { data: data as MealRule[] };
}

/**
 * Define/atualiza uma regra de preço obtendo a identidade do usuário autenticado no servidor via cookies Supabase Auth.
 */
export async function setMealRuleWithSessionServer(
  params: SetMealRuleInput
): Promise<{ ruleId: string | null; error?: string }> {
  const { userId, tenantId, error: authError } = await getAuthenticatedUserServer();
  if (authError || !userId || !tenantId) {
    return { ruleId: null, error: authError || 'Acesso negado. Usuário não autenticado.' };
  }

  return setMealRuleServer(userId, tenantId, params);
}

/**
 * Define/atualiza uma regra de preço invocando a RPC transacional server-side `set_meal_rule`.
 * Esta RPC realiza lock pessimista FOR UPDATE, valida a categoria integral e encerra a vigência anterior.
 */
export async function setMealRuleServer(
  requestingUserId: string,
  tenantId: string,
  params: SetMealRuleInput
): Promise<{ ruleId: string | null; error?: string }> {
  const isAuthorized = await validateStaffRequester(requestingUserId, tenantId, [
    'admin_general',
    'operations_director',
  ]);
  if (!isAuthorized) {
    return { ruleId: null, error: 'Acesso negado. Apenas administradores do tenant podem alterar tabelas de preço.' };
  }

  const { unit_id, meal_type_id, category_id, full_price, student_price, effective_from } = params;

  if (student_price < 0 || full_price < 0) {
    return { ruleId: null, error: 'Os preços não podem ser valores negativos.' };
  }

  if (student_price > full_price) {
    return { ruleId: null, error: 'O preço do aluno não pode exceder o valor cheio da refeição.' };
  }

  const adminClient = getAdminClient();

  const { data: ruleId, error } = await adminClient.rpc('set_meal_rule', {
    p_requesting_user_id: requestingUserId,
    p_unit_id: unit_id,
    p_meal_type_id: meal_type_id,
    p_category_id: category_id,
    p_full_price: full_price,
    p_student_price: student_price,
    p_effective_from: effective_from || new Date().toISOString(),
  });

  if (error || !ruleId) {
    return { ruleId: null, error: `Erro ao definir regra de preço: ${error?.message || 'Falha na RPC'}` };
  }

  return { ruleId: ruleId as string };
}

/**
 * Busca a regra de preço vigente exata para (unidade, tipo de refeição, categoria do aluno) em determinada data.
 */
export async function getActiveMealRuleServer(
  tenantId: string,
  unitId: string,
  mealTypeId: string,
  categoryId: string,
  targetDate: Date = new Date()
): Promise<{ rule: MealRule | null; error?: string }> {
  const adminClient = getAdminClient();
  const dateIso = targetDate.toISOString();

  const { data, error } = await adminClient
    .from('meal_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('unit_id', unitId)
    .eq('meal_type_id', mealTypeId)
    .eq('category_id', categoryId)
    .eq('enabled', true)
    .lte('effective_from', dateIso)
    .or(`effective_to.is.null,effective_to.gt.${dateIso}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { rule: null, error: `Erro ao resolver preço vigente: ${error.message}` };
  }

  return { rule: data as MealRule | null };
}
