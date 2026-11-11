-- ==============================================================================
-- MIGRATION 83: SPRINT 20 (ETAPA 20.6) — PERSISTÊNCIA E IDEMPOTÊNCIA DE FECHAMENTO DIÁRIO
-- Data: 2026-11-10
-- Objetivos:
--   1. Garantir unicidade idempotente também para fechamentos consolidados (unit_id IS NULL).
--   2. Expor RPC SECURITY DEFINER public.close_financial_daily_period com:
--      - Validação estrita de autenticação, perfil ativo e tenant_id (fail-closed)
--      - Proibição explícita de mutações automáticas/retroativas em wallets ou wallet_transactions
--      - Segregação contábil preservada (recebimentos brutos, custódia, receita realizada e subsídios)
--      - Registro de auditoria com closed_by, timestamp e justificativa obrigatória
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_closing_tenant_date_consolidated
  ON public.financial_daily_closings (tenant_id, closing_date)
  WHERE unit_id IS NULL;

CREATE OR REPLACE FUNCTION public.close_financial_daily_period(
  p_tenant_id UUID,
  p_closing_date DATE,
  p_unit_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_profile RECORD;
  v_today_br DATE;
  v_notes TEXT;
  v_pix_receipts NUMERIC(14,2) := 0.00;
  v_card_receipts NUMERIC(14,2) := 0.00;
  v_cash_receipts NUMERIC(14,2) := 0.00;
  v_total_receipts NUMERIC(14,2) := 0.00;
  v_wallet_credits NUMERIC(14,2) := 0.00;
  v_wallet_debits NUMERIC(14,2) := 0.00;
  v_closing_custody NUMERIC(14,2) := 0.00;
  v_ledger_net NUMERIC(14,2) := 0.00;
  v_custody_drift NUMERIC(14,2) := 0.00;
  v_student_revenue NUMERIC(14,2) := 0.00;
  v_contract_subsidies NUMERIC(14,2) := 0.00;
  v_contingency_subsidies NUMERIC(14,2) := 0.00;
  v_refunds_amount NUMERIC(14,2) := 0.00;
  v_unresolved_divs INT := 0;
  v_health_status TEXT;
  v_closing_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação obrigatória para fechar período financeiro.';
  END IF;

  SELECT id, tenant_id, role, status
    INTO v_profile
    FROM public.profiles
   WHERE id = v_uid
   LIMIT 1;

  IF NOT FOUND OR v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED: Perfil ativo não encontrado ou inativo.';
  END IF;

  IF v_profile.role NOT IN ('admin_general', 'operations_director', 'finance') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Papel % não autorizado a consolidar fechamento diário.', v_profile.role;
  END IF;

  IF v_profile.tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Acesso negado para consolidar fechamento de outro tenant.';
  END IF;

  IF p_closing_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_CLOSING_DATE: Data de fechamento obrigatória.';
  END IF;

  v_today_br := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF p_closing_date > v_today_br THEN
    RAISE EXCEPTION 'INVALID_CLOSING_DATE: Não é permitido fechar data futura (%).', p_closing_date;
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  IF v_notes IS NULL OR char_length(v_notes) < 5 THEN
    RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: Informe justificativa ou observação de conferência (mínimo 5 caracteres).';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.units u
       WHERE u.id = p_unit_id
         AND u.tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'UNIT_TENANT_MISMATCH: Unidade informada não pertence ao tenant autenticado.';
    END IF;
  END IF;

  -- Serialização transacional para concorrência no mesmo tenant/data/escopo
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      p_tenant_id::text || '|daily_closing|' || p_closing_date::text || '|' || COALESCE(p_unit_id::text, 'consolidated')
    )
  );

  -- Trava idempotente contra fechamento duplicado na mesma data/escopo
  IF EXISTS (
    SELECT 1
      FROM public.financial_daily_closings fdc
     WHERE fdc.tenant_id = p_tenant_id
       AND fdc.closing_date = p_closing_date
       AND (
         (p_unit_id IS NULL AND fdc.unit_id IS NULL)
         OR (p_unit_id IS NOT NULL AND fdc.unit_id = p_unit_id)
       )
  ) THEN
    RAISE EXCEPTION 'DAILY_CLOSING_ALREADY_EXISTS: O fechamento de % já foi persistido para este escopo.', p_closing_date;
  END IF;

  -- 1. Entradas brutas confirmadas por meio de pagamento na data (escopo tenant)
  SELECT
    COALESCE(SUM(CASE WHEN p.method = 'pix' THEN p.amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN p.method NOT IN ('pix', 'cash') THEN p.amount ELSE 0 END), 0.00)
  INTO v_pix_receipts, v_cash_receipts, v_card_receipts
  FROM public.payments p
  WHERE p.tenant_id = p_tenant_id
    AND p.status = 'confirmed'
    AND (COALESCE(p.confirmed_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = p_closing_date;

  v_total_receipts := ROUND(v_pix_receipts + v_card_receipts + v_cash_receipts, 2);

  -- 2. Movimentação real de custódia no livro-razão na data
  SELECT
    COALESCE(SUM(CASE WHEN wt.amount > 0 THEN wt.amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN wt.amount < 0 THEN ABS(wt.amount) ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN wt.type = 'refund' THEN ABS(wt.amount) ELSE 0 END), 0.00)
  INTO v_wallet_credits, v_wallet_debits, v_refunds_amount
  FROM public.wallet_transactions wt
  WHERE wt.tenant_id = p_tenant_id
    AND (wt.created_at AT TIME ZONE 'America/Sao_Paulo')::date = p_closing_date;

  -- 3. Batimento patrimonial instantâneo (wallets.balance vs SUM ledger) sem mutações
  SELECT COALESCE(SUM(w.balance), 0.00)
    INTO v_closing_custody
    FROM public.wallets w
   WHERE w.tenant_id = p_tenant_id;

  SELECT COALESCE(SUM(wt.amount), 0.00)
    INTO v_ledger_net
    FROM public.wallet_transactions wt
   WHERE wt.tenant_id = p_tenant_id;

  v_custody_drift := ROUND(v_closing_custody - v_ledger_net, 2);

  -- 4. Receita realizada de alunos e subsídios contratuais no dia (com filtro opcional de unidade)
  SELECT
    COALESCE(SUM(mc.student_price), 0.00),
    COALESCE(SUM(mc.subsidy_amount), 0.00)
  INTO v_student_revenue, v_contract_subsidies
  FROM public.meal_consumptions mc
  WHERE mc.tenant_id = p_tenant_id
    AND mc.consumption_date = p_closing_date
    AND mc.status IN ('approved', 'financially_refunded')
    AND (p_unit_id IS NULL OR mc.unit_id = p_unit_id);

  -- 5. Subsídios aprovados de contingência na data (com filtro opcional de unidade)
  SELECT COALESCE(SUM(cb.total_subsidy_amount), 0.00)
    INTO v_contingency_subsidies
    FROM public.contingency_meal_batches cb
   WHERE cb.tenant_id = p_tenant_id
     AND cb.service_date = p_closing_date
     AND cb.status = 'approved'
     AND (p_unit_id IS NULL OR cb.unit_id = p_unit_id);

  -- 6. Divergências em aberto do tenant no momento do fechamento
  SELECT COUNT(*)::INT
    INTO v_unresolved_divs
    FROM public.financial_reconciliation_divergences frd
   WHERE frd.tenant_id = p_tenant_id
     AND frd.status = 'open';

  v_health_status := CASE
    WHEN v_unresolved_divs > 0 OR ABS(v_custody_drift) > 0.009 THEN 'divergent'
    ELSE 'balanced'
  END;

  BEGIN
    INSERT INTO public.financial_daily_closings (
      tenant_id,
      unit_id,
      closing_date,
      pix_receipts_amount,
      card_receipts_amount,
      cash_receipts_amount,
      total_receipts_by_method,
      wallet_credits_added,
      wallet_debits_consumed,
      closing_custody_balance,
      custody_ledger_drift,
      realized_student_revenue,
      contractual_subsidies,
      contingency_subsidies,
      refunds_amount,
      unresolved_divergences_count,
      status,
      closed_by,
      metadata
    ) VALUES (
      p_tenant_id,
      p_unit_id,
      p_closing_date,
      ROUND(v_pix_receipts, 2),
      ROUND(v_card_receipts, 2),
      ROUND(v_cash_receipts, 2),
      v_total_receipts,
      ROUND(v_wallet_credits, 2),
      ROUND(v_wallet_debits, 2),
      ROUND(v_closing_custody, 2),
      v_custody_drift,
      ROUND(v_student_revenue, 2),
      ROUND(v_contract_subsidies, 2),
      ROUND(v_contingency_subsidies, 2),
      ROUND(v_refunds_amount, 2),
      v_unresolved_divs,
      'closed',
      v_uid,
      jsonb_build_object(
        'notes', v_notes,
        'health_status', v_health_status,
        'scope', CASE WHEN p_unit_id IS NULL THEN 'consolidated' ELSE 'unit' END,
        'receipts_and_custody_scope', 'tenant',
        'closed_at', now(),
        'closed_by_role', v_profile.role
      )
    )
    RETURNING id INTO v_closing_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DAILY_CLOSING_ALREADY_EXISTS: O fechamento de % já foi persistido para este escopo.', p_closing_date;
  END;

  RETURN jsonb_build_object(
    'id', v_closing_id,
    'closing_date', p_closing_date,
    'unit_id', p_unit_id,
    'status', 'closed',
    'health_status', v_health_status,
    'unresolved_divergences_count', v_unresolved_divs,
    'custody_ledger_drift', v_custody_drift,
    'closed_by', v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_financial_daily_period(UUID, DATE, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_financial_daily_period(UUID, DATE, UUID, TEXT) TO authenticated, service_role;

-- Proteção de imutabilidade estrita (append-only) para registros de fechamento diário
CREATE OR REPLACE FUNCTION public.prevent_financial_daily_closing_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_DAILY_CLOSING: Registros de financial_daily_closings são imutáveis e não permitem %.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_financial_daily_closing_mutation ON public.financial_daily_closings;
CREATE TRIGGER trg_prevent_financial_daily_closing_mutation
  BEFORE UPDATE OR DELETE ON public.financial_daily_closings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_daily_closing_mutation();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.financial_daily_closings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_daily_closings TO authenticated;
GRANT ALL ON public.financial_daily_closings TO service_role;

