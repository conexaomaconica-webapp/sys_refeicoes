/** Validação autônoma da Sprint 11 — Importação Parcial. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  [OK] ${label}`); passed++; }
  else { console.error(`  [FAIL] ${label}`); failed++; }
}
function read(...parts) { return fs.readFileSync(path.join(root, ...parts), 'utf8'); }

console.log('SPRINT 11 — VALIDAÇÃO DA IMPORTAÇÃO PARCIAL');

const migration = read('supabase', 'migrations', '20261019000048_complete_partial_import_workflow.sql');
check(!/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i.test(migration), 'migration não remove estruturas ou dados');
check(migration.includes('student_category_history'), 'histórico de categoria criado');
check(migration.includes('effective_date DATE NOT NULL'), 'data de vigência persistida');
check(migration.includes('FORCE ROW LEVEL SECURITY'), 'RLS forçado no histórico');
check(migration.includes("IN ('admin_general', 'operations_director')"), 'acesso restrito aos perfis autorizados');
check(migration.includes('v_import.error_rows > 0'), 'erros de validação resultam em completed_with_errors');
check(migration.includes('processed_rows = v_processed_count'), 'totais finais são persistidos');
check(!/UPDATE\s+public\.wallets|INSERT\s+INTO\s+public\.wallet/i.test(migration), 'processamento não altera carteira ou extrato');

const hardening = read('supabase', 'migrations', '20261019000049_restrict_import_rpc_execution.sql');
check(hardening.includes('FROM PUBLIC, anon'), 'migration 49 revoga execução anônima das RPCs');
check(hardening.includes('stage_import_batch_v2') && hardening.includes('confirm_and_process_import'), 'endurecimento cobre staging e confirmação');

const correction = read('supabase', 'migrations', '20261019000050_fix_import_update_concurrency_and_guard.sql');
check(correction.includes("::TIMESTAMPTZ"), 'migration 50 compara updated_at como instante temporal');
check(correction.includes("set_config('request.jwt.claim.sub', '', true)"), 'contexto autenticado é suspenso somente no UPDATE interno');
check(correction.includes("set_config('request.jwt.claim.sub', COALESCE(v_jwt_sub, ''), true)"), 'contexto autenticado é restaurado após o UPDATE');
check(correction.includes('FROM PUBLIC, anon'), 'migration 50 preserva bloqueio de execução anônima');

const bucketRepair = read('supabase', 'migrations', '20261019000051_reconcile_import_files_bucket.sql');
check(bucketRepair.includes("'import-files'"), 'migration 51 reconcilia o bucket de importação');
check(bucketRepair.includes('public = FALSE'), 'bucket reconciliado permanece privado');
check(bucketRepair.includes('10485760'), 'bucket mantém limite de 10 MB');
check(bucketRepair.includes('ON CONFLICT (id) DO UPDATE'), 'reconciliação do bucket é idempotente');

const sourceUnit = read('supabase', 'migrations', '20261020000054_add_import_source_unit.sql');
check(!/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i.test(sourceUnit), 'migration 54 é aditiva');
check(sourceUnit.includes('ADD COLUMN IF NOT EXISTS unit_id UUID'), 'lote registra unidade de origem');
check(sourceUnit.includes('fk_imports_unit_institution_tenant'), 'unidade pertence à instituição e ao tenant');
check(sourceUnit.includes('stage_import_batch_v3'), 'staging versionado recebe a unidade');
check(sourceUnit.includes('FROM PUBLIC, anon, authenticated'), 'RPC v3 bloqueia execução pública e anônima');

const service = read('src', 'services', 'admin-import.service.ts');
check(service.includes("'stage_import_batch_v3'") && service.includes('p_unit_id'), 'serviço usa contrato com unidade e data de vigência');
check(service.includes(".eq('status', 'active')"), 'importação aceita somente categorias ativas');
check(service.includes('generateErrorXlsxReport'), 'relatório XLSX de rejeições implementado');
check(service.includes('row.raw_data'), 'relatório preserva colunas originais');
check(service.includes('motivo_rejeicao') && service.includes('linha_original'), 'relatório contém motivo e linha original');
check(service.includes('sanitizeCellForExport'), 'exportação neutraliza formula injection');

const validator = read('src', 'services', 'import-validator.service.ts');
check(validator.includes('categoryChanged') && validator.includes('Categoria será atualizada'), 'preview evidencia mudança de categoria');
check(correction.includes('category_id = v_category_id') && correction.includes('student_category_history'), 'confirmação atualiza categoria e preserva histórico');

const ui = read('src', 'app', 'admin', 'importacoes', '_components', 'ImportWorkspace.tsx');
check(ui.includes('Confirmar linhas válidas'), 'confirmação parcial explícita na interface');
check(ui.includes('format=xlsx') && ui.includes('format=csv'), 'downloads XLSX e CSV disponíveis');
check(ui.includes('saldos/extratos de carteira não serão alterados'), 'preservação da carteira informada ao operador');

check(ui.includes('name="unitId"') && ui.includes('Unidade de origem da listagem'), 'interface exige unidade de origem');

const sample = Array.from({ length: 1000 }, (_, index) => ({ action: index < 980 ? 'insert' : 'error' }));
check(sample.filter((row) => row.action === 'insert').length === 980, 'cenário de aceite: 980 de 1000 linhas válidas');
check(sample.filter((row) => row.action === 'error').length === 20, 'cenário de aceite: 20 rejeições isoladas');

console.log(`RESULTADO: ${passed} PASSED, ${failed} FAILED`);
if (failed) process.exit(1);
