const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261022000066_enable_scoped_consumer_management.sql');
const accessPolicy = read('src/services/student-management-access.service.ts');
const consumerAccess = read('src/services/consumer-access.service.ts');
const page = read('src/app/admin/comensais/page.tsx');
const actions = read('src/app/admin/comensais/actions.ts');
const manager = read('src/app/admin/comensais/CommensalManager.tsx');
const studentService = read('src/services/admin-student.service.ts');

const checks = [
  [
    'management roles include scoped supervisors and unit managers',
    accessPolicy.includes("'supervisor'") && accessPolicy.includes("'unit_manager'"),
  ],
  [
    'tenant-wide access remains limited to master and operations director',
    accessPolicy.includes('TENANT_WIDE_STUDENT_MANAGER_ROLES') &&
      accessPolicy.includes("'admin_general'") &&
      accessPolicy.includes("'operations_director'"),
  ],
  [
    'scoped managers resolve both institution and unit assignments',
    accessPolicy.includes("from('user_institution_access')") &&
      accessPolicy.includes("from('user_unit_access')") &&
      accessPolicy.includes("from('units')"),
  ],
  [
    'student writes validate institutional scope server-side',
    studentService.includes('canManageStudentInstitution') &&
      studentService.includes('current.institution_id'),
  ],
  [
    'consumer auth invitations are created only by a server-only service',
    consumerAccess.startsWith("import 'server-only';") &&
      consumerAccess.includes('adminClient.auth.admin.inviteUserByEmail') &&
      !consumerAccess.includes('adminClient.auth.admin.createUser'),
  ],
  [
    'consumer accounts are always provisioned with the student role',
    consumerAccess.includes("role: 'student'") &&
      consumerAccess.includes("profile.role !== 'student'"),
  ],
  [
    'partial consumers receive a wallet without overwriting an existing one',
    consumerAccess.includes('category?.requires_wallet') &&
      consumerAccess.includes('existingWallet'),
  ],
  [
    'admin page applies the resolved institution scope',
    page.includes('access.institutionIds') &&
      page.includes(".in('institution_id', scopedInstitutionIds)"),
  ],
  [
    'consumer access mutation is a server action',
    actions.startsWith("'use server';") &&
      actions.includes('saveConsumerAccessAction'),
  ],
  [
    'interface supports invitations, recovery and disabling consumer access',
    manager.includes('Criar acesso') &&
      manager.includes('redefinir sua senha') &&
      manager.includes('Criar e enviar convite') &&
      manager.includes('<option value="inactive">Inativo</option>'),
  ],
  [
    'database policy combines role and organizational scope',
    migration.includes('can_manage_students_at_institution') &&
      migration.includes('user_institution_access') &&
      migration.includes('user_unit_access'),
  ],
  [
    'consumer identity is one-to-one and RLS remains enabled',
    migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_students_user_id') &&
      !migration.includes('DISABLE ROW LEVEL SECURITY'),
  ],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
