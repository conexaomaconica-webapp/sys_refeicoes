const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { decryptReadable, sha256File } = require('./backup-crypto.cjs');

function fail(message) { throw new Error(message); }
function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function safeError(value) {
  return String(value || '').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED]').slice(-3000);
}

async function measureDecrypted(file, key) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of decryptReadable(file, key)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return {
    plainBytes: bytes,
    plainSha256: hash.digest('hex'),
    encryptedBytes: fs.statSync(file).size,
    encryptedSha256: await sha256File(file),
  };
}

async function readDecryptedJson(file, key) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of decryptReadable(file, key)) {
    bytes += chunk.length;
    if (bytes > 5 * 1024 * 1024) fail('Indice cifrado excede limite seguro.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function verifyPgRestore(pgRestore, databaseFile, key) {
  const child = spawn(pgRestore, ['--list'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let listingBytes = 0;
  let stderr = '';
  child.stdout.on('data', (chunk) => { listingBytes += chunk.length; });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-6000); });
  const piping = pipeline(decryptReadable(databaseFile, key), child.stdin)
    .then(() => null, (error) => error);
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const [code, pipeError] = await Promise.all([exit, piping]);
  if (code !== 0 || listingBytes === 0) fail(`pg_restore --list falhou: ${safeError(stderr)}`);
  if (pipeError && pipeError.code !== 'EOF' && pipeError.code !== 'EPIPE') throw pipeError;
  return { exitCode: code, listingBytes };
}

async function main() {
  if (process.env.STAGE9E1B_ALLOW_FINALIZE !== 'YES') fail('Finalizacao nao habilitada.');
  const runRoot = path.resolve(arg('--run-root') || '');
  const keyPath = path.resolve(arg('--key') || '');
  const pgRestore = path.resolve(arg('--pg-restore') || '');
  const backupRoot = path.resolve('C:\\MARefeicoes-Backups');
  if (!runRoot.startsWith(`${backupRoot}${path.sep}stage9e1b-`)) fail('Run fora da raiz autorizada.');
  if (!fs.existsSync(path.join(runRoot, '.stage9e1b-backup'))) fail('Marcador de backup ausente.');
  if (fs.existsSync(path.join(runRoot, 'manifest.json'))) fail('Manifesto ja existe; recusando sobrescrever.');
  if (!fs.existsSync(keyPath) || !fs.existsSync(pgRestore)) fail('Chave ou pg_restore ausente.');
  const keyHex = fs.readFileSync(keyPath, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) fail('Chave de recuperacao invalida.');
  const key = Buffer.from(keyHex, 'hex');

  const databaseFile = path.join(runRoot, 'database.dump.enc');
  const rolesFile = path.join(runRoot, 'roles.sql.enc');
  const indexFile = path.join(runRoot, 'storage-index.json.enc');
  const database = await measureDecrypted(databaseFile, key);
  const roles = await measureDecrypted(rolesFile, key);
  const index = await measureDecrypted(indexFile, key);
  const privateIndex = await readDecryptedJson(indexFile, key);

  let verifiedObjects = 0;
  for (const object of privateIndex.objects || []) {
    const measured = await measureDecrypted(path.join(runRoot, 'storage', object.encryptedName), key);
    if (measured.plainBytes !== object.plainBytes || measured.plainSha256 !== object.plainSha256) {
      fail(`Objeto cifrado divergente no indice ${verifiedObjects + 1}.`);
    }
    verifiedObjects += 1;
  }
  const restore = await verifyPgRestore(pgRestore, databaseFile, key);
  const runId = fs.readFileSync(path.join(runRoot, '.stage9e1b-backup'), 'utf8').trim();
  const manifest = {
    stage: '9E.1-B',
    runId,
    finalizedAt: new Date().toISOString(),
    encryption: 'AES-256-GCM',
    sourceMutations: 0,
    database,
    roles: { ...roles, passwordsIncluded: false },
    storage: {
      bucketCount: (privateIndex.buckets || []).length,
      objectCount: (privateIndex.objects || []).length,
      plainBytes: (privateIndex.objects || []).reduce((sum, object) => sum + object.plainBytes, 0),
      index,
    },
    verification: {
      encryptedObjectsVerified: verifiedObjects,
      pgRestoreListExitCode: restore.exitCode,
      pgRestoreListingBytes: restore.listingBytes,
    },
    keyStoredOutsideBackupRoot: !keyPath.startsWith(`${backupRoot}${path.sep}`),
    keyFileName: path.basename(keyPath),
  };
  fs.writeFileSync(path.join(runRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx', mode: 0o600,
  });
  console.log(`STAGE9E1B_FINALIZED run=${path.basename(runRoot)} objects=${verifiedObjects}`);
}

main().catch((error) => {
  console.error(`STAGE9E1B_FINALIZE_ABORTED ${safeError(error.message)}`);
  process.exitCode = 1;
});

