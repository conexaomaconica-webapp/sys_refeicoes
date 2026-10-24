-- Primeiro acesso seguro do consumidor a partir de uma listagem oficial.
-- O manifesto operacional persiste somente HMAC e last4. O arquivo-fonte,
-- que pode conter CPF, permanece no bucket privado de importações.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS cpf_lookup_hash TEXT,
    ADD COLUMN IF NOT EXISTS cpf_last4 TEXT,
    ADD COLUMN IF NOT EXISTS first_access_status TEXT NOT NULL DEFAULT 'unavailable',
    ADD COLUMN IF NOT EXISTS first_access_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumer_activated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_students_cpf_last4'
           AND conrelid = 'public.students'::regclass
    ) THEN
        ALTER TABLE public.students
            ADD CONSTRAINT chk_students_cpf_last4
            CHECK (cpf_last4 IS NULL OR cpf_last4 ~ '^[0-9]{4}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_students_first_access_status'
           AND conrelid = 'public.students'::regclass
    ) THEN
        ALTER TABLE public.students
            ADD CONSTRAINT chk_students_first_access_status
            CHECK (first_access_status IN (
                'unavailable', 'eligible', 'pending_review', 'invited', 'active', 'disabled'
            ));
    END IF;
END $$;

UPDATE public.students
   SET first_access_status = CASE
       WHEN user_id IS NOT NULL THEN 'active'
       WHEN cpf_lookup_hash IS NOT NULL THEN 'eligible'
       ELSE 'unavailable'
   END
 WHERE first_access_status = 'unavailable';

CREATE INDEX IF NOT EXISTS idx_students_first_access_lookup
    ON public.students (tenant_id, institution_id, registration_number, cpf_lookup_hash)
    WHERE cpf_lookup_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_first_access_status
    ON public.students (tenant_id, first_access_status, first_access_requested_at DESC);

CREATE TABLE IF NOT EXISTS public.consumer_first_access_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    institution_id UUID REFERENCES public.institutions(id) ON DELETE RESTRICT,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    request_fingerprint TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_consumer_first_access_outcome CHECK (outcome IN (
        'rejected', 'rate_limited', 'pending_review', 'invited', 'already_linked', 'delivery_failed'
    ))
);

CREATE INDEX IF NOT EXISTS idx_consumer_first_access_attempts_rate
    ON public.consumer_first_access_attempts (request_fingerprint, created_at DESC);

ALTER TABLE public.consumer_first_access_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_first_access_attempts FORCE ROW LEVEL SECURITY;

-- Sincroniza o HMAC do CPF processado no manifesto com o cadastro final dentro
-- da mesma transação da confirmação da importação.
CREATE OR REPLACE FUNCTION public.sync_imported_consumer_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_jwt_sub TEXT;
    v_jwt_claims TEXT;
BEGIN
    IF NEW.status = 'processed'
       AND NEW.student_id IS NOT NULL
       AND NULLIF(NEW.normalized_data->>'cpf_lookup_hash', '') IS NOT NULL THEN
        v_jwt_sub := current_setting('request.jwt.claim.sub', true);
        v_jwt_claims := current_setting('request.jwt.claims', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM set_config('request.jwt.claims', '{}', true);

        UPDATE public.students
           SET cpf_lookup_hash = NEW.normalized_data->>'cpf_lookup_hash',
               cpf_last4 = NEW.normalized_data->>'cpf_last4',
               first_access_status = CASE
                   WHEN user_id IS NOT NULL THEN 'active'
                   ELSE 'eligible'
               END
         WHERE id = NEW.student_id
           AND tenant_id = NEW.tenant_id;

        PERFORM set_config('request.jwt.claim.sub', COALESCE(v_jwt_sub, ''), true);
        PERFORM set_config('request.jwt.claims', COALESCE(v_jwt_claims, '{}'), true);
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_jwt_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_jwt_claims, '{}'), true);
    RAISE;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_rows_consumer_identity ON public.import_rows;
CREATE TRIGGER trg_import_rows_consumer_identity
AFTER INSERT OR UPDATE OF status, student_id, normalized_data ON public.import_rows
FOR EACH ROW EXECUTE FUNCTION public.sync_imported_consumer_identity();

-- Atualiza a whitelist defensiva para incluir explicitamente os novos campos
-- protegidos. O próprio consumidor continua podendo alterar somente contatos.
CREATE OR REPLACE FUNCTION public.trg_prevent_student_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
           NEW.institution_id IS DISTINCT FROM OLD.institution_id OR
           NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.category_id IS DISTINCT FROM OLD.category_id OR
           NEW.registration_number IS DISTINCT FROM OLD.registration_number OR
           NEW.full_name IS DISTINCT FROM OLD.full_name OR
           NEW.course IS DISTINCT FROM OLD.course OR
           NEW.photo_path IS DISTINCT FROM OLD.photo_path OR
           NEW.status IS DISTINCT FROM OLD.status OR
           NEW.cpf_lookup_hash IS DISTINCT FROM OLD.cpf_lookup_hash OR
           NEW.cpf_last4 IS DISTINCT FROM OLD.cpf_last4 OR
           NEW.first_access_status IS DISTINCT FROM OLD.first_access_status OR
           NEW.first_access_requested_at IS DISTINCT FROM OLD.first_access_requested_at OR
           NEW.consumer_activated_at IS DISTINCT FROM OLD.consumer_activated_at OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Ação não autorizada: consumidores só podem atualizar diretamente e-mail e telefone.'
            USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.students.cpf_lookup_hash IS
    'HMAC-SHA256 determinístico do CPF, calculado exclusivamente no servidor para primeiro acesso.';
COMMENT ON COLUMN public.students.cpf_last4 IS
    'Quatro últimos dígitos para suporte mascarado; nunca usado isoladamente como autenticação.';
COMMENT ON TABLE public.consumer_first_access_attempts IS
    'Trilha mínima e sem CPF/matrícula em claro para rate limit e auditoria do primeiro acesso.';

NOTIFY pgrst, 'reload schema';
