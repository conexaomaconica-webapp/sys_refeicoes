/**
 * ==============================================================================
 * STAGE 9E.1-C — PREFLIGHT OBRIGATÓRIO DA RESTAURAÇÃO ISOLADA (GATE G1)
 * - Verifica integridade AES-256-GCM e SHA-256 em memória de todos os 21 artefatos cifrados.
 * - Valida TOC do database.dump.enc via pg_restore --list (sem gravar texto puro em disco).
 * - Avalia volumes disponíveis, espaço em disco e completude dos binários locais.
 * - NÃO acessa Supabase remoto, NÃO exibe segredos, NÃO modifica backup/chaves originais.
 * ==============================================================================
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { decryptReadable, verifyEncrypted } = require('./backup-crypto.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BACKUP_ROOT = path.resolve('C:\\MARefeicoes-Backups');
const RUN_ROOT = path.join(BACKUP_ROOT, 'stage9e1b-20261028152457');
const PG_TOOLS_ROOT = path.join(BACKUP_ROOT, '.tools', 'postgresql-17.11-5', 'pgsql');
const MIN_SAFE_RESTORE_FREE_GB = 2.50;

function findKeyFile(dir, expectedName) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findKeyFile(full, expectedName);
      if (found) return found;
    } else if (entry.name === expectedName) {
      return full;
    }
  }
  return null;
}

async function readDecryptedJsonInMemory(file, key) {
  const chunks = [];
  let total = 0;
  for await (const chunk of decryptReadable(file, key)) {
    total += chunk.length;
    if (total > 5 * 1024 * 1024) {
      throw new Error('Índice cifrado excedeu o limite seguro de 5 MB.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function analyzeDumpToc(pgRestoreExe, encryptedDumpPath, key) {
  const child = spawn(pgRestoreExe, ['--list'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stdoutChunks = [];
  let stderr = '';
  child.stdout.on('data', (c) => stdoutChunks.push(c));
  child.stderr.on('data', (c) => {
    stderr = `${stderr}${c}`.slice(-2000);
  });

  const piping = pipeline(decryptReadable(encryptedDumpPath, key), child.stdin)
    .then(() => null, (err) => err);
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const [code, pipeErr] = await Promise.all([exit, piping]);
  if (code !== 0) {
    throw new Error(`pg_restore --list retornou código ${code}: ${stderr}`);
  }
  if (pipeErr && pipeErr.code !== 'EOF' && pipeErr.code !== 'EPIPE') {
    throw pipeErr;
  }

  const lines = Buffer.concat(stdoutChunks).toString('utf8').split(/\r?\n/);
  let totalEntries = 0;
  const schemas = new Set();
  const objectTypes = {};
  const extensions = [];

  for (const line of lines) {
    if (!line || line.startsWith(';')) continue;
    // Formato TOC pg_restore: id; oid oids TYPE schema name owner
    const match = line.match(/^\d+;\s+\d+\s+\d+\s+([A-Z ]+?)\s+(\S+)\s+/);
    if (!match) continue;
    totalEntries += 1;
    const objType = match[1].trim();
    const schema = match[2].trim();
    objectTypes[objType] = (objectTypes[objType] || 0) + 1;
    if (schema && schema !== '-') schemas.add(schema);
    if (objType === 'EXTENSION') {
      const extMatch = line.match(/EXTENSION\s+-\s+(\S+)/);
      if (extMatch) extensions.push(extMatch[1]);
    }
  }

  return {
    tocEntriesTotal: totalEntries,
    schemasReferenced: Array.from(schemas).sort(),
    extensionsReferenced: extensions.sort(),
    objectTypeCounts: objectTypes,
  };
}

async function main() {
  if (!fs.existsSync(RUN_ROOT)) {
    throw new Error(`Diretório do backup não localizado: ${RUN_ROOT}`);
  }

  const manifestPath = path.join(RUN_ROOT, 'manifest.json');
  const markerPath = path.join(RUN_ROOT, '.stage9e1b-backup');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(markerPath)) {
    throw new Error('Manifesto ou marcador do backup 9E.1-B ausente.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const docsDir = path.join(os.homedir(), 'Documents');
  const keyPath = findKeyFile(docsDir, manifest.keyFileName);
  if (!keyPath) {
    throw new Error('Arquivo de chave não localizado em Documents fora da pasta de backup.');
  }
  if (keyPath.toLowerCase().startsWith(BACKUP_ROOT.toLowerCase())) {
    throw new Error('Violação de custódia: chave armazenada dentro da pasta de backup.');
  }

  const keyHex = fs.readFileSync(keyPath, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) {
    throw new Error('Formato de chave AES-256 inválido.');
  }
  const key = Buffer.from(keyHex, 'hex');

  // 1. Verificar integridade AES-GCM + SHA-256 dos artefatos do banco, roles e índice (em memória)
  const dbVerified = await verifyEncrypted(path.join(RUN_ROOT, 'database.dump.enc'), key, manifest.database);
  const rolesVerified = await verifyEncrypted(path.join(RUN_ROOT, 'roles.sql.enc'), key, manifest.roles);
  const idxVerified = await verifyEncrypted(path.join(RUN_ROOT, 'storage-index.json.enc'), key, manifest.storage.index);

  const privateIndex = await readDecryptedJsonInMemory(path.join(RUN_ROOT, 'storage-index.json.enc'), key);
  let verifiedStorageObjects = 0;
  let verifiedStorageBytes = 0;
  for (const obj of privateIndex.objects || []) {
    const res = await verifyEncrypted(path.join(RUN_ROOT, 'storage', obj.encryptedName), key, {
      plainBytes: obj.plainBytes,
      plainSha256: obj.plainSha256,
    });
    verifiedStorageObjects += 1;
    verifiedStorageBytes += res.plainBytes;
  }

  // 2. Verificar TOC via pg_restore --list em memória
  const pgRestoreExe = path.join(PG_TOOLS_ROOT, 'bin', 'pg_restore.exe');
  if (!fs.existsSync(pgRestoreExe)) {
    throw new Error('pg_restore.exe ausente em C:\\MARefeicoes-Backups\\.tools');
  }
  const tocSummary = await analyzeDumpToc(pgRestoreExe, path.join(RUN_ROOT, 'database.dump.enc'), key);

  // 3. Inventário de disco e binários locais
  const statC = fs.statfsSync('C:\\');
  const cTotalGB = Number(((statC.blocks * statC.bsize) / 1073741824).toFixed(2));
  const cFreeGB = Number(((statC.bavail * statC.bsize) / 1073741824).toFixed(2));
  const hasSecondaryVolume = ['D:\\', 'E:\\', 'F:\\'].some((drive) => {
    try {
      return fs.existsSync(drive);
    } catch {
      return false;
    }
  });

  const hasShareBki = fs.existsSync(path.join(PG_TOOLS_ROOT, 'share', 'postgres.bki'));
  const hasPostgresExe = fs.existsSync(path.join(PG_TOOLS_ROOT, 'bin', 'postgres.exe'));
  const hasInitdbExe = fs.existsSync(path.join(PG_TOOLS_ROOT, 'bin', 'initdb.exe'));

  // Estimativa conservadora para restauração portátil local:
  // Download ZIP (364 MB) + extração seletiva (280 MB) + cluster initdb/restore (~180 MB) + Storage (4.2 MB) + folga SO Windows (>= 1.5 GB)
  const estimatedTransientMB = 830;
  const spaceAdequateForLocalRestore = cFreeGB >= MIN_SAFE_RESTORE_FREE_GB || hasSecondaryVolume;

  const blockers = [];
  if (!hasSecondaryVolume && cFreeGB < MIN_SAFE_RESTORE_FREE_GB) {
    blockers.push(`DISCO_C_INSUFICIENTE: apenas ${cFreeGB} GB livres em C:\\ (mínimo seguro recomendado: ${MIN_SAFE_RESTORE_FREE_GB.toFixed(2)} GB) e nenhum volume secundário disponível.`);
  }
  if (!hasShareBki) {
    blockers.push('BINARIOS_INCOMPLETOS: C:\\MARefeicoes-Backups\\.tools não contém share/postgres.bki (initdb exige novo download/extração ~644 MB temporários).');
  }
  blockers.push('FIDELIDADE_PLATAFORMA: PostgreSQL 17 local genérico não reproduz Supabase Auth/Storage/Realtime gerenciados (G1 completo exige novo projeto Supabase isolado ou volume dedicado).');

  const preflightResult = {
    stage: '9E.1-C-PREFLIGHT',
    checkedAt: new Date().toISOString(),
    runId: manifest.runId,
    encryption: manifest.encryption,
    keyCustody: {
      keyAvailableOutsideBackupRoot: true,
      keyFormatValid256Bit: true,
      keyExposedInLogs: false,
    },
    integrity: {
      databasePlainBytes: dbVerified.plainBytes,
      rolesPlainBytes: rolesVerified.plainBytes,
      storageIndexPlainBytes: idxVerified.plainBytes,
      storageObjectsVerified: verifiedStorageObjects,
      storageObjectsExpected: (privateIndex.objects || []).length,
      storagePlainBytes: verifiedStorageBytes,
      allEncryptedArtifactsValid:
        verifiedStorageObjects === (privateIndex.objects || []).length &&
        dbVerified.plainBytes === manifest.database.plainBytes &&
        rolesVerified.plainBytes === manifest.roles.plainBytes,
    },
    tocSummary,
    environment: {
      volumes: [{ drive: 'C:\\', totalGB: cTotalGB, freeGB: cFreeGB }],
      secondaryVolumePresent: hasSecondaryVolume,
      localPgTools: {
        version: '17.11-5',
        pgRestorePresent: true,
        initdbPresent: hasInitdbExe,
        postgresPresent: hasPostgresExe,
        sharePostgresBkiPresent: hasShareBki,
      },
      estimatedLocalRestoreTransientMB: estimatedTransientMB,
      minSafeLocalFreeGB: MIN_SAFE_RESTORE_FREE_GB,
      spaceAdequateForLocalRestore,
    },
    remoteAccessAttempted: false,
    restoresPerformed: 0,
    plaintextWrittenToDisk: 0,
    decision: spaceAdequateForLocalRestore ? 'PREFLIGHT_OK_PROCEED_WITH_CAUTION' : 'NO_GO_INSUFFICIENT_DISK_AND_ISOLATED_TARGET',
    blockers,
  };

  const evidenceDir = path.join(ROOT, 'docs', 'evidence', 'stage9e');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const outPath = path.join(evidenceDir, `stage9e1c-preflight-${ts}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(preflightResult, null, 2)}\n`, 'utf8');

  console.log('================================================================================');
  console.log('ETAPA 9E.1-C — PREFLIGHT GATE G1 (READ-ONLY EM MEMÓRIA)');
  console.log('================================================================================');
  console.log(`PASS Backup runId=${manifest.runId} | keyOutsideBackup=true | AES-256-GCM=OK`);
  console.log(`PASS Integridade decifrada em RAM: database=${dbVerified.plainBytes}B, roles=${rolesVerified.plainBytes}B, storage=${verifiedStorageObjects}/${(privateIndex.objects || []).length} objs (${verifiedStorageBytes}B)`);
  console.log(`PASS TOC pg_restore --list: ${tocSummary.tocEntriesTotal} itens, schemas=[${tocSummary.schemasReferenced.join(', ')}]`);
  console.log(`WARN Volume único C:\\ freeGB=${cFreeGB} GB (mínimo seguro=${MIN_SAFE_RESTORE_FREE_GB.toFixed(2)} GB) | share/postgres.bki=${hasShareBki}`);
  console.log(`DECISÃO PREFLIGHT: ${preflightResult.decision}`);
  console.log(`Evidência sanitizada: ${path.relative(ROOT, outPath)}`);
}

main().catch((err) => {
  console.error(`FAIL_9E1C_PREFLIGHT: ${err.message}`);
  process.exit(1);
});

