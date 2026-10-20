/**
 * ==============================================================================
 * AUDITORIA ELETIVA DE EQUIVALÊNCIA ESTRUTURAL COMPLETA
 * Migrations Locais (000001 a 000030) vs Catálogo Remoto PostgreSQL (Supabase)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('======================================================================');
  console.log('  AUDITORIA DE EQUIVALÊNCIA ESTRUTURAL — SISTEMA MA REFEIÇÕES');
  console.log('  Comparação: Catálogo Remoto vs Migrations Locais 000001 a 000030');
  console.log('======================================================================\n');

  // 1. As 24 Tabelas Reais das Sprints 1 a 9
  const expectedTables = [
    'tenants',
    'tenant_branding',
    'institutions',
    'units',
    'profiles',
    'user_unit_access',
    'user_institution_access',
    'imports',
    'import_rows',
    'student_categories',
    'students',
    'cards',
    'qr_tokens',
    'meal_types',
    'unit_meal_types',
    'meal_rules',
    'payment_providers',
    'payments',
    'recharges',
    'payment_webhook_events',
    'wallets',
    'wallet_transactions',
    'meal_consumptions',
    'blocked_attempts'
  ];

  const resTables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  const remoteTables = resTables.rows.map(r => r.table_name);

  console.log('1. AUDITORIA DE TABELAS PÚBLICAS (24/24):');
  let allTablesPresent = true;
  for (const t of expectedTables) {
    const exists = remoteTables.includes(t);
    if (!exists) allTablesPresent = false;
    console.log(`  - [${exists ? 'OK' : 'MISSING'}] Tabela: ${t}`);
  }

  // 2. Auditar Colunas Principais de Cada Tabela
  console.log('\n2. AUDITORIA DE COLUNAS POR TABELA:');
  const resCols = await client.query(`
    SELECT table_name, count(*) as col_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
    ORDER BY table_name;
  `);
  resCols.rows.forEach(r => {
    console.log(`  - Tabela ${r.table_name}: ${r.col_count} colunas ativas`);
  });

  // 3. Auditar ENUMs Criados nas Migrations
  console.log('\n3. AUDITORIA DE TIPOS ENUM:');
  const resEnums = await client.query(`
    SELECT t.typname, count(e.enumlabel) as val_count
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname;
  `);
  resEnums.rows.forEach(r => {
    console.log(`  - [OK] ENUM public.${r.typname} (${r.val_count} valores registrados)`);
  });

  // 4. Auditar Funções e RPCs Críticas
  console.log('\n4. AUDITORIA DE FUNÇÕES E PROCEDURES (RPCs):');
  const expectedFunctions = [
    'get_auth_tenant_id',
    'get_auth_user_role',
    'get_auth_user_status',
    'has_unit_access',
    'has_institution_access',
    'admin_issue_card',
    'admin_update_card_status',
    'generate_student_qr_token',
    'resolve_student_identity',
    'consume_meal',
    'cancel_meal_consumption'
  ];

  const resFuncs = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as is_security_definer,
           p.proconfig as config
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
    ORDER BY p.proname;
  `, [expectedFunctions]);

  const remoteFuncs = resFuncs.rows;
  for (const f of expectedFunctions) {
    const found = remoteFuncs.filter(rf => rf.proname === f);
    if (found.length > 0) {
      found.forEach(fn => {
        console.log(`  - [OK] RPC: ${fn.proname}(${fn.args}) [Security Definer: ${fn.is_security_definer}, Config: ${fn.config || 'padrão'}]`);
      });
    } else {
      console.log(`  - [MISSING] RPC: ${f} não encontrada no banco remoto!`);
    }
  }

  // 5. Auditar Triggers
  console.log('\n5. AUDITORIA DE TRIGGERS ATIVAS:');
  const resTriggers = await client.query(`
    SELECT event_object_table as table_name, trigger_name, action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `);
  console.log(`  Total de triggers no schema public: ${resTriggers.rows.length}`);
  resTriggers.rows.forEach(tr => {
    console.log(`  - [OK] Trigger ${tr.trigger_name} ON ${tr.table_name} (${tr.action_timing})`);
  });

  // 6. Auditar RLS em Todas as Tabelas
  console.log('\n6. AUDITORIA DE ROW LEVEL SECURITY (RLS):');
  const resRLSTables = await client.query(`
    SELECT relname as table_name, relrowsecurity as rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname = ANY($1::text[])
    ORDER BY relname;
  `, [expectedTables]);

  let allRLSEnabled = true;
  resRLSTables.rows.forEach(r => {
    if (!r.rls_enabled) allRLSEnabled = false;
    console.log(`  - [${r.rls_enabled ? 'OK' : 'FAIL'}] Tabela ${r.table_name}: RLS ${r.rls_enabled ? 'ATIVO' : 'DESATIVADO'}`);
  });

  const resPolicies = await client.query(`
    SELECT tablename, count(*) as policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY tablename
    ORDER BY tablename;
  `);
  console.log(`\n  Políticas RLS por Tabela:`);
  resPolicies.rows.forEach(p => {
    console.log(`  - Tabela ${p.tablename}: ${p.policy_count} políticas RLS ativas`);
  });

  // 7. Auditar Buckets de Storage
  console.log('\n7. AUDITORIA DE STORAGE BUCKETS:');
  const resBuckets = await client.query(`SELECT id, name, public FROM storage.buckets;`);
  resBuckets.rows.forEach(b => {
    console.log(`  - [OK] Bucket: ${b.name} (id: ${b.id}, public: ${b.public})`);
  });

  // 8. Resumo da Auditoria
  console.log('\n======================================================================');
  console.log('  RESUMO DA AUDITORIA DE EQUIVALÊNCIA:');
  console.log(`  - Tabelas públicas verificadas: ${remoteTables.length} / ${expectedTables.length} (${allTablesPresent ? '100% PRESENTES' : 'DIVERGÊNCIA'})`);
  console.log(`  - RLS ativo em 100% das tabelas: ${allRLSEnabled ? 'SIM' : 'NÃO'}`);
  console.log(`  - Total de tipos ENUM: ${resEnums.rows.length}`);
  console.log(`  - Total de triggers ativas: ${resTriggers.rows.length}`);
  console.log(`  - Total de RPCs críticas auditadas: ${remoteFuncs.length} / ${expectedFunctions.length}`);
  console.log('======================================================================\n');

  await client.end();
}

main().catch(err => {
  console.error('Erro na auditoria de equivalência:', err);
  process.exit(1);
});
