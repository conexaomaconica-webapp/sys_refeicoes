-- Sprint 11: reconcilia drift do bucket privado de arquivos de importacao.
-- A migration 18 consta no historico remoto, mas o bucket estava ausente.

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'import-files',
    'import-files',
    FALSE,
    10485760,
    ARRAY[
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/csv',
        'text/plain'
    ]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- storage.objects ja possui RLS gerenciado pelo Supabase. Esta migration nao
-- altera a seguranca da tabela interna; apenas reconcilia o bucket privado.
