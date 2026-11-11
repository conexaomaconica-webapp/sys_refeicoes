-- ==============================================================================
-- Migration: 20261110000082_sprint18_performance_indexes.sql
-- Descrição: Índices não-destrutivos de performance e escala operacional (Sprint 18)
-- Alvos:
--   1. Validação de caixa aberto por terminal/operador em cada atendimento (consume_operator_terminal_meal)
--   2. Resumos de turno e dashboard operacional em tempo real (meal_consumptions)
--   3. Lookup de carteira por student_id + tenant_id no débito atômico (consume_meal)
--   4. Janela/expurgo eficiente de sinais realtime (operational_dashboard_signals)
-- ATENÇÃO: Somente CREATE INDEX IF NOT EXISTS não-destrutivo.
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_cash_shifts_open_operator_terminal
    ON public.cash_shifts (unit_id, terminal_id, operator_id, opened_at DESC)
    WHERE status = 'opened';

CREATE INDEX IF NOT EXISTS idx_meal_consumptions_unit_date_meal_status
    ON public.meal_consumptions (unit_id, consumption_date, meal_type_id, status)
    INCLUDE (student_price, full_price, subsidy_amount);

CREATE INDEX IF NOT EXISTS idx_wallets_student_tenant
    ON public.wallets (student_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_ops_signals_emitted_at
    ON public.operational_dashboard_signals (emitted_at);

COMMENT ON INDEX public.idx_cash_shifts_open_operator_terminal IS
    'Acelera verificação de turno de caixa aberto no terminal durante picos de até 40 req/s.';

COMMENT ON INDEX public.idx_meal_consumptions_unit_date_meal_status IS
    'Índice covering parcial para relatórios de turno e agregação do dashboard operacional.';

