/**
 * Auditoria Completa e Profunda do Estado Real do Banco Remoto Supabase
 * Executa apenas queries de leitura direta para inspecionar:
 * - Contagens exatas de linhas (todas as tabelas)
 * - Tabelas de migrations
 * - Usuários auth.users
 * - Storage buckets e objects
 * - Funções (RPCs), Triggers, Policies (RLS) e Constraints
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const envContent = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrlMatch = envContent.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)["']?/);

if (!dbUrlMatch) {
  console.error('SUPABASE_DB_URL não encontrada no .env.local');
  process.exit(1);
}

const rawUrl = dbUrlMatch[1].trim();
// Remover sslmode query param para que a config ssl de rejectUnauthorized tenha precedência
const cleanUrl = rawUrl.replace(/\?sslmode=.*/, '');

async function runDeepAudit() {
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('======================================================================');
    console.log('  AUDITORIA PROFUNDA DO BANCO REMOTO SUPABASE');
    console.log('======================================================================\n');

    // 1. Contagens Reais das 24 Tabelas Públicas
    console.log('1. Contagem Exata de Linhas por Tabela Pública:');
    const tables = [
      'tenants', 'tenant_branding', 'institutions', 'units',
      'user_institution_access', 'user_unit_access', 'profiles',
      'student_categories', 'students', 'imports', 'import_rows',
      'meal_types', 'unit_meal_types', 'meal_rules', 'wallets',
      'wallet_transactions', 'payment_providers', 'payments',
      'recharges', 'payment_webhook_events', 'cards', 'qr_tokens',
      'meal_consumptions', 'blocked_attempts'
    ];

    let totalRowsAllTables = 0;
    for (const t of tables) {
      try {
        const res = await client.query(`SELECT count(*)::bigint as total FROM public."${t}"`);
        const count = parseInt(res.rows[0].total, 10);
        totalRowsAllTables += count;
        console.log(`  - public.${t.padEnd(25)}: ${count} registros`);
      } catch (err) {
        console.log(`  - public.${t.padEnd(25)}: [TABELA NÃO ENCONTRADA / ERRO: ${err.message}]`);
      }
    }
    console.log(`  --> TOTAL DE REGISTROS PÚBLICOS: ${totalRowsAllTables}`);

    // 2. Histórico de Migrations no Banco
    console.log('\n2. Tabela de Migrations do Supabase (supabase_migrations.schema_migrations):');
    try {
      const resMig = await client.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`);
      console.log(`  - Migrations registradas (${resMig.rows.length}):`, resMig.rows.map(r => r.version));
    } catch (err) {
      console.log(`  - Tabela supabase_migrations.schema_migrations não existe ou vazia: ${err.message}`);
    }

    // 3. Schemas Gerenciados (Auth e Storage)
    console.log('\n3. Schemas Gerenciados (Auth e Storage):');
    try {
      const resAuth = await client.query(`SELECT count(*)::bigint as total FROM auth.users;`);
      console.log(`  - auth.users: ${resAuth.rows[0].total} usuários cadastrados`);
    } catch (err) {
      console.log(`  - auth.users: erro ao consultar (${err.message})`);
    }

    try {
      const resBuckets = await client.query(`SELECT id, name, public FROM storage.buckets;`);
      console.log(`  - storage.buckets (${resBuckets.rows.length} encontrados):`, resBuckets.rows);
      const resObjects = await client.query(`SELECT count(*)::bigint as total FROM storage.objects;`);
      console.log(`  - storage.objects: ${resObjects.rows[0].total} arquivos armazenados`);
    } catch (err) {
      console.log(`  - storage: erro ao consultar (${err.message})`);
    }

    // 4. Funções (RPCs) no Schema Public
    console.log('\n4. Funções (RPCs) Instaladas no Schema Public:');
    const resFuncs = await client.query(`
      SELECT p.proname as function_name, 
             pg_get_function_identity_arguments(p.oid) as arguments,
             p.prosecdef as is_security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      ORDER BY p.proname;
    `);
    resFuncs.rows.forEach(f => {
      console.log(`  - ${f.function_name}(${f.arguments}) [SECURITY DEFINER: ${f.is_security_definer}]`);
    });

    // 5. Triggers Ativos
    console.log('\n5. Triggers Ativos no Schema Public:');
    const resTriggers = await client.query(`
      SELECT event_object_table as table_name, trigger_name, event_manipulation
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY event_object_table, trigger_name;
    `);
    resTriggers.rows.forEach(trg => {
      console.log(`  - ${trg.table_name}: ${trg.trigger_name} (${trg.event_manipulation})`);
    });

    // 6. Políticas de RLS
    console.log('\n6. Políticas de Row Level Security (RLS) Ativas:');
    const resPolicies = await client.query(`
      SELECT tablename, policyname, roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `);
    console.log(`  Total de Políticas RLS: ${resPolicies.rows.length}`);
    resPolicies.rows.forEach(pol => {
      console.log(`  - ${pol.tablename.padEnd(25)} | ${pol.policyname.padEnd(40)} | ${pol.cmd} | roles: ${pol.roles}`);
    });

    // 7. Tipos ENUM
    console.log('\n7. Tipos ENUM Criados:');
    const resEnums = await client.query(`
      SELECT t.typname as enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
      GROUP BY t.typname
      ORDER BY t.typname;
    `);
    resEnums.rows.forEach(en => {
      console.log(`  - ${en.enum_name}: [${en.values}]`);
    });

    // 8. Constraints de Chave Composta e Checks Relevantes
    console.log('\n8. Auditoria de Constraints Relevantes:');
    const resConstraints = await client.query(`
      SELECT conname, contype, conrelid::regclass::text as table_name
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND contype IN ('f', 'u', 'c')
      ORDER BY conrelid::regclass::text, conname;
    `);
    console.log(`  Total de Constraints registradas no catálogo: ${resConstraints.rows.length}`);

    console.log('\n======================================================================');
    console.log('  AUDITORIA DE CATÁLOGO CONCLUÍDA COM SUCESSO');
    console.log('======================================================================\n');

  } catch (err) {
    console.error('Erro na auditoria:', err);
  } finally {
    await client.end();
  }
}

runDeepAudit();
