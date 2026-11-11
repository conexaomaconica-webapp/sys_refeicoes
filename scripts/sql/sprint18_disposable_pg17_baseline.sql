-- ==============================================================================
-- Sprint 18: Baseline Fiel para Performance, Carga, Estresse e Resiliência (PG 17)
-- ATENÇÃO: Uso exclusivo em instância PostgreSQL 17 local e descartável.
-- NUNCA executar em instâncias Supabase remotas ou bancos de produção.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;

-- 1. Papéis sem SUPERUSER e sem BYPASSRLS (fidelidade Supabase)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;

-- 2. Emulação mínima de schemas auth / storage / publicação supabase_realtime
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email TEXT
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public BOOLEAN DEFAULT false,
    file_size_limit BIGINT,
    allowed_mime_types TEXT[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT NOT NULL,
    name TEXT NOT NULL,
    owner UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- 3. Enums Canônicos
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM (
            'admin_general', 'operations_director', 'finance', 'supervisor',
            'unit_manager', 'operator', 'institution_user', 'student'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE public.payment_status AS ENUM ('pending', 'confirmed', 'failed', 'cancelled', 'refunded');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recharge_status') THEN
        CREATE TYPE public.recharge_status AS ENUM ('pending', 'confirmed', 'failed', 'reversed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type') THEN
        CREATE TYPE public.wallet_transaction_type AS ENUM ('recharge', 'meal_debit', 'refund', 'adjustment');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meal_type_code') THEN
        CREATE TYPE public.meal_type_code AS ENUM ('breakfast', 'lunch', 'dinner');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

-- 4. Tabelas Core (Fiel às migrations 01–78 + suporte operacional consume_meal)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    full_name TEXT NOT NULL,
    email TEXT,
    role public.user_role NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.user_unit_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    unit_id UUID NOT NULL REFERENCES public.units(id)
);
CREATE INDEX idx_uua_user_unit ON public.user_unit_access(user_id, unit_id);

CREATE TABLE public.user_institution_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id)
);

CREATE TABLE public.student_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    requires_wallet BOOLEAN NOT NULL DEFAULT true,
    pricing_type TEXT NOT NULL DEFAULT 'percentage',
    charge_percentage NUMERIC(5,2) NOT NULL DEFAULT 100.00,
    fixed_price NUMERIC(10,2),
    allowed_meal_types UUID[] NULL,
    allow_multi_meal BOOLEAN NOT NULL DEFAULT false,
    payment_mode TEXT NOT NULL DEFAULT 'wallet',
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE (tenant_id, code),
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    category_id UUID NOT NULL REFERENCES public.student_categories(id),
    user_id UUID,
    full_name TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    photo_path TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (institution_id, registration_number),
    UNIQUE (id, tenant_id)
);
CREATE INDEX idx_students_lookup_reg ON public.students(institution_id, registration_number);
CREATE INDEX idx_students_tenant_inst_reg ON public.students(tenant_id, institution_id, registration_number);

CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    status TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (id, tenant_id),
    UNIQUE (student_id, tenant_id)
);

CREATE TABLE public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    wallet_id UUID NOT NULL,
    student_id UUID NOT NULL,
    type public.wallet_transaction_type NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    balance_before NUMERIC(12,2) NOT NULL CHECK (balance_before >= 0),
    balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
    reference_type VARCHAR(50),
    reference_id UUID,
    description TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_wallet_tx_math CHECK (ROUND(balance_after, 2) = ROUND(balance_before + amount, 2)),
    CONSTRAINT fk_wallet_tx_wallet_tenant FOREIGN KEY (wallet_id, tenant_id) REFERENCES public.wallets(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_wallet_tx_student_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_wallet_tx_wallet ON public.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_wallet_tx_student ON public.wallet_transactions(tenant_id, student_id);

CREATE TABLE public.cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL,
    card_number TEXT NOT NULL,
    card_serial TEXT NULL,
    card_type TEXT NOT NULL DEFAULT 'digital',
    physical_code_hash TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, tenant_id),
    FOREIGN KEY (student_id, tenant_id) REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_cards_serial_tenant ON public.cards(tenant_id, card_serial) WHERE card_serial IS NOT NULL;

CREATE TABLE public.qr_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    card_id UUID NOT NULL,
    student_id UUID NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (token_hash)
);
CREATE INDEX idx_qr_tokens_lookup_hash ON public.qr_tokens(token_hash, tenant_id);

CREATE TABLE public.payment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    external_payment_id TEXT,
    method TEXT NOT NULL CHECK (method IN ('pix', 'credit_card')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status public.payment_status NOT NULL DEFAULT 'pending',
    raw_response JSONB,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.recharges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    student_id UUID NOT NULL,
    wallet_id UUID NOT NULL,
    payment_id UUID REFERENCES public.payments(id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status public.recharge_status NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL CHECK (source IN ('pix', 'credit_card', 'cash', 'manual')),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.meal_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    code public.meal_type_code NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE (id, tenant_id)
);

CREATE TABLE public.unit_meal_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id),
    enabled BOOLEAN NOT NULL DEFAULT true,
    start_time TIME WITHOUT TIME ZONE NULL,
    end_time TIME WITHOUT TIME ZONE NULL,
    UNIQUE (unit_id, meal_type_id, tenant_id)
);

CREATE TABLE public.meal_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL,
    meal_type_id UUID NOT NULL,
    category_id UUID NOT NULL,
    full_price NUMERIC(12,2) NOT NULL,
    student_price NUMERIC(12,2) NOT NULL,
    subsidy_amount NUMERIC(12,2) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_meal_rules_lookup ON public.meal_rules(tenant_id, unit_id, meal_type_id, category_id, enabled);

CREATE TABLE public.meal_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL REFERENCES public.units(id),
    institution_id UUID NOT NULL REFERENCES public.institutions(id),
    student_id UUID NOT NULL REFERENCES public.students(id),
    category_id UUID NOT NULL REFERENCES public.student_categories(id),
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id),
    consumption_date DATE NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    full_price NUMERIC(12,2) NOT NULL,
    student_price NUMERIC(12,2) NOT NULL,
    subsidy_amount NUMERIC(12,2) NOT NULL,
    wallet_transaction_id UUID,
    operator_id UUID NOT NULL REFERENCES public.profiles(id),
    terminal_id TEXT,
    verification_method TEXT NOT NULL DEFAULT 'registration_number',
    idempotency_key TEXT NULL,
    qr_token_id UUID NULL REFERENCES public.qr_tokens(id),
    status TEXT NOT NULL DEFAULT 'approved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_meal_consumptions_math CHECK (ROUND(subsidy_amount, 2) = ROUND(full_price - student_price, 2))
);

CREATE UNIQUE INDEX idx_meal_consumptions_active_daily
    ON public.meal_consumptions(student_id, consumption_date, meal_type_id)
    WHERE (status IN ('approved', 'financially_refunded'));

CREATE UNIQUE INDEX uq_meal_consumptions_idempotency
    ON public.meal_consumptions(tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_meal_consumptions_unit_date ON public.meal_consumptions(unit_id, consumption_date);
CREATE INDEX idx_meal_consumptions_tenant_created ON public.meal_consumptions(tenant_id, created_at DESC);

CREATE TABLE public.blocked_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    unit_id UUID NOT NULL,
    student_id UUID,
    category_id UUID,
    meal_type_id UUID,
    registration_attempted TEXT,
    verification_method TEXT NOT NULL DEFAULT 'registration_number',
    reason_code TEXT NOT NULL,
    reason_message TEXT NOT NULL,
    terminal_id TEXT,
    operator_id UUID,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_blocked_attempts_unit_date ON public.blocked_attempts(unit_id, attempted_at DESC);

CREATE TABLE public.cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    meal_type_id UUID REFERENCES public.meal_types(id) ON DELETE SET NULL,
    terminal_id VARCHAR(50) NOT NULL,
    operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    cash_shift_mode VARCHAR(20) NOT NULL DEFAULT 'daily',
    status VARCHAR(20) NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'closed')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    initial_float_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_shifts_tenant_unit_status ON public.cash_shifts(tenant_id, unit_id, status);

-- 5. Helpers RLS idênticos às Migrations 08/73
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid() AND status = 'active' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND status = 'active' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_status()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT status FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_unit_access(p_unit_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_role public.user_role;
    v_tenant_id UUID;
BEGIN
    SELECT role, tenant_id INTO v_role, v_tenant_id
    FROM public.profiles WHERE id = auth.uid() AND status = 'active';
    IF v_role IS NULL THEN RETURN FALSE; END IF;
    IF v_role IN ('admin_general', 'operations_director', 'finance') THEN
        RETURN EXISTS (SELECT 1 FROM public.units u WHERE u.id = p_unit_id AND u.tenant_id = v_tenant_id AND u.status = 'active');
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.user_unit_access uua
        JOIN public.units u ON u.id = uua.unit_id
        WHERE uua.user_id = auth.uid() AND uua.unit_id = p_unit_id AND uua.tenant_id = v_tenant_id AND u.status = 'active'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_auth_tenant_id(), public.get_auth_user_role(), public.get_auth_user_status(), public.has_unit_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_tenant_id(), public.get_auth_user_role(), public.get_auth_user_status(), public.has_unit_access(UUID) TO authenticated, service_role;

-- RLS nas tabelas base
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meal_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_consumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_wallets_staff ON public.wallets FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_status() = 'active' AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance'));

CREATE POLICY sel_wallet_tx_staff ON public.wallet_transactions FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_status() = 'active' AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance'));

CREATE POLICY sel_meal_consumptions_staff ON public.meal_consumptions FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_status() = 'active' AND public.has_unit_access(unit_id));

CREATE POLICY sel_blocked_attempts_staff ON public.blocked_attempts FOR SELECT TO authenticated
USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_status() = 'active' AND public.has_unit_access(unit_id));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.wallet_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Stub de assinatura para compatibilidade com Migration 72 (REVOKE get_terminal_shift_snapshot)
CREATE OR REPLACE FUNCTION public.get_terminal_shift_snapshot(p_unit_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT '[]'::jsonb; $$;

CREATE OR REPLACE FUNCTION public.consume_operator_terminal_meal(
    p_unit_id UUID,
    p_identifier TEXT,
    p_meal_type_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_terminal_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_meal_type_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'MEAL_TYPE_REQUIRED', 'message', 'Selecione a refeicao antes de iniciar o atendimento.');
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               <> (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'STALE_CASH_SHIFT', 'message', 'O caixa aberto pertence a uma data anterior e deve ser fechado.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.cash_shifts AS cs
         WHERE cs.unit_id = p_unit_id AND cs.terminal_id = p_terminal_id
           AND cs.operator_id = auth.uid() AND cs.status = 'opened'
           AND (cs.opened_at AT TIME ZONE 'America/Sao_Paulo')::DATE
               = (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::DATE
           AND (cs.cash_shift_mode = 'daily' OR cs.meal_type_id = p_meal_type_id)
    ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error_code', 'CASH_SHIFT_REQUIRED', 'message', 'Abra um caixa compativel com a refeicao selecionada antes de iniciar o atendimento.');
    END IF;
    RETURN public.consume_meal(p_unit_id, p_identifier, p_meal_type_id, p_idempotency_key, p_terminal_id);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_operator_terminal_meal(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
