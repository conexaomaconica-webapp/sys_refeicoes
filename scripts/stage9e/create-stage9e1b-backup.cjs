const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { decryptReadable, encryptReadable, sha256File, verifyEncrypted } = require('./backup-crypto.cjs');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const EXPECTED_BACKUP_ROOT = path.resolve('C:\\MARefeicoes-Backups');

function fail(message) {
  throw new Error(message);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function envValue(name) {
  const source = fs.readFileSync(envPath, 'utf8');
  const match = source.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)["']?$`, 'm'));
  return match?.[1]?.trim() || null;
}

function pgEnvironment(certificatePath) {
  const raw = envValue('SUPABASE_DB_URL');
  if (!raw) fail('SUPABASE_DB_URL ausente.');
  const url = new URL(raw);
  if (!url.hostname.endsWith('.supabase.com') || url.pathname !== '/postgres') {
    fail('Destino PostgreSQL fora do Supabase vinculado.');
  }
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: 'postgres',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: certificatePath,
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'ma-refeicoes-stage9e1b-backup',
  };
}

function safeError(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/sbp_[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .slice(-3000);
}

async function spawnEncrypted(executable, args, environment, outputPath, key) {
  const child = spawn(executable, args, {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-6000);
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  const encrypted = await encryptReadable(child.stdout, outputPath, key);
  const code = await exit;
  if (code !== 0) fail(`Utilitario PostgreSQL falhou (${code}): ${safeError(stderr)}`);
  return encrypted;
}

async function listStorageFiles(client, bucketId, prefix = '') {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucketId).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) fail(`Falha ao listar Storage: ${error.message}`);
    const entries = data || [];
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) files.push({ path: objectPath, metadata: entry.metadata || null });
      else files.push(...await listStorageFiles(client, bucketId, objectPath));
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }
  return files;
}

async function verifyWithPgRestore(pgRestore, encryptedFile, key, environment) {
  const child = spawn(pgRestore, ['--list'], {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdoutBytes = 0;
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdoutBytes += chunk.length; });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-6000); });
  const piping = pipeline(decryptReadable(encryptedFile, key), child.stdin)
    .then(() => null, (error) => error);
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const [code, pipeError] = await Promise.all([exit, piping]);
  if (code !== 0 || stdoutBytes === 0) fail(`pg_restore --list falhou: ${safeError(stderr)}`);
  if (pipeError && pipeError.code !== 'EOF' && pipeError.code !== 'EPIPE') throw pipeError;
  return { exitCode: code, listingBytes: stdoutBytes };
}

async function main() {
  if (process.env.STAGE9E1B_ALLOW_REAL_EXPORT !== 'YES') {
    fail('Exportacao real nao habilitada explicitamente.');
  }
  const backupRoot = path.resolve(arg('--backup-root') || '');
  const keyRoot = path.resolve(arg('--key-root') || '');
  const pgBin = path.resolve(arg('--pg-bin') || '');
  const certificatePath = path.resolve(arg('--ca') || '');
  if (backupRoot !== EXPECTED_BACKUP_ROOT) fail('Raiz de backup fora do destino autorizado.');
  if (keyRoot.startsWith(`${backupRoot}${path.sep}`) || keyRoot === backupRoot) {
    fail('A chave deve permanecer fora da pasta de backup.');
  }
  for (const file of [certificatePath, path.join(pgBin, 'pg_dump.exe'), path.join(pgBin, 'pg_dumpall.exe'), path.join(pgBin, 'pg_restore.exe')]) {
    if (!fs.existsSync(file)) fail(`Dependencia ausente: ${path.basename(file)}`);
  }

  const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const runRoot = path.join(backupRoot, `stage9e1b-${runId}`);
  const storageRoot = path.join(runRoot, 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(keyRoot, { recursive: true });
  const marker = path.join(runRoot, '.stage9e1b-backup');
  fs.writeFileSync(marker, `${runId}\n`, { flag: 'wx', mode: 0o600 });

  const key = crypto.randomBytes(32);
  const keyPath = path.join(keyRoot, `stage9e1b-${runId}.key`);
  fs.writeFileSync(keyPath, `${key.toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  const environment = pgEnvironment(certificatePath);

  const databaseFile = path.join(runRoot, 'database.dump.enc');
  const rolesFile = path.join(runRoot, 'roles.sql.enc');
  const database = await spawnEncrypted(
    path.join(pgBin, 'pg_dump.exe'),
    ['--format=custom', '--compress=zstd:9', '--no-password'],
    environment,
    databaseFile,
    key,
  );
  const roles = await spawnEncrypted(
    path.join(pgBin, 'pg_dumpall.exe'),
    ['--roles-only', '--no-role-passwords', '--no-password'],
    environment,
    rolesFile,
    key,
  );

  const supabaseUrl = envValue('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRole = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) fail('Credenciais de Storage ausentes.');
  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: buckets, error: bucketsError } = await client.storage.listBuckets();
  if (bucketsError) fail(`Falha ao listar buckets: ${bucketsError.message}`);

  const privateStorageIndex = { version: 1, buckets: [], objects: [] };
  let objectNumber = 0;
  for (const bucket of buckets || []) {
    privateStorageIndex.buckets.push({
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit,
      allowedMimeTypes: bucket.allowed_mime_types,
    });
    const objects = await listStorageFiles(client, bucket.id);
    for (const object of objects) {
      objectNumber += 1;
      const { data, error } = await client.storage.from(bucket.id).download(object.path);
      if (error || !data) fail(`Falha ao baixar objeto ${objectNumber}: ${error?.message || 'sem dados'}`);
      const buffer = Buffer.from(await data.arrayBuffer());
      const encryptedName = `object-${String(objectNumber).padStart(6, '0')}.enc`;
      const encryptedPath = path.join(storageRoot, encryptedName);
      const encrypted = await encryptReadable(Readable.from(buffer), encryptedPath, key);
      privateStorageIndex.objects.push({
        bucketId: bucket.id,
        path: object.path,
        encryptedName,
        metadata: object.metadata,
        ...encrypted,
      });
    }
  }

  const storageIndexFile = path.join(runRoot, 'storage-index.json.enc');
  const storageIndex = await encryptReadable(
    Readable.from(Buffer.from(JSON.stringify(privateStorageIndex), 'utf8')),
    storageIndexFile,
    key,
  );

  await verifyEncrypted(databaseFile, key, database);
  await verifyEncrypted(rolesFile, key, roles);
  await verifyEncrypted(storageIndexFile, key, storageIndex);
  for (const object of privateStorageIndex.objects) {
    await verifyEncrypted(path.join(storageRoot, object.encryptedName), key, object);
  }
  const pgRestore = await verifyWithPgRestore(
    path.join(pgBin, 'pg_restore.exe'),
    databaseFile,
    key,
    environment,
  );

  const manifest = {
    stage: '9E.1-B',
    runId,
    createdAt: new Date().toISOString(),
    encryption: 'AES-256-GCM',
    sourceMutations: 0,
    database: { ...database, encryptedFileSha256: await sha256File(databaseFile) },
    roles: { ...roles, encryptedFileSha256: await sha256File(rolesFile), passwordsIncluded: false },
    storage: {
      bucketCount: privateStorageIndex.buckets.length,
      objectCount: privateStorageIndex.objects.length,
      plainBytes: privateStorageIndex.objects.reduce((sum, object) => sum + object.plainBytes, 0),
      index: storageIndex,
    },
    verification: {
      encryptedObjectsVerified: privateStorageIndex.objects.length,
      pgRestoreListExitCode: pgRestore.exitCode,
      pgRestoreListingBytes: pgRestore.listingBytes,
    },
    keyStoredOutsideBackupRoot: true,
    keyFileName: path.basename(keyPath),
  };
  fs.writeFileSync(path.join(runRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`STAGE9E1B_BACKUP_COMPLETE run=${path.basename(runRoot)} objects=${manifest.storage.objectCount}`);
  console.log(`STAGE9E1B_KEY_CREATED file=${path.basename(keyPath)}`);
}

main().catch((error) => {
  console.error(`STAGE9E1B_BACKUP_ABORTED ${safeError(error.message)}`);
  process.exitCode = 1;
});
