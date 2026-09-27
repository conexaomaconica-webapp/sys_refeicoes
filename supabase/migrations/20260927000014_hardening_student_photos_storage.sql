-- ==============================================================================
-- Migration: 20260927000014_hardening_student_photos_storage.sql
-- Descrição: Hardening estrito do bucket student-photos.
--            Remove qualquer política de SELECT/INSERT/UPDATE/DELETE direto via client.
--            Acesso a fotos e geração de Signed URLs é 100% EXCLUSIVO do servidor (service_role).
-- ==============================================================================

-- 1. Garante que o bucket student-photos é estritamente privado
UPDATE storage.buckets 
SET public = false 
WHERE id = 'student-photos';

-- 2. Revoga qualquer política de acesso direto via client REST em storage.objects para o bucket student-photos
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'sel_student_photos_storage'
    ) THEN
        DROP POLICY sel_student_photos_storage ON storage.objects;
    END IF;
END $$;
