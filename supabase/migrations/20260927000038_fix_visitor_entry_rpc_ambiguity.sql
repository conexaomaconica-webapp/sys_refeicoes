-- Migration: RPC sem sobrecarga para registro de visitante no terminal.
--
-- Versoes anteriores mantiveram assinaturas de register_visitor_entry com
-- TEXT e VARCHAR. O PostgREST nao consegue escolher uma delas quando os
-- parametros chegam como JSON. Esta funcao possui nome exclusivo e encaminha
-- a chamada para a versao mais recente, com tipos explicitos.

CREATE OR REPLACE FUNCTION public.register_terminal_visitor_entry(
    p_unit_id UUID,
    p_meal_type_id UUID DEFAULT NULL,
    p_terminal_id TEXT DEFAULT 'TERM-01',
    p_payment_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    IF p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_PAYMENT_METHOD',
            'message', 'Forma de pagamento invalida.'
        );
    END IF;

    RETURN public.register_visitor_entry(
        p_unit_id,
        p_meal_type_id,
        coalesce(p_terminal_id, 'TERM-01')::VARCHAR,
        p_payment_method::VARCHAR
    );
END;
$$;

REVOKE ALL ON FUNCTION public.register_terminal_visitor_entry(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_terminal_visitor_entry(UUID, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_terminal_visitor_entry(UUID, UUID, TEXT, TEXT)
IS 'Registra visitante no terminal usando uma RPC sem sobrecargas ambiguas para o PostgREST.';
