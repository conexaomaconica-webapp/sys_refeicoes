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
const sourceTables = [
  'tenants',
  'tenant_branding',
  'institutions',
  'units',
  'profiles',
  'user_unit_access',
  'user_institution_access',
  'student_categories',
  'students',
  'meal_types',
  'unit_meal_types',
  'meal_rules',
  'wallets',
  'wallet_transactions',
  'payment_providers',
  'payments',
  'recharges',
  'payment_webhook_events',
  'cards',
  'qr_tokens',
  'meal_consumptions',
  'blocked_attempts',
  'cash_shifts',
  'cash_movements',
  'offline_contingency_events',
];

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

  try {
    const existingSchema = await client.query(
      'SELECT 1 FROM pg_namespace WHERE nspname = $1',
      [snapshotSchema],
    );

    if (existingSchema.rowCount > 0) {
      throw new Error(`O schema ${snapshotSchema} ja existe; nada foi sobrescrito.`);
    }

    const existingTables = await client.query(
      `SELECT c.relname AS table_name,
              pg_total_relation_size(c.oid)::bigint AS source_total_bytes
         FROM pg_class AS c
         JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [sourceTables],
    );

    const tableMetadata = new Map(
      existingTables.rows.map((row) => [row.table_name, row]),
    );
    const missingTables = sourceTables.filter((table) => !tableMetadata.has(table));

    if (missingTables.length > 0) {
      throw new Error(`Tabelas ausentes: ${missingTables.join(', ')}`);
    }

    const quotedSchema = quoteIdentifier(snapshotSchema);
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`REVOKE ALL ON SCHEMA ${quotedSchema} FROM PUBLIC, anon, authenticated`);
    await client.query(`COMMENT ON SCHEMA ${quotedSchema} IS 'Snapshot interno pre-homologacao criado em 2026-10-19; nao substitui backup externo.'`);
    await client.query(`
      CREATE TABLE ${quotedSchema}.snapshot_manifest (
        table_name text PRIMARY KEY,
        source_rows bigint NOT NULL,
        snapshot_rows bigint NOT NULL,
        source_total_bytes bigint NOT NULL,
        snapshot_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const manifest = [];
    for (const table of sourceTables) {
      const quotedTable = quoteIdentifier(table);
      const sourceCount = await client.query(
        `SELECT count(*)::bigint AS row_count FROM public.${quotedTable}`,
      );

      await client.query(
        `CREATE TABLE ${quotedSchema}.${quotedTable} AS TABLE public.${quotedTable} WITH DATA`,
      );

      const snapshotCount = await client.query(
        `SELECT count(*)::bigint AS row_count FROM ${quotedSchema}.${quotedTable}`,
      );
      const sourceRows = sourceCount.rows[0].row_count;
      const snapshotRows = snapshotCount.rows[0].row_count;

      if (sourceRows !== snapshotRows) {
        throw new Error(
          `Contagem divergente em ${table}: origem=${sourceRows}, copia=${snapshotRows}`,
        );
      }

      const sourceTotalBytes = tableMetadata.get(table).source_total_bytes;
      await client.query(
        `INSERT INTO ${quotedSchema}.snapshot_manifest
           (table_name, source_rows, snapshot_rows, source_total_bytes)
         VALUES ($1, $2, $3, $4)`,
        [table, sourceRows, snapshotRows, sourceTotalBytes],
      );

      manifest.push({
        table: table,
        rows: Number(snapshotRows),
        sourceTotalBytes: Number(sourceTotalBytes),
      });
    }

    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quotedSchema} FROM PUBLIC, anon, authenticated`,
    );
    await client.query('COMMIT');

    const verification = await client.query(
      `SELECT count(*)::integer AS copied_tables,
              coalesce(sum(snapshot_rows), 0)::bigint AS copied_rows
         FROM ${quotedSchema}.snapshot_manifest`,
    );

    console.log(`Snapshot criado: ${snapshotSchema}`);
    console.log(`Tabelas copiadas: ${verification.rows[0].copied_tables}`);
    console.log(`Linhas copiadas: ${verification.rows[0].copied_rows}`);
    console.log('Manifesto:');
    for (const item of manifest) {
      console.log(`  ${item.table}: ${item.rows} linhas`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const details = error?.stack || error?.message || JSON.stringify(error);
  console.error(`Falha ao criar snapshot: ${details}`);
  process.exit(1);
});
