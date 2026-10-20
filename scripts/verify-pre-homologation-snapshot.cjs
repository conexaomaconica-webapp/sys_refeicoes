const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!match) {
  throw new Error('SUPABASE_DB_URL nao configurada.');
}

const snapshotSchema = 'backup_pre_homologacao_20261019';
const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');

  try {
    const state = await client.query(
      `SELECT to_regnamespace($1) IS NOT NULL AS schema_exists,
              (SELECT count(*)::integer
                 FROM information_schema.tables
                WHERE table_schema = $1) AS tables_including_manifest,
              has_schema_privilege('anon', $1, 'USAGE') AS anon_has_usage,
              has_schema_privilege('authenticated', $1, 'USAGE') AS authenticated_has_usage`,
      [snapshotSchema],
    );
    const manifest = await client.query(`
      SELECT count(*)::integer AS copied_tables,
             coalesce(sum(snapshot_rows), 0)::bigint AS copied_rows,
             bool_and(source_rows = snapshot_rows) AS counts_match
        FROM backup_pre_homologacao_20261019.snapshot_manifest
    `);

    console.log('Estado:', state.rows[0]);
    console.log('Manifesto:', manifest.rows[0]);

    const valid =
      state.rows[0].schema_exists === true &&
      state.rows[0].tables_including_manifest === 26 &&
      state.rows[0].anon_has_usage === false &&
      state.rows[0].authenticated_has_usage === false &&
      manifest.rows[0].copied_tables === 25 &&
      manifest.rows[0].copied_rows === '5352' &&
      manifest.rows[0].counts_match === true;

    if (!valid) {
      throw new Error('A verificacao do snapshot nao atingiu os valores esperados.');
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  const details = error?.stack || error?.message || JSON.stringify(error);
  console.error(`Falha ao verificar snapshot: ${details}`);
  process.exit(1);
});
