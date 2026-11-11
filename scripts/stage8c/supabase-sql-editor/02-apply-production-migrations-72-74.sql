-- GERADO. Não editar manualmente.
-- Etapa 8C: aplicação atômica autorizada no projeto oficial.
-- Ordem: 72 -> 73 -> 74. A migration 75 não é reaplicada.
-- Gerado por scripts/stage8c/build-production-migration-bundle.cjs
-- SHA-256 supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql: 59f807659086352bb79211ec1efdb21c7f7695e8502dfd7e2f2c32632359700c
-- SHA-256 supabase/migrations/20261026000073_harden_scoped_read_policies.sql: 2366745fb1dc760da810c1dac6a54885c31ef3fce4f1102bb273a14ca8db9f25
-- SHA-256 supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql: 10062d9faf19bd4234d14d589e1a552d0e8eb28cd67fb79e732e7f2fadf1e8aa

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '180s';

DO $stage8c_preflight$
DECLARE
    v_version integer := current_setting('server_version_num')::integer;
    v_relation text;
    v_function text;
    v_invalid_statuses bigint;
BEGIN
    IF v_version < 170000 OR v_version >= 180000 THEN
        RAISE EXCEPTION 'Etapa 8C exige PostgreSQL 17; encontrado %.', v_version;
    END IF;

    FOREACH v_relation IN ARRAY ARRAY[
        'public.offline_contingency_events',
        'public.institutions',
        'public.profiles',
        'public.user_institution_access',
        'public.user_unit_access',
        'public.students',
        'public.wallets',
        'public.wallet_transactions',
        'public.payments',
        'public.recharges',
        'public.cash_shifts',
        'public.cash_movements',
        'public.units',
        'public.meal_consumptions',
        'public.student_categories'
    ] LOOP
        IF to_regclass(v_relation) IS NULL THEN
            RAISE EXCEPTION 'Relação obrigatória ausente: %.', v_relation;
        END IF;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
        'public.get_auth_tenant_id()',
        'public.get_auth_user_role()',
        'public.get_auth_user_status()',
        'public.has_unit_access(uuid)',
        'public.reconcile_offline_consumptions(jsonb)',
        'public.get_terminal_shift_snapshot(uuid)'
    ] LOOP
        IF to_regprocedure(v_function) IS NULL THEN
            RAISE EXCEPTION 'Função obrigatória ausente: %.', v_function;
        END IF;
    END LOOP;

    IF to_regprocedure(
        'public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'RPC da migration 74 já existe sem histórico reconciliado.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version IN ('20261026000072', '20261026000073', '20261027000074')
    ) THEN
        RAISE EXCEPTION 'Uma migration 72–74 já consta no histórico; interromper para reconciliar.';
    END IF;

    SELECT count(*)
      INTO v_invalid_statuses
      FROM public.offline_contingency_events
     WHERE status NOT IN (
        'pending',
        'received',
        'confirmed_regular',
        'conflict_duplicate',
        'pending_administrative_review',
        'failed_irrecoverable'
     );

    IF v_invalid_statuses <> 0 THEN
        RAISE EXCEPTION 'Existem % eventos offline com status incompatível.', v_invalid_statuses;
    END IF;
END
$stage8c_preflight$;

-- BEGIN supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql
-- Etapa 7B: reconciliar o schema offline e convergir suas policies.
-- Migration preparada localmente. Nao aplicar sem homologacao e autorizacao.

ALTER TABLE public.offline_contingency_events
    ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS consumption_date DATE,
    ADD COLUMN IF NOT EXISTS conflict_reason TEXT,
    ADD COLUMN IF NOT EXISTS linked_consumption_id UUID REFERENCES public.meal_consumptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS financial_debit_applied BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now();

ALTER TABLE public.offline_contingency_events
    ALTER COLUMN status SET DEFAULT 'received';

ALTER TABLE public.offline_contingency_events
    DROP CONSTRAINT IF EXISTS chk_offline_events_status;

-- "pending" permanece aceito somente para compatibilidade com registros legados.
ALTER TABLE public.offline_contingency_events
    ADD CONSTRAINT chk_offline_events_status CHECK (
        status IN (
            'pending',
            'received',
            'confirmed_regular',
            'conflict_duplicate',
            'pending_administrative_review',
            'failed_irrecoverable'
        )
    ) NOT VALID;

ALTER TABLE public.offline_contingency_events
    VALIDATE CONSTRAINT chk_offline_events_status;

CREATE INDEX IF NOT EXISTS idx_offline_events_tenant_unit_status
    ON public.offline_contingency_events (tenant_id, unit_id, status);

ALTER TABLE public.offline_contingency_events ENABLE ROW LEVEL SECURITY;

-- O ambiente auditado continha policies extras, nao versionadas e com nomes
-- desconhecidos. A convergencia remove toda policy anterior desta tabela antes
-- de instalar a unica superficie de leitura autorizada.
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT policyname
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'offline_contingency_events'
    LOOP
        EXECUTE pg_catalog.format(
            'DROP POLICY %I ON public.offline_contingency_events',
            policy_record.policyname
        );
    END LOOP;
END;
$$;

CREATE POLICY sel_offline_events_scoped_staff
ON public.offline_contingency_events
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN (
        'admin_general',
        'operations_director',
        'supervisor',
        'unit_manager',
        'operator'
    )
    AND public.has_unit_access(unit_id)
);

-- A estrategia oficial permanece online-first. A funcao legada e preservada
-- para auditoria/reversibilidade, mas nao pode ser chamada por clientes.
REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_terminal_shift_snapshot(UUID)
FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.offline_contingency_events IS
    'Livro imutavel de contingencia; leitura exige tenant, usuario ativo, papel operacional e escopo de unidade.';

NOTIFY pgrst, 'reload schema';
-- END supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql


-- BEGIN supabase/migrations/20261026000073_harden_scoped_read_policies.sql
-- Etapa 7B: hardening das policies identificadas na homologacao da Etapa 4B.
-- Migration preparada localmente. Nao aplicar sem homologacao e autorizacao.

-- Sem relacao canonica estudante <-> unidade, inferir a unidade por instituicao
-- permitiria acesso lateral. Supervisores e gerentes dependem, por ora, de um
-- vinculo institucional explicito. Acesso baseado apenas em user_unit_access
-- fica fechado ate a decisao de modelagem.
CREATE OR REPLACE FUNCTION public.can_manage_students_at_institution(
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
          JOIN public.institutions AS institution
            ON institution.id = p_institution_id
           AND institution.tenant_id = profile.tenant_id
         WHERE profile.id = auth.uid()
           AND profile.status = 'active'
           AND (
                profile.role IN ('admin_general', 'operations_director', 'finance')
                OR (
                    profile.role IN ('supervisor', 'unit_manager', 'institution_user')
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_institution_access AS institution_access
                         WHERE institution_access.user_id = profile.id
                           AND institution_access.tenant_id = profile.tenant_id
                           AND institution_access.institution_id = p_institution_id
                    )
                )
           )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_students_at_institution(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_students_at_institution(UUID)
TO authenticated;

DROP POLICY IF EXISTS sel_students ON public.students;
CREATE POLICY sel_students
ON public.students
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.can_manage_students_at_institution(institution_id)
    )
);

-- Financeiro e perfis organizacionais globais conservam leitura por tenant.
-- Perfis de unidade ficam fail-closed enquanto nao existir origem canonica de
-- unit_id em estudante/carteira/pagamento/recarga.
DROP POLICY IF EXISTS sel_wallets_staff ON public.wallets;
CREATE POLICY sel_wallets_staff
ON public.wallets
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_wallet_tx_staff ON public.wallet_transactions;
CREATE POLICY sel_wallet_tx_staff
ON public.wallet_transactions
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_payments_staff ON public.payments;
CREATE POLICY sel_payments_staff
ON public.payments
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_recharges_staff ON public.recharges;
CREATE POLICY sel_recharges_staff
ON public.recharges
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS cash_shifts_select_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_select_policy
ON public.cash_shifts
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
);

DROP POLICY IF EXISTS cash_shifts_insert_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_insert_policy
ON public.cash_shifts
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
    AND public.has_unit_access(unit_id)
);

DROP POLICY IF EXISTS cash_shifts_update_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_update_policy
ON public.cash_shifts
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
);

DROP POLICY IF EXISTS cash_movements_select_policy ON public.cash_movements;
CREATE POLICY cash_movements_select_policy
ON public.cash_movements
FOR SELECT TO authenticated
USING (
    public.get_auth_user_status() = 'active'
    AND EXISTS (
        SELECT 1
          FROM public.cash_shifts AS shift
         WHERE shift.id = cash_movements.cash_shift_id
           AND shift.tenant_id = public.get_auth_tenant_id()
           AND (
                public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
                OR (
                    public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
                    AND public.has_unit_access(shift.unit_id)
                )
           )
    )
);

DROP POLICY IF EXISTS cash_movements_insert_policy ON public.cash_movements;
CREATE POLICY cash_movements_insert_policy
ON public.cash_movements
FOR INSERT TO authenticated
WITH CHECK (
    public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
    AND EXISTS (
        SELECT 1
          FROM public.cash_shifts AS shift
         WHERE shift.id = cash_movements.cash_shift_id
           AND shift.tenant_id = public.get_auth_tenant_id()
           AND public.has_unit_access(shift.unit_id)
    )
);

NOTIFY pgrst, 'reload schema';
-- END supabase/migrations/20261026000073_harden_scoped_read_policies.sql


-- BEGIN supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql
-- Etapas 7D.1/7D.2: contrato read-only dos indicadores operacionais.
-- Migration preparada localmente. Nao aplicar sem reconciliacao de schema,
-- homologacao em staging e autorizacao expressa.

CREATE OR REPLACE FUNCTION public.get_operational_intelligence_v1(
    p_period_start DATE,
    p_period_end DATE,
    p_previous_start DATE,
    p_previous_end DATE,
    p_institution_ids UUID[] DEFAULT NULL,
    p_unit_ids UUID[] DEFAULT NULL,
    p_category_ids UUID[] DEFAULT NULL
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
    v_duration INTEGER;
    v_result JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
    END IF;

    SELECT profile.id, profile.tenant_id, profile.role, profile.status
      INTO v_profile
      FROM public.profiles AS profile
     WHERE profile.id = v_uid;

    IF v_profile.id IS NULL OR v_profile.status <> 'active' THEN
        RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role NOT IN (
        'admin_general',
        'operations_director',
        'finance',
        'supervisor',
        'unit_manager',
        'institution_user'
    ) THEN
        RAISE EXCEPTION 'OPERATIONAL_INTELLIGENCE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF p_period_start IS NULL OR p_period_end IS NULL
       OR p_previous_start IS NULL OR p_previous_end IS NULL
       OR p_period_end <= p_period_start
       OR p_previous_end <= p_previous_start THEN
        RAISE EXCEPTION 'INVALID_PERIOD' USING ERRCODE = '22023';
    END IF;

    v_duration := p_period_end - p_period_start;
    IF v_duration > 366 OR (p_previous_end - p_previous_start) <> v_duration THEN
        RAISE EXCEPTION 'PERIODS_MUST_HAVE_EQUAL_DURATION' USING ERRCODE = '22023';
    END IF;

    IF coalesce(cardinality(p_institution_ids), 1) = 0
       OR coalesce(cardinality(p_unit_ids), 1) = 0
       OR coalesce(cardinality(p_category_ids), 1) = 0
       OR cardinality(p_institution_ids) > 100
       OR cardinality(p_unit_ids) > 100
       OR cardinality(p_category_ids) > 100 THEN
        RAISE EXCEPTION 'INVALID_FILTER_SET' USING ERRCODE = '22023';
    END IF;

    -- Escopos locais precisam possuir ao menos uma atribuicao explicita.
    IF v_profile.role IN ('supervisor', 'unit_manager') AND NOT EXISTS (
        SELECT 1
          FROM public.user_unit_access AS unit_access
         WHERE unit_access.user_id = v_profile.id
           AND unit_access.tenant_id = v_profile.tenant_id
    ) THEN
        RAISE EXCEPTION 'UNIT_SCOPE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_profile.role = 'institution_user' AND NOT EXISTS (
        SELECT 1
          FROM public.user_institution_access AS institution_access
         WHERE institution_access.user_id = v_profile.id
           AND institution_access.tenant_id = v_profile.tenant_id
    ) THEN
        RAISE EXCEPTION 'INSTITUTION_SCOPE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    -- Todo filtro institucional solicitado deve estar integralmente autorizado.
    IF p_institution_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_institution_ids) AS requested(institution_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.institutions AS institution
             WHERE institution.id = requested.institution_id
               AND institution.tenant_id = v_profile.tenant_id
               AND (
                    v_profile.role IN ('admin_general', 'operations_director', 'finance')
                    OR (
                        v_profile.role IN ('supervisor', 'unit_manager')
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_unit_access AS unit_access
                              JOIN public.units AS scoped_unit
                                ON scoped_unit.id = unit_access.unit_id
                               AND scoped_unit.tenant_id = unit_access.tenant_id
                             WHERE unit_access.user_id = v_profile.id
                               AND unit_access.tenant_id = v_profile.tenant_id
                               AND scoped_unit.institution_id = institution.id
                        )
                    )
                    OR (
                        v_profile.role = 'institution_user'
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_institution_access AS institution_access
                             WHERE institution_access.user_id = v_profile.id
                               AND institution_access.tenant_id = v_profile.tenant_id
                               AND institution_access.institution_id = institution.id
                        )
                    )
               )
         )
    ) THEN
        RAISE EXCEPTION 'INSTITUTION_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Todo filtro de unidade solicitado deve estar integralmente autorizado.
    IF p_unit_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_unit_ids) AS requested(unit_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.units AS unit
             WHERE unit.id = requested.unit_id
               AND unit.tenant_id = v_profile.tenant_id
               AND (
                    v_profile.role IN ('admin_general', 'operations_director', 'finance')
                    OR (
                        v_profile.role IN ('supervisor', 'unit_manager')
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_unit_access AS unit_access
                             WHERE unit_access.user_id = v_profile.id
                               AND unit_access.tenant_id = v_profile.tenant_id
                               AND unit_access.unit_id = unit.id
                        )
                    )
                    OR (
                        v_profile.role = 'institution_user'
                        AND EXISTS (
                            SELECT 1
                              FROM public.user_institution_access AS institution_access
                             WHERE institution_access.user_id = v_profile.id
                               AND institution_access.tenant_id = v_profile.tenant_id
                               AND institution_access.institution_id = unit.institution_id
                        )
                    )
               )
         )
    ) THEN
        RAISE EXCEPTION 'UNIT_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Categorias de outro tenant ou inexistentes sao recusadas, nao ignoradas.
    IF p_category_ids IS NOT NULL AND EXISTS (
        SELECT 1
          FROM unnest(p_category_ids) AS requested(category_id)
         WHERE NOT EXISTS (
            SELECT 1
              FROM public.student_categories AS category
             WHERE category.id = requested.category_id
               AND category.tenant_id = v_profile.tenant_id
         )
    ) THEN
        RAISE EXCEPTION 'CATEGORY_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    WITH authorized_units AS (
        SELECT unit.id, unit.institution_id, unit.name
          FROM public.units AS unit
         WHERE unit.tenant_id = v_profile.tenant_id
           AND (
                v_profile.role IN ('admin_general', 'operations_director', 'finance')
                OR (
                    v_profile.role IN ('supervisor', 'unit_manager')
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_unit_access AS unit_access
                         WHERE unit_access.user_id = v_profile.id
                           AND unit_access.tenant_id = v_profile.tenant_id
                           AND unit_access.unit_id = unit.id
                    )
                )
                OR (
                    v_profile.role = 'institution_user'
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_institution_access AS institution_access
                         WHERE institution_access.user_id = v_profile.id
                           AND institution_access.tenant_id = v_profile.tenant_id
                           AND institution_access.institution_id = unit.institution_id
                    )
                )
           )
    ),
    selected_units AS (
        SELECT unit.id, unit.institution_id, unit.name
          FROM authorized_units AS unit
         WHERE (p_institution_ids IS NULL OR unit.institution_id = ANY(p_institution_ids))
           AND (p_unit_ids IS NULL OR unit.id = ANY(p_unit_ids))
    ),
    scoped_counts AS (
        SELECT consumption.unit_id,
               consumption.category_id,
               count(*) FILTER (
                   WHERE consumption.consumption_date >= p_period_start
                     AND consumption.consumption_date < p_period_end
               )::BIGINT AS current_total,
               count(*) FILTER (
                   WHERE consumption.consumption_date >= p_previous_start
                     AND consumption.consumption_date < p_previous_end
               )::BIGINT AS previous_total
          FROM public.meal_consumptions AS consumption
          JOIN selected_units AS unit ON unit.id = consumption.unit_id
         WHERE consumption.tenant_id = v_profile.tenant_id
           AND consumption.status IN ('approved', 'financially_refunded')
           AND (
                (consumption.consumption_date >= p_period_start AND consumption.consumption_date < p_period_end)
                OR
                (consumption.consumption_date >= p_previous_start AND consumption.consumption_date < p_previous_end)
           )
           AND (p_category_ids IS NULL OR consumption.category_id = ANY(p_category_ids))
         GROUP BY consumption.unit_id, consumption.category_id
    ),
    totals AS (
        SELECT coalesce(sum(current_total), 0)::BIGINT AS current_total,
               coalesce(sum(previous_total), 0)::BIGINT AS previous_total
          FROM scoped_counts
    ),
    counts_by_unit AS (
        SELECT unit_id,
               sum(current_total)::BIGINT AS current_total,
               sum(previous_total)::BIGINT AS previous_total
          FROM scoped_counts
         GROUP BY unit_id
    ),
    unit_totals AS (
        SELECT unit.id,
               unit.institution_id,
               unit.name,
               coalesce(consumption.current_total, 0)::BIGINT AS current_total,
               coalesce(consumption.previous_total, 0)::BIGINT AS previous_total
          FROM selected_units AS unit
          LEFT JOIN counts_by_unit AS consumption ON consumption.unit_id = unit.id
    ),
    category_totals AS (
        SELECT category.id,
               category.code,
               category.name,
               sum(consumption.current_total)::BIGINT AS current_total
          FROM scoped_counts AS consumption
          JOIN public.student_categories AS category
            ON category.id = consumption.category_id
           AND category.tenant_id = v_profile.tenant_id
         WHERE consumption.current_total > 0
         GROUP BY category.id, category.code, category.name
    )
    SELECT jsonb_build_object(
        'schema_version', 'stage7d-operational-v1',
        'generated_at', clock_timestamp(),
        'periods', jsonb_build_object(
            'current', jsonb_build_object('start_date', p_period_start, 'end_date_exclusive', p_period_end),
            'previous', jsonb_build_object('start_date', p_previous_start, 'end_date_exclusive', p_previous_end)
        ),
        'applied_scope', jsonb_build_object(
            'institution_ids', coalesce((SELECT jsonb_agg(DISTINCT institution_id ORDER BY institution_id) FROM selected_units), '[]'::JSONB),
            'unit_ids', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM selected_units), '[]'::JSONB),
            'category_ids', coalesce(to_jsonb(p_category_ids), '[]'::JSONB)
        ),
        'meals_served', totals.current_total,
        'volume_by_unit', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'unit_id', unit.id,
                'institution_id', unit.institution_id,
                'unit_name', unit.name,
                'meals_served', unit.current_total,
                'previous_meals_served', unit.previous_total,
                'variation_percent', CASE
                    WHEN unit.previous_total = 0 THEN NULL
                    ELSE round(((unit.current_total - unit.previous_total) * 100.0) / unit.previous_total, 2)
                END
            ) ORDER BY unit.current_total DESC, unit.name)
              FROM unit_totals AS unit
        ), '[]'::JSONB),
        'utilization_by_category', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'category_id', category.id,
                'category_code', category.code,
                'category_name', category.name,
                'meals_served', category.current_total,
                'percentage', CASE
                    WHEN totals.current_total = 0 THEN 0
                    ELSE round((category.current_total * 100.0) / totals.current_total, 2)
                END
            ) ORDER BY category.current_total DESC, category.name)
              FROM category_totals AS category
        ), '[]'::JSONB),
        'period_comparison', jsonb_build_object(
            'current_meals_served', totals.current_total,
            'previous_meals_served', totals.previous_total,
            'variation_percent', CASE
                WHEN totals.previous_total = 0 THEN NULL
                ELSE round(((totals.current_total - totals.previous_total) * 100.0) / totals.previous_total, 2)
            END
        )
    )
      INTO v_result
      FROM totals;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[])
IS 'Agrega somente indicadores operacionais de refeicoes, com tenant derivado de auth.uid e escopo institucional/unidade fail-closed.';

REVOKE ALL ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_operational_intelligence_v1(DATE, DATE, DATE, DATE, UUID[], UUID[], UUID[]) TO authenticated;
-- END supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql

DO $stage8c_postflight$
DECLARE
    v_offline_policies text[];
    v_rpc regprocedure :=
        to_regprocedure('public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])');
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'public.offline_contingency_events'::regclass
           AND conname = 'chk_offline_events_status'
           AND convalidated
    ) THEN
        RAISE EXCEPTION 'Constraint offline esperada não foi validada.';
    END IF;

    SELECT array_agg(policyname ORDER BY policyname)
      INTO v_offline_policies
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'offline_contingency_events';

    IF v_offline_policies IS DISTINCT FROM ARRAY['sel_offline_events_scoped_staff']::text[] THEN
        RAISE EXCEPTION 'Policies offline divergentes após migration 72: %.', v_offline_policies;
    END IF;

    IF has_function_privilege('anon', 'public.reconcile_offline_consumptions(jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.reconcile_offline_consumptions(jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_terminal_shift_snapshot(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_terminal_shift_snapshot(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'RPCs offline legadas continuam executáveis por clientes.';
    END IF;

    IF to_regprocedure('public.can_manage_students_at_institution(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Função de escopo institucional da migration 73 ausente.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'students'
           AND policyname = 'sel_students'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'cash_movements'
           AND policyname = 'cash_movements_select_policy'
    ) THEN
        RAISE EXCEPTION 'Policies obrigatórias da migration 73 ausentes.';
    END IF;

    IF v_rpc IS NULL THEN
        RAISE EXCEPTION 'RPC operacional da migration 74 ausente.';
    END IF;

    -- Se PUBLIC mantivesse EXECUTE, o papel anon também teria privilégio efetivo.
    IF has_function_privilege('anon', v_rpc, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE') THEN
        RAISE EXCEPTION 'ACL da RPC operacional diverge do contrato.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc
         WHERE oid = v_rpc
           AND prosecdef
           AND provolatile = 's'
           AND EXISTS (
               SELECT 1
                 FROM unnest(proconfig) AS setting(value)
                WHERE setting.value IN ('search_path=', 'search_path=""')
           )
    ) THEN
        RAISE EXCEPTION 'Segurança, volatilidade ou search_path da RPC operacional diverge.';
    END IF;
END
$stage8c_postflight$;

COMMIT;

SELECT jsonb_build_object(
    'approved', true,
    'serverVersionNum', current_setting('server_version_num')::integer,
    'offlinePolicies', (
        SELECT jsonb_agg(policyname ORDER BY policyname)
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'offline_contingency_events'
    ),
    'operationalRpcExists',
        to_regprocedure('public.get_operational_intelligence_v1(date,date,date,date,uuid[],uuid[],uuid[])') IS NOT NULL,
    'migrationHistoryRecorded', EXISTS (
        SELECT 1
          FROM supabase_migrations.schema_migrations
         WHERE version IN ('20261026000072', '20261026000073', '20261027000074')
    )
);
