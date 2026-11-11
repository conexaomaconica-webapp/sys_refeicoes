const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const projectRefPath = path.join(root, 'supabase', '.temp', 'project-ref');
const evidenceDir = path.join(root, 'docs', 'evidence', 'stage9e');

function fail(message) {
  throw new Error(message);
}

function envValue(name) {
  const source = fs.readFileSync(envPath, 'utf8');
  const match = source.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)["']?$`, 'm'));
  return match?.[1]?.trim() || null;
}

function safeConnectionUrl() {
  const raw = envValue('SUPABASE_DB_URL');
  if (!raw) fail('SUPABASE_DB_URL ausente.');
  const parsed = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('Protocolo PostgreSQL obrigatorio.');
  if (!parsed.hostname.endsWith('.supabase.com')) fail('Host fora do dominio Supabase.');
  if (parsed.pathname !== '/postgres') fail('Somente o banco postgres e permitido.');
  const projectRef = fs.readFileSync(projectRefPath, 'utf8').trim();
  const username = decodeURIComponent(parsed.username);
  if (!parsed.hostname.includes(projectRef) && !username.endsWith(`.${projectRef}`)) {
    fail('A URL nao corresponde ao projeto vinculado.');
  }
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

function tlsOptions() {
  const certificatePath = process.env.SUPABASE_SSL_CA_PATH;
  if (!certificatePath) return { rejectUnauthorized: true };
  const resolved = path.resolve(certificatePath);
  if (!fs.existsSync(resolved)) fail('CA TLS configurada nao existe.');
  return { ca: fs.readFileSync(resolved, 'utf8'), rejectUnauthorized: true };
}

async function main() {
  if (process.env.STAGE9E1_ALLOW_REMOTE_READONLY !== 'YES') {
    fail('Janela remota nao habilitada explicitamente.');
  }

  const client = new Client({
    connectionString: safeConnectionUrl(),
    ssl: tlsOptions(),
    application_name: 'ma-refeicoes-stage9e1-readonly-inventory',
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '25s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '40s'");

    const result = await client.query(`
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
        'storageBucketCount', CASE
          WHEN to_regclass('storage.buckets') IS NULL THEN 0
          ELSE (SELECT count(*)::bigint FROM storage.buckets)
        END,
        'storageObjectCount', CASE
          WHEN to_regclass('storage.objects') IS NULL THEN 0
          ELSE (SELECT count(*)::bigint FROM storage.objects)
        END,
        'storageObjectBytes', CASE
          WHEN to_regclass('storage.objects') IS NULL THEN 0
          ELSE (
            SELECT COALESCE(sum(
              CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END
            ), 0)::bigint
            FROM storage.objects
          )
        END,
        'externalExtensions', (
          SELECT COALESCE(jsonb_agg(extension.extname ORDER BY extension.extname), '[]'::jsonb)
          FROM pg_catalog.pg_extension AS extension
          WHERE extension.extname IN ('pg_cron', 'pg_net', 'wrappers')
        )
      ) AS inventory
    `);

    const inventory = result.rows[0]?.inventory;
    if (!inventory || inventory.transactionReadOnly !== 'on') fail('Inventario nao comprovou transacao read-only.');

    const evidence = {
      stage: '9E.1-A',
      collectedAt: new Date().toISOString(),
      source: 'postgresql_metadata_readonly',
      ...inventory,
      operationalRowsRead: false,
      backupAvailabilityVerified: false,
      pitrVerified: false,
    };
    const file = path.join(evidenceDir, 'stage9e1a-sql-capacity-inventory.json');
    fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    console.log('STAGE9E1_SQL_INVENTORY_WRITTEN docs/evidence/stage9e/stage9e1a-sql-capacity-inventory.json');
  } finally {
    if (connected) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
      await client.end().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`STAGE9E1_INVENTORY_ABORTED ${error.message}`);
  process.exitCode = 1;
});

