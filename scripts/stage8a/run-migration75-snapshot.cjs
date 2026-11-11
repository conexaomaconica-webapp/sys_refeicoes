const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const sqlPath = path.join(root, 'scripts/stage8a/05-migration75-preapply-readonly.sql');
const evidenceDirectory = path.join(root, 'docs/evidence/stage8a');
const projectRef = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();

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
  if (!/^postgres(?:\.|$)/i.test(username)) fail('Snapshot administrativo exige a identidade esperada.');
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
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

function snapshotQuery() {
  const source = fs.readFileSync(sqlPath, 'utf8');
  const forbidden = /^\s*(?:alter|create|delete|do|drop|grant|insert|notify|revoke|truncate|update)\b/im;
  if (forbidden.test(source)) fail('Snapshot contem comando de escrita recusado.');
  const query = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('\\'))
    .filter((line) => !/^\s*(?:BEGIN TRANSACTION READ ONLY|SET LOCAL|ROLLBACK);?\s*$/i.test(line))
    .join('\n')
    .trim();
  if (!/^--[\s\S]*?WITH\s+targets/im.test(query) || !query.endsWith(';')) fail('Consulta de snapshot invalida.');
  return query;
}

async function main() {
  if (process.env.STAGE8A_ALLOW_ADMIN_SNAPSHOT !== 'YES') {
    fail('Defina STAGE8A_ALLOW_ADMIN_SNAPSHOT=YES somente durante a janela autorizada.');
  }
  const client = new Client({
    connectionString: dbUrl(),
    ssl: tlsOptions(),
    application_name: 'ma-refeicoes-stage8a-migration75-snapshot',
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
    const result = await client.query(snapshotQuery());
    const snapshot = result.rows[0]?.jsonb_build_object;
    if (!snapshot || typeof snapshot !== 'object') fail('Snapshot retornou formato inesperado.');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(evidenceDirectory, `stage8a-migration75-snapshot-${timestamp}.json`);
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`STAGE8A_SNAPSHOT_WRITTEN ${path.relative(root, target)}`);
    console.log(`STAGE8A_SNAPSHOT_SUMMARY functions=${snapshot.functions?.length ?? -1} missing=${snapshot.missingSignatures?.length ?? -1} migration75Recorded=${Boolean(snapshot.migration75Recorded)}`);
  } finally {
    if (connected) {
      try { await client.query('ROLLBACK'); } catch { /* conexao pode ter sido encerrada */ }
      await client.end().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(`STAGE8A_SNAPSHOT_ABORTED ${error.code ?? 'ERROR'} ${error.message}`);
  process.exitCode = 1;
});

