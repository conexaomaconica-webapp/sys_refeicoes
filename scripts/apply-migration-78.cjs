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

async function applyMigration78() {
  await client.connect();
  console.log('✓ Conectado ao banco de dados Supabase.');

  try {
    // 1. Verificar se já foi aplicada
    const checkRes = await client.query(
      "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20261109000078';"
    );

    if (checkRes.rows.length > 0) {
      console.log(`ℹ A migration 20261109000078 já está registrada como aplicada (${checkRes.rows[0].name}).`);
    }

    console.log('2. Lendo arquivo de migration 78...');
    const migrationFile = path.join(
      rootDir,
      'supabase',
      'migrations',
      '20261109000078_create_realtime_operational_dashboard.sql'
    );
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('3. Executando migration 78 no banco de dados...');
    await client.query('BEGIN;');
    await client.query(sql);

    await client.query(`
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ('20261109000078', 'create_realtime_operational_dashboard')
      ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
    `);

    await client.query('COMMIT;');
    console.log('✓ Migration 20261109000078 aplicada com sucesso!');

    // 4. Verificação física dos novos índices, RPC e publicação Realtime
    console.log('4. Verificando integridade física dos novos objetos...');

    const rpcCheck = await client.query(`
      SELECT routine_name, routine_type, security_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name = 'get_realtime_operational_dashboard';
    `);
    console.log('   RPC encontrada:', rpcCheck.rows);

    const indexCheck = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('idx_meal_consumptions_dashboard_fast', 'idx_blocked_attempts_dashboard_fast');
    `);
    console.log('   Índices encontrados:', indexCheck.rows.map((r) => `${r.tablename} -> ${r.indexname}`));

    const realtimeCheck = await client.query(`
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename IN ('meal_consumptions', 'blocked_attempts');
    `);
    console.log('   Tabelas no supabase_realtime:', realtimeCheck.rows.map((r) => r.tablename));

    console.log('\n🎉 MIGRATION 078 APLICADA E HOMOLOGADA NO BANCO DE DADOS COM SUCESSO!');
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    console.error('❌ Erro ao aplicar migration 78:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration78();

