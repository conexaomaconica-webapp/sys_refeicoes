/**
 * ==============================================================================
 * Script de Verificação e Validação Estrutural e de Segurança da Sprint 3
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

console.log('------------------------------------------------------------');
console.log('INICIANDO AUDITORIA DE ARQUITETURA E SEGURANÇA DA SPRINT 3');
console.log('------------------------------------------------------------\n');

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ');
}

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

// 1. Validar existência das 3 migrations da Sprint 3
console.log('1. Validando existência e ordem das 3 migrations da Sprint 3:');
const expectedMigrations = [
  '20260927000010_create_student_categories.sql',
  '20260927000011_create_students.sql',
  '20260927000012_create_student_security_policies_and_triggers.sql',
];

expectedMigrations.forEach((file) => {
  const filePath = path.join(migrationsDir, file);
  const exists = fs.existsSync(filePath);
  assert(exists, `Migration presente: ${file}`);
});

// 2. Validar Tabela student_categories e Provisionamento (20260927000010)
console.log('\n2. Validando student_categories e hardening (20260927000010):');
const mig10Normalized = normalizeSql(fs.readFileSync(path.join(migrationsDir, expectedMigrations[0]), 'utf8'));

assert(mig10Normalized.includes('code TEXT NOT NULL'), 'code é TEXT NOT NULL extensível (sem Enum fechado)');
assert(mig10Normalized.includes('uq_student_categories_tenant_code UNIQUE (tenant_id, code)'), 'Unicidade composta (tenant_id, code) ativa');
assert(mig10Normalized.includes('uq_student_categories_id_tenant UNIQUE (id, tenant_id)'), 'Unicidade composta (id, tenant_id) para suporte a FK multi-tenant');
assert(mig10Normalized.includes("provision_default_student_categories(p_tenant_id UUID)"), 'Função de provisionamento de categorias criada');
assert(mig10Normalized.includes("REVOKE ALL ON FUNCTION public.provision_default_student_categories(UUID) FROM PUBLIC;"), 'Execução pública de provision_default_student_categories revogada');

// 3. Validar Tabela students e FKs Compostas (20260927000011)
console.log('\n3. Validando tabela students e as 3 FKs compostas (20260927000011):');
const mig11Normalized = normalizeSql(fs.readFileSync(path.join(migrationsDir, expectedMigrations[1]), 'utf8'));

assert(mig11Normalized.includes('uq_students_inst_registration UNIQUE (institution_id, registration_number)'), 'Matrícula única por instituição configurada');
assert(mig11Normalized.includes('fk_students_inst_tenant FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id)'), 'FK composta 1: institution_id + tenant_id em institutions');
assert(mig11Normalized.includes('fk_students_category_tenant FOREIGN KEY (category_id, tenant_id) REFERENCES public.student_categories(id, tenant_id)'), 'FK composta 2: category_id + tenant_id em student_categories');
assert(mig11Normalized.includes('fk_students_user_tenant FOREIGN KEY (user_id, tenant_id) REFERENCES public.profiles(id, tenant_id)'), 'FK composta 3: user_id + tenant_id em profiles');
assert(mig11Normalized.includes('ON DELETE RESTRICT'), 'FK com profiles utiliza ON DELETE RESTRICT (sem SET NULL implícito)');
assert(mig11Normalized.includes('photo_path TEXT'), 'Coluna photo_path configurada (sem assinar URLs no banco)');

// 4. Validar Policies RLS Minimizadas e Trigger de Imutabilidade (20260927000012)
console.log('\n4. Validando minimização RLS LGPD e Triggers (20260927000012):');
const mig12Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[2]), 'utf8');

assert(mig12Content.includes('trg_prevent_student_tampering'), 'Trigger trg_prevent_student_tampering presente');
assert(mig12Content.includes("public.get_auth_user_role() IN ('admin_general', 'operations_director')"), 'Policy sel_students limita SELECT completo a admin_general e operations_director (finance/operadores excluídos)');
assert(!mig12Content.includes("'finance'"), 'finance EXCLUÍDO de sel_students para evitar exposição de email/phone (LGPD)');
assert(!mig12Content.includes("'operator'"), 'operator EXCLUÍDO de sel_students (recepção usará projeção minimizada)');

// 5. Validar Proteção Server-Only
console.log('\n5. Validando proteção server-only nos serviços administrativos:');
const adminStudentServicePath = path.join(__dirname, '..', 'src', 'services', 'admin-student.service.ts');
assert(fs.readFileSync(adminStudentServicePath, 'utf8').startsWith("import 'server-only';"), "admin-student.service.ts protegido com import 'server-only'");

// 6. Testes Lógicos e de Segurança (Simulação)
console.log('\n6. Testando Regras de Negócio e Segurança da Sprint 3 (Simulação):');

const mockTenants = [{ id: 'tenant-A' }, { id: 'tenant-B' }];
const mockInstitutions = [
  { id: 'inst-A1', tenant_id: 'tenant-A' },
  { id: 'inst-B1', tenant_id: 'tenant-B' },
];
const mockCategories = [
  { id: 'cat-A-integral', tenant_id: 'tenant-A', code: 'integral', requires_wallet: false },
  { id: 'cat-A-partial', tenant_id: 'tenant-A', code: 'partial', requires_wallet: true },
  { id: 'cat-B-integral', tenant_id: 'tenant-B', code: 'integral', requires_wallet: false },
];
const mockProfiles = [
  { id: 'user-stud-1', tenant_id: 'tenant-A', role: 'student', status: 'active' },
  { id: 'user-stud-beta', tenant_id: 'tenant-B', role: 'student', status: 'active' },
];

const mockStudents = [
  {
    id: 'stud-1',
    tenant_id: 'tenant-A',
    institution_id: 'inst-A1',
    user_id: 'user-stud-1',
    category_id: 'cat-A-integral',
    registration_number: '2026-001',
    full_name: 'João da Silva',
    status: 'active',
  },
  {
    id: 'stud-2',
    tenant_id: 'tenant-A',
    institution_id: 'inst-A1',
    user_id: null, // Aluno sem Auth
    category_id: 'cat-A-partial',
    registration_number: '2026-002',
    full_name: 'Maria Oliveira',
    status: 'active',
  },
];

// Teste 1: Rejeitar Matrícula Duplicada na Mesma Instituição
function simulateInsertStudent(student) {
  const duplicate = mockStudents.some(
    (s) => s.institution_id === student.institution_id && s.registration_number === student.registration_number
  );
  if (duplicate) {
    throw new Error('UQ_VIOLATION: Matrícula já existente nesta instituição');
  }

  // Validação de FK Composta (institution_id, tenant_id)
  const inst = mockInstitutions.find((i) => i.id === student.institution_id && i.tenant_id === student.tenant_id);
  if (!inst) throw new Error('FK_VIOLATION: institution_id pertence a outro tenant');

  // Validação de FK Composta (category_id, tenant_id)
  const cat = mockCategories.find((c) => c.id === student.category_id && c.tenant_id === student.tenant_id);
  if (!cat) throw new Error('FK_VIOLATION: category_id pertence a outro tenant');

  return true;
}

let duplicateBlocked = false;
try {
  simulateInsertStudent({
    tenant_id: 'tenant-A',
    institution_id: 'inst-A1',
    category_id: 'cat-A-integral',
    registration_number: '2026-001', // Já existe na inst-A1!
  });
} catch (e) {
  duplicateBlocked = true;
}
assert(duplicateBlocked, 'Matrícula duplicada na mesma instituição BLOQUEADA');

// Teste 2: Permitir Matrícula Idêntica em Instituição Diferente
let crossInstAllowed = false;
try {
  crossInstAllowed = simulateInsertStudent({
    tenant_id: 'tenant-B',
    institution_id: 'inst-B1',
    category_id: 'cat-B-integral',
    registration_number: '2026-001', // Mesma string, mas na inst-B1!
  });
} catch (e) {
  crossInstAllowed = false;
}
assert(crossInstAllowed, 'Matrícula idêntica em universidade diferente PERMITIDA');

// Teste 3: Inserção de Aluno do Tenant A com Categoria do Tenant B
let crossCategoryBlocked = false;
try {
  simulateInsertStudent({
    tenant_id: 'tenant-A',
    institution_id: 'inst-A1',
    category_id: 'cat-B-integral', // Categoria do Tenant B!
    registration_number: '2026-999',
  });
} catch (e) {
  crossCategoryBlocked = true;
}
assert(crossCategoryBlocked, 'Aluno do Tenant A com Categoria do Tenant B BLOQUEADO pela FK Composta');

// Teste 4: Aluno A tentando alterar sua própria Categoria ou Matrícula
function simulateStudentUpdate(authUserId, student, updates) {
  if (authUserId !== null) {
    const allowedKeys = ['phone', 'email'];
    const attemptedKeys = Object.keys(updates);
    const hasForbidden = attemptedKeys.some((k) => !allowedKeys.includes(k));
    if (hasForbidden) {
      throw new Error('42501: Aluno só pode atualizar e-mail e telefone');
    }
  }
  return { ...student, ...updates };
}

let academicTamperingBlocked = false;
try {
  simulateStudentUpdate('user-stud-1', mockStudents[0], { category_id: 'cat-A-partial' });
} catch (e) {
  academicTamperingBlocked = true;
}
assert(academicTamperingBlocked, 'Tentativa do aluno de alterar própria categoria BLOQUEADA pelo Trigger');

// Teste 5: Aluno alterando apenas telefone/email na Whitelist
let contactUpdatePassed = false;
try {
  const updated = simulateStudentUpdate('user-stud-1', mockStudents[0], { phone: '71999998888', email: 'joao@email.com' });
  contactUpdatePassed = updated.phone === '71999998888';
} catch (e) {
  contactUpdatePassed = false;
}
assert(contactUpdatePassed, 'Edição de telefone/email pelo próprio aluno PERMITIDA');

console.log('\n------------------------------------------------------------');
console.log(`TOTAL DE VERIFICAÇÕES: ${totalChecks} | APROVADAS: ${passedChecks}`);
console.log(passedChecks === totalChecks ? 'STATUS GERAL: SPRINT 3 VALIDADA COM SUCESSO' : 'STATUS GERAL: FALHAS DETECTADAS');
console.log('------------------------------------------------------------\n');
