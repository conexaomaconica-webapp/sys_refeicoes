const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const report = read('docs/STAGE_9E1A_RECOVERY_INVENTORY.md');
const runner = read('scripts/stage9e/inventory-recovery-sql-readonly.cjs');
const sqlEditor = read('scripts/stage9e/supabase-sql-editor/09e1a-capacity-readonly.sql');
const evidence = JSON.parse(read('docs/evidence/stage9e/stage9e1a-inventory-status-20261028.json'));
const capacity = JSON.parse(read('docs/evidence/stage9e/stage9e1a-sql-capacity-inventory.json'));
const backups = JSON.parse(read('docs/evidence/stage9e/stage9e1a-backups-inventory.json'));

const checks = [
  ['inventario terminou em NO-GO por falta de backup', evidence.decision === 'NO_GO_NO_RECOVERABLE_BACKUP'],
  ['Management API confirmou lista vazia', evidence.controlPlane.backupAvailabilityVerified === true && backups.backups.count === 0],
  ['PITR foi verificado como desativado', evidence.controlPlane.pitrVerified === true && backups.pitrEnabled === false],
  ['janela recuperavel nao esta disponivel', evidence.controlPlane.recoverableWindowAvailable === false && backups.physicalWindow.earliest === null],
  ['requisicao administrativa foi somente GET', backups.request.method === 'GET' && backups.request.mutationsPerformed === 0],
  ['token e identificadores nao foram persistidos', backups.tokenPersisted === false && backups.projectRefPersisted === false && backups.backupIdsPersisted === false],
  ['metadados PostgreSQL foram autenticados', evidence.postgresqlMetadata.authenticated === true],
  ['TLS permaneceu verificado', evidence.postgresqlMetadata.tlsVerificationEnforced === true],
  ['consulta remota foi somente agregada', evidence.postgresqlMetadata.queryExecuted === true && capacity.operationalRowsRead === false],
  ['transacao foi read-only e revertida', evidence.postgresqlMetadata.transactionReadOnly === true && evidence.postgresqlMetadata.rollbackCompleted === true],
  ['capacidade do banco foi coletada', capacity.databaseBytes > 0 && capacity.transactionReadOnly === 'on'],
  ['Storage foi agregado sem nomes', capacity.storageBucketCount >= 0 && capacity.storageObjectCount >= 0 && capacity.storageObjectBytes >= 0],
  ['nenhuma linha operacional foi lida', evidence.operationalRowsRead === 0],
  ['nenhuma mutacao foi realizada', evidence.mutationsPerformed === 0],
  ['nenhum backup ou restore ocorreu', evidence.backupsPerformed === 0 && evidence.restoresPerformed === 0],
  ['nenhum projeto foi criado', evidence.projectsCreated === 0],
  ['nenhum segredo foi persistido', evidence.secretsPersisted === 0],
  ['lint e typecheck foram aprovados', evidence.localQualityChecks.lintPassed === true && evidence.localQualityChecks.typecheckPassed === true],
  ['build gerou 26 paginas', evidence.localQualityChecks.buildExitCode === 0 && evidence.localQualityChecks.buildPagesGenerated === 26],
  ['BUILD_ID foi gerado', evidence.localQualityChecks.buildIdPresent === true],
  ['runner exige autorizacao explicita', runner.includes("STAGE9E1_ALLOW_REMOTE_READONLY !== 'YES'")],
  ['runner usa transacao read-only', runner.includes('BEGIN TRANSACTION READ ONLY')],
  ['runner verifica certificado', runner.includes('rejectUnauthorized: true')],
  ['runner nao usa service role', !runner.includes("envValue('SUPABASE_SERVICE_ROLE_KEY')")],
  ['runner retorna somente agregados', runner.includes('pg_database_size') && runner.includes('storageObjectCount')],
  ['SQL Editor usa transacao read-only', sqlEditor.includes('BEGIN TRANSACTION READ ONLY')],
  ['SQL Editor finaliza com rollback', sqlEditor.includes('ROLLBACK;')],
  ['plano e backups dependem do control plane', report.includes('Management API') && report.includes('Database > Backups')],
  ['Storage separado esta documentado', report.includes('Storage') && report.includes('acompanha o clone')],
  ['custos estao identificados como referencia', report.includes('custo real depende do plano')],
  ['producao permanece NO-GO', report.includes('NO-GO')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
