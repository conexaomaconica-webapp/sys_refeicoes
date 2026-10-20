const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!match) throw new Error('SUPABASE_DB_URL não configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migrations = await client.query(
      "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20260927000018', '20261019000051') ORDER BY version",
    );
    const bucket = await client.query(
      "SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'import-files'",
    );
    const objects = await client.query(
      "SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id = 'import-files'",
    );
    const rls = await client.query(
      "SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'objects'",
    );

    console.log('Migrations do bucket:', migrations.rows);
    console.log('Bucket import-files:', bucket.rows);
    console.log('Objetos import-files:', objects.rows[0].count);
    console.log('RLS storage.objects:', rls.rows[0]?.relrowsecurity);

    if (migrations.rowCount !== 2) throw new Error('Migrations 18 e 51 não constam no histórico remoto.');
    if (bucket.rowCount !== 1) throw new Error('Bucket import-files ausente.');

    const row = bucket.rows[0];
    if (row.public !== false) throw new Error('Bucket import-files não está privado.');
    if (Number(row.file_size_limit) !== 10485760) throw new Error('Limite do bucket import-files diverge de 10 MB.');

    const expectedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'text/plain',
    ];
    if (!expectedMimeTypes.every((mime) => row.allowed_mime_types.includes(mime))) {
      throw new Error('Tipos MIME do bucket import-files estão incompletos.');
    }
    if (rls.rows[0]?.relrowsecurity !== true) throw new Error('RLS de storage.objects não está ativo.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
