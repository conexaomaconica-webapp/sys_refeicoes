-- Etapa 9E.1-A: inventario agregado de capacidade.
-- Somente metadados; nao retorna linhas, identidades ou conteudo operacional.
-- Executar isoladamente no Supabase SQL Editor e copiar apenas o JSON retornado.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '2s';

SELECT jsonb_build_object(
  'serverVersionNum', current_setting('server_version_num')::integer,
  'transactionReadOnly', current_setting('transaction_read_only'),
  'databaseBytes', pg_database_size(current_database()),
  'publicBytes', COALESCE((
    SELECT sum(pg_total_relation_size(class.oid))::bigint
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p', 'm')
  ), 0),
  'authBytes', COALESCE((
    SELECT sum(pg_total_relation_size(class.oid))::bigint
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'auth'
      AND class.relkind IN ('r', 'p', 'm')
  ), 0),
  'storageMetadataBytes', COALESCE((
    SELECT sum(pg_total_relation_size(class.oid))::bigint
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'storage'
      AND class.relkind IN ('r', 'p', 'm')
  ), 0),
  'storageBucketCount', (SELECT count(*)::bigint FROM storage.buckets),
  'storageObjectCount', (SELECT count(*)::bigint FROM storage.objects),
  'storageObjectBytes', (
    SELECT COALESCE(sum(
      CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END
    ), 0)::bigint
    FROM storage.objects
  ),
  'externalExtensions', (
    SELECT COALESCE(jsonb_agg(extension.extname ORDER BY extension.extname), '[]'::jsonb)
    FROM pg_catalog.pg_extension AS extension
    WHERE extension.extname IN ('pg_cron', 'pg_net', 'wrappers')
  )
) AS stage9e1a_capacity_inventory;

ROLLBACK;

