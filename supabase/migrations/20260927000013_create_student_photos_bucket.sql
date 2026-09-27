-- ==============================================================================
-- Migration: 20260927000013_create_student_photos_bucket.sql
-- Descrição: Provisionamento idempotente do bucket privado student-photos no Supabase Storage
--            com restrições de tamanho (2MB) e tipos MIME (JPEG, PNG, WebP).
-- ==============================================================================

-- 1. Inserir ou atualizar a configuração do bucket privado student-photos em storage.buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'student-photos',
    'student-photos',
    false,
    2097152, -- Limite de 2 MB em bytes
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2. Política RLS em storage.objects para leitura segura por tenant
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'sel_student_photos_storage'
    ) THEN
        CREATE POLICY sel_student_photos_storage ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'student-photos'
            AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
            AND public.get_auth_user_status() = 'active'
        );
    END IF;
END $$;
