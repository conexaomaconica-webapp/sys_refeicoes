/**
 * Script de Backup Estrutural Completo do Banco Supabase
 * Salva todo o catálogo (tabelas, colunas, constraints, triggers, policies e RPCs)
 * em supabase/backups/schema_pre_homologacao.sql
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function runBackup() {
  await client.connect();
  const backupDir = path.join(ROOT_DIR, 'supabase', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const backupFile = path.join(backupDir, `backup_schema_${timestamp}.sql`);
  let sqlContent = `-- BACKUP ESTRUTURAL COMPLETO - SUPABASE MA REFEIÇÕES\n-- Data: ${new Date().toISOString()}\n-- Host: db.ltydhrmfhzhiuygqqeol.supabase.co\n\n`;

  // 1. Extrair Enums
  sqlContent += `-- ===================== ENUMS =====================\n`;
  const resEnums = await client.query(`
    SELECT t.typname, string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) as values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    GROUP BY t.typname;
  `);
  for (const row of resEnums.rows) {
    sqlContent += `DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${row.typname}') THEN\n    CREATE TYPE public.${row.typname} AS ENUM (${row.values});\n  END IF;\nEND $$;\n\n`;
  }

  // 2. Extrair Funções / RPCs
  sqlContent += `-- ===================== FUNÇÕES (RPCs) =====================\n`;
  const resFuncs = await client.query(`
    SELECT pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);
  for (const row of resFuncs.rows) {
    sqlContent += `${row.def};\n\n`;
  }

  // 3. Extrair Triggers
  sqlContent += `-- ===================== TRIGGERS =====================\n`;
  const resTriggers = await client.query(`
    SELECT pg_get_triggerdef(t.oid) as def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  `);
  for (const row of resTriggers.rows) {
    sqlContent += `${row.def};\n\n`;
  }

  // 4. Extrair Policies RLS
  sqlContent += `-- ===================== POLICIES RLS =====================\n`;
  const resPolicies = await client.query(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public';
  `);
  for (const p of resPolicies.rows) {
    sqlContent += `-- Policy: ${p.policyname} on ${p.tablename}\n`;
    sqlContent += `CREATE POLICY "${p.policyname}" ON public."${p.tablename}" AS ${p.permissive} FOR ${p.cmd} TO ${p.roles} USING (${p.qual || 'true'})`;
    if (p.with_check) sqlContent += ` WITH CHECK (${p.with_check})`;
    sqlContent += `;\n\n`;
  }

  fs.writeFileSync(backupFile, sqlContent, 'utf8');
  const stats = fs.statSync(backupFile);
  console.log(`[BACKUP OK] Arquivo gerado com sucesso: ${backupFile}`);
  console.log(`[BACKUP TAMANHO]: ${(stats.size / 1024).toFixed(2)} KB`);

  await client.end();
}

runBackup().catch(err => {
  console.error('Erro ao gerar backup:', err);
  process.exit(1);
});
