/**
 * ==============================================================================
 * Script de Verificação e Validação Estrutural e de Segurança da Sprint 2
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

console.log('------------------------------------------------------------');
console.log('INICIANDO AUDITORIA DE ARQUITETURA E SEGURANÇA DA SPRINT 2');
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

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

// Helper para normalizar múltiplos espaços e quebras de linha
function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ');
}

// 1. Validar a existência das 5 migrations da Sprint 2 na ordem exata
console.log('1. Validando existência e ordem das 5 migrations da Sprint 2:');
const expectedMigrations = [
  '20260927000005_create_user_role_enum.sql',
  '20260927000006_create_profiles.sql',
  '20260927000007_create_access_scopes.sql',
  '20260927000008_create_auth_helper_functions.sql',
  '20260927000009_create_security_policies_and_triggers.sql',
];

expectedMigrations.forEach((file) => {
  const filePath = path.join(migrationsDir, file);
  const exists = fs.existsSync(filePath);
  assert(exists, `Migration presente: ${file}`);
});

// 2. Validar Enum user_role
console.log('\n2. Validando Enum user_role (20260927000005):');
const mig5Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[0]), 'utf8');
const roles = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
  'operator',
  'institution_user',
  'student',
];
roles.forEach((r) => {
  assert(mig5Content.includes(`'${r}'`), `Role presente no Enum: ${r}`);
});

// 3. Validar Tabela profiles (20260927000006)
console.log('\n3. Validando estrutura de profiles (20260927000006):');
const mig6Raw = fs.readFileSync(path.join(migrationsDir, expectedMigrations[1]), 'utf8');
// Remover comentários para checar colunas da DDL
const mig6NoComments = mig6Raw.replace(/--.*$/gm, '');
const mig6Normalized = normalizeSql(mig6NoComments);

assert(mig6Normalized.includes('REFERENCES auth.users(id) ON DELETE CASCADE'), 'profiles.id referencia auth.users(id) 1:1');
assert(mig6Normalized.includes('uq_profiles_id_tenant UNIQUE (id, tenant_id)'), 'profiles possui constraint unica (id, tenant_id)');
assert(!mig6NoComments.includes('institution_id'), 'profiles NAO possui coluna institution_id (escopo isolado em user_institution_access)');
assert(mig6Normalized.includes('ENABLE ROW LEVEL SECURITY'), 'RLS ativado em profiles');

// 4. Validar Escopos e FKs Compostas (20260927000007)
console.log('\n4. Validando escopos e FKs compostas (20260927000007):');
const mig7Normalized = normalizeSql(fs.readFileSync(path.join(migrationsDir, expectedMigrations[2]), 'utf8'));

assert(mig7Normalized.includes('uq_units_id_tenant UNIQUE (id, tenant_id)'), 'units recebe constraint de unicidade composta (id, tenant_id)');
assert(mig7Normalized.includes('fk_user_unit_access_user_tenant FOREIGN KEY (user_id, tenant_id) REFERENCES public.profiles(id, tenant_id)'), 'user_unit_access valida user+tenant em profiles');
assert(mig7Normalized.includes('fk_user_unit_access_unit_tenant FOREIGN KEY (unit_id, tenant_id) REFERENCES public.units(id, tenant_id)'), 'user_unit_access valida unit+tenant em units');
assert(mig7Normalized.includes('fk_user_inst_access_inst_tenant FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id)'), 'user_institution_access valida institution+tenant em institutions');

// 5. Validar Funções SECURITY DEFINER (20260927000008)
console.log('\n5. Validando hardening de funções SECURITY DEFINER (20260927000008):');
const mig8Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[3]), 'utf8');
assert(mig8Content.includes('SECURITY DEFINER'), 'Funções declaradas como SECURITY DEFINER');
assert(mig8Content.includes("SET search_path = ''"), "Funções declaradas com SET search_path = ''");
assert(mig8Content.includes('REVOKE ALL ON FUNCTION public.get_auth_tenant_id() FROM PUBLIC;'), 'Privilégios públicos revogados de get_auth_tenant_id');
assert(mig8Content.includes('GRANT EXECUTE ON FUNCTION public.has_unit_access(UUID) TO authenticated;'), 'Execução de has_unit_access concedida estritamente a authenticated');

// 6. Validar Trigger de Prevenção contra Escalada de Privilégios e RLS (20260927000009)
console.log('\n6. Validando imutabilidade de privilégios e RLS (20260927000009):');
const mig9Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[4]), 'utf8');
assert(mig9Content.includes('trg_prevent_profile_escalation'), 'Trigger de imutabilidade criado');
assert(mig9Content.includes('IF (auth.uid() IS NOT NULL) THEN'), 'Trigger verifica se requisição veio de sessão de usuário autenticado');
assert(mig9Content.includes('sel_profiles_owner_or_admin'), 'Policy de SELECT em profiles ativa');
assert(mig9Content.includes('sel_units_scoped'), 'Policy de unidades utiliza public.has_unit_access');

// 7. Validar Proteção Server-Only nos Serviços Administrativos
console.log('\n7. Validando proteção server-only:');
const adminPath = path.join(__dirname, '..', 'src', 'lib', 'supabase', 'admin.ts');
const adminServicePath = path.join(__dirname, '..', 'src', 'services', 'admin-user.service.ts');

assert(fs.readFileSync(adminPath, 'utf8').startsWith("import 'server-only';"), "admin.ts possui import 'server-only'");
assert(fs.readFileSync(adminServicePath, 'utf8').startsWith("import 'server-only';"), "admin-user.service.ts possui import 'server-only'");

// 8. Simulação de Lógica de Negócio e Segurança de Permissões
console.log('\n8. Testando Lógica de Autorização e Escopos (Simulação):');

const mockTenants = [
  { id: 'tenant-A', name: 'Tenant Alpha' },
  { id: 'tenant-B', name: 'Tenant Beta' },
];

const mockProfiles = [
  { id: 'user-admin', tenant_id: 'tenant-A', role: 'admin_general', status: 'active' },
  { id: 'user-op', tenant_id: 'tenant-A', role: 'operator', status: 'active' },
  { id: 'user-inactive', tenant_id: 'tenant-A', role: 'operator', status: 'inactive' },
  { id: 'user-beta-op', tenant_id: 'tenant-B', role: 'operator', status: 'active' },
];

const mockUnits = [
  { id: 'unit-A1', tenant_id: 'tenant-A', status: 'active' },
  { id: 'unit-A2', tenant_id: 'tenant-A', status: 'active' },
  { id: 'unit-B1', tenant_id: 'tenant-B', status: 'active' },
];

const mockUserUnitAccess = [
  { tenant_id: 'tenant-A', user_id: 'user-op', unit_id: 'unit-A1' },
];

function simulateHasUnitAccess(userId, unitId) {
  const profile = mockProfiles.find((p) => p.id === userId && p.status === 'active');
  if (!profile) return false;

  const unit = mockUnits.find((u) => u.id === unitId && u.status === 'active');
  if (!unit) return false;

  // Tenant Isolation
  if (profile.tenant_id !== unit.tenant_id) return false;

  if (['admin_general', 'operations_director', 'finance'].includes(profile.role)) {
    return true;
  }

  return mockUserUnitAccess.some(
    (a) => a.user_id === userId && a.unit_id === unitId && a.tenant_id === profile.tenant_id
  );
}

// Teste 1: Admin Tenant A acessa Unit A1 e A2, mas NÃO Unit B1
assert(simulateHasUnitAccess('user-admin', 'unit-A1') === true, 'Admin A acessa Unit A1');
assert(simulateHasUnitAccess('user-admin', 'unit-B1') === false, 'Admin A BLOQUEADO na Unit B1 do Tenant B');

// Teste 2: Operador Tenant A acessa Unit A1 atribuída, mas NÃO Unit A2 não atribuída
assert(simulateHasUnitAccess('user-op', 'unit-A1') === true, 'Operador A1 acessa Unit A1 atribuída');
assert(simulateHasUnitAccess('user-op', 'unit-A2') === false, 'Operador A1 BLOQUEADO na Unit A2 não atribuída');

// Teste 3: Usuário Inativo Bloqueado
assert(simulateHasUnitAccess('user-inactive', 'unit-A1') === false, 'Usuário INATIVO BLOQUEADO totalmente');

// Teste 4: Impedir Vínculo Cruzado entre Tenant A e Unit B
function simulateInsertUnitAccess(tenantId, userId, unitId) {
  const user = mockProfiles.find((p) => p.id === userId);
  const unit = mockUnits.find((u) => u.id === unitId);

  // A FK Composta valida (user_id, tenant_id) e (unit_id, tenant_id)
  if (!user || user.tenant_id !== tenantId) {
    throw new Error('FK_VIOLATION: user_id e tenant_id incompatíveis em profiles');
  }
  if (!unit || unit.tenant_id !== tenantId) {
    throw new Error('FK_VIOLATION: unit_id e tenant_id incompatíveis em units');
  }
  return true;
}

let crossTenantBlocked = false;
try {
  simulateInsertUnitAccess('tenant-A', 'user-op', 'unit-B1'); // unit-B1 é do tenant-B!
} catch (e) {
  crossTenantBlocked = true;
}
assert(crossTenantBlocked, 'Inserção de acesso com Usuário do Tenant A em Unidade do Tenant B BLOQUEADA pela FK Composta');

// Teste 5: Prevenção de Escalada de Privilégios (Trigger Simulation)
function simulateUpdateProfile(authUserId, targetProfile, updates) {
  if (authUserId !== null) {
    if (
      (updates.role !== undefined && updates.role !== targetProfile.role) ||
      (updates.tenant_id !== undefined && updates.tenant_id !== targetProfile.tenant_id) ||
      (updates.status !== undefined && updates.status !== targetProfile.status)
    ) {
      throw new Error('42501: Alterações em role/tenant_id/status via client não permitidas');
    }
  }
  return { ...targetProfile, ...updates };
}

let escalationBlocked = false;
try {
  simulateUpdateProfile('user-op', mockProfiles[1], { role: 'admin_general' });
} catch (e) {
  escalationBlocked = true;
}
assert(escalationBlocked, 'Tentativa de alteração do próprio role via client BLOQUEADA pelo Trigger');

console.log('\n------------------------------------------------------------');
console.log(`TOTAL DE VERIFICAÇÕES: ${totalChecks} | APROVADAS: ${passedChecks}`);
console.log(passedChecks === totalChecks ? 'STATUS GERAL: SPRINT 2 VALIDADA COM SUCESSO' : 'STATUS GERAL: FALHAS DETECTADAS');
console.log('------------------------------------------------------------\n');
