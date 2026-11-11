const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- VALIDATING SPRINT 13: CONTINGENCY REGULARIZATION ---');

const migrationPath = path.join(__dirname, '../supabase/migrations/20261029000077_create_contingency_regularization.sql');

// 1. Verificar existência do arquivo de migration
assert(fs.existsSync(migrationPath), 'Migration 20261029000077_create_contingency_regularization.sql must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
console.log('✓ Migration 77 exists');

// 2. Princípio aditivo e integridade de RLS
assert(!migrationSql.includes('DROP TABLE public.contingency_meal_batches'), 'Migration must not drop contingency_meal_batches');
assert(!migrationSql.includes('DISABLE ROW LEVEL SECURITY'), 'RLS must NEVER be disabled');
assert(migrationSql.includes('ALTER TABLE public.contingency_meal_batches ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on contingency_meal_batches');
assert(migrationSql.includes('ALTER TABLE public.contingency_batch_items ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on contingency_batch_items');
console.log('✓ RLS enabled and strictly preserved');

// 3. Estrutura e Constraints de contingency_meal_batches
assert(migrationSql.includes('contingency_meal_batches'), 'Must create contingency_meal_batches');
assert(migrationSql.includes('chk_contingency_batch_type'), 'Must enforce valid batch_type');
assert(migrationSql.includes('type_a_identified'), 'Must support Type A (identified)');
assert(migrationSql.includes('type_b_unidentified_count'), 'Must support Type B (unidentified count)');
assert(migrationSql.includes('type_c_administrative_adjustment'), 'Must support Type C (administrative adjustment)');
assert(migrationSql.includes('chk_contingency_batch_meals'), 'Must enforce total_meals_served > 0');
assert(migrationSql.includes('chk_contingency_batch_status'), 'Must enforce status enum');
console.log('✓ Table contingency_meal_batches constraints and types verified');

// 4. Estrutura da tabela de itens individualizados (Tipo A)
assert(migrationSql.includes('contingency_batch_items'), 'Must create contingency_batch_items');
assert(migrationSql.includes('student_id UUID NOT NULL REFERENCES public.students(id)'), 'Must link to real students only');
assert(migrationSql.includes('uq_contingency_batch_student UNIQUE (batch_id, student_id)'), 'Must prevent duplicate student in same batch');
console.log('✓ Table contingency_batch_items individualization verified');

// 5. Bucket de Evidências Privado
assert(migrationSql.includes('contingency-evidence'), 'Must register contingency-evidence bucket');
assert(migrationSql.includes('public = false') || migrationSql.includes('false,'), 'Bucket must be private');
assert(migrationSql.includes('15728640'), 'Must enforce 15MB file size limit');
console.log('✓ Private storage bucket for technical evidence verified');

// 6. Segregação de Funções e Dupla Aprovação (review_contingency_batch)
assert(migrationSql.includes('review_contingency_batch'), 'Must define review_contingency_batch RPC');
assert(migrationSql.includes('SELF_APPROVAL_PROHIBITED'), 'Must enforce double-approval (operator cannot approve own batch)');
assert(migrationSql.includes('admin_general') && migrationSql.includes('operations_director') && migrationSql.includes('finance'), 'Reviewer roles must be restricted');
assert(migrationSql.includes('REASON_REQUIRED'), 'Must require rejection reason');
console.log('✓ Double-approval and segregation of duties logic verified');

// 7. Submissão Segura e Anti-Comensal Fictício (submit_contingency_batch)
assert(migrationSql.includes('submit_contingency_batch'), 'Must define submit_contingency_batch RPC');
assert(migrationSql.includes('has_unit_access'), 'Must enforce unit access');
assert(migrationSql.includes('Aluno % já possui refeição regular aprovada para esta data e turno'), 'Must prevent duplicate meal on same date/meal_type');
console.log('✓ Anti-fictitious and duplicate prevention logic verified');

console.log('\n🎉 ALL SPRINT 13 CONTINGENCY REGULARIZATION CHECKS PASSED (7/7)!');
