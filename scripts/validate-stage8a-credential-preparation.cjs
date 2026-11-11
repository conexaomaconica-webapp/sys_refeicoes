const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'scripts/stage8a');
const preflight = fs.readFileSync(path.join(directory, '01-preflight-admin-readonly.sql'), 'utf8');
const create = fs.readFileSync(path.join(directory, '02-create-auditor.sql'), 'utf8');
const verify = fs.readFileSync(path.join(directory, '03-verify-as-auditor.sql'), 'utf8');
const revoke = fs.readFileSync(path.join(directory, '04-revoke-auditor.sql'), 'utf8');
const editorDirectory = path.join(directory, 'supabase-sql-editor');
const editorPreflight = fs.readFileSync(path.join(editorDirectory, '01-preflight-readonly.sql'), 'utf8');
const editorCreate = fs.readFileSync(path.join(editorDirectory, '02-create-temporary-auditor.sql'), 'utf8');
const editorRevoke = fs.readFileSync(path.join(editorDirectory, '03-revoke-temporary-auditor.sql'), 'utf8');
const report = fs.readFileSync(path.join(root, 'docs/STAGE_8A1_AUDIT_CREDENTIAL_PREPARATION.md'), 'utf8');
const adminPreflightRunner = fs.readFileSync(path.join(directory, 'run-admin-preflight.cjs'), 'utf8');
const checks = [];

function check(name, condition) { checks.push([name, Boolean(condition)]); }

check('preflight e read-only com rollback', preflight.includes('BEGIN TRANSACTION READ ONLY') && preflight.trimEnd().endsWith('ROLLBACK;'));
check('preflight inventaria privilegios herdados de PUBLIC', preflight.includes('acl.grantee = 0') && preflight.includes('publicOperationalPrivileges'));
check('preflight identifica funcoes sensiveis executaveis', preflight.includes('publicSensitiveExecutables') && preflight.includes("procedure.provolatile = 'v'"));
check('criacao exige PostgreSQL 17 e historico Supabase', create.includes('STAGE8A_REQUIRES_POSTGRESQL_17') && create.includes('MIGRATION_HISTORY_NOT_FOUND'));
check('criacao falha se o papel ja existe', create.includes('STAGE8A_AUDITOR_ALREADY_EXISTS'));
check('criacao bloqueia CREATE herdado de PUBLIC', create.includes('PUBLIC_CAN_CREATE_IN_PUBLIC_SCHEMA'));
check('criacao bloqueia acesso operacional herdado de PUBLIC', create.includes('PUBLIC_CAN_ACCESS_OPERATIONAL_TABLES'));
check('criacao bloqueia execucao sensivel herdada de PUBLIC', create.includes('PUBLIC_CAN_EXECUTE_SENSITIVE_FUNCTIONS'));
check('papel usa flags minimas e conexao unica', ['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOINHERIT', 'NOREPLICATION', 'NOBYPASSRLS', 'CONNECTION LIMIT 1'].every((token) => create.includes(token)));
check('senha usa prompt seguro e nao variavel de shell', create.includes('\\password ma_stage8a_auditor') && !create.includes('stage8a_password'));
check('validade temporaria e obrigatoria', create.includes('stage8a_valid_until') && create.includes('VALID UNTIL'));
check('default read-only e timeouts sao definidos', ['default_transaction_read_only', 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout'].every((token) => create.includes(token)));
check('unico SELECT concedido e na coluna version', create.includes('GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations') && !/GRANT SELECT ON .*public\./i.test(create));
check('nenhuma execucao de funcao e concedida', !/GRANT EXECUTE/i.test(create));
check('verificacao recusa leitura e escrita operacional', verify.includes("has_table_privilege(pg_catalog.current_user, class.oid, 'SELECT')") && verify.includes('INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
check('verificacao recusa funcoes sensiveis efetivas', verify.includes('has_function_privilege') && verify.includes("procedure.provolatile = 'v'"));
check('verificacao exige apenas coluna version do historico', verify.includes('has_column_privilege') && verify.includes("'version'") && verify.includes('count(version)'));
check('revogacao bloqueia novos logins primeiro', revoke.indexOf('NOLOGIN') < revoke.indexOf('pg_stat_activity'));
check('revogacao nao encerra sessoes automaticamente', !revoke.includes('pg_terminate_backend'));
check('revogacao recusa papel com objetos', revoke.includes('STAGE8A_AUDITOR_OWNS_OBJECTS') && !revoke.includes('DROP OWNED') && !revoke.includes('REASSIGN OWNED'));
check('revogacao remove grants antes de excluir papel', revoke.indexOf('REVOKE SELECT') < revoke.indexOf('DROP ROLE'));
check('scripts nao aplicam migrations 72 73 ou 74', !/2026102[67]00007[234]/.test([preflight, create, verify, revoke].join('\n')));
check('pacote SQL Editor possui preflight read-only', editorPreflight.includes('BEGIN TRANSACTION READ ONLY') && editorPreflight.trimEnd().endsWith('ROLLBACK;'));
check('SQL Editor gera segredo aleatorio sem literal', editorCreate.includes('gen_random_uuid()') && editorCreate.includes('CREATE TEMP TABLE stage8a_generated_secret') && !/PASSWORD\s+'[^']+'/i.test(editorCreate));
check('segredo temporario expira em duas horas', editorCreate.includes("interval '2 hours'") && editorCreate.includes('VALID UNTIL %L'));
check('tabela de segredo desaparece no commit', editorCreate.includes('ON COMMIT DROP'));
check('SQL Editor preserva os mesmos guards de PUBLIC', ['PUBLIC_CAN_CREATE_IN_PUBLIC_SCHEMA', 'PUBLIC_CAN_ACCESS_PUBLIC_TABLES', 'PUBLIC_CAN_EXECUTE_SENSITIVE_FUNCTIONS'].every((token) => editorCreate.includes(token)));
check('revogacao SQL Editor nao mata sessoes nem objetos', editorRevoke.includes('NOLOGIN') && !editorRevoke.includes('pg_terminate_backend') && !editorRevoke.includes('DROP OWNED'));
check('pacote SQL Editor nao e migration', ![editorPreflight, editorCreate, editorRevoke].some((sql) => /INSERT INTO supabase_migrations\.schema_migrations/i.test(sql)));
check('runner administrativo executa somente preflight read-only', adminPreflightRunner.includes('BEGIN TRANSACTION READ ONLY') && adminPreflightRunner.includes("client.query('ROLLBACK')") && !/CREATE ROLE|GRANT CONNECT|DROP ROLE/.test(adminPreflightRunner));
check('runner administrativo exige TLS verificado', adminPreflightRunner.includes('rejectUnauthorized: true') && adminPreflightRunner.includes('STAGE8A_CA_CERT_PATH'));
check('relatorio nao declara execucao remota concluida', report.includes('ainda não confirmada') && report.includes('não realizou conexão nem comando remoto'));
check('relatorio mantem 8B 8C e producao bloqueados', report.includes('Etapas 8B, 8C, integração real e produção permanecem em **NO-GO**'));

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
