const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration72Path = path.join(
  root,
  'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql',
);
const migration73Path = path.join(
  root,
  'supabase/migrations/20261026000073_harden_scoped_read_policies.sql',
);
const migration72 = fs.readFileSync(migration72Path, 'utf8');
const migration73 = fs.readFileSync(migration73Path, 'utf8');
const stage7Sql = `${migration72}\n${migration73}`;

function includesAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

function policyBody(sql, policyName, tableName) {
  const start = sql.indexOf(`CREATE POLICY ${policyName}`);
  if (start < 0) return '';
  const tail = sql.slice(start);
  const end = tail.indexOf(';');
  const body = end >= 0 ? tail.slice(0, end + 1) : tail;
  return body.includes(`ON public.${tableName}`) ? body : '';
}

const walletStaff = policyBody(migration73, 'sel_wallets_staff', 'wallets');
const paymentStaff = policyBody(migration73, 'sel_payments_staff', 'payments');
const rechargeStaff = policyBody(migration73, 'sel_recharges_staff', 'recharges');
const offlineStaff = policyBody(
  migration72,
  'sel_offline_events_scoped_staff',
  'offline_contingency_events',
);
const studentPolicy = policyBody(migration73, 'sel_students', 'students');
const cashShiftSelect = policyBody(migration73, 'cash_shifts_select_policy', 'cash_shifts');
const cashMovementSelect = policyBody(
  migration73,
  'cash_movements_select_policy',
  'cash_movements',
);

const scenarios = [
  ['01 offline com RLS habilitada', migration72.includes('ALTER TABLE public.offline_contingency_events ENABLE ROW LEVEL SECURITY')],
  ['02 policies offline convergidas', includesAll(migration72, ["FROM pg_catalog.pg_policies", "tablename = 'offline_contingency_events'", 'DROP POLICY %I'])],
  ['03 offline isolado por tenant', offlineStaff.includes('tenant_id = public.get_auth_tenant_id()')],
  ['04 offline exige perfil ativo', offlineStaff.includes("public.get_auth_user_status() = 'active'")],
  ['05 offline limita papeis operacionais', includesAll(offlineStaff, ["'admin_general'", "'operations_director'", "'supervisor'", "'unit_manager'", "'operator'"])],
  ['06 offline exige escopo de unidade', offlineStaff.includes('public.has_unit_access(unit_id)')],
  ['07 usuario institucional sem livro offline', !offlineStaff.includes("'institution_user'")],
  ['08 consumidor sem livro offline', !offlineStaff.includes("'student'")],
  ['09 inativo sem livro offline', offlineStaff.includes("public.get_auth_user_status() = 'active'")],
  ['10 RPC offline revogada de PUBLIC', /reconcile_offline_consumptions\(JSONB\)[\s\S]*?FROM PUBLIC, anon, authenticated;/.test(migration72)],
  ['11 RPC offline revogada de anon', /reconcile_offline_consumptions\(JSONB\)[\s\S]*?FROM PUBLIC, anon, authenticated;/.test(migration72)],
  ['12 RPC offline revogada de authenticated', /reconcile_offline_consumptions\(JSONB\)[\s\S]*?FROM PUBLIC, anon, authenticated;/.test(migration72)],
  ['13 status recebido reproduzivel', includesAll(migration72, ["ALTER COLUMN status SET DEFAULT 'received'", "'received'"])],
  ['14 colunas offline reconciliadas', includesAll(migration72, ['institution_id UUID', 'consumption_date DATE', 'conflict_reason TEXT', 'linked_consumption_id UUID', 'financial_debit_applied BOOLEAN', 'notes TEXT', 'updated_at TIMESTAMPTZ'])],
  ['15 supervisor sem carteira global', !walletStaff.includes("'supervisor'")],
  ['16 gerente sem carteira global', !walletStaff.includes("'unit_manager'")],
  ['17 supervisor sem pagamentos globais', !paymentStaff.includes("'supervisor'")],
  ['18 supervisor sem recargas globais', !rechargeStaff.includes("'supervisor'")],
  ['19 gerente sem pagamentos globais', !paymentStaff.includes("'unit_manager'")],
  ['20 gerente sem recargas globais', !rechargeStaff.includes("'unit_manager'")],
  ['21 supervisor nao infere estudante pela unidade', !migration73.includes('JOIN public.user_unit_access')],
  ['22 gerente nao infere estudante pela unidade', !migration73.includes('JOIN public.units AS unit')],
  ['23 instituicao le estudantes explicitamente vinculados', includesAll(migration73, ["'institution_user'", 'public.user_institution_access'])],
  ['24 consumidor le apenas o proprio estudante', studentPolicy.includes('user_id = auth.uid()')],
  ['25 caixa isolado por tenant', cashShiftSelect.includes('tenant_id = public.get_auth_tenant_id()')],
  ['26 caixa exige perfil ativo', cashShiftSelect.includes("public.get_auth_user_status() = 'active'")],
  ['27 caixa de perfil local exige unidade', cashShiftSelect.includes('public.has_unit_access(unit_id)')],
  ['28 movimento herda tenant do turno', cashMovementSelect.includes('shift.tenant_id = public.get_auth_tenant_id()')],
  ['29 movimento herda unidade do turno', cashMovementSelect.includes('public.has_unit_access(shift.unit_id)')],
  ['30 policies financeiras exigem perfil ativo', [walletStaff, paymentStaff, rechargeStaff].every((body) => body.includes("public.get_auth_user_status() = 'active'"))],
  ['31 migration nao desabilita RLS nem expoe service role', !/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(stage7Sql) && !/SUPABASE_SERVICE_ROLE_KEY/.test(stage7Sql)],
];

let passed = 0;
for (const [name, condition] of scenarios) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}`);
  }
}

console.log(`RESULT passed=${passed} failed=${scenarios.length - passed} total=${scenarios.length}`);
if (passed !== scenarios.length) process.exitCode = 1;
