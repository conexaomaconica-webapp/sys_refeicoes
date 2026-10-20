-- Sprint 11 security hardening.
-- Supabase grants EXECUTE to anon explicitly when functions are created.
-- The RPCs also validate auth.uid(), tenant and role internally, but anonymous
-- execution is revoked explicitly as defense in depth.

REVOKE ALL ON FUNCTION public.stage_import_batch(
    UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.stage_import_batch_v2(
    UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.confirm_and_process_import(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_import(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.stage_import_batch(
    UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.stage_import_batch_v2(
    UUID, public.import_mode, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, BOOLEAN, JSONB, DATE
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_and_process_import(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_import(UUID) TO authenticated;
