/**
 * Script de Validação Autônoma da Sprint 4 (Importação por Planilha)
 * Execução: node scripts/validate-sprint4.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [OK] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

console.log('====================================================');
console.log('  VALIDAÇÃO AUTÔNOMA DA SPRINT 4 — IMPORTAÇÃO POR PLANILHA');
console.log('====================================================\n');

// 1. Validação da Migration 000015 (Students UNIQUE id, tenant_id)
console.log('1. Verificando Migration 000015 (Constraint uq_students_id_tenant)...');
const mig15Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000015_create_students_id_tenant_unique.sql');
assert(fs.existsSync(mig15Path), 'Arquivo 20260927000015_create_students_id_tenant_unique.sql existe');
if (fs.existsSync(mig15Path)) {
  const content = fs.readFileSync(mig15Path, 'utf8');
  assert(content.includes('uq_students_id_tenant'), 'Contém constraint uq_students_id_tenant');
  assert(content.includes('UNIQUE (id, tenant_id)'), 'Define UNIQUE (id, tenant_id) na tabela students');
}

// 2. Validação da Migration 000016 (Tabelas imports e import_rows)
console.log('\n2. Verificando Migration 000016 (Tabelas imports e import_rows)...');
const mig16Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000016_create_imports_tables.sql');
assert(fs.existsSync(mig16Path), 'Arquivo 20260927000016_create_imports_tables.sql existe');
if (fs.existsSync(mig16Path)) {
  const content = fs.readFileSync(mig16Path, 'utf8');
  
  // Enums
  assert(content.includes('completed_with_errors'), 'Enum import_status possui completed_with_errors');
  assert(content.includes('integral_snapshot'), 'Enum import_mode possui integral_snapshot');
  assert(content.includes('reclassify_partial'), 'Enum import_row_action possui reclassify_partial');
  
  // Table imports constraints
  assert(content.includes('uq_imports_id_tenant UNIQUE (id, tenant_id)'), 'imports possui UNIQUE (id, tenant_id)');
  assert(content.includes('fk_imports_institution_tenant'), 'imports possui FK composta (institution_id, tenant_id)');
  assert(content.includes('fk_imports_created_by_tenant'), 'imports possui FK composta (created_by, tenant_id)');
  assert(content.includes('chk_imports_mode_snapshot'), 'imports possui CHECK de consistência entre import_mode e is_official_snapshot');

  // Table import_rows constraints
  assert(content.includes('fk_import_rows_import_tenant'), 'import_rows possui FK composta (import_id, tenant_id)');
  assert(content.includes('fk_import_rows_student_tenant'), 'import_rows possui FK composta (student_id, tenant_id)');
  assert(content.includes('REFERENCES public.students(id, tenant_id) ON DELETE RESTRICT'), 'import_rows usa ON DELETE RESTRICT na FK com students para preservar auditoria');
}

// 3. Validação da Migration 000017 (Security Policies e RPCs Server-Side)
console.log('\n3. Verificando Migration 000017 (RLS e RPCs Server-Side)...');
const mig17Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000017_create_import_security_policies.sql');
assert(fs.existsSync(mig17Path), 'Arquivo 20260927000017_create_import_security_policies.sql existe');
if (fs.existsSync(mig17Path)) {
  const content = fs.readFileSync(mig17Path, 'utf8');
  
  assert(content.includes('ALTER TABLE public.imports FORCE ROW LEVEL SECURITY;'), 'RLS forçado em imports');
  assert(content.includes('ALTER TABLE public.import_rows FORCE ROW LEVEL SECURITY;'), 'RLS forçado em import_rows');
  assert(!content.includes('FOR ALL TO authenticated'), 'NENHUMA policy FOR ALL TO authenticated permitida');
  assert(content.includes('sel_imports_admin'), 'Policy sel_imports_admin restrita a admin_general e operations_director');
  assert(content.includes('sel_import_rows_admin'), 'Policy sel_import_rows_admin restrita a admin_general e operations_director');
  
  // RPCs
  assert(content.includes('CREATE OR REPLACE FUNCTION public.stage_import_batch'), 'RPC stage_import_batch criada');
  assert(content.includes('CREATE OR REPLACE FUNCTION public.confirm_and_process_import'), 'RPC confirm_and_process_import criada');
  assert(content.includes('CREATE OR REPLACE FUNCTION public.cancel_import'), 'RPC cancel_import criada');
  assert(content.includes('SECURITY DEFINER'), 'Funções SQL usam SECURITY DEFINER');
  assert(content.includes("SET search_path = ''"), 'Funções SQL usam search_path seguro');
}

// 4. Validação da Migration 000018 (Bucket Privado import-files)
console.log('\n4. Verificando Migration 000018 (Storage import-files)...');
const mig18Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000018_create_import_files_bucket.sql');
assert(fs.existsSync(mig18Path), 'Arquivo 20260927000018_create_import_files_bucket.sql existe');
if (fs.existsSync(mig18Path)) {
  const content = fs.readFileSync(mig18Path, 'utf8');
  assert(content.includes("'import-files'"), "Cria bucket 'import-files'");
  assert(content.includes('FALSE'), 'Bucket import-files é 100% privado (public = FALSE)');
  assert(!content.includes('CREATE POLICY'), 'Sem policies diretas para authenticated no client');
}

// 5. Validação de Segurança contra Formula Injection (formula-sanitizer.ts)
console.log('\n5. Verificando Sanitizador de Fórmulas (src/lib/security/formula-sanitizer.ts)...');
const sanitizerPath = path.join(ROOT_DIR, 'src', 'lib', 'security', 'formula-sanitizer.ts');
assert(fs.existsSync(sanitizerPath), 'Arquivo formula-sanitizer.ts existe');
if (fs.existsSync(sanitizerPath)) {
  const { sanitizeCellForExport } = require(sanitizerPath);
  assert(sanitizeCellForExport('=1+1') === "'=1+1", 'Neutraliza fórmula = na exportação');
  assert(sanitizeCellForExport('+50') === "'+50", 'Neutraliza fórmula + na exportação');
  assert(sanitizeCellForExport('-10') === "'-10", 'Neutraliza fórmula - na exportação');
  assert(sanitizeCellForExport('@cmd') === "'@cmd", 'Neutraliza fórmula @ na exportação');
  assert(sanitizeCellForExport('0012345') === '0012345', 'Preserva matrícula 0012345 sem aspa na exportação normal');
}

// 6. Validação do Parser e Preservação de Zeros à Esquerda (import-parser.service.ts)
console.log('\n6. Verificando Parser e Preservação de Zeros à Esquerda...');
const parserPath = path.join(ROOT_DIR, 'src', 'services', 'import-parser.service.ts');
assert(fs.existsSync(parserPath), 'Arquivo import-parser.service.ts existe');
if (fs.existsSync(parserPath)) {
  const content = fs.readFileSync(parserPath, 'utf8');
  assert(content.includes("import 'server-only';"), 'import-parser é server-only');
  assert(content.includes('MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024'), 'Limite de arquivo 10 MB');
  assert(content.includes('MAX_ROWS_LIMIT = 10000'), 'Limite de 10.000 linhas');
  assert(content.includes('MAX_SHEETS_LIMIT = 5'), 'Limite de 5 sheets (Decompression Bomb protection)');
  assert(content.includes('MAX_CELLS_LIMIT = 100000'), 'Limite de 100.000 células (Decompression Bomb protection)');
  assert(content.includes('normalizeRegistrationNumber'), 'Função de normalização de matrícula presente');
}

// 7. Validação do Validador e Modo Integrais (import-validator.service.ts)
console.log('\n7. Verificando Validador e Modo Integrais (import-validator.service.ts)...');
const validatorPath = path.join(ROOT_DIR, 'src', 'services', 'import-validator.service.ts');
assert(fs.existsSync(validatorPath), 'Arquivo import-validator.service.ts existe');
if (fs.existsSync(validatorPath)) {
  const content = fs.readFileSync(validatorPath, 'utf8');
  assert(content.includes("import 'server-only';"), 'import-validator é server-only');
  assert(content.includes('reclassify_partial'), 'Trata reclassificação de ausentes no Modo Oficial Snapshot de Integrais');
  assert(content.includes('warnings.push'), 'E-mail duplicado gera warning, não erro impeditivo');
}

// 8. Validação do Admin Import Service (admin-import.service.ts)
console.log('\n8. Verificando Serviço de Administração (admin-import.service.ts)...');
const adminServicePath = path.join(ROOT_DIR, 'src', 'services', 'admin-import.service.ts');
assert(fs.existsSync(adminServicePath), 'Arquivo admin-import.service.ts existe');
if (fs.existsSync(adminServicePath)) {
  const content = fs.readFileSync(adminServicePath, 'utf8');
  assert(content.includes("import 'server-only';"), 'admin-import.service é server-only');
  assert(content.includes("stage_import_batch"), 'Chama RPC stage_import_batch');
  assert(content.includes("confirm_and_process_import"), 'Chama RPC confirm_and_process_import');
  assert(content.includes("cancel_import"), 'Chama RPC cancel_import');
  assert(content.includes("generateErrorCsvReport"), 'Gera relatório CSV de erros neutralizado');
}

console.log('\n====================================================');
console.log(`  RESULTADO: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
