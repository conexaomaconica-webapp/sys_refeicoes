-- Permite configurar por unidade se o terminal deve solicitar valor recebido e calcular troco
-- ao registrar pagamentos em dinheiro (padrao: true) ou confirmar diretamente (false).

ALTER TABLE public.units
    ADD COLUMN IF NOT EXISTS cash_require_change BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.units.cash_require_change IS
    'Define se o terminal solicita valor recebido e calcula troco em pagamentos em dinheiro (true) ou confirma diretamente (false).';

CREATE OR REPLACE FUNCTION public.get_unit_cash_shift_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
    v_result JSONB;
BEGIN
    SELECT p.tenant_id, p.role, p.status
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.tenant_id IS NULL
       OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager', 'operator') THEN
        RAISE EXCEPTION 'Acesso negado as configuracoes de caixa.';
    END IF;

    SELECT coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'unit_id', u.id,
                'unit_name', u.name,
                'cash_shift_mode', u.cash_shift_mode,
                'cash_require_change', u.cash_require_change,
                'can_manage', v_caller.role IN ('admin_general', 'operations_director', 'unit_manager')
            ) ORDER BY u.name
        ),
        '[]'::JSONB
    )
      INTO v_result
      FROM public.units AS u
     WHERE u.tenant_id = v_caller.tenant_id
       AND u.status = 'active'
       AND public.has_unit_access(u.id);

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_unit_cash_require_change(
    p_unit_id UUID,
    p_require_change BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller RECORD;
BEGIN
    SELECT p.tenant_id, p.role, p.status
      INTO v_caller
      FROM public.profiles AS p
     WHERE p.id = auth.uid();

    IF v_caller.tenant_id IS NULL
       OR v_caller.status <> 'active'
       OR v_caller.role NOT IN ('admin_general', 'operations_director', 'unit_manager')
       OR NOT public.has_unit_access(p_unit_id) THEN
        RAISE EXCEPTION 'Perfil sem permissao para configurar o caixa desta unidade.';
    END IF;

    IF p_require_change IS NULL THEN
        RAISE EXCEPTION 'Valor invalido para configuracao de troco.';
    END IF;

    UPDATE public.units AS u
       SET cash_require_change = p_require_change,
           updated_at = pg_catalog.now()
     WHERE u.id = p_unit_id
       AND u.tenant_id = v_caller.tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unidade nao encontrada no escopo autorizado.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'unit_id', p_unit_id,
        'cash_require_change', p_require_change
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_unit_cash_shift_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_unit_cash_require_change(UUID, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_unit_cash_shift_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_unit_cash_require_change(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

