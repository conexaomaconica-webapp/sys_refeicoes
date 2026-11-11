const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const report = read('docs/STAGE_9E1B_LOGICAL_BACKUP.md');
const evidence = JSON.parse(read('docs/evidence/stage9e/stage9e1b-logical-backup-20261028.json'));
const cryptoModule = read('scripts/stage9e/backup-crypto.cjs');
const runner = read('scripts/stage9e/create-stage9e1b-backup.cjs');

const checks = [
  ['backup foi criado e verificado', evidence.executionStatus === 'backup_created_and_verified'],
  ['decisao separa backup e restore', evidence.decision === 'GO_BACKUP_NO_GO_RESTORE'],
  ['pacote PostgreSQL teve hash verificado', evidence.postgresTools.archiveSha256Verified === true],
  ['ZIP foi removido depois da extracao', evidence.postgresTools.archiveRemovedAfterExtraction === true && evidence.cleanup.removedOnlyDownloadedArchive === true],
  ['backup e chave foram preservados na limpeza', evidence.cleanup.backupPreserved === true && evidence.cleanup.keyPreserved === true],
  ['pg_restore reconheceu o catalogo', evidence.database.pgRestoreListExitCode === 0],
  ['roles nao incluem senhas', evidence.roles.passwordsIncluded === false],
  ['Storage possui 18 de 18 objetos', evidence.storage.objectCount === 18 && evidence.storage.objectsVerified === 18],
  ['nenhum arquivo de dados ficou em texto puro', evidence.artifacts.plaintextDataFiles === 0],
  ['chave ficou fora do backup', evidence.artifacts.keyStoredOutsideBackupRoot === true],
  ['ACL da chave foi restringida', evidence.artifacts.keyAclRestricted === true],
  ['origem nao sofreu mutacoes', evidence.sourceMutations === 0],
  ['nenhuma restauracao ocorreu', evidence.restoresPerformed === 0],
  ['nenhuma migration remota ocorreu', evidence.remoteMigrationsExecuted === 0],
  ['nenhum segredo entrou na evidencia', evidence.secretsPersistedInEvidence === 0],
  ['lint e typecheck foram aprovados', evidence.localQualityChecks.lintPassed === true && evidence.localQualityChecks.typecheckPassed === true],
  ['build gerou 26 paginas', evidence.localQualityChecks.buildExitCode === 0 && evidence.localQualityChecks.buildPagesGenerated === 26],
  ['BUILD_ID foi gerado', evidence.localQualityChecks.buildIdPresent === true],
  ['cifra e AES-256-GCM', cryptoModule.includes("createCipheriv('aes-256-gcm'")],
  ['arquivos usam criacao exclusiva', cryptoModule.includes("flags: 'wx'") && runner.includes("flag: 'wx'")],
  ['runner exige autorizacao explicita', runner.includes("STAGE9E1B_ALLOW_REAL_EXPORT !== 'YES'")],
  ['credenciais PostgreSQL ficam no ambiente', runner.includes('PGPASSWORD') && !runner.includes("console.log(environment")],
  ['TLS usa verify-full', runner.includes("PGSSLMODE: 'verify-full'")],
  ['service role nao e persistida', !report.includes('SUPABASE_SERVICE_ROLE_KEY=')],
  ['backup permanece sem restauracao', report.includes('NO-GO para restaura') || report.includes('NO-GO para restauraÃ§Ã£o')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
