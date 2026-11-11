-- Baseline minimo e descartavel para homologar as migrations 72 e 73.
-- Este arquivo nao representa uma migration de producao.

CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA auth;

CREATE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE TABLE public.tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE public.institutions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.units (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.user_unit_access (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    PRIMARY KEY (user_id, unit_id)
);

CREATE TABLE public.user_institution_access (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    PRIMARY KEY (user_id, institution_id)
);

CREATE TABLE public.students (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    user_id UUID,
    full_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.wallets (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    balance NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.wallet_transactions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE public.payments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE public.recharges (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id),
    unit_id UUID REFERENCES public.units(id),
    amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE public.meal_consumptions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    student_id UUID NOT NULL REFERENCES public.students(id)
);

CREATE TABLE public.offline_contingency_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    operator_id UUID NOT NULL REFERENCES public.profiles(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    status TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_offline_events_status CHECK (
        status IN (
            'pending',
            'confirmed_regular',
            'conflict_duplicate',
            'pending_administrative_review',
            'failed_irrecoverable'
        )
    )
);

CREATE TABLE public.cash_shifts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    operator_id UUID NOT NULL REFERENCES public.profiles(id),
    status TEXT NOT NULL DEFAULT 'opened'
);

CREATE TABLE public.cash_movements (
    id UUID PRIMARY KEY,
    cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id),
    amount NUMERIC(12,2) NOT NULL,
    operator_id UUID NOT NULL REFERENCES public.profiles(id)
);

CREATE FUNCTION public.get_auth_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE FUNCTION public.get_auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE FUNCTION public.get_auth_user_status()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT status FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE FUNCTION public.has_unit_access(p_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
          JOIN public.units AS unit
            ON unit.id = p_unit_id
           AND unit.tenant_id = profile.tenant_id
           AND unit.status = 'active'
         WHERE profile.id = auth.uid()
           AND profile.status = 'active'
           AND (
                profile.role IN ('admin_general', 'operations_director', 'finance')
                OR EXISTS (
                    SELECT 1
                      FROM public.user_unit_access AS access
                     WHERE access.user_id = profile.id
                       AND access.tenant_id = profile.tenant_id
                       AND access.unit_id = p_unit_id
                )
           )
    );
$$;

CREATE FUNCTION public.can_manage_students_at_institution(p_institution_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT false; $$;

CREATE FUNCTION public.reconcile_offline_consumptions(p_batch JSONB)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT p_batch; $$;

CREATE FUNCTION public.get_terminal_shift_snapshot(p_unit_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT pg_catalog.jsonb_build_object('unit_id', p_unit_id); $$;

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_contingency_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY sel_students ON public.students FOR SELECT TO authenticated USING (true);
CREATE POLICY sel_wallets_staff ON public.wallets FOR SELECT TO authenticated USING (true);
CREATE POLICY sel_wallet_tx_staff ON public.wallet_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY sel_payments_staff ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY sel_recharges_staff ON public.recharges FOR SELECT TO authenticated USING (true);
CREATE POLICY sel_offline_events_staff ON public.offline_contingency_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Eventos offline do tenant" ON public.offline_contingency_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura da contingencia" ON public.offline_contingency_events FOR SELECT TO authenticated USING (true);
CREATE POLICY cash_shifts_select_policy ON public.cash_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY cash_shifts_insert_policy ON public.cash_shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cash_shifts_update_policy ON public.cash_shifts FOR UPDATE TO authenticated USING (true);
CREATE POLICY cash_movements_select_policy ON public.cash_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY cash_movements_insert_policy ON public.cash_movements FOR INSERT TO authenticated WITH CHECK (true);

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_unit_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_students_at_institution(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_consumptions(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_terminal_shift_snapshot(UUID) TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
