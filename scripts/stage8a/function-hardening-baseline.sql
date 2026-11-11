-- Baseline sintetico e descartavel da Etapa 8A.4.
-- Reproduz as 12 assinaturas observadas no preflight remoto e gatilhos
-- representativos. Nao e migration e nao deve ser aplicado fora do runner.

CREATE FUNCTION public.admin_list_cash_shifts(UUID, VARCHAR, DATE, DATE)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT '[]'::JSONB $$;

CREATE FUNCTION public.get_active_cash_shift(UUID, VARCHAR)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT '{}'::JSONB $$;

CREATE FUNCTION public.record_cash_movement(UUID, VARCHAR, NUMERIC, VARCHAR, TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT '{}'::JSONB $$;

CREATE FUNCTION public.register_visitor_entry(UUID, UUID, TEXT, VARCHAR)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT '{}'::JSONB $$;

CREATE FUNCTION public.get_terminal_shift_reports(
    p_unit_id UUID,
    p_meal_type_id UUID,
    p_terminal_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant UUID;
BEGIN
    v_tenant := public.get_auth_tenant_id();
    IF v_tenant IS NULL OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Acesso negado ao relatorio do terminal.' USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'tenant_id', v_tenant,
        'unit_id', p_unit_id,
        'meal_type_id', p_meal_type_id,
        'terminal_id', p_terminal_id
    );
END;
$$;

CREATE TABLE public.stage8a_updated_probe (
    id INTEGER PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01 00:00:00+00'
);

CREATE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;

CREATE TRIGGER trg_stage8a_updated
BEFORE UPDATE ON public.stage8a_updated_probe
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.stage8a_movement_probe (
    id INTEGER PRIMARY KEY,
    amount NUMERIC NOT NULL,
    enriched BOOLEAN NOT NULL DEFAULT false
);

CREATE FUNCTION public.enrich_cash_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$ BEGIN NEW.enriched := true; RETURN NEW; END; $$;

CREATE TRIGGER trg_stage8a_enrich
BEFORE INSERT ON public.stage8a_movement_probe
FOR EACH ROW EXECUTE FUNCTION public.enrich_cash_movement();

CREATE TABLE public.stage8a_total_probe (
    id INTEGER PRIMARY KEY,
    total NUMERIC NOT NULL DEFAULT 0
);

CREATE FUNCTION public.refresh_cash_shift_payment_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    UPDATE public.stage8a_total_probe SET total = total + NEW.amount WHERE id = 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stage8a_refresh_total
AFTER INSERT ON public.stage8a_movement_probe
FOR EACH ROW EXECUTE FUNCTION public.refresh_cash_shift_payment_totals();

CREATE TABLE public.stage8a_identity_probe (
    id INTEGER PRIMARY KEY,
    normalized_data JSONB NOT NULL,
    synchronized BOOLEAN NOT NULL DEFAULT false
);

CREATE FUNCTION public.sync_imported_consumer_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$ BEGIN NEW.synchronized := true; RETURN NEW; END; $$;

CREATE TRIGGER trg_stage8a_sync_identity
BEFORE INSERT ON public.stage8a_identity_probe
FOR EACH ROW EXECUTE FUNCTION public.sync_imported_consumer_identity();

CREATE TABLE public.stage8a_profile_probe (
    id INTEGER PRIMARY KEY,
    tenant_id UUID NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE FUNCTION public.trg_prevent_profile_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.role IS DISTINCT FROM OLD.role OR
        NEW.status IS DISTINCT FROM OLD.status
    ) THEN
        RAISE EXCEPTION 'Escalada de perfil bloqueada.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stage8a_profile_guard
BEFORE UPDATE ON public.stage8a_profile_probe
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_profile_escalation();

CREATE TABLE public.stage8a_student_probe (
    id INTEGER PRIMARY KEY,
    tenant_id UUID NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT
);

CREATE FUNCTION public.trg_prevent_student_tampering()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.full_name IS DISTINCT FROM OLD.full_name
    ) THEN
        RAISE EXCEPTION 'Alteracao academica bloqueada.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stage8a_student_guard
BEFORE UPDATE ON public.stage8a_student_probe
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_student_tampering();

CREATE FUNCTION public.rls_auto_enable()
RETURNS EVENT_TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$ BEGIN PERFORM 1; END; $$;

CREATE EVENT TRIGGER stage8a_rls_auto_enable_probe
ON ddl_command_end WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.rls_auto_enable();

-- Reproduz o estado vulneravel observado: EXECUTE efetivo herdado de PUBLIC.
GRANT EXECUTE ON FUNCTION public.admin_list_cash_shifts(UUID, VARCHAR, DATE, DATE) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_cash_shift(UUID, VARCHAR) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_terminal_shift_reports(UUID, UUID, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(UUID, VARCHAR, NUMERIC, VARCHAR, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_visitor_entry(UUID, UUID, TEXT, VARCHAR) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enrich_cash_movement() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_cash_shift_payment_totals() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_imported_consumer_identity() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_prevent_profile_escalation() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_prevent_student_tampering() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;

GRANT SELECT, INSERT, UPDATE ON public.stage8a_updated_probe,
    public.stage8a_movement_probe, public.stage8a_total_probe,
    public.stage8a_identity_probe, public.stage8a_profile_probe,
    public.stage8a_student_probe TO authenticated;

