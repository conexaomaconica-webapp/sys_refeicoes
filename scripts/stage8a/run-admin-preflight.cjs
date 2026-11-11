const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const projectRef = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
const sourcePath = path.join(root, 'scripts/stage8a/supabase-sql-editor/01-preflight-readonly.sql');
const evidenceDirectory = path.join(root, 'docs/evidence/stage8a');

function fail(message) { throw new Error(message); }

function dbUrl() {
  const env = fs.readFileSync(envPath, 'utf8');
  const match = env.match(/^SUPABASE_DB_URL=["']?([^"'\r\n]+)["']?$/m);
  if (!match) fail('SUPABASE_DB_URL nao configurada.');
  const parsed = new URL(match[1].trim());
  const username = decodeURIComponent(parsed.username);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('Protocolo PostgreSQL obrigatorio.');
  if (!parsed.hostname.endsWith('.supabase.com')) fail('Host fora do Supabase.');
  if (!parsed.hostname.includes(projectRef) && !username.endsWith(`.${projectRef}`)) fail('Project-ref divergente.');
  if (!/^postgres(?:\.|$)/i.test(username)) fail('Preflight administrativo exige a identidade esperada.');
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

function selectQuery() {
  const sql = fs.readFileSync(sourcePath, 'utf8');
  const match = sql.match(/SELECT jsonb_pretty\([\s\S]*?\) AS stage8a_preflight;/);
  if (!match) fail('Consulta de preflight nao encontrada.');
  return match[0];
}

function tlsOptions() {
  const certificatePath = process.env.STAGE8A_CA_CERT_PATH;
  if (!certificatePath) return { rejectUnauthorized: true };
  const resolved = path.resolve(certificatePath);
  if (!fs.existsSync(resolved) || !['.crt', '.cer', '.pem'].includes(path.extname(resolved).toLowerCase())) {
    fail('STAGE8A_CA_CERT_PATH deve apontar para um certificado existente.');
  }
  return { ca: fs.readFileSync(resolved, 'utf8'), rejectUnauthorized: true };
}

async function main() {
  const client = new Client({
    connectionString: dbUrl(),
    ssl: tlsOptions(),
    application_name: 'ma-refeicoes-stage8a-admin-preflight',
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
    const result = await client.query(selectQuery());
    const raw = result.rows[0]?.stage8a_preflight;
    if (!raw) fail('Preflight retornou vazio.');
    const evidence = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(evidenceDirectory, `stage8a-admin-preflight-${timestamp}.json`);
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`STAGE8A_PREFLIGHT_WRITTEN ${path.relative(root, target)}`);
    console.log(`STAGE8A_PREFLIGHT_SUMMARY roleExists=${Boolean(evidence.auditorRoleAlreadyExists)} publicCreate=${Boolean(evidence.publicCanCreateInPublicSchema)} publicTablePrivileges=${evidence.publicTablePrivileges?.length ?? -1} publicSensitiveExecutables=${evidence.publicSensitiveExecutables?.length ?? -1}`);
  } finally {
    if (connected) {
      try { await client.query('ROLLBACK'); } catch { /* conexao pode ter sido encerrada */ }
      await client.end().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`STAGE8A_PREFLIGHT_ABORTED ${error.code ?? 'ERROR'} ${error.message}`);
  process.exitCode = 1;
});
