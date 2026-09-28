-- ==============================================================================
-- Migration: 20260927000018_create_import_files_bucket.sql
-- Descrição: Criação do bucket privado 'import-files' com RLS ativado e sem acesso
--            direto client-side (operações restritas ao contexto server-side).
-- ==============================================================================

-- 1. Inserção idempotente do bucket privado
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'import-files',
    'import-files',
    FALSE, -- Bucket 100% privado
    10485760, -- Limite de 10 MB (10 * 1024 * 1024)
    ARRAY[
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- .xlsx
        'text/csv', -- .csv
        'application/csv',
        'text/plain'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Garantir RLS ativado na tabela storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- NENHUMA policy de INSERT, UPDATE ou DELETE é concedida ao papel 'authenticated' no bucket 'import-files'.
-- Os uploads são realizados server-side, garantindo que usuários do browser não gravem arquivos arbitrários.
