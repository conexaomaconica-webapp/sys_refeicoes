-- Integrações Asaas gerenciadas pelo administrador geral.
-- Segredos ficam no Supabase Vault e nunca são retornados ao cliente autenticado.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.payment_gateway_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'asaas',
    environment TEXT NOT NULL,
    api_key_secret_id UUID NOT NULL,
    webhook_secret_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    last_api_test_status TEXT NOT NULL DEFAULT 'not_tested',
    last_api_test_at TIMESTAMPTZ,
    last_webhook_test_status TEXT NOT NULL DEFAULT 'not_tested',
    last_webhook_test_at TIMESTAMPTZ,
    last_test_message TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id),
    updated_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_gateway_integration UNIQUE (tenant_id, provider, environment),
    CONSTRAINT chk_payment_gateway_provider CHECK (provider = 'asaas'),
    CONSTRAINT chk_payment_gateway_environment CHECK (environment IN ('sandbox', 'production')),
    CONSTRAINT chk_payment_gateway_api_status CHECK (last_api_test_status IN ('not_tested', 'success', 'failed')),
    CONSTRAINT chk_payment_gateway_webhook_status CHECK (last_webhook_test_status IN ('not_tested', 'success', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_gateway_active_provider
ON public.payment_gateway_integrations (tenant_id, provider)
WHERE is_active;

ALTER TABLE public.payment_gateway_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_integrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_gateway_integrations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.payment_gateway_integration_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    environment TEXT NOT NULL,
    action TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    actor_id UUID NOT NULL REFERENCES public.profiles(id),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_payment_gateway_audit_action CHECK (action IN ('configured', 'activated', 'deactivated', 'api_test', 'webhook_test'))
);
ALTER TABLE public.payment_gateway_integration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_integration_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_gateway_integration_audit FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_gateway_integrations_updated_at ON public.payment_gateway_integrations;
CREATE TRIGGER trg_payment_gateway_integrations_updated_at
BEFORE UPDATE ON public.payment_gateway_integrations
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.admin_list_asaas_integrations(p_requester_id UUID)
RETURNS TABLE (
    environment TEXT,
    is_active BOOLEAN,
    has_api_key BOOLEAN,
    has_webhook_secret BOOLEAN,
    last_api_test_status TEXT,
    last_api_test_at TIMESTAMPTZ,
    last_webhook_test_status TEXT,
    last_webhook_test_at TIMESTAMPTZ,
    last_test_message TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    SELECT p.tenant_id INTO v_tenant_id
    FROM public.profiles p
    WHERE p.id = p_requester_id AND p.status = 'active' AND p.role = 'admin_general';
    IF v_tenant_id IS NULL OR auth.uid() IS DISTINCT FROM p_requester_id THEN
        RAISE EXCEPTION 'ACCESS_DENIED';
    END IF;

    RETURN QUERY
    SELECT i.environment, i.is_active, true, true,
           i.last_api_test_status, i.last_api_test_at,
           i.last_webhook_test_status, i.last_webhook_test_at,
           i.last_test_message, i.updated_at
    FROM public.payment_gateway_integrations i
    WHERE i.tenant_id = v_tenant_id AND i.provider = 'asaas'
    ORDER BY i.environment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_asaas_integrations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_asaas_integrations(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.service_upsert_asaas_integration(
    p_requester_id UUID,
    p_environment TEXT,
    p_api_key TEXT,
    p_webhook_secret TEXT,
    p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_row public.payment_gateway_integrations%ROWTYPE;
    v_api_secret_id UUID;
    v_webhook_secret_id UUID;
    v_prefix TEXT;
BEGIN
    SELECT p.tenant_id INTO v_tenant_id
    FROM public.profiles p
    WHERE p.id = p_requester_id AND p.status = 'active' AND p.role = 'admin_general';
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
    IF p_environment NOT IN ('sandbox', 'production') THEN RAISE EXCEPTION 'INVALID_ENVIRONMENT'; END IF;

    v_prefix := CASE WHEN p_environment = 'sandbox' THEN '$aact_hmlg_' ELSE '$aact_prod_' END;
    IF p_api_key IS NOT NULL AND (length(p_api_key) < 20 OR left(p_api_key, length(v_prefix)) <> v_prefix) THEN
        RAISE EXCEPTION 'INVALID_ASAAS_KEY_FOR_ENVIRONMENT';
    END IF;
    IF p_webhook_secret IS NOT NULL AND length(p_webhook_secret) < 32 THEN
        RAISE EXCEPTION 'WEBHOOK_SECRET_TOO_SHORT';
    END IF;

    SELECT * INTO v_row FROM public.payment_gateway_integrations i
    WHERE i.tenant_id = v_tenant_id AND i.provider = 'asaas' AND i.environment = p_environment
    FOR UPDATE;

    IF v_row.id IS NULL AND (p_api_key IS NULL OR p_webhook_secret IS NULL) THEN
        RAISE EXCEPTION 'CREDENTIALS_REQUIRED_ON_CREATE';
    END IF;

    IF p_api_key IS NOT NULL THEN
        IF v_row.api_key_secret_id IS NULL THEN
            v_api_secret_id := vault.create_secret(p_api_key, 'ma_refeicoes_asaas_api_' || v_tenant_id || '_' || p_environment);
        ELSE
            PERFORM vault.update_secret(v_row.api_key_secret_id, p_api_key);
            v_api_secret_id := v_row.api_key_secret_id;
        END IF;
    ELSE
        v_api_secret_id := v_row.api_key_secret_id;
    END IF;

    IF p_webhook_secret IS NOT NULL THEN
        IF v_row.webhook_secret_id IS NULL THEN
            v_webhook_secret_id := vault.create_secret(p_webhook_secret, 'ma_refeicoes_asaas_webhook_' || v_tenant_id || '_' || p_environment);
        ELSE
            PERFORM vault.update_secret(v_row.webhook_secret_id, p_webhook_secret);
            v_webhook_secret_id := v_row.webhook_secret_id;
        END IF;
    ELSE
        v_webhook_secret_id := v_row.webhook_secret_id;
    END IF;

    IF p_is_active THEN
        UPDATE public.payment_gateway_integrations
        SET is_active = false, updated_by = p_requester_id
        WHERE tenant_id = v_tenant_id AND provider = 'asaas' AND environment <> p_environment;
    END IF;

    INSERT INTO public.payment_gateway_integrations (
        tenant_id, provider, environment, api_key_secret_id, webhook_secret_id,
        is_active, created_by, updated_by
    ) VALUES (
        v_tenant_id, 'asaas', p_environment, v_api_secret_id, v_webhook_secret_id,
        p_is_active, p_requester_id, p_requester_id
    )
    ON CONFLICT (tenant_id, provider, environment) DO UPDATE SET
        api_key_secret_id = EXCLUDED.api_key_secret_id,
        webhook_secret_id = EXCLUDED.webhook_secret_id,
        is_active = EXCLUDED.is_active,
        updated_by = EXCLUDED.updated_by,
        last_api_test_status = CASE WHEN p_api_key IS NULL THEN public.payment_gateway_integrations.last_api_test_status ELSE 'not_tested' END,
        last_webhook_test_status = CASE WHEN p_webhook_secret IS NULL THEN public.payment_gateway_integrations.last_webhook_test_status ELSE 'not_tested' END,
        last_test_message = NULL;

    INSERT INTO public.payment_providers (tenant_id, code, name, is_active, credentials, status)
    VALUES (v_tenant_id, 'asaas', 'Asaas', p_is_active, '{}'::jsonb, 'active')
    ON CONFLICT (tenant_id, code) DO UPDATE SET
        is_active = EXCLUDED.is_active,
        credentials = '{}'::jsonb,
        status = 'active';

    INSERT INTO public.payment_gateway_integration_audit (
        tenant_id, provider, environment, action, success, actor_id, details
    ) VALUES (
        v_tenant_id, 'asaas', p_environment,
        CASE WHEN p_is_active THEN 'activated' WHEN v_row.is_active THEN 'deactivated' ELSE 'configured' END,
        true, p_requester_id,
        jsonb_build_object('api_key_rotated', p_api_key IS NOT NULL, 'webhook_secret_rotated', p_webhook_secret IS NOT NULL)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.service_upsert_asaas_integration(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_upsert_asaas_integration(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.service_get_asaas_integration(
    p_requester_id UUID,
    p_environment TEXT
)
RETURNS TABLE (tenant_id UUID, api_key TEXT, webhook_secret TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_tenant_id UUID;
BEGIN
    SELECT p.tenant_id INTO v_tenant_id FROM public.profiles p
    WHERE p.id = p_requester_id AND p.status = 'active' AND p.role = 'admin_general';
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;

    RETURN QUERY
    SELECT i.tenant_id, api.decrypted_secret, webhook.decrypted_secret, i.is_active
    FROM public.payment_gateway_integrations i
    JOIN vault.decrypted_secrets api ON api.id = i.api_key_secret_id
    JOIN vault.decrypted_secrets webhook ON webhook.id = i.webhook_secret_id
    WHERE i.tenant_id = v_tenant_id AND i.provider = 'asaas' AND i.environment = p_environment;
END;
$$;

REVOKE ALL ON FUNCTION public.service_get_asaas_integration(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_asaas_integration(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.service_get_asaas_runtime_integration(
    p_tenant_id UUID,
    p_environment TEXT DEFAULT NULL
)
RETURNS TABLE (api_key TEXT, webhook_secret TEXT, environment TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT api.decrypted_secret, webhook.decrypted_secret, i.environment
    FROM public.payment_gateway_integrations i
    JOIN vault.decrypted_secrets api ON api.id = i.api_key_secret_id
    JOIN vault.decrypted_secrets webhook ON webhook.id = i.webhook_secret_id
    WHERE i.tenant_id = p_tenant_id
      AND i.provider = 'asaas'
      AND i.is_active = true
      AND (p_environment IS NULL OR i.environment = p_environment)
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.service_get_asaas_runtime_integration(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_asaas_runtime_integration(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.service_record_asaas_test(
    p_requester_id UUID,
    p_environment TEXT,
    p_test_type TEXT,
    p_success BOOLEAN,
    p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_tenant_id UUID;
BEGIN
    SELECT p.tenant_id INTO v_tenant_id FROM public.profiles p
    WHERE p.id = p_requester_id AND p.status = 'active' AND p.role = 'admin_general';
    IF v_tenant_id IS NULL OR p_test_type NOT IN ('api', 'webhook') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;

    UPDATE public.payment_gateway_integrations SET
        last_api_test_status = CASE WHEN p_test_type = 'api' THEN CASE WHEN p_success THEN 'success' ELSE 'failed' END ELSE last_api_test_status END,
        last_api_test_at = CASE WHEN p_test_type = 'api' THEN now() ELSE last_api_test_at END,
        last_webhook_test_status = CASE WHEN p_test_type = 'webhook' THEN CASE WHEN p_success THEN 'success' ELSE 'failed' END ELSE last_webhook_test_status END,
        last_webhook_test_at = CASE WHEN p_test_type = 'webhook' THEN now() ELSE last_webhook_test_at END,
        last_test_message = left(p_message, 500), updated_by = p_requester_id
    WHERE tenant_id = v_tenant_id AND provider = 'asaas' AND environment = p_environment;

    INSERT INTO public.payment_gateway_integration_audit (
        tenant_id, provider, environment, action, success, actor_id, details
    ) VALUES (
        v_tenant_id, 'asaas', p_environment,
        CASE WHEN p_test_type = 'api' THEN 'api_test' ELSE 'webhook_test' END,
        p_success, p_requester_id, jsonb_build_object('message', left(p_message, 500))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.service_record_asaas_test(UUID, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_record_asaas_test(UUID, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
