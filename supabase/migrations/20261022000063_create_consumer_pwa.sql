-- Sprint 12: portal PWA do consumidor, preferências de notificação e
-- endurecimento das superfícies financeiras para bolsistas integrais.

CREATE TABLE IF NOT EXISTS public.consumer_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL,
    low_balance_enabled BOOLEAN NOT NULL DEFAULT true,
    low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 10.00,
    push_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_consumer_preferences_student_tenant
        FOREIGN KEY (student_id, tenant_id)
        REFERENCES public.students(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_consumer_preferences_student UNIQUE (student_id),
    CONSTRAINT chk_consumer_preferences_threshold
        CHECK (low_balance_threshold >= 0 AND low_balance_threshold <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_consumer_preferences_tenant
    ON public.consumer_preferences(tenant_id, student_id);

DROP TRIGGER IF EXISTS trg_consumer_preferences_updated_at
ON public.consumer_preferences;

CREATE TRIGGER trg_consumer_preferences_updated_at
BEFORE UPDATE ON public.consumer_preferences
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.consumer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_consumer_preferences_owner
ON public.consumer_preferences;

CREATE POLICY sel_consumer_preferences_owner
ON public.consumer_preferences
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1
          FROM public.students AS student
         WHERE student.id = consumer_preferences.student_id
           AND student.tenant_id = consumer_preferences.tenant_id
           AND student.user_id = auth.uid()
           AND student.status = 'active'
    )
);

-- Preferências são alteradas somente pela RPC abaixo. Não há policies de
-- INSERT/UPDATE/DELETE para authenticated.

CREATE OR REPLACE FUNCTION public.upsert_my_consumer_preferences(
    p_low_balance_enabled BOOLEAN,
    p_low_balance_threshold NUMERIC(12,2),
    p_push_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_student RECORD;
    v_preference RECORD;
BEGIN
    SELECT tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.status <> 'active' OR v_profile.role <> 'student' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Apenas consumidores ativos podem alterar estas preferencias.';
    END IF;

    IF p_low_balance_threshold IS NULL
       OR p_low_balance_threshold < 0
       OR p_low_balance_threshold > 1000 THEN
        RAISE EXCEPTION 'INVALID_THRESHOLD: Informe um limite entre R$ 0,00 e R$ 1.000,00.';
    END IF;

    SELECT id, tenant_id
      INTO v_student
      FROM public.students
     WHERE user_id = auth.uid()
       AND tenant_id = v_profile.tenant_id
       AND status = 'active';

    IF v_student.id IS NULL THEN
        RAISE EXCEPTION 'STUDENT_NOT_FOUND: Consumidor ativo nao vinculado ao usuario.';
    END IF;

    INSERT INTO public.consumer_preferences (
        tenant_id, student_id, low_balance_enabled,
        low_balance_threshold, push_enabled
    ) VALUES (
        v_student.tenant_id, v_student.id, p_low_balance_enabled,
        round(p_low_balance_threshold, 2), p_push_enabled
    )
    ON CONFLICT (student_id) DO UPDATE
       SET low_balance_enabled = EXCLUDED.low_balance_enabled,
           low_balance_threshold = EXCLUDED.low_balance_threshold,
           push_enabled = EXCLUDED.push_enabled,
           updated_at = now()
    RETURNING * INTO v_preference;

    RETURN to_jsonb(v_preference);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_my_consumer_preferences(BOOLEAN, NUMERIC, BOOLEAN)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_my_consumer_preferences(BOOLEAN, NUMERIC, BOOLEAN)
TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_my_digital_card()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_student RECORD;
    v_card RECORD;
BEGIN
    SELECT tenant_id, role, status
      INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid();

    IF v_profile.status <> 'active' OR v_profile.role <> 'student' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Apenas consumidores ativos podem emitir a propria carteirinha.';
    END IF;

    SELECT id, tenant_id
      INTO v_student
      FROM public.students
     WHERE user_id = auth.uid()
       AND tenant_id = v_profile.tenant_id
       AND status = 'active';

    IF v_student.id IS NULL THEN
        RAISE EXCEPTION 'STUDENT_NOT_FOUND: Consumidor ativo nao vinculado ao usuario.';
    END IF;

    SELECT *
      INTO v_card
      FROM public.cards
     WHERE student_id = v_student.id
       AND tenant_id = v_student.tenant_id
       AND card_type = 'digital'
     ORDER BY issued_at DESC
     LIMIT 1;

    IF v_card.id IS NULL THEN
        INSERT INTO public.cards (
            tenant_id, student_id, card_number, card_type, status, issued_at
        ) VALUES (
            v_student.tenant_id,
            v_student.id,
            'DIG-' || to_char(now(), 'YYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 8)),
            'digital',
            'active',
            now()
        )
        RETURNING * INTO v_card;
    ELSIF v_card.status <> 'active' THEN
        RAISE EXCEPTION 'CARD_INACTIVE: A carteirinha esta inativa. Procure a administracao para nova emissao.';
    END IF;

    RETURN to_jsonb(v_card);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_digital_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_digital_card() TO authenticated;

-- Um bolsista integral pode manter saldo residual por exigência contábil, mas
-- não pode acessar saldo, extrato, pagamentos ou recargas no portal/API.
DROP POLICY IF EXISTS sel_wallets_student ON public.wallets;
CREATE POLICY sel_wallets_student ON public.wallets
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1
          FROM public.students AS student
          JOIN public.student_categories AS category
            ON category.id = student.category_id
           AND category.tenant_id = student.tenant_id
         WHERE student.id = wallets.student_id
           AND student.user_id = auth.uid()
           AND student.tenant_id = wallets.tenant_id
           AND student.status = 'active'
           AND category.requires_wallet = true
    )
);

DROP POLICY IF EXISTS sel_wallet_tx_student ON public.wallet_transactions;
CREATE POLICY sel_wallet_tx_student ON public.wallet_transactions
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1
          FROM public.students AS student
          JOIN public.student_categories AS category
            ON category.id = student.category_id
           AND category.tenant_id = student.tenant_id
         WHERE student.id = wallet_transactions.student_id
           AND student.user_id = auth.uid()
           AND student.tenant_id = wallet_transactions.tenant_id
           AND student.status = 'active'
           AND category.requires_wallet = true
    )
);

DROP POLICY IF EXISTS sel_payments_student ON public.payments;
CREATE POLICY sel_payments_student ON public.payments
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1
          FROM public.students AS student
          JOIN public.student_categories AS category
            ON category.id = student.category_id
           AND category.tenant_id = student.tenant_id
         WHERE student.id = payments.student_id
           AND student.user_id = auth.uid()
           AND student.tenant_id = payments.tenant_id
           AND student.status = 'active'
           AND category.requires_wallet = true
    )
);

DROP POLICY IF EXISTS sel_recharges_student ON public.recharges;
CREATE POLICY sel_recharges_student ON public.recharges
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND EXISTS (
        SELECT 1
          FROM public.students AS student
          JOIN public.student_categories AS category
            ON category.id = student.category_id
           AND category.tenant_id = student.tenant_id
         WHERE student.id = recharges.student_id
           AND student.user_id = auth.uid()
           AND student.tenant_id = recharges.tenant_id
           AND student.status = 'active'
           AND category.requires_wallet = true
    )
);

-- Ativa eventos em tempo real usados pelo PWA. O bloco é idempotente para
-- ambientes nos quais alguma tabela já pertença à publicação.
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['meal_consumptions', 'wallet_transactions', 'payments']
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
        END IF;
    END LOOP;
END;
$$;

COMMENT ON TABLE public.consumer_preferences IS
'Preferencias do PWA do consumidor para notificacoes e alerta de saldo baixo.';
