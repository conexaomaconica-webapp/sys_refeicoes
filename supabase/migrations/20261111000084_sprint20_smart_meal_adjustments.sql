-- ==============================================================================
-- MIGRATION 84: SPRINT 20.13 — AJUSTES RETROATIVOS E AJUSTE INTELIGENTE MENSAL
-- Data: 11/11/2026
-- Objetivos:
--   1. Trava cross-batch em public.contingency_batch_items impedindo o mesmo
--      estudante em múltiplos lotes ativos/aprovados para mesma data e refeição.
--   2. Calendário operacional por unidade (public.unit_operating_calendar).
--   3. Campanhas de ajuste mensal e saldo mensal pendente sem base por data
--      (public.meal_adjustment_campaigns) com imutabilidade e dupla aprovação.
--   4. Vínculo aditivo em public.contingency_meal_batches + RPCs seguras.
--   5. Segregação nos relatórios consolidados entre regularizações individuais,
--      regularizações agregadas e pendências mensais ainda não distribuídas.
-- ==============================================================================

-- 1. TRAVA DE DUPLICIDADE INDIVIDUAL CROSS-BATCH
ALTER TABLE public.contingency_batch_items
  ADD COLUMN IF NOT EXISTS service_date DATE,
  ADD COLUMN IF NOT EXISTS meal_type_id UUID REFERENCES public.meal_types(id) ON DELETE RESTRICT;

UPDATE public.contingency_batch_items cbi
   SET service_date = cb.service_date,
       meal_type_id = cb.meal_type_id
  FROM public.contingency_meal_batches cb
 WHERE cb.id = cbi.batch_id
   AND (cbi.service_date IS NULL OR cbi.meal_type_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_contingency_items_student_date_meal
  ON public.contingency_batch_items (tenant_id, student_id, service_date, meal_type_id);

CREATE OR REPLACE FUNCTION public.get_student_category_on_date(
  p_tenant_id UUID,
  p_student_id UUID,
  p_service_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hist_cat UUID;
  v_current_cat UUID;
BEGIN
  SELECT sch.new_category_id
    INTO v_hist_cat
    FROM public.student_category_history sch
   WHERE sch.tenant_id = p_tenant_id
     AND sch.student_id = p_student_id
     AND sch.effective_from <= p_service_date
   ORDER BY sch.effective_from DESC, sch.created_at DESC
   LIMIT 1;

  IF v_hist_cat IS NOT NULL THEN
    RETURN v_hist_cat;
  END IF;

  SELECT sch.previous_category_id
    INTO v_hist_cat
    FROM public.student_category_history sch
   WHERE sch.tenant_id = p_tenant_id
     AND sch.student_id = p_student_id
     AND sch.effective_from > p_service_date
     AND sch.previous_category_id IS NOT NULL
   ORDER BY sch.effective_from ASC, sch.created_at ASC
   LIMIT 1;

  IF v_hist_cat IS NOT NULL THEN
    RETURN v_hist_cat;
  END IF;

  SELECT s.category_id
    INTO v_current_cat
    FROM public.students s
   WHERE s.tenant_id = p_tenant_id
     AND s.id = p_student_id
   LIMIT 1;

  RETURN v_current_cat;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_category_on_date(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_category_on_date(UUID, UUID, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_contingency_item_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch RECORD;
  v_student RECORD;
  v_effective_cat UUID;
BEGIN
  SELECT id, tenant_id, unit_id, service_date, meal_type_id, category_id, status
    INTO v_batch
    FROM public.contingency_meal_batches
   WHERE id = NEW.batch_id
     FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND: Lote de regularização não encontrado para o item.';
  END IF;

  IF v_batch.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Item incompatível com o tenant do lote.';
  END IF;

  NEW.service_date := v_batch.service_date;
  NEW.meal_type_id := v_batch.meal_type_id;

  -- Serialização concorrente por aluno/data/turno dentro do tenant
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      v_batch.tenant_id::text || '|cbi|' || NEW.student_id::text || '|' || v_batch.service_date::text || '|' || v_batch.meal_type_id::text
    )
  );

  SELECT id, registration_number, category_id, status
    INTO v_student
    FROM public.students
   WHERE id = NEW.student_id
     AND tenant_id = v_batch.tenant_id
   LIMIT 1;

  IF NOT FOUND OR v_student.status <> 'active' THEN
    RAISE EXCEPTION 'INACTIVE_OR_MISSING_STUDENT: Estudante inativo ou inexistente neste tenant.';
  END IF;

  v_effective_cat := COALESCE(
    public.get_student_category_on_date(v_batch.tenant_id, NEW.student_id, v_batch.service_date),
    v_student.category_id
  );
  NEW.category_id := v_effective_cat;

  IF v_batch.category_id IS NOT NULL AND v_effective_cat IS DISTINCT FROM v_batch.category_id THEN
    RAISE EXCEPTION 'CATEGORY_MISMATCH: Categoria do estudante % na data % diverge da categoria selecionada no lote.',
      v_student.registration_number, v_batch.service_date;
  END IF;

  -- Impedir inclusão se já houver consumo regular aprovado na mesma data e refeição (independentemente da categoria)
  IF EXISTS (
    SELECT 1
      FROM public.meal_consumptions mc
     WHERE mc.tenant_id = v_batch.tenant_id
       AND mc.student_id = NEW.student_id
       AND mc.consumption_date = v_batch.service_date
       AND mc.meal_type_id = v_batch.meal_type_id
       AND mc.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_REGULAR_CONSUMPTION: Estudante % já possui consumo regular aprovado em %.',
      v_student.registration_number, v_batch.service_date;
  END IF;

  -- Impedir inclusão se o mesmo estudante constar em outro lote ativo/aprovado na mesma data e refeição (independentemente da categoria)
  IF v_batch.status IN ('draft', 'pending_approval', 'approved') THEN
    IF EXISTS (
      SELECT 1
        FROM public.contingency_batch_items cbi
        JOIN public.contingency_meal_batches cb ON cb.id = cbi.batch_id
       WHERE cbi.tenant_id = v_batch.tenant_id
         AND cbi.student_id = NEW.student_id
         AND cb.service_date = v_batch.service_date
         AND cb.meal_type_id = v_batch.meal_type_id
         AND cb.status IN ('draft', 'pending_approval', 'approved')
         AND cbi.batch_id <> NEW.batch_id
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_CROSS_BATCH_ITEM: Estudante % já consta em outro lote ativo ou aprovado para %.',
        v_student.registration_number, v_batch.service_date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contingency_item_uniqueness ON public.contingency_batch_items;
CREATE TRIGGER trg_enforce_contingency_item_uniqueness
  BEFORE INSERT OR UPDATE ON public.contingency_batch_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_contingency_item_uniqueness();

REVOKE ALL ON FUNCTION public.enforce_contingency_item_uniqueness() FROM PUBLIC, anon, authenticated;

-- Impedir alteração de data/refeição em lote que já possua itens nominais vinculados
CREATE OR REPLACE FUNCTION public.prevent_batch_scope_change_with_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.service_date IS DISTINCT FROM OLD.service_date OR NEW.meal_type_id IS DISTINCT FROM OLD.meal_type_id)
     AND EXISTS (SELECT 1 FROM public.contingency_batch_items cbi WHERE cbi.batch_id = OLD.id) THEN
    RAISE EXCEPTION 'BATCH_ITEMS_LOCKED: Não é permitido alterar data ou refeição de lote com itens individualizados.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_batch_scope_change_with_items ON public.contingency_meal_batches;
CREATE TRIGGER trg_prevent_batch_scope_change_with_items
  BEFORE UPDATE ON public.contingency_meal_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_batch_scope_change_with_items();

REVOKE ALL ON FUNCTION public.prevent_batch_scope_change_with_items() FROM PUBLIC, anon, authenticated;

-- 2. CALENDÁRIO OPERACIONAL POR UNIDADE
CREATE TABLE IF NOT EXISTS public.unit_operating_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  calendar_date DATE NOT NULL,
  meal_type_id UUID REFERENCES public.meal_types(id) ON DELETE RESTRICT,
  is_operating BOOLEAN NOT NULL,
  reason TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_operating_calendar_scope
  ON public.unit_operating_calendar (
    tenant_id,
    unit_id,
    calendar_date,
    COALESCE(meal_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.unit_operating_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_operating_calendar FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.unit_operating_calendar FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.unit_operating_calendar TO authenticated;
GRANT ALL ON public.unit_operating_calendar TO service_role;

DROP POLICY IF EXISTS sel_unit_calendar_staff ON public.unit_operating_calendar;
CREATE POLICY sel_unit_calendar_staff ON public.unit_operating_calendar
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
  );

DROP POLICY IF EXISTS ins_unit_calendar_staff ON public.unit_operating_calendar;
CREATE POLICY ins_unit_calendar_staff ON public.unit_operating_calendar
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND created_by = auth.uid()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
  );

DROP POLICY IF EXISTS upd_unit_calendar_staff ON public.unit_operating_calendar;
CREATE POLICY upd_unit_calendar_staff ON public.unit_operating_calendar
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
  )
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
  );

CREATE OR REPLACE FUNCTION public.upsert_unit_operating_calendar(
  p_unit_id UUID,
  p_calendar_date DATE,
  p_is_operating BOOLEAN,
  p_meal_type_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_existing_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
  END IF;

  SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou inexistente.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Papel sem permissão para configurar calendário operacional.';
  END IF;

  IF NOT public.has_unit_access(p_unit_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem acesso à unidade informada.';
  END IF;

  IF p_calendar_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Data obrigatória para registro no calendário.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.units WHERE id = p_unit_id AND tenant_id = v_profile.tenant_id AND status = 'active') THEN
    RAISE EXCEPTION 'UNIT_TENANT_MISMATCH: Unidade não localizada ou pertencente a outro tenant.';
  END IF;

  IF p_meal_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.meal_types WHERE id = p_meal_type_id AND tenant_id = v_profile.tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'MEAL_TYPE_NOT_FOUND: Tipo de refeição inválido.';
  END IF;

  SELECT id
    INTO v_existing_id
    FROM public.unit_operating_calendar
   WHERE tenant_id = v_profile.tenant_id
     AND unit_id = p_unit_id
     AND calendar_date = p_calendar_date
     AND ((p_meal_type_id IS NULL AND meal_type_id IS NULL) OR meal_type_id = p_meal_type_id)
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.unit_operating_calendar
       SET is_operating = p_is_operating,
           reason = NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''),
           updated_at = pg_catalog.now()
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.unit_operating_calendar (
      tenant_id, unit_id, calendar_date, meal_type_id, is_operating, reason, created_by
    ) VALUES (
      v_profile.tenant_id,
      p_unit_id,
      p_calendar_date,
      p_meal_type_id,
      p_is_operating,
      NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''),
      v_uid
    )
    RETURNING id INTO v_existing_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_existing_id,
    'unit_id', p_unit_id,
    'calendar_date', p_calendar_date,
    'meal_type_id', p_meal_type_id,
    'is_operating', p_is_operating
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_unit_operating_calendar(UUID, DATE, BOOLEAN, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_unit_operating_calendar(UUID, DATE, BOOLEAN, UUID, TEXT) TO authenticated, service_role;

-- 3. CAMPANHAS DE AJUSTE INTELIGENTE MENSAL E PENDÊNCIAS NÃO ALOCADAS
CREATE TABLE IF NOT EXISTS public.meal_adjustment_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  meal_type_id UUID REFERENCES public.meal_types(id) ON DELETE RESTRICT,
  selected_meal_type_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  distribution_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  competence_month DATE NOT NULL,
  modality TEXT NOT NULL,
  proven_total_meals INT NOT NULL,
  allocated_meals_count INT NOT NULL DEFAULT 0,
  unallocated_pending_meals INT NOT NULL DEFAULT 0,
  allocation_status TEXT NOT NULL DEFAULT 'submitted_for_approval',
  analysis_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  justification TEXT NOT NULL,
  evidence_document_url TEXT,
  rejection_reason TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_mac_competence_first_day CHECK (pg_catalog.date_trunc('month', competence_month)::date = competence_month),
  CONSTRAINT chk_mac_modality CHECK (modality IN ('smart_quantity_distribution', 'smart_individual_reconciliation')),
  CONSTRAINT chk_mac_status CHECK (allocation_status IN ('draft', 'partially_allocated_pending', 'submitted_for_approval', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT chk_mac_counts CHECK (
    proven_total_meals > 0
    AND allocated_meals_count >= 0
    AND unallocated_pending_meals >= 0
    AND allocated_meals_count + unallocated_pending_meals = proven_total_meals
  )
);

ALTER TABLE public.meal_adjustment_campaigns
  ALTER COLUMN meal_type_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS selected_meal_type_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS distribution_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_meal_adj_campaigns_tenant_comp
  ON public.meal_adjustment_campaigns (tenant_id, unit_id, competence_month DESC);

ALTER TABLE public.meal_adjustment_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_adjustment_campaigns FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.meal_adjustment_campaigns FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.meal_adjustment_campaigns TO authenticated;
GRANT ALL ON public.meal_adjustment_campaigns TO service_role;

DROP POLICY IF EXISTS sel_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns;
CREATE POLICY sel_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')
  );

DROP POLICY IF EXISTS ins_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns;
CREATE POLICY ins_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND created_by = auth.uid()
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager')
  );

DROP POLICY IF EXISTS upd_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns;
CREATE POLICY upd_meal_adj_campaigns_staff ON public.meal_adjustment_campaigns
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
      (created_by = auth.uid() AND allocation_status IN ('draft', 'partially_allocated_pending', 'submitted_for_approval'))
      OR public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
    )
  )
  WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.has_unit_access(unit_id)
    AND (
      public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
      OR (
        created_by = auth.uid()
        AND allocation_status IN ('draft', 'partially_allocated_pending', 'submitted_for_approval', 'cancelled')
        AND approved_by IS NULL
        AND approved_at IS NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_campaign_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
  v_uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_CAMPAIGN: Campanhas de ajuste não podem ser excluídas.';
  END IF;

  IF OLD.allocation_status IN ('approved', 'rejected') THEN
    IF NEW.proven_total_meals IS DISTINCT FROM OLD.proven_total_meals
       OR NEW.allocated_meals_count IS DISTINCT FROM OLD.allocated_meals_count
       OR NEW.unallocated_pending_meals IS DISTINCT FROM OLD.unallocated_pending_meals
       OR NEW.competence_month IS DISTINCT FROM OLD.competence_month
       OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.allocation_status IS DISTINCT FROM OLD.allocation_status
       OR NEW.analysis_snapshot IS DISTINCT FROM OLD.analysis_snapshot
    THEN
      RAISE EXCEPTION 'CAMPAIGN_IMMUTABLE: Campanha já deliberada (%) não pode ser alterada.', OLD.allocation_status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.allocation_status IN ('approved', 'rejected') AND OLD.allocation_status <> NEW.allocation_status AND v_uid IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid AND status = 'active';
    IF v_role IS NULL OR v_role NOT IN ('admin_general', 'operations_director', 'finance') THEN
      RAISE EXCEPTION 'FORBIDDEN_APPROVAL: Apenas diretoria, financeiro ou master podem deliberar campanhas.' USING ERRCODE = '42501';
    END IF;
    IF OLD.created_by = v_uid AND v_role <> 'admin_general' THEN
      RAISE EXCEPTION 'SELF_APPROVAL_PROHIBITED: Criador da campanha não pode aprová-la.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_campaign_tampering ON public.meal_adjustment_campaigns;
CREATE TRIGGER trg_prevent_campaign_tampering
  BEFORE UPDATE OR DELETE ON public.meal_adjustment_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_campaign_tampering();

REVOKE ALL ON FUNCTION public.prevent_campaign_tampering() FROM PUBLIC, anon, authenticated;

-- 4. EXTENSÃO ADITIVA EM public.contingency_meal_batches
ALTER TABLE public.contingency_meal_batches
  ADD COLUMN IF NOT EXISTS adjustment_modality TEXT NOT NULL DEFAULT 'single_date_manual',
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.meal_adjustment_campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_individual_confirmed BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contingency_adjustment_modality'
  ) THEN
    ALTER TABLE public.contingency_meal_batches
      ADD CONSTRAINT chk_contingency_adjustment_modality
      CHECK (adjustment_modality IN ('single_date_manual', 'smart_quantity_distribution', 'smart_individual_reconciliation'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contingency_batches_campaign
  ON public.contingency_meal_batches (tenant_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

-- 5. RPC PRÉVIA POR DATA ESPECÍFICA
CREATE OR REPLACE FUNCTION public.preview_contingency_date_context(
  p_unit_id UUID,
  p_meal_type_id UUID,
  p_service_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_regular_count INT := 0;
  v_batch_count INT := 0;
  v_calendar_entry RECORD;
  v_is_operating BOOLEAN := true;
  v_calendar_reason TEXT := NULL;
  v_is_closed_period BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.';
  END IF;

  SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou inexistente.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem acesso ao módulo de ajustes.';
  END IF;

  IF NOT public.has_unit_access(p_unit_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem acesso à unidade.';
  END IF;

  SELECT COUNT(*)::INT
    INTO v_regular_count
    FROM public.meal_consumptions mc
   WHERE mc.tenant_id = v_profile.tenant_id
     AND mc.unit_id = p_unit_id
     AND mc.meal_type_id = p_meal_type_id
     AND mc.consumption_date = p_service_date
     AND mc.status = 'approved';

  SELECT COALESCE(SUM(cb.total_meals_served), 0)::INT
    INTO v_batch_count
    FROM public.contingency_meal_batches cb
   WHERE cb.tenant_id = v_profile.tenant_id
     AND cb.unit_id = p_unit_id
     AND cb.meal_type_id = p_meal_type_id
     AND cb.service_date = p_service_date
     AND cb.status IN ('draft', 'pending_approval', 'approved');

  SELECT is_operating, reason
    INTO v_calendar_entry
    FROM public.unit_operating_calendar uoc
   WHERE uoc.tenant_id = v_profile.tenant_id
     AND uoc.unit_id = p_unit_id
     AND uoc.calendar_date = p_service_date
     AND (uoc.meal_type_id = p_meal_type_id OR uoc.meal_type_id IS NULL)
   ORDER BY uoc.meal_type_id NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    v_is_operating := v_calendar_entry.is_operating;
    v_calendar_reason := v_calendar_entry.reason;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.financial_daily_closings fdc
     WHERE fdc.tenant_id = v_profile.tenant_id
       AND fdc.closing_date = p_service_date
       AND (fdc.unit_id IS NULL OR fdc.unit_id = p_unit_id)
  ) INTO v_is_closed_period;

  RETURN pg_catalog.jsonb_build_object(
    'service_date', p_service_date,
    'regular_meals_count', v_regular_count,
    'existing_adjustment_meals_count', v_batch_count,
    'is_operating', v_is_operating,
    'calendar_reason', v_calendar_reason,
    'is_closed_period', v_is_closed_period
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_contingency_date_context(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_contingency_date_context(UUID, UUID, DATE) TO authenticated, service_role;

-- 6. RPC SUBMISSÃO DE CAMPANHA DE AJUSTE INTELIGENTE MENSAL (MÚLTIPLOS TURNOS E CATEGORIAS)
DROP FUNCTION IF EXISTS public.submit_smart_adjustment_campaign(UUID, UUID, DATE, TEXT, INT, JSONB, JSONB, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.submit_smart_adjustment_campaign(
  p_unit_id UUID,
  p_meal_type_id UUID,
  p_competence_month DATE,
  p_modality TEXT,
  p_proven_total_meals INT,
  p_allocations JSONB DEFAULT '[]'::jsonb,
  p_analysis_snapshot JSONB DEFAULT '{}'::jsonb,
  p_justification TEXT DEFAULT '',
  p_evidence_document_url TEXT DEFAULT NULL,
  p_allow_closed_period BOOLEAN DEFAULT false,
  p_meal_type_ids UUID[] DEFAULT NULL,
  p_distribution_lines JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_unit RECORD;
  v_today_br DATE;
  v_month_start DATE;
  v_month_end DATE;
  v_selected_meal_type_ids UUID[];
  v_primary_meal_type_id UUID;
  v_mt_id UUID;
  v_line JSONB;
  v_line_mt_id UUID;
  v_line_cat_id UUID;
  v_line_qty INT;
  v_lines_sum INT := 0;
  v_item JSONB;
  v_alloc_date DATE;
  v_alloc_mt_id UUID;
  v_alloc_qty INT;
  v_category_id UUID;
  v_rule RECORD;
  v_total_allocated INT := 0;
  v_unallocated INT := 0;
  v_campaign_id UUID;
  v_batch_id UUID;
  v_created_batches UUID[] := ARRAY[]::UUID[];
  v_batch_type TEXT;
  v_cal_non_operating BOOLEAN;
  v_is_closed BOOLEAN;
  v_student_item JSONB;
  v_student RECORD;
  v_effective_cat UUID;
  v_student_count INT;
  v_campaign_status TEXT;
  v_has_lines BOOLEAN := false;
  v_line_cap INT;
  v_pair_allocated INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
  END IF;

  SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não localizado.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Papel sem permissão para submeter ajustes.';
  END IF;

  IF NOT public.has_unit_access(p_unit_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem acesso à unidade informada.';
  END IF;

  SELECT id, tenant_id, institution_id, status
    INTO v_unit
    FROM public.units
   WHERE id = p_unit_id
     AND tenant_id = v_profile.tenant_id
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNIT_TENANT_MISMATCH: Unidade inativa ou pertencente a outro tenant.';
  END IF;

  v_selected_meal_type_ids := COALESCE(
    NULLIF(p_meal_type_ids, ARRAY[]::uuid[]),
    CASE WHEN p_meal_type_id IS NOT NULL THEN ARRAY[p_meal_type_id] ELSE ARRAY[]::uuid[] END
  );

  IF pg_catalog.coalesce(pg_catalog.array_length(v_selected_meal_type_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'MEAL_TYPE_REQUIRED: Selecione ao menos um turno/refeição habilitado na unidade.';
  END IF;

  FOREACH v_mt_id IN ARRAY v_selected_meal_type_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.meal_types mt
       WHERE mt.id = v_mt_id AND mt.tenant_id = v_profile.tenant_id AND mt.status = 'active'
    ) THEN
      RAISE EXCEPTION 'MEAL_TYPE_NOT_FOUND: Turno % inválido ou inativo.', v_mt_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.unit_meal_types umt
       WHERE umt.tenant_id = v_profile.tenant_id
         AND umt.unit_id = p_unit_id
         AND umt.meal_type_id = v_mt_id
         AND umt.enabled = true
    ) THEN
      RAISE EXCEPTION 'UNIT_MEAL_TYPE_DISABLED: Turno % não está habilitado para esta unidade.', v_mt_id;
    END IF;
  END LOOP;

  v_primary_meal_type_id := CASE
    WHEN pg_catalog.array_length(v_selected_meal_type_ids, 1) = 1 THEN v_selected_meal_type_ids[1]
    ELSE NULL
  END;

  IF p_modality NOT IN ('smart_quantity_distribution', 'smart_individual_reconciliation') THEN
    RAISE EXCEPTION 'INVALID_MODALITY: Modalidade de ajuste inteligente inválida.';
  END IF;

  IF p_proven_total_meals IS NULL OR p_proven_total_meals <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: Quantidade comprovada deve ser maior que zero.';
  END IF;

  IF p_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_justification)) < 10 THEN
    RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: Justificativa detalhada obrigatória (mínimo 10 caracteres).';
  END IF;

  v_today_br := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month_start := pg_catalog.date_trunc('month', p_competence_month)::date;
  v_month_end := (v_month_start + INTERVAL '1 month - 1 day')::date;

  IF v_month_start > pg_catalog.date_trunc('month', v_today_br)::date THEN
    RAISE EXCEPTION 'INVALID_COMPETENCE: Competência futura não permitida.';
  END IF;

  -- Validar linhas de distribuição (turno + categoria + quantidade), quando fornecidas
  IF pg_catalog.jsonb_typeof(COALESCE(p_distribution_lines, '[]'::jsonb)) = 'array'
     AND pg_catalog.jsonb_array_length(COALESCE(p_distribution_lines, '[]'::jsonb)) > 0 THEN
    v_has_lines := true;
    FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_distribution_lines)
    LOOP
      v_line_mt_id := NULLIF(v_line->>'meal_type_id', '')::uuid;
      v_line_cat_id := NULLIF(v_line->>'category_id', '')::uuid;
      v_line_qty := COALESCE((v_line->>'quantity')::int, 0);

      IF v_line_mt_id IS NULL OR NOT (v_line_mt_id = ANY(v_selected_meal_type_ids)) THEN
        RAISE EXCEPTION 'LINE_MEAL_TYPE_INVALID: Toda linha deve referenciar um turno selecionado.';
      END IF;
      IF v_line_cat_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.student_categories sc
         WHERE sc.id = v_line_cat_id AND sc.tenant_id = v_profile.tenant_id AND sc.status = 'active'
      ) THEN
        RAISE EXCEPTION 'CATEGORY_REQUIRED: Toda linha de distribuição exige categoria administrativa ativa.';
      END IF;
      IF v_line_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_LINE_QUANTITY: Quantidade da linha deve ser maior que zero.';
      END IF;

      v_lines_sum := v_lines_sum + v_line_qty;
    END LOOP;

    IF v_lines_sum > p_proven_total_meals THEN
      RAISE EXCEPTION 'LINES_EXCEED_PROVEN_TOTAL: Soma das linhas (%) excede o total comprovado (%).',
        v_lines_sum, p_proven_total_meals;
    END IF;
  END IF;

  -- Somar alocações e validar datas, categorias, regras vigentes e saldos antes de persistir
  FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    v_alloc_date := (v_item->>'service_date')::date;
    v_alloc_mt_id := COALESCE(NULLIF(v_item->>'meal_type_id', '')::uuid, v_selected_meal_type_ids[1]);
    v_category_id := NULLIF(v_item->>'category_id', '')::uuid;
    v_alloc_qty := COALESCE((v_item->>'quantity')::int, 0);

    IF v_alloc_qty <= 0 THEN
      CONTINUE;
    END IF;

    IF NOT (v_alloc_mt_id = ANY(v_selected_meal_type_ids)) THEN
      RAISE EXCEPTION 'ALLOCATION_MEAL_TYPE_MISMATCH: Turno da alocação não pertence aos turnos selecionados.';
    END IF;

    IF v_category_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.student_categories sc
       WHERE sc.id = v_category_id AND sc.tenant_id = v_profile.tenant_id AND sc.status = 'active'
    ) THEN
      RAISE EXCEPTION 'CATEGORY_REQUIRED: Categoria administrativa obrigatória em todas as alocações.';
    END IF;

    IF v_alloc_date < v_month_start OR v_alloc_date > v_month_end OR v_alloc_date > v_today_br THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_DATE: Data % fora da competência permitida ou futura.', v_alloc_date;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.meal_rules mr
       WHERE mr.tenant_id = v_profile.tenant_id
         AND mr.unit_id = p_unit_id
         AND mr.meal_type_id = v_alloc_mt_id
         AND mr.category_id = v_category_id
         AND mr.enabled = true
         AND mr.effective_from <= (v_alloc_date::timestamptz + INTERVAL '23 hours 59 minutes 59 seconds')
         AND (mr.effective_to IS NULL OR mr.effective_to >= v_alloc_date::timestamptz)
    ) THEN
      RAISE EXCEPTION 'RULE_NOT_EFFECTIVE: Não existe regra tarifária ativa para unidade/turno/categoria na data %.', v_alloc_date;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.unit_operating_calendar uoc
       WHERE uoc.tenant_id = v_profile.tenant_id
         AND uoc.unit_id = p_unit_id
         AND uoc.calendar_date = v_alloc_date
         AND (uoc.meal_type_id = v_alloc_mt_id OR uoc.meal_type_id IS NULL)
         AND uoc.is_operating = false
    ) INTO v_cal_non_operating;

    IF v_cal_non_operating THEN
      RAISE EXCEPTION 'NON_OPERATING_DAY: A unidade não funcionou em % segundo o calendário operacional.', v_alloc_date;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.financial_daily_closings fdc
       WHERE fdc.tenant_id = v_profile.tenant_id
         AND fdc.closing_date = v_alloc_date
         AND (fdc.unit_id IS NULL OR fdc.unit_id = p_unit_id)
    ) INTO v_is_closed;

    IF v_is_closed AND (NOT p_allow_closed_period OR v_profile.role NOT IN ('admin_general', 'operations_director')) THEN
      RAISE EXCEPTION 'CLOSED_DAILY_PERIOD: A data % já possui fechamento financeiro diário consolidado.', v_alloc_date;
    END IF;

    v_total_allocated := v_total_allocated + v_alloc_qty;
  END LOOP;

  IF v_total_allocated > p_proven_total_meals THEN
    RAISE EXCEPTION 'ALLOCATION_EXCEEDS_PROVEN_TOTAL: Soma distribuída (%) excede total comprovado (%).',
      v_total_allocated, p_proven_total_meals;
  END IF;

  IF v_has_lines THEN
    FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_distribution_lines)
    LOOP
      v_line_mt_id := (v_line->>'meal_type_id')::uuid;
      v_line_cat_id := (v_line->>'category_id')::uuid;
      v_line_cap := COALESCE((v_line->>'quantity')::int, 0);

      SELECT COALESCE(SUM(COALESCE((a->>'quantity')::int, 0)), 0)::int
        INTO v_pair_allocated
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) a
       WHERE COALESCE(NULLIF(a->>'meal_type_id', '')::uuid, v_selected_meal_type_ids[1]) = v_line_mt_id
         AND NULLIF(a->>'category_id', '')::uuid = v_line_cat_id;

      IF v_pair_allocated > v_line_cap THEN
        RAISE EXCEPTION 'ALLOCATION_EXCEEDS_LINE_LIMIT: Soma distribuída (%) excede o limite definido para a linha turno/categoria (%).',
          v_pair_allocated, v_line_cap;
      END IF;
    END LOOP;
  END IF;

  v_unallocated := p_proven_total_meals - v_total_allocated;
  v_campaign_status := CASE
    WHEN v_total_allocated = 0 OR v_unallocated > 0 THEN 'partially_allocated_pending'
    ELSE 'submitted_for_approval'
  END;

  INSERT INTO public.meal_adjustment_campaigns (
    tenant_id, institution_id, unit_id, meal_type_id, selected_meal_type_ids, distribution_lines,
    competence_month, modality, proven_total_meals, allocated_meals_count, unallocated_pending_meals,
    allocation_status, analysis_snapshot, justification, evidence_document_url, created_by
  ) VALUES (
    v_profile.tenant_id, v_unit.institution_id, p_unit_id, v_primary_meal_type_id, v_selected_meal_type_ids,
    COALESCE(p_distribution_lines, '[]'::jsonb), v_month_start, p_modality, p_proven_total_meals,
    v_total_allocated, v_unallocated, v_campaign_status, COALESCE(p_analysis_snapshot, '{}'::jsonb),
    pg_catalog.btrim(p_justification), p_evidence_document_url, v_uid
  )
  RETURNING id INTO v_campaign_id;

  v_batch_type := CASE
    WHEN p_modality = 'smart_individual_reconciliation' THEN 'type_a_identified'
    ELSE 'type_b_unidentified_count'
  END;

  -- Criar lotes diários apenas para datas efetivamente confirmadas com quantidade > 0
  FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    v_alloc_date := (v_item->>'service_date')::date;
    v_alloc_mt_id := COALESCE(NULLIF(v_item->>'meal_type_id', '')::uuid, v_selected_meal_type_ids[1]);
    v_category_id := NULLIF(v_item->>'category_id', '')::uuid;
    v_alloc_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_alloc_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT mr.student_price, mr.subsidy_amount
      INTO v_rule
      FROM public.meal_rules mr
     WHERE mr.tenant_id = v_profile.tenant_id
       AND mr.unit_id = p_unit_id
       AND mr.meal_type_id = v_alloc_mt_id
       AND mr.category_id = v_category_id
       AND mr.enabled = true
       AND mr.effective_from <= (v_alloc_date::timestamptz + INTERVAL '23 hours 59 minutes 59 seconds')
       AND (mr.effective_to IS NULL OR mr.effective_to >= v_alloc_date::timestamptz)
     ORDER BY mr.effective_from DESC
     LIMIT 1;

    INSERT INTO public.contingency_meal_batches (
      tenant_id, unit_id, meal_type_id, service_date, batch_type,
      total_meals_served, category_id, unit_price, subsidy_price,
      total_amount, total_subsidy_amount, justification, evidence_document_url,
      operator_id, status, adjustment_modality, campaign_id, is_individual_confirmed
    ) VALUES (
      v_profile.tenant_id, p_unit_id, v_alloc_mt_id, v_alloc_date, v_batch_type,
      v_alloc_qty, v_category_id, COALESCE(v_rule.student_price, 0.00), COALESCE(v_rule.subsidy_amount, 0.00),
      pg_catalog.round(COALESCE(v_rule.student_price, 0.00) * v_alloc_qty, 2),
      pg_catalog.round(COALESCE(v_rule.subsidy_amount, 0.00) * v_alloc_qty, 2),
      pg_catalog.btrim(COALESCE(NULLIF(v_item->>'notes', ''), p_justification)),
      p_evidence_document_url,
      v_uid,
      'pending_approval',
      p_modality,
      v_campaign_id,
      (p_modality = 'smart_individual_reconciliation')
    )
    RETURNING id INTO v_batch_id;

    IF p_modality = 'smart_individual_reconciliation' THEN
      v_student_count := 0;
      FOR v_student_item IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(v_item->'identified_students', '[]'::jsonb))
      LOOP
        IF NULLIF(pg_catalog.btrim(COALESCE(v_student_item->>'notes', '')), '') IS NULL THEN
          RAISE EXCEPTION 'DOCUMENT_REFERENCE_REQUIRED: Reconciliação individual exige referência documental por estudante.';
        END IF;

        SELECT id, full_name, registration_number, category_id
          INTO v_student
          FROM public.students
         WHERE tenant_id = v_profile.tenant_id
           AND id = (v_student_item->>'student_id')::uuid
           AND status = 'active'
         LIMIT 1;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'INACTIVE_OR_MISSING_STUDENT: Estudante % não localizado ou inativo.', v_student_item->>'student_id';
        END IF;

        v_effective_cat := COALESCE(
          public.get_student_category_on_date(v_profile.tenant_id, v_student.id, v_alloc_date),
          v_student.category_id
        );

        IF v_effective_cat IS DISTINCT FROM v_category_id THEN
          RAISE EXCEPTION 'CATEGORY_MISMATCH: Estudante % possuía outra categoria vigente em % e não pode ser lançado na categoria selecionada.',
            v_student.registration_number, v_alloc_date;
        END IF;

        INSERT INTO public.contingency_batch_items (
          tenant_id, batch_id, student_id, registration_number,
          student_name, category_id, notes, service_date, meal_type_id
        ) VALUES (
          v_profile.tenant_id, v_batch_id, v_student.id, v_student.registration_number,
          v_student.full_name, v_effective_cat, pg_catalog.btrim(v_student_item->>'notes'),
          v_alloc_date, v_alloc_mt_id
        );

        v_student_count := v_student_count + 1;
      END LOOP;

      IF v_student_count <> v_alloc_qty THEN
        RAISE EXCEPTION 'STUDENT_COUNT_MISMATCH: Quantidade (%) difere do número de estudantes confirmados (%) em %.',
          v_alloc_qty, v_student_count, v_alloc_date;
      END IF;
    END IF;

    v_created_batches := pg_catalog.array_append(v_created_batches, v_batch_id);
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'campaign_id', v_campaign_id,
    'allocation_status', v_campaign_status,
    'allocated_meals_count', v_total_allocated,
    'unallocated_pending_meals', v_unallocated,
    'batch_ids', to_jsonb(v_created_batches)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_smart_adjustment_campaign(UUID, UUID, DATE, TEXT, INT, JSONB, JSONB, TEXT, TEXT, BOOLEAN, UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_smart_adjustment_campaign(UUID, UUID, DATE, TEXT, INT, JSONB, JSONB, TEXT, TEXT, BOOLEAN, UUID[], JSONB) TO authenticated, service_role;

-- 6B. RPC SUBMISSÃO RETROATIVA POR DATA COM MÚLTIPLOS TURNOS E CATEGORIAS
CREATE OR REPLACE FUNCTION public.submit_retroactive_date_distribution(
  p_unit_id UUID,
  p_service_date DATE,
  p_lines JSONB,
  p_justification TEXT,
  p_evidence_document_url TEXT DEFAULT NULL,
  p_allow_closed_period BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_unit RECORD;
  v_today_br DATE;
  v_is_closed BOOLEAN;
  v_line JSONB;
  v_mt_id UUID;
  v_cat_id UUID;
  v_batch_type TEXT;
  v_qty INT;
  v_rule RECORD;
  v_cal_non_operating BOOLEAN;
  v_batch_id UUID;
  v_created_batches UUID[] := ARRAY[]::UUID[];
  v_student_item JSONB;
  v_student RECORD;
  v_effective_cat UUID;
  v_student_count INT;
  v_total_meals INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
  END IF;

  SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não localizado.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Papel sem permissão para lançar regularizações.';
  END IF;

  IF NOT public.has_unit_access(p_unit_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem acesso à unidade informada.';
  END IF;

  SELECT id, tenant_id, status
    INTO v_unit
    FROM public.units
   WHERE id = p_unit_id
     AND tenant_id = v_profile.tenant_id
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNIT_TENANT_MISMATCH: Unidade inativa ou pertencente a outro tenant.';
  END IF;

  v_today_br := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF p_service_date IS NULL OR p_service_date > v_today_br THEN
    RAISE EXCEPTION 'FUTURE_DATE_NOT_ALLOWED: Regularização retroativa não permite data futura.';
  END IF;

  IF p_justification IS NULL OR pg_catalog.length(pg_catalog.btrim(p_justification)) < 10 THEN
    RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: Justificativa detalhada obrigatória (mínimo 10 caracteres).';
  END IF;

  IF pg_catalog.jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array'
     OR pg_catalog.jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'LINES_REQUIRED: Informe ao menos uma linha (turno + categoria + quantidade).';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.financial_daily_closings fdc
     WHERE fdc.tenant_id = v_profile.tenant_id
       AND fdc.closing_date = p_service_date
       AND (fdc.unit_id IS NULL OR fdc.unit_id = p_unit_id)
  ) INTO v_is_closed;

  IF v_is_closed AND (NOT p_allow_closed_period OR v_profile.role NOT IN ('admin_general', 'operations_director')) THEN
    RAISE EXCEPTION 'CLOSED_DAILY_PERIOD: A data % já possui fechamento financeiro diário consolidado.', p_service_date;
  END IF;

  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines)
  LOOP
    v_mt_id := NULLIF(v_line->>'meal_type_id', '')::uuid;
    v_cat_id := NULLIF(v_line->>'category_id', '')::uuid;
    v_batch_type := COALESCE(NULLIF(v_line->>'batch_type', ''), 'type_b_unidentified_count');
    v_qty := COALESCE((v_line->>'quantity')::int, 0);

    IF v_mt_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.unit_meal_types umt
       WHERE umt.tenant_id = v_profile.tenant_id
         AND umt.unit_id = p_unit_id
         AND umt.meal_type_id = v_mt_id
         AND umt.enabled = true
    ) THEN
      RAISE EXCEPTION 'UNIT_MEAL_TYPE_DISABLED: Turno não está habilitado para esta unidade.';
    END IF;

    IF v_cat_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.student_categories sc
       WHERE sc.id = v_cat_id AND sc.tenant_id = v_profile.tenant_id AND sc.status = 'active'
    ) THEN
      RAISE EXCEPTION 'CATEGORY_REQUIRED: Categoria administrativa obrigatória em todas as linhas.';
    END IF;

    IF v_batch_type NOT IN ('type_a_identified', 'type_b_unidentified_count', 'type_c_administrative_adjustment') THEN
      RAISE EXCEPTION 'INVALID_BATCH_TYPE: Tipo de lote inválido.';
    END IF;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: Quantidade da linha deve ser maior que zero.';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.unit_operating_calendar uoc
       WHERE uoc.tenant_id = v_profile.tenant_id
         AND uoc.unit_id = p_unit_id
         AND uoc.calendar_date = p_service_date
         AND (uoc.meal_type_id = v_mt_id OR uoc.meal_type_id IS NULL)
         AND uoc.is_operating = false
    ) INTO v_cal_non_operating;

    IF v_cal_non_operating THEN
      RAISE EXCEPTION 'NON_OPERATING_DAY: A unidade não funcionou em % segundo o calendário operacional.', p_service_date;
    END IF;

    SELECT mr.student_price, mr.subsidy_amount
      INTO v_rule
      FROM public.meal_rules mr
     WHERE mr.tenant_id = v_profile.tenant_id
       AND mr.unit_id = p_unit_id
       AND mr.meal_type_id = v_mt_id
       AND mr.category_id = v_cat_id
       AND mr.enabled = true
       AND mr.effective_from <= (p_service_date::timestamptz + INTERVAL '23 hours 59 minutes 59 seconds')
       AND (mr.effective_to IS NULL OR mr.effective_to >= p_service_date::timestamptz)
     ORDER BY mr.effective_from DESC
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RULE_NOT_EFFECTIVE: Não existe regra tarifária ativa para unidade/turno/categoria na data %.', p_service_date;
    END IF;

    INSERT INTO public.contingency_meal_batches (
      tenant_id, unit_id, meal_type_id, service_date, batch_type,
      total_meals_served, category_id, unit_price, subsidy_price,
      total_amount, total_subsidy_amount, justification, evidence_document_url,
      operator_id, status, adjustment_modality, is_individual_confirmed
    ) VALUES (
      v_profile.tenant_id, p_unit_id, v_mt_id, p_service_date, v_batch_type,
      v_qty, v_cat_id, COALESCE(v_rule.student_price, 0.00), COALESCE(v_rule.subsidy_amount, 0.00),
      pg_catalog.round(COALESCE(v_rule.student_price, 0.00) * v_qty, 2),
      pg_catalog.round(COALESCE(v_rule.subsidy_amount, 0.00) * v_qty, 2),
      pg_catalog.btrim(COALESCE(NULLIF(v_line->>'notes', ''), p_justification)),
      p_evidence_document_url,
      v_uid,
      'pending_approval',
      'single_date_manual',
      (v_batch_type = 'type_a_identified')
    )
    RETURNING id INTO v_batch_id;

    IF v_batch_type = 'type_a_identified' THEN
      v_student_count := 0;
      FOR v_student_item IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(v_line->'identified_students', '[]'::jsonb))
      LOOP
        SELECT id, full_name, registration_number, category_id
          INTO v_student
          FROM public.students
         WHERE tenant_id = v_profile.tenant_id
           AND id = (v_student_item->>'student_id')::uuid
           AND status = 'active'
         LIMIT 1;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'INACTIVE_OR_MISSING_STUDENT: Estudante % não localizado ou inativo.', v_student_item->>'student_id';
        END IF;

        v_effective_cat := COALESCE(
          public.get_student_category_on_date(v_profile.tenant_id, v_student.id, p_service_date),
          v_student.category_id
        );

        IF v_effective_cat IS DISTINCT FROM v_cat_id THEN
          RAISE EXCEPTION 'CATEGORY_MISMATCH: Estudante % possuía outra categoria vigente em % e não pode ser lançado na categoria selecionada.',
            v_student.registration_number, p_service_date;
        END IF;

        INSERT INTO public.contingency_batch_items (
          tenant_id, batch_id, student_id, registration_number,
          student_name, category_id, notes, service_date, meal_type_id
        ) VALUES (
          v_profile.tenant_id, v_batch_id, v_student.id, v_student.registration_number,
          v_student.full_name, v_effective_cat, NULLIF(pg_catalog.btrim(COALESCE(v_student_item->>'notes', '')), ''),
          p_service_date, v_mt_id
        );

        v_student_count := v_student_count + 1;
      END LOOP;

      IF v_student_count <> v_qty THEN
        RAISE EXCEPTION 'STUDENT_COUNT_MISMATCH: Quantidade (%) difere dos comensais informados (%).',
          v_qty, v_student_count;
      END IF;
    END IF;

    v_total_meals := v_total_meals + v_qty;
    v_created_batches := pg_catalog.array_append(v_created_batches, v_batch_id);
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'service_date', p_service_date,
    'total_meals', v_total_meals,
    'batch_ids', to_jsonb(v_created_batches)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_retroactive_date_distribution(UUID, DATE, JSONB, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_retroactive_date_distribution(UUID, DATE, JSONB, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- 7. RPC REVISÃO DE CAMPANHA INTEIRA (DUPLA APROVAÇÃO SEGREGADA)
CREATE OR REPLACE FUNCTION public.review_smart_adjustment_campaign(
  p_campaign_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_campaign RECORD;
  v_clean_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Usuário não autenticado.';
  END IF;

  SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil inativo ou não localizado.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Apenas diretoria, financeiro ou master podem aprovar campanhas.';
  END IF;

  SELECT *
    INTO v_campaign
    FROM public.meal_adjustment_campaigns
   WHERE id = p_campaign_id
     AND tenant_id = v_profile.tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND: Campanha de ajuste não encontrada.';
  END IF;

  IF v_campaign.allocation_status NOT IN ('submitted_for_approval', 'partially_allocated_pending') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_STATUS: Campanha já deliberada (%).', v_campaign.allocation_status;
  END IF;

  IF v_campaign.created_by = v_uid AND v_profile.role <> 'admin_general' THEN
    RAISE EXCEPTION 'SELF_APPROVAL_PROHIBITED: Criador da campanha não pode aprová-la.';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.meal_adjustment_campaigns
       SET allocation_status = 'approved',
           approved_by = v_uid,
           approved_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE id = p_campaign_id;

    UPDATE public.contingency_meal_batches
       SET status = 'approved',
           approved_by = v_uid,
           approved_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE campaign_id = p_campaign_id
       AND tenant_id = v_profile.tenant_id
       AND status = 'pending_approval';

    RETURN pg_catalog.jsonb_build_object('campaign_id', p_campaign_id, 'status', 'approved');
  ELSIF p_action = 'reject' THEN
    v_clean_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
    IF v_clean_reason IS NULL OR pg_catalog.length(v_clean_reason) < 5 THEN
      RAISE EXCEPTION 'REASON_REQUIRED: Motivo da rejeição obrigatório (mínimo 5 caracteres).';
    END IF;

    UPDATE public.meal_adjustment_campaigns
       SET allocation_status = 'rejected',
           rejection_reason = v_clean_reason,
           approved_by = v_uid,
           approved_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE id = p_campaign_id;

    UPDATE public.contingency_meal_batches
       SET status = 'rejected',
           rejection_reason = v_clean_reason,
           approved_by = v_uid,
           approved_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE campaign_id = p_campaign_id
       AND tenant_id = v_profile.tenant_id
       AND status IN ('draft', 'pending_approval');

    RETURN pg_catalog.jsonb_build_object('campaign_id', p_campaign_id, 'status', 'rejected');
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION: Ação inválida. Utilize approve ou reject.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_smart_adjustment_campaign(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_smart_adjustment_campaign(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 8. ENRIQUECIMENTO DO RELATÓRIO FINANCEIRO CONSOLIDADO (SEGREGAÇÃO INDIVIDUAL VS AGREGADA VS PENDÊNCIA MENSAL)
CREATE OR REPLACE FUNCTION public.get_consolidated_financial_report(
    p_tenant_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_institution_id UUID DEFAULT NULL,
    p_unit_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile RECORD;
    v_total_meals INT := 0;
    v_gross_meal_amount NUMERIC(14,2) := 0.00;
    v_total_subsidy_amount NUMERIC(14,2) := 0.00;
    v_student_paid_amount NUMERIC(14,2) := 0.00;
    v_total_recharges_amount NUMERIC(14,2) := 0.00;
    v_total_custody_balance NUMERIC(14,2) := 0.00;
    v_total_gateway_fees NUMERIC(14,2) := 0.00;

    v_contingency_meals INT := 0;
    v_contingency_gross NUMERIC(14,2) := 0.00;
    v_contingency_subsidy NUMERIC(14,2) := 0.00;
    v_cont_ident_meals INT := 0;
    v_cont_ident_gross NUMERIC(14,2) := 0.00;
    v_cont_ident_subsidy NUMERIC(14,2) := 0.00;
    v_cont_agg_meals INT := 0;
    v_cont_agg_gross NUMERIC(14,2) := 0.00;
    v_cont_agg_subsidy NUMERIC(14,2) := 0.00;
    v_unallocated_pending_meals INT := 0;

    v_category_breakdown JSONB;
    v_unit_breakdown JSONB;
    v_contingency_breakdown JSONB;
    v_result JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação necessária.' USING ERRCODE = '42501';
    END IF;

    SELECT id, tenant_id, role, status INTO v_profile FROM public.profiles WHERE id = v_uid;
    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo obrigatório.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Perfil sem permissão para acessar relatórios fiscais.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.tenant_id <> p_tenant_id THEN
        RAISE EXCEPTION 'TENANT_MISMATCH: Acesso negado a dados de outro tenant.' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role IN ('unit_manager', 'supervisor') THEN
        IF p_unit_id IS NULL THEN
            RAISE EXCEPTION 'UNIT_SCOPE_REQUIRED: Gestores locais devem obrigatoriamente especificar uma unidade autorizada.' USING ERRCODE = '42501';
        END IF;
        IF NOT public.has_unit_access(p_unit_id) THEN
            RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
        END IF;
    ELSIF p_unit_id IS NOT NULL AND NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'INVALID_DATE_RANGE: Período de apuração inválido.' USING ERRCODE = '22023';
    END IF;

    SELECT
        COUNT(*)::INT,
        COALESCE(SUM(mc.full_price), 0.00),
        COALESCE(SUM(mc.subsidy_amount), 0.00),
        COALESCE(SUM(mc.student_price), 0.00)
      INTO
        v_total_meals,
        v_gross_meal_amount,
        v_total_subsidy_amount,
        v_student_paid_amount
      FROM public.meal_consumptions mc
     WHERE mc.tenant_id = p_tenant_id
       AND mc.consumption_date >= p_start_date
       AND mc.consumption_date <= p_end_date
       AND mc.status IN ('approved', 'financially_refunded')
       AND (p_institution_id IS NULL OR mc.institution_id = p_institution_id)
       AND (p_unit_id IS NULL OR mc.unit_id = p_unit_id)
       AND (p_category_id IS NULL OR mc.category_id = p_category_id);

    SELECT
        COALESCE(SUM(cmb.total_meals_served), 0)::INT,
        COALESCE(SUM(cmb.total_amount), 0.00),
        COALESCE(SUM(cmb.total_subsidy_amount), 0.00),
        COALESCE(SUM(CASE WHEN cmb.batch_type = 'type_a_identified' THEN cmb.total_meals_served ELSE 0 END), 0)::INT,
        COALESCE(SUM(CASE WHEN cmb.batch_type = 'type_a_identified' THEN cmb.total_amount ELSE 0.00 END), 0.00),
        COALESCE(SUM(CASE WHEN cmb.batch_type = 'type_a_identified' THEN cmb.total_subsidy_amount ELSE 0.00 END), 0.00),
        COALESCE(SUM(CASE WHEN cmb.batch_type <> 'type_a_identified' THEN cmb.total_meals_served ELSE 0 END), 0)::INT,
        COALESCE(SUM(CASE WHEN cmb.batch_type <> 'type_a_identified' THEN cmb.total_amount ELSE 0.00 END), 0.00),
        COALESCE(SUM(CASE WHEN cmb.batch_type <> 'type_a_identified' THEN cmb.total_subsidy_amount ELSE 0.00 END), 0.00)
      INTO
        v_contingency_meals,
        v_contingency_gross,
        v_contingency_subsidy,
        v_cont_ident_meals,
        v_cont_ident_gross,
        v_cont_ident_subsidy,
        v_cont_agg_meals,
        v_cont_agg_gross,
        v_cont_agg_subsidy
      FROM public.contingency_meal_batches cmb
      JOIN public.units u_cmb ON u_cmb.id = cmb.unit_id AND u_cmb.tenant_id = cmb.tenant_id
     WHERE cmb.tenant_id = p_tenant_id
       AND cmb.service_date >= p_start_date
       AND cmb.service_date <= p_end_date
       AND cmb.status = 'approved'
       AND (p_institution_id IS NULL OR u_cmb.institution_id = p_institution_id)
       AND (p_unit_id IS NULL OR cmb.unit_id = p_unit_id)
       AND (p_category_id IS NULL OR cmb.category_id = p_category_id);

    -- Pendências mensais sem alocação por data (apenas informativo; nunca entra no faturamento)
    SELECT COALESCE(SUM(mac.unallocated_pending_meals), 0)::INT
      INTO v_unallocated_pending_meals
      FROM public.meal_adjustment_campaigns mac
     WHERE mac.tenant_id = p_tenant_id
       AND mac.competence_month >= pg_catalog.date_trunc('month', p_start_date)::date
       AND mac.competence_month <= pg_catalog.date_trunc('month', p_end_date)::date
       AND mac.allocation_status IN ('partially_allocated_pending', 'submitted_for_approval', 'approved')
       AND (p_institution_id IS NULL OR mac.institution_id = p_institution_id)
       AND (p_unit_id IS NULL OR mac.unit_id = p_unit_id);

    IF v_profile.role IN ('admin_general', 'operations_director', 'finance') THEN
        SELECT COALESCE(SUM(r.amount), 0.00)
          INTO v_total_recharges_amount
          FROM public.recharges r
          JOIN public.students s_r ON s_r.id = r.student_id AND s_r.tenant_id = r.tenant_id
         WHERE r.tenant_id = p_tenant_id
           AND COALESCE(r.confirmed_at, r.created_at)::DATE >= p_start_date
           AND COALESCE(r.confirmed_at, r.created_at)::DATE <= p_end_date
           AND r.status = 'confirmed'
           AND (p_institution_id IS NULL OR s_r.institution_id = p_institution_id);

        SELECT COALESCE(SUM(w.balance), 0.00)
          INTO v_total_custody_balance
          FROM public.wallets w
          JOIN public.students s ON s.id = w.student_id AND s.tenant_id = w.tenant_id
         WHERE w.tenant_id = p_tenant_id
           AND s.status = 'active'
           AND (p_institution_id IS NULL OR s.institution_id = p_institution_id);

        SELECT COALESCE(SUM(
            CASE
                WHEN (p.raw_response->>'fee') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (p.raw_response->>'fee')::NUMERIC(14,2)
                ELSE 0.00
            END
        ), 0.00)
          INTO v_total_gateway_fees
          FROM public.payments p
          JOIN public.students s_p ON s_p.id = p.student_id AND s_p.tenant_id = p.tenant_id
         WHERE p.tenant_id = p_tenant_id
           AND COALESCE(p.confirmed_at, p.created_at)::DATE >= p_start_date
           AND COALESCE(p.confirmed_at, p.created_at)::DATE <= p_end_date
           AND p.status = 'confirmed'
           AND (p_institution_id IS NULL OR s_p.institution_id = p_institution_id);
    END IF;

    WITH cat_stats AS (
        SELECT
            sc.id AS category_id,
            sc.name AS category_name,
            sc.code AS category_code,
            (sc.code = 'integral') AS is_integral,
            COUNT(mc.id)::INT AS meals_count,
            COALESCE(SUM(mc.full_price), 0.00) AS gross_amount,
            COALESCE(SUM(mc.subsidy_amount), 0.00) AS subsidy_amount,
            COALESCE(SUM(mc.student_price), 0.00) AS student_paid_amount
          FROM public.meal_consumptions mc
          JOIN public.student_categories sc ON sc.id = mc.category_id
         WHERE mc.tenant_id = p_tenant_id
           AND mc.consumption_date >= p_start_date
           AND mc.consumption_date <= p_end_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_institution_id IS NULL OR mc.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR mc.unit_id = p_unit_id)
           AND (p_category_id IS NULL OR mc.category_id = p_category_id)
         GROUP BY sc.id, sc.name, sc.code
         ORDER BY gross_amount DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'category_id', category_id,
                'category_name', category_name,
                'category_code', category_code,
                'is_integral', is_integral,
                'meals_count', meals_count,
                'gross_amount', gross_amount,
                'subsidy_amount', subsidy_amount,
                'student_paid_amount', student_paid_amount
            )
        ),
        '[]'::jsonb
    )
    INTO v_category_breakdown
    FROM cat_stats;

    WITH unit_stats AS (
        SELECT
            u.id AS unit_id,
            u.name AS unit_name,
            i.name AS institution_name,
            COUNT(mc.id)::INT AS meals_count,
            COALESCE(SUM(mc.full_price), 0.00) AS gross_amount,
            COALESCE(SUM(mc.subsidy_amount), 0.00) AS subsidy_amount,
            COALESCE(SUM(mc.student_price), 0.00) AS student_paid_amount
          FROM public.units u
          JOIN public.institutions i ON i.id = u.institution_id
          LEFT JOIN public.meal_consumptions mc
            ON mc.unit_id = u.id
           AND mc.consumption_date >= p_start_date
           AND mc.consumption_date <= p_end_date
           AND mc.status IN ('approved', 'financially_refunded')
           AND (p_category_id IS NULL OR mc.category_id = p_category_id)
         WHERE u.tenant_id = p_tenant_id
           AND (p_institution_id IS NULL OR u.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR u.id = p_unit_id)
         GROUP BY u.id, u.name, i.name
         ORDER BY gross_amount DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'unit_id', unit_id,
                'unit_name', unit_name,
                'institution_name', institution_name,
                'meals_count', meals_count,
                'gross_amount', gross_amount,
                'subsidy_amount', subsidy_amount,
                'student_paid_amount', student_paid_amount
            )
        ),
        '[]'::jsonb
    )
    INTO v_unit_breakdown
    FROM unit_stats;

    WITH contingency_stats AS (
        SELECT
            cmb.id,
            u.name AS unit_name,
            mt.name AS meal_type_name,
            cmb.service_date,
            cmb.batch_type,
            cmb.total_meals_served,
            cmb.total_amount,
            cmb.total_subsidy_amount,
            cmb.justification,
            p.full_name AS approved_by_name,
            cmb.approved_at
          FROM public.contingency_meal_batches cmb
          JOIN public.units u ON u.id = cmb.unit_id AND u.tenant_id = cmb.tenant_id
          JOIN public.meal_types mt ON mt.id = cmb.meal_type_id
          LEFT JOIN public.profiles p ON p.id = cmb.approved_by
         WHERE cmb.tenant_id = p_tenant_id
           AND cmb.service_date >= p_start_date
           AND cmb.service_date <= p_end_date
           AND cmb.status = 'approved'
           AND (p_institution_id IS NULL OR u.institution_id = p_institution_id)
           AND (p_unit_id IS NULL OR cmb.unit_id = p_unit_id)
           AND (p_category_id IS NULL OR cmb.category_id = p_category_id)
         ORDER BY cmb.service_date DESC
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', id,
                'unit_name', unit_name,
                'meal_type_name', meal_type_name,
                'service_date', service_date,
                'batch_type', batch_type,
                'total_meals_served', total_meals_served,
                'total_amount', total_amount,
                'total_subsidy_amount', total_subsidy_amount,
                'justification', justification,
                'approved_by_name', approved_by_name,
                'approved_at', approved_at
            )
        ),
        '[]'::jsonb
    )
    INTO v_contingency_breakdown
    FROM contingency_stats;

    v_result := pg_catalog.jsonb_build_object(
        'generated_at', pg_catalog.now(),
        'period', pg_catalog.jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date),
        'applied_filters', pg_catalog.jsonb_build_object('institution_id', p_institution_id, 'unit_id', p_unit_id, 'category_id', p_category_id),
        'summary', pg_catalog.jsonb_build_object(
            'regular_meals_served', v_total_meals,
            'contingency_meals_served', v_contingency_meals,
            'contingency_identified_meals', v_cont_ident_meals,
            'contingency_aggregated_meals', v_cont_agg_meals,
            'unallocated_pending_meals_total', v_unallocated_pending_meals,
            'total_meals_delivered', (v_total_meals + v_contingency_meals),
            'gross_meal_amount', v_gross_meal_amount,
            'contingency_gross_amount', v_contingency_gross,
            'contingency_identified_gross', v_cont_ident_gross,
            'contingency_aggregated_gross', v_cont_agg_gross,
            'total_gross_invoicing', (v_gross_meal_amount + v_contingency_gross),
            'regular_subsidy_amount', v_total_subsidy_amount,
            'contingency_subsidy_amount', v_contingency_subsidy,
            'contingency_identified_subsidy', v_cont_ident_subsidy,
            'contingency_aggregated_subsidy', v_cont_agg_subsidy,
            'total_institutional_subsidy', (v_total_subsidy_amount + v_contingency_subsidy),
            'student_paid_amount', v_student_paid_amount,
            'recharges_in_period', v_total_recharges_amount,
            'current_custody_liability', v_total_custody_balance,
            'gateway_processing_fees', v_total_gateway_fees
        ),
        'category_breakdown', v_category_breakdown,
        'unit_breakdown', v_unit_breakdown,
        'contingency_breakdown', v_contingency_breakdown
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consolidated_financial_report(UUID, DATE, DATE, UUID, UUID, UUID) TO authenticated, service_role;

