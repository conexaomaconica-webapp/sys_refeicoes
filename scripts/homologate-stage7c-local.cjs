const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const connectionString = process.env.STAGE7C_DB_URL;
const expectedDataDirectory = process.env.STAGE7C_EXPECTED_DATA_DIR;
const expectedPort = Number(process.env.STAGE7C_EXPECTED_PORT || 0);
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (!connectionString) {
  throw new Error('STAGE7C_DB_URL e obrigatoria para a homologacao descartavel.');
}
if (!expectedDataDirectory) {
  throw new Error('STAGE7C_EXPECTED_DATA_DIR e obrigatoria para comprovar o cluster descartavel.');
}
if (!Number.isInteger(expectedPort) || expectedPort < 1024 || expectedPort > 65535) {
  throw new Error('STAGE7C_EXPECTED_PORT deve informar uma porta local nao privilegiada.');
}

const target = new URL(connectionString);
if (!allowedHosts.has(target.hostname)) {
  throw new Error(`Host recusado: ${target.hostname}. A Etapa 7C aceita somente loopback local.`);
}
if (!target.pathname.slice(1).startsWith('stage7c_')) {
  throw new Error('Banco recusado: o nome deve iniciar com stage7c_.');
}

const sqlFiles = [
  path.join(root, 'scripts/stage7c/bootstrap.sql'),
  path.join(root, 'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql'),
  path.join(root, 'supabase/migrations/20261026000073_harden_scoped_read_policies.sql'),
];

const ids = {
  tenantA: '7c000000-0000-4000-8000-000000000001',
  tenantB: '7c000000-0000-4000-8000-000000000002',
  institutionA: '7c100000-0000-4000-8000-000000000001',
  institutionB: '7c100000-0000-4000-8000-000000000002',
  institutionOther: '7c100000-0000-4000-8000-000000000003',
  unitA1: '7c200000-0000-4000-8000-000000000001',
  unitA2: '7c200000-0000-4000-8000-000000000002',
  unitB: '7c200000-0000-4000-8000-000000000003',
  unitOther: '7c200000-0000-4000-8000-000000000004',
  studentA1: '7c300000-0000-4000-8000-000000000001',
  studentA2: '7c300000-0000-4000-8000-000000000002',
  studentB: '7c300000-0000-4000-8000-000000000003',
  studentOther: '7c300000-0000-4000-8000-000000000004',
  walletA1: '7c400000-0000-4000-8000-000000000001',
  walletA2: '7c400000-0000-4000-8000-000000000002',
  walletB: '7c400000-0000-4000-8000-000000000003',
  walletOther: '7c400000-0000-4000-8000-000000000004',
};

const users = {
  admin: '7ca00000-0000-4000-8000-000000000001',
  director: '7ca00000-0000-4000-8000-000000000002',
  finance: '7ca00000-0000-4000-8000-000000000003',
  supervisor: '7ca00000-0000-4000-8000-000000000004',
  manager: '7ca00000-0000-4000-8000-000000000005',
  operator: '7ca00000-0000-4000-8000-000000000006',
  institution: '7ca00000-0000-4000-8000-000000000007',
  student: '7ca00000-0000-4000-8000-000000000008',
  inactive: '7ca00000-0000-4000-8000-000000000009',
  otherAdmin: '7ca00000-0000-4000-8000-000000000010',
};

const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
let passed = 0;
let failed = 0;

function check(condition, name, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${String(passed + failed).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
  }
}

async function setAuth(userId, role = 'authenticated') {
  await client.query('RESET ROLE');
  await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
  await client.query(`SET LOCAL ROLE ${role === 'anon' ? 'anon' : 'authenticated'}`);
}

async function asOwner() {
  await client.query('RESET ROLE');
}

async function visibleCount(userId, table, role = 'authenticated') {
  const allowedTables = new Set([
    'students',
    'wallets',
    'payments',
    'recharges',
    'offline_contingency_events',
    'cash_shifts',
    'cash_movements',
  ]);
  if (!allowedTables.has(table)) throw new Error(`Tabela de teste invalida: ${table}`);
  await setAuth(userId, role);
  await client.query('SAVEPOINT stage7c_visibility');
  try {
    const result = await client.query(`SELECT count(*)::integer AS value FROM public.${table}`);
    await client.query('RELEASE SAVEPOINT stage7c_visibility');
    await asOwner();
    return Number(result.rows[0].value);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT stage7c_visibility');
    await client.query('RELEASE SAVEPOINT stage7c_visibility');
    await asOwner();
    if (error.code === '42501') return 0;
    throw error;
  }
}

async function seed() {
  await client.query(`
    INSERT INTO public.tenants (id, name) VALUES
      ('${ids.tenantA}', 'Tenant A'), ('${ids.tenantB}', 'Tenant B');
    INSERT INTO public.institutions (id, tenant_id, name) VALUES
      ('${ids.institutionA}', '${ids.tenantA}', 'Instituicao A'),
      ('${ids.institutionB}', '${ids.tenantA}', 'Instituicao B'),
      ('${ids.institutionOther}', '${ids.tenantB}', 'Instituicao Outro Tenant');
    INSERT INTO public.units (id, tenant_id, institution_id, name) VALUES
      ('${ids.unitA1}', '${ids.tenantA}', '${ids.institutionA}', 'Unidade A1'),
      ('${ids.unitA2}', '${ids.tenantA}', '${ids.institutionA}', 'Unidade A2'),
      ('${ids.unitB}', '${ids.tenantA}', '${ids.institutionB}', 'Unidade B'),
      ('${ids.unitOther}', '${ids.tenantB}', '${ids.institutionOther}', 'Unidade Outro Tenant');
    INSERT INTO public.profiles (id, tenant_id, role, status) VALUES
      ('${users.admin}', '${ids.tenantA}', 'admin_general', 'active'),
      ('${users.director}', '${ids.tenantA}', 'operations_director', 'active'),
      ('${users.finance}', '${ids.tenantA}', 'finance', 'active'),
      ('${users.supervisor}', '${ids.tenantA}', 'supervisor', 'active'),
      ('${users.manager}', '${ids.tenantA}', 'unit_manager', 'active'),
      ('${users.operator}', '${ids.tenantA}', 'operator', 'active'),
      ('${users.institution}', '${ids.tenantA}', 'institution_user', 'active'),
      ('${users.student}', '${ids.tenantA}', 'student', 'active'),
      ('${users.inactive}', '${ids.tenantA}', 'unit_manager', 'inactive'),
      ('${users.otherAdmin}', '${ids.tenantB}', 'admin_general', 'active');
    INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
      ('${ids.tenantA}', '${users.supervisor}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.manager}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.operator}', '${ids.unitA1}'),
      ('${ids.tenantA}', '${users.inactive}', '${ids.unitA1}');
    INSERT INTO public.user_institution_access (tenant_id, user_id, institution_id) VALUES
      ('${ids.tenantA}', '${users.institution}', '${ids.institutionA}');
    INSERT INTO public.students (id, tenant_id, institution_id, user_id, full_name) VALUES
      ('${ids.studentA1}', '${ids.tenantA}', '${ids.institutionA}', '${users.student}', 'Estudante A1'),
      ('${ids.studentA2}', '${ids.tenantA}', '${ids.institutionA}', NULL, 'Estudante A2'),
      ('${ids.studentB}', '${ids.tenantA}', '${ids.institutionB}', NULL, 'Estudante B'),
      ('${ids.studentOther}', '${ids.tenantB}', '${ids.institutionOther}', NULL, 'Estudante Outro Tenant');
    INSERT INTO public.wallets (id, tenant_id, student_id, balance) VALUES
      ('${ids.walletA1}', '${ids.tenantA}', '${ids.studentA1}', 60),
      ('${ids.walletA2}', '${ids.tenantA}', '${ids.studentA2}', 25),
      ('${ids.walletB}', '${ids.tenantA}', '${ids.studentB}', 0),
      ('${ids.walletOther}', '${ids.tenantB}', '${ids.studentOther}', 999);
    INSERT INTO public.wallet_transactions (id, tenant_id, wallet_id, student_id, amount) VALUES
      ('7c500000-0000-4000-8000-000000000001', '${ids.tenantA}', '${ids.walletA1}', '${ids.studentA1}', 60),
      ('7c500000-0000-4000-8000-000000000002', '${ids.tenantB}', '${ids.walletOther}', '${ids.studentOther}', 999);
    INSERT INTO public.payments (id, tenant_id, student_id, amount) VALUES
      ('7c600000-0000-4000-8000-000000000001', '${ids.tenantA}', '${ids.studentA1}', 100),
      ('7c600000-0000-4000-8000-000000000002', '${ids.tenantA}', '${ids.studentA2}', 50),
      ('7c600000-0000-4000-8000-000000000003', '${ids.tenantB}', '${ids.studentOther}', 999);
    INSERT INTO public.recharges (id, tenant_id, student_id, wallet_id, unit_id, amount) VALUES
      ('7c700000-0000-4000-8000-000000000001', '${ids.tenantA}', '${ids.studentA1}', '${ids.walletA1}', '${ids.unitA1}', 100),
      ('7c700000-0000-4000-8000-000000000002', '${ids.tenantA}', '${ids.studentA2}', '${ids.walletA2}', '${ids.unitA2}', 50),
      ('7c700000-0000-4000-8000-000000000003', '${ids.tenantB}', '${ids.studentOther}', '${ids.walletOther}', '${ids.unitOther}', 999);
    INSERT INTO public.offline_contingency_events (id, tenant_id, unit_id, operator_id, student_id, status) VALUES
      ('7c800000-0000-4000-8000-000000000001', '${ids.tenantA}', '${ids.unitA1}', '${users.operator}', '${ids.studentA1}', 'received'),
      ('7c800000-0000-4000-8000-000000000002', '${ids.tenantA}', '${ids.unitB}', '${users.admin}', '${ids.studentB}', 'received'),
      ('7c800000-0000-4000-8000-000000000003', '${ids.tenantB}', '${ids.unitOther}', '${users.otherAdmin}', '${ids.studentOther}', 'received');
    INSERT INTO public.cash_shifts (id, tenant_id, unit_id, operator_id, status) VALUES
      ('7c900000-0000-4000-8000-000000000001', '${ids.tenantA}', '${ids.unitA1}', '${users.operator}', 'closed'),
      ('7c900000-0000-4000-8000-000000000002', '${ids.tenantA}', '${ids.unitA2}', '${users.admin}', 'closed'),
      ('7c900000-0000-4000-8000-000000000003', '${ids.tenantA}', '${ids.unitB}', '${users.admin}', 'opened'),
      ('7c900000-0000-4000-8000-000000000004', '${ids.tenantB}', '${ids.unitOther}', '${users.otherAdmin}', 'opened');
    INSERT INTO public.cash_movements (id, cash_shift_id, amount, operator_id) VALUES
      ('7cb00000-0000-4000-8000-000000000001', '7c900000-0000-4000-8000-000000000001', 10, '${users.operator}'),
      ('7cb00000-0000-4000-8000-000000000002', '7c900000-0000-4000-8000-000000000004', 20, '${users.otherAdmin}');
  `);
}

function normalizeServerPath(value) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

async function visibleCountsSequential(entries) {
  const counts = [];
  for (const [userId, table, role] of entries) {
    counts.push(await visibleCount(userId, table, role));
  }
  return counts;
}

async function main() {
  await client.connect();
  const identity = await client.query(`
    SELECT current_database() AS database, version() AS version,
           current_setting('data_directory') AS data_directory,
           pg_catalog.inet_server_port() AS port
  `);
  if (!identity.rows[0].database.startsWith('stage7c_')) {
    throw new Error(`Banco efetivo recusado: ${identity.rows[0].database}`);
  }
  if (!identity.rows[0].version.includes('PostgreSQL 17')) {
    throw new Error(`Versao recusada: ${identity.rows[0].version}`);
  }
  if (normalizeServerPath(identity.rows[0].data_directory) !== normalizeServerPath(expectedDataDirectory)) {
    throw new Error(`Diretorio de dados recusado: ${identity.rows[0].data_directory}`);
  }
  if (Number(identity.rows[0].port) !== expectedPort) {
    throw new Error(`Porta efetiva recusada: ${identity.rows[0].port}`);
  }

  await client.query('BEGIN');
  try {
    for (const sqlFile of sqlFiles) {
      await client.query(fs.readFileSync(sqlFile, 'utf8'));
    }

    const testedRoles = await client.query(`
      SELECT rolname, rolsuper, rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname IN ('anon', 'authenticated')
       ORDER BY rolname
    `);
    if (
      testedRoles.rowCount !== 2
      || testedRoles.rows.some((role) => role.rolsuper || role.rolbypassrls)
    ) {
      throw new Error('Papeis de teste ausentes ou com privilegio de bypass de RLS.');
    }
    await seed();

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='offline_contingency_events'
         AND column_name IN ('institution_id','consumption_date','conflict_reason','linked_consumption_id','financial_debit_applied','notes','updated_at')
    `);
    check(columns.rowCount === 7, 'Schema offline possui as sete colunas reconciliadas');

    const statusDefinition = await client.query(`
      SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='offline_contingency_events' AND column_name='status'
    `);
    const statusConstraint = await client.query(`
      SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
       WHERE conrelid='public.offline_contingency_events'::regclass AND conname='chk_offline_events_status'
    `);
    check(statusDefinition.rows[0].column_default.includes('received') && statusConstraint.rows[0].definition.includes('received'), 'Default e constraint offline aceitam received');

    const policies = await client.query(`
      SELECT policyname FROM pg_catalog.pg_policies
       WHERE schemaname='public' AND tablename='offline_contingency_events'
    `);
    check(policies.rowCount === 1 && policies.rows[0].policyname === 'sel_offline_events_scoped_staff', 'Policies offline convergiram para definicao unica');

    const privileges = await client.query(`
      SELECT
        pg_catalog.has_function_privilege('authenticated', 'public.reconcile_offline_consumptions(jsonb)', 'EXECUTE') AS reconcile,
        pg_catalog.has_function_privilege('authenticated', 'public.get_terminal_shift_snapshot(uuid)', 'EXECUTE') AS snapshot
    `);
    check(!privileges.rows[0].reconcile && !privileges.rows[0].snapshot, 'RPCs offline permanecem revogadas');

    check(await visibleCount(users.admin, 'offline_contingency_events') === 2, 'Admin ve offline somente do proprio tenant');
    check(await visibleCount(users.director, 'offline_contingency_events') === 2, 'Diretor ve offline somente do proprio tenant');
    check(await visibleCount(users.supervisor, 'offline_contingency_events') === 1, 'Supervisor ve offline somente da unidade atribuida');
    check(await visibleCount(users.manager, 'offline_contingency_events') === 1, 'Gerente ve offline somente da unidade atribuida');
    check(await visibleCount(users.operator, 'offline_contingency_events') === 1, 'Operador ve offline somente da unidade atribuida');
    check(await visibleCount(users.institution, 'offline_contingency_events') === 0, 'Usuario institucional nao ve offline');
    check(await visibleCount(users.student, 'offline_contingency_events') === 0, 'Consumidor nao ve offline');
    check(await visibleCount(users.inactive, 'offline_contingency_events') === 0, 'Usuario inativo nao ve offline');
    check(await visibleCount(users.otherAdmin, 'offline_contingency_events') === 1, 'Admin do outro tenant nao cruza offline');
    check(await visibleCount(null, 'offline_contingency_events', 'anon') === 0, 'Anonimo nao ve offline');

    check(await visibleCount(users.admin, 'wallets') === 3, 'Admin ve carteiras do proprio tenant');
    check(await visibleCount(users.finance, 'wallets') === 3, 'Financeiro ve carteiras do proprio tenant');
    check(await visibleCount(users.supervisor, 'wallets') === 0, 'Supervisor permanece fail-closed em carteiras');
    check(await visibleCount(users.manager, 'wallets') === 0, 'Gerente permanece fail-closed em carteiras');
    check(await visibleCount(users.supervisor, 'payments') === 0, 'Supervisor permanece fail-closed em pagamentos');
    check(await visibleCount(users.supervisor, 'recharges') === 0, 'Supervisor permanece fail-closed em recargas');
    check(await visibleCount(users.manager, 'payments') === 0, 'Gerente permanece fail-closed em pagamentos');
    check(await visibleCount(users.manager, 'recharges') === 0, 'Gerente permanece fail-closed em recargas');
    const inactiveFinancial = await visibleCountsSequential([
      [users.inactive, 'wallets'],
      [users.inactive, 'payments'],
      [users.inactive, 'recharges'],
    ]);
    check(inactiveFinancial.every((count) => count === 0), 'Usuario inativo nao ve dados financeiros');
    check(await visibleCount(users.otherAdmin, 'wallets') === 1, 'Admin do outro tenant ve somente sua carteira');

    check(await visibleCount(users.institution, 'students') === 2, 'Usuario institucional ve estudantes vinculados');
    check(await visibleCount(users.student, 'students') === 1, 'Consumidor ve somente o proprio cadastro');
    check(await visibleCount(users.supervisor, 'students') === 0, 'Supervisor sem vinculo institucional permanece fail-closed');
    check(await visibleCount(users.manager, 'students') === 0, 'Gerente sem vinculo institucional permanece fail-closed');

    check(await visibleCount(users.admin, 'cash_shifts') === 3, 'Admin ve caixas somente do proprio tenant');
    check(await visibleCount(users.otherAdmin, 'cash_shifts') === 1, 'Admin do outro tenant nao cruza caixas');
    const localCash = await visibleCountsSequential([
      [users.operator, 'cash_shifts'],
      [users.supervisor, 'cash_shifts'],
      [users.inactive, 'cash_shifts'],
      [users.otherAdmin, 'cash_movements'],
    ]);
    check(localCash[0] === 1 && localCash[1] === 1 && localCash[2] === 0 && localCash[3] === 1, 'Caixa e movimentos respeitam unidade, status e tenant', JSON.stringify(localCash));
  } finally {
    await asOwner().catch(() => {});
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }

  console.log(`RESULT passed=${passed} failed=${failed} total=${passed + failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(async (error) => {
  console.error(`FATAL code=${error.code || 'unknown'} message=${error.message}`);
  await client.end().catch(() => {});
  process.exitCode = 1;
});
