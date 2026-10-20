const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function exportMigration31() {
  await client.connect();

  const fnDef = await client.query(`
    SELECT pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reconcile_offline_consumptions';
  `);

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offline_contingency_events'
    ORDER BY ordinal_position;
  `);

  console.log('Colunas de offline_contingency_events:', cols.rows.map(c => c.column_name));
  console.log('Function def length:', fnDef.rows[0]?.def.length);

  const fullSql = `-- ==============================================================================
-- Migration: 20260927000031_create_offline_contingency_tables_and_rpc.sql
-- Descrição: Tabela imutável de contingência offline e RPC reconciliadora
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.offline_contingency_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL,
    terminal_id TEXT NOT NULL,
    operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    registration_attempted TEXT NOT NULL,
    meal_type_id UUID NOT NULL REFERENCES public.meal_types(id) ON DELETE RESTRICT,
    device_timestamp TIMESTAMPTZ NOT NULL,
    sequence_num BIGINT NOT NULL,
    idempotency_key TEXT NOT NULL,
    previous_event_hash TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reconciled_at TIMESTAMPTZ,
    consumption_id UUID REFERENCES public.meal_consumptions(id) ON DELETE SET NULL,
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
    reconciliation_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_offline_events_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT chk_offline_events_status CHECK (status IN ('pending', 'confirmed_regular', 'conflict_duplicate', 'pending_administrative_review', 'failed_irrecoverable'))
);

CREATE INDEX IF NOT EXISTS idx_offline_events_tenant_terminal ON public.offline_contingency_events(tenant_id, terminal_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_offline_events_student_date ON public.offline_contingency_events(tenant_id, student_id, device_timestamp);
CREATE INDEX IF NOT EXISTS idx_offline_events_status ON public.offline_contingency_events(tenant_id, status);

ALTER TABLE public.offline_contingency_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_offline_events_staff ON public.offline_contingency_events;
CREATE POLICY sel_offline_events_staff ON public.offline_contingency_events
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'supervisor', 'unit_manager', 'operator')
);

${fnDef.rows[0]?.def || ''};

REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_consumptions(JSONB) TO authenticated;
`;

  fs.writeFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260927000031_create_offline_contingency_tables_and_rpc.sql'),
    fullSql,
    'utf8'
  );

  console.log('Migration 31 populada com sucesso a partir da base oficial!');
  await client.end();
}

exportMigration31().catch(console.error);
