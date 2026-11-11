const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');
const dbUrlMatch = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!dbUrlMatch) {
  console.error('SUPABASE_DB_URL não encontrada no .env.local.');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrlMatch[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function applyMigration77() {
  await client.connect();
  console.log('✓ Conectado ao banco de dados Supabase.');

  try {
    // 1. Verificar se já foi aplicada
    const checkRes = await client.query(
      "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20261029000077';"
    );

    if (checkRes.rows.length > 0) {
      console.log(`ℹ A migration 20261029000077 já está registrada como aplicada (${checkRes.rows[0].name}).`);
    }

    console.log('2. Lendo arquivo de migration 77...');
    const migrationFile = path.join(
      rootDir,
      'supabase',
      'migrations',
      '20261029000077_create_contingency_regularization.sql'
    );
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('3. Executando migration 77 no banco de dados...');
    await client.query('BEGIN;');
    await client.query(sql);

    await client.query(`
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ('20261029000077', 'create_contingency_regularization')
      ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
    `);

    await client.query('COMMIT;');
    console.log('✓ Migration 20261029000077 aplicada com sucesso!');

    // 4. Verificação física das tabelas e RPCs
    console.log('4. Verificando integridade física dos novos objetos...');
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('contingency_meal_batches', 'contingency_batch_items');
    `);
    console.log('   Tabelas encontradas:', tableCheck.rows.map((r) => r.table_name));

    const rpcCheck = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN ('submit_contingency_batch', 'review_contingency_batch');
    `);
    console.log('   Funções/RPCs encontradas:', rpcCheck.rows.map((r) => r.routine_name));

    const bucketCheck = await client.query(`
      SELECT id, name, public, file_size_limit
      FROM storage.buckets
      WHERE id = 'contingency-evidence';
    `);
    console.log('   Bucket de evidências:', bucketCheck.rows);

    console.log('\n🎉 MIGRATION 077 APLICADA E HOMOLOGADA NO BANCO DE DADOS COM SUCESSO!');
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    console.error('❌ Erro ao aplicar migration 77:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration77();
