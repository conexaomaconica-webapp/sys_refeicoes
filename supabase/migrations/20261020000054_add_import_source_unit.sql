-- Identifica a unidade operacional de origem de cada lote de importacao.
-- O cadastro do comensal permanece institucional; a unidade registra a
-- procedencia operacional da listagem sem restringir o local de consumo.

ALTER TABLE public.imports
    ADD COLUMN IF NOT EXISTS unit_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'uq_units_id_institution_tenant'
           AND conrelid = 'public.units'::regclass
    ) THEN
        ALTER TABLE public.units
            ADD CONSTRAINT uq_units_id_institution_tenant
            UNIQUE (id, institution_id, tenant_id);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_imports_unit_institution_tenant'
           AND conrelid = 'public.imports'::regclass
    ) THEN
        ALTER TABLE public.imports
            ADD CONSTRAINT fk_imports_unit_institution_tenant
            FOREIGN KEY (unit_id, institution_id, tenant_id)
            REFERENCES public.units(id, institution_id, tenant_id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_imports_tenant_unit_created
    ON public.imports (tenant_id, unit_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.stage_import_batch_v3(
    p_institution_id UUID,
    p_unit_id UUID,
    p_import_mode public.import_mode,
    p_original_filename TEXT,
    p_storage_path TEXT,
    p_file_hash TEXT,
    p_file_size_bytes BIGINT,
    p_is_official_snapshot BOOLEAN,
    p_force_reimport BOOLEAN,
    p_rows JSONB,
    p_effective_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant_id UUID;
    v_import_id UUID;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();

    IF v_tenant_id IS NULL OR auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario nao autenticado ou sem tenant.' USING ERRCODE = '42501';
    END IF;

    IF public.get_auth_user_role() NOT IN ('admin_general', 'operations_director') THEN
        RAISE EXCEPTION 'Acesso negado para importacao.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.units AS unit
         WHERE unit.id = p_unit_id
           AND unit.institution_id = p_institution_id
           AND unit.tenant_id = v_tenant_id
           AND unit.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Unidade invalida, inativa ou fora da instituicao informada.' USING ERRCODE = '22023';
    END IF;

    v_import_id := public.stage_import_batch_v2(
        p_institution_id,
        p_import_mode,
        p_original_filename,
        p_storage_path,
        p_file_hash,
        p_file_size_bytes,
        p_is_official_snapshot,
        p_force_reimport,
        p_rows,
        p_effective_date
    );

    UPDATE public.imports
       SET unit_id = p_unit_id
     WHERE id = v_import_id
       AND tenant_id = v_tenant_id;

    RETURN v_import_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_import_batch_v3(
    UUID, UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.stage_import_batch_v3(
    UUID, UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE
) TO authenticated;

NOTIFY pgrst, 'reload schema';
