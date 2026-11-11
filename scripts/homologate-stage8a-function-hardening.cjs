const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const connectionString = process.env.STAGE8A_DB_URL;
const expectedDataDirectory = process.env.STAGE8A_EXPECTED_DATA_DIR;
const expectedPort = Number(process.env.STAGE8A_EXPECTED_PORT || 0);
const evidenceJson = process.env.STAGE8A_EVIDENCE_JSON;
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (!connectionString || !expectedDataDirectory || !evidenceJson) {
  throw new Error('Variaveis STAGE8A obrigatorias nao foram informadas.');
}
if (!Number.isInteger(expectedPort) || expectedPort < 1024 || expectedPort > 65535) {
  throw new Error('STAGE8A_EXPECTED_PORT deve ser uma porta local nao privilegiada.');
}
const target = new URL(connectionString);
if (!allowedHosts.has(target.hostname)) throw new Error(`Host recusado: ${target.hostname}.`);
if (!target.pathname.slice(1).startsWith('stage8a_')) throw new Error('Banco deve usar prefixo stage8a_.');

const files = {
  bootstrap: 'scripts/stage7c/bootstrap.sql',
  operational: 'scripts/stage7d/extend-operational-baseline.sql',
  hardeningBaseline: 'scripts/stage8a/function-hardening-baseline.sql',
  migration72: 'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql',
  migration73: 'supabase/migrations/20261026000073_harden_scoped_read_policies.sql',
  migration74: 'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql',
  migration75: 'supabase/migrations/20261027000075_harden_public_function_execution.sql',
};
for (const [key, value] of Object.entries(files)) files[key] = path.join(root, value);

const signatures = [
  'public.admin_list_cash_shifts(uuid,character varying,date,date)',
  'public.get_active_cash_shift(uuid,character varying)',
  'public.get_terminal_shift_reports(uuid,uuid,text)',
  'public.record_cash_movement(uuid,character varying,numeric,character varying,text)',
  'public.register_visitor_entry(uuid,uuid,text,character varying)',
  'public.enrich_cash_movement()',
  'public.handle_updated_at()',
  'public.refresh_cash_shift_payment_totals()',
  'public.sync_imported_consumer_identity()',
  'public.trg_prevent_profile_escalation()',
  'public.trg_prevent_student_tampering()',
  'public.rls_auto_enable()',
];
const legacySignatures = signatures.slice(0, 2).concat(signatures.slice(3, 5));
const triggerSignatures = signatures.slice(5);
const owner = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, passed: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${String(checks.length).padStart(2, '0')} ${name}${detail ? ` | ${detail}` : ''}`);
}

function sql(file) { return fs.readFileSync(file, 'utf8'); }

async function publicExecutable() {
  const result = await owner.query(`
    SELECT signature,
           EXISTS (
             SELECT 1
               FROM pg_catalog.pg_proc AS procedure,
                    LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) AS acl
              WHERE procedure.oid = pg_catalog.to_regprocedure(signature)
                AND acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS executable
      FROM pg_catalog.unnest($1::TEXT[]) AS signature
     ORDER BY signature
  `, [signatures]);
  return result.rows;
}

async function roleExecutable(role, selected = signatures) {
  const result = await owner.query(`
    SELECT signature,
           pg_catalog.has_function_privilege($1, pg_catalog.to_regprocedure(signature), 'EXECUTE') AS executable
      FROM pg_catalog.unnest($2::TEXT[]) AS signature
     ORDER BY signature
  `, [role, selected]);
  return result.rows;
}

async function identityClient(userId) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await client.query('SET ROLE authenticated');
  return client;
}

async function denied(query, params = []) {
  const client = await identityClient('8a000000-0000-4000-8000-000000000002');
  try {
    await client.query(query, params);
    return false;
  } catch (error) {
    return error.code === '42501';
  } finally {
    await client.end();
  }
}

async function main() {
  await owner.connect();
  const server = (await owner.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num')::INTEGER AS version_num,
           current_setting('data_directory') AS data_directory,
           pg_catalog.host(inet_server_addr()) AS address,
           current_setting('listen_addresses') AS listen_addresses,
           inet_server_port() AS port
  `)).rows[0];
  check('PostgreSQL 17 descartavel confirmado', server.version_num >= 170000 && server.version_num < 180000);
  check('banco descartavel confirmado', server.database_name.startsWith('stage8a_'));
  check('data directory exclusivo confirmado', path.resolve(server.data_directory).toLowerCase() === path.resolve(expectedDataDirectory).toLowerCase());
  check('listener restrito a loopback', server.address === '127.0.0.1' && server.listen_addresses === '127.0.0.1' && Number(server.port) === expectedPort);

  await owner.query('BEGIN');
  try {
    await owner.query(sql(files.bootstrap));
    await owner.query(sql(files.operational));
    await owner.query(sql(files.hardeningBaseline));
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
  const roles = await owner.query("SELECT rolname, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname");
  check('papeis de aplicacao sem superuser ou bypass RLS', roles.rowCount === 2 && roles.rows.every((role) => !role.rolsuper && !role.rolbypassrls));
  const definitions = await owner.query(`SELECT pg_catalog.to_regprocedure(signature)::TEXT AS signature FROM pg_catalog.unnest($1::TEXT[]) AS signature`, [signatures]);
  check('baseline contem as 12 assinaturas reais', definitions.rowCount === 12 && definitions.rows.every((row) => row.signature));
  const before = await publicExecutable();
  check('baseline reproduz EXECUTE de PUBLIC nas 12 funcoes', before.every((row) => row.executable));

  await owner.query('BEGIN');
  await owner.query(sql(files.migration72));
  await owner.query(sql(files.migration73));
  await owner.query(sql(files.migration74));
  await owner.query(sql(files.migration75));
  const duringRollbackProbe = await publicExecutable();
  check('migrations 72 a 75 compilam juntas', duringRollbackProbe.every((row) => !row.executable));
  await owner.query('ROLLBACK');
  const afterRollback = await publicExecutable();
  check('rollback restaura integralmente os ACLs anteriores', afterRollback.every((row) => row.executable));

  await owner.query('BEGIN');
  try {
    for (const file of [files.migration72, files.migration73, files.migration74, files.migration75]) await owner.query(sql(file));
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
  const after = await publicExecutable();
  check('migration 75 remove EXECUTE de PUBLIC nas 12 funcoes', after.every((row) => !row.executable));
  const authLegacy = await roleExecutable('authenticated', legacySignatures);
  check('authenticated nao executa as quatro RPCs legadas', authLegacy.every((row) => !row.executable));
  const authReport = await roleExecutable('authenticated', [signatures[2]]);
  const anonReport = await roleExecutable('anon', [signatures[2]]);
  check('somente authenticated conserva EXECUTE da RPC ativa', authReport[0].executable && !anonReport[0].executable);
  const authTriggers = await roleExecutable('authenticated', triggerSignatures);
  const anonTriggers = await roleExecutable('anon', triggerSignatures);
  check('funcoes de trigger nao sao chamaveis por papeis de aplicacao', authTriggers.every((row) => !row.executable) && anonTriggers.every((row) => !row.executable));

  const tenant = '8a100000-0000-4000-8000-000000000001';
  const institution = '8a200000-0000-4000-8000-000000000001';
  const unitA = '8a300000-0000-4000-8000-000000000001';
  const unitB = '8a300000-0000-4000-8000-000000000002';
  const user = '8a000000-0000-4000-8000-000000000001';
  await owner.query("INSERT INTO public.tenants(id,name) VALUES ($1,'Tenant A')", [tenant]);
  await owner.query("INSERT INTO public.institutions(id,tenant_id,name) VALUES ($1,$2,'Instituicao A')", [institution, tenant]);
  await owner.query("INSERT INTO public.units(id,tenant_id,institution_id,name) VALUES ($1,$3,$2,'Unidade A'),($4,$3,$2,'Unidade B')", [unitA, institution, tenant, unitB]);
  await owner.query("INSERT INTO public.profiles(id,tenant_id,role,status) VALUES ($1,$2,'supervisor','active')", [user, tenant]);
  await owner.query('INSERT INTO public.user_unit_access(tenant_id,user_id,unit_id) VALUES ($1,$2,$3)', [tenant, user, unitA]);
  await owner.query("INSERT INTO public.stage8a_updated_probe VALUES (1,'antes','2000-01-01')");
  await owner.query('INSERT INTO public.stage8a_total_probe VALUES (1,0)');
  await owner.query("INSERT INTO public.stage8a_profile_probe VALUES (1,$1,'operator','active')", [tenant]);
  await owner.query("INSERT INTO public.stage8a_student_probe VALUES (1,$1,'Aluno','a@example.test')", [tenant]);

  const client = await identityClient(user);
  try {
    const report = (await client.query('SELECT public.get_terminal_shift_reports($1,$2,$3) AS value', [unitA, null, 'T-01'])).rows[0].value;
    check('RPC ativa responde no escopo autorizado', report.unit_id === unitA && report.tenant_id === tenant);
    let crossDenied = false;
    try { await client.query('SELECT public.get_terminal_shift_reports($1,$2,$3)', [unitB, null, 'T-01']); } catch (error) { crossDenied = error.code === '42501'; }
    check('RPC ativa bloqueia acesso cruzado por unidade', crossDenied);
    await client.query("UPDATE public.stage8a_updated_probe SET value='depois' WHERE id=1");
    const updated = (await client.query('SELECT updated_at > $1::timestamptz AS ok FROM public.stage8a_updated_probe WHERE id=1', ['2000-01-02'])).rows[0].ok;
    check('trigger handle_updated_at continua funcional', updated);
    await client.query('INSERT INTO public.stage8a_movement_probe(id,amount) VALUES (1,12.50)');
    const movement = (await client.query('SELECT enriched FROM public.stage8a_movement_probe WHERE id=1')).rows[0];
    const total = (await client.query('SELECT total FROM public.stage8a_total_probe WHERE id=1')).rows[0];
    check('triggers de caixa continuam funcionais', movement.enriched && Number(total.total) === 12.5);
    await client.query("INSERT INTO public.stage8a_identity_probe VALUES (1,'{}',false)");
    const synced = (await client.query('SELECT synchronized FROM public.stage8a_identity_probe WHERE id=1')).rows[0].synchronized;
    check('trigger de sincronizacao continua funcional', synced);
    await client.query("UPDATE public.stage8a_student_probe SET email='b@example.test' WHERE id=1");
    check('trigger de estudante permite campo autorizado', true);
  } finally {
    await client.end();
  }
  check('trigger de perfil bloqueia escalada', await denied("UPDATE public.stage8a_profile_probe SET role='admin_general' WHERE id=1"));
  check('trigger de estudante bloqueia adulteracao', await denied("UPDATE public.stage8a_student_probe SET full_name='Outro' WHERE id=1"));
  await owner.query('CREATE TABLE public.stage8a_event_trigger_probe(id INTEGER)');
  const eventTrigger = await owner.query("SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname='stage8a_rls_auto_enable_probe'");
  check('event trigger continua associado e executavel', eventTrigger.rowCount === 1 && eventTrigger.rows[0].evtenabled !== 'D');

  const aclBeforeSecondApply = (await owner.query(`SELECT oid::regprocedure::TEXT AS signature, proacl::TEXT AS acl FROM pg_catalog.pg_proc WHERE oid = ANY($1::regprocedure[]) ORDER BY 1`, [signatures])).rows;
  await owner.query('BEGIN');
  try { await owner.query(sql(files.migration75)); await owner.query('COMMIT'); } catch (error) { await owner.query('ROLLBACK'); throw error; }
  const aclAfterSecondApply = (await owner.query(`SELECT oid::regprocedure::TEXT AS signature, proacl::TEXT AS acl FROM pg_catalog.pg_proc WHERE oid = ANY($1::regprocedure[]) ORDER BY 1`, [signatures])).rows;
  check('segunda aplicacao da migration 75 e idempotente', JSON.stringify(aclBeforeSecondApply) === JSON.stringify(aclAfterSecondApply));
  const finalPublic = await publicExecutable();
  check('pos-condicao permanece valida apos reaplicacao', finalPublic.every((row) => !row.executable));

  const result = { stage: '8A.4', generatedAt: new Date().toISOString(), server: { versionNum: server.version_num, address: server.address, listenAddresses: server.listen_addresses, port: Number(server.port) }, checks, summary: { passed: checks.filter((item) => item.passed).length, failed: checks.filter((item) => !item.passed).length, total: checks.length } };
  fs.mkdirSync(path.dirname(evidenceJson), { recursive: true });
  fs.writeFileSync(evidenceJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`RESULT passed=${result.summary.passed} failed=${result.summary.failed} total=${result.summary.total}`);
  if (result.summary.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(`STAGE8A_ERROR ${error.code || 'ERR'} ${error.message}`); process.exitCode = 1; }).finally(async () => { try { await owner.end(); } catch {} });
