const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, 'docs', 'evidence', 'stage8a');
const projectRefPath = path.join(root, 'supabase', '.temp', 'project-ref');
const inventorySqlPath = path.join(root, 'scripts', 'stage7d', 'staging-inventory-readonly.sql');

function fail(message) {
  throw new Error(message);
}

function outputPath() {
  const flag = process.argv.indexOf('--output');
  const value = flag >= 0 ? process.argv[flag + 1] : null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resolved = value
    ? path.resolve(process.cwd(), value)
    : path.join(evidenceRoot, `stage8a-inventory-${timestamp}.json`);
  const relative = path.relative(evidenceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(resolved) !== '.json') {
    fail('A evidencia deve ser um JSON dentro de docs/evidence/stage8a.');
  }
  return resolved;
}

function validateTarget(rawUrl, projectRef) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail('STAGE8A_DB_URL invalida.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('Somente PostgreSQL e permitido.');
  if (!url.hostname.endsWith('.supabase.com')) fail('Destino fora do dominio Supabase autorizado.');
  if (url.pathname !== '/postgres') fail('O banco de destino deve ser postgres.');
  const username = decodeURIComponent(url.username);
  if (!username || /^postgres(?:\.|$)/i.test(username) || /service[_-]?role/i.test(username)) {
    fail('Credencial administrativa recusada; use um papel dedicado read-only.');
  }
  if (!url.hostname.includes(projectRef) && !username.endsWith(`.${projectRef}`)) {
    fail('A URL nao corresponde ao project-ref autorizado.');
  }
  if (!url.password) fail('Credencial sem senha recusada.');
  return url;
}

function inventoryQuery() {
  const sql = fs.readFileSync(inventorySqlPath, 'utf8');
  const match = sql.match(/SELECT jsonb_build_object\([\s\S]*?\)::text;/);
  if (!match) fail('Consulta de inventario nao encontrada.');
  return match[0];
}

async function assertLeastPrivilege(client) {
  const roleResult = await client.query(`
    SELECT role.rolsuper,
           role.rolbypassrls,
           role.rolcreaterole,
           role.rolcreatedb,
           role.rolreplication,
           current_setting('transaction_read_only') AS transaction_read_only,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
           EXISTS (
             SELECT 1
             FROM pg_catalog.pg_class AS class
             JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
             WHERE namespace.nspname = 'public'
               AND class.relkind IN ('r', 'p')
               AND has_table_privilege(
                 current_user,
                 class.oid,
                 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               )
           ) AS can_mutate_public,
           EXISTS (
             SELECT 1
             FROM pg_catalog.pg_class AS class
             JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
             WHERE namespace.nspname = 'public'
               AND class.relkind IN ('r', 'p')
               AND has_table_privilege(current_user, class.oid, 'SELECT')
           ) AS can_read_operational
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `);
  const role = roleResult.rows[0];
  if (!role) fail('Papel PostgreSQL atual nao identificado.');
  if (role.transaction_read_only !== 'on') fail('Transacao nao esta em modo read-only.');
  if (role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication) {
    fail('Papel possui privilegios administrativos e foi recusado.');
  }
  if (role.can_create_public || role.can_mutate_public || role.can_read_operational) {
    fail('Papel possui privilegios excessivos no schema public e foi recusado.');
  }
}

async function main() {
  if (process.env.STAGE8A_ALLOW_REMOTE_READONLY !== 'YES') {
    fail('Defina STAGE8A_ALLOW_REMOTE_READONLY=YES somente durante a janela autorizada.');
  }
  const rawUrl = process.env.STAGE8A_DB_URL;
  if (!rawUrl) fail('STAGE8A_DB_URL nao configurada; SUPABASE_DB_URL nao e aceita.');
  const projectRef = fs.readFileSync(projectRefPath, 'utf8').trim();
  validateTarget(rawUrl, projectRef);

  const client = new Client({
    connectionString: rawUrl,
    ssl: { rejectUnauthorized: true },
    application_name: 'ma-refeicoes-stage8a-readonly',
    connectionTimeoutMillis: 10_000,
    query_timeout: 35_000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '45s'");
    await assertLeastPrivilege(client);
    const result = await client.query(inventoryQuery());
    const rawInventory = result.rows[0]?.jsonb_build_object;
    if (!rawInventory) fail('Inventario retornou vazio.');
    const inventory = typeof rawInventory === 'string' ? JSON.parse(rawInventory) : rawInventory;
    const target = outputPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`STAGE8A_INVENTORY_WRITTEN ${path.relative(root, target)}`);
  } finally {
    if (connected) {
      try { await client.query('ROLLBACK'); } catch { /* conexao pode ter sido encerrada */ }
      await client.end().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`STAGE8A_ABORTED ${error.message}`);
  process.exitCode = 1;
});
