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
