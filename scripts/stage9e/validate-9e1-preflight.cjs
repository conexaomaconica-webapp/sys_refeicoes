const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const report = read('docs/STAGE_9E1_PREFLIGHT_READINESS.md');
const evidence = JSON.parse(
  read('docs/evidence/stage9e/stage9e1-preflight-readiness-20261028.json'),
);

const checks = [
  ['escopo permanece local', report.includes('remota:**') && report.includes('realizada')],
  ['origem oficial nunca é destino', report.includes('nunca poderá ser escolhido como destino')],
  ['destino é projeto novo isolado', report.includes('novo projeto Supabase de') && report.includes('isolado')],
  ['destino ainda não foi provisionado', evidence.destination.provisioned === false],
  ['restore real é classificado como sensível', report.includes('dados pessoais e financeiros reais')],
  ['storage possui restauração independente', report.includes('restaurar Storage separadamente')],
  ['efeitos externos são contidos', ['pg_cron', 'pg_net', 'webhooks'].every((term) => report.includes(term))],
  ['autorizações são separadas', report.includes('devem ser independentes')],
  ['RPO alvo permanece em 15 minutos', report.includes('15 minutos')],
  ['RTO alvo permanece em 4 horas', report.includes('4 horas')],
  ['RLS exige 31 de 31', report.includes('31/31 cenários RLS')],
  ['origem não sofreu acesso remoto', evidence.source.remoteAccessPerformed === false],
  ['nenhuma ação externa ocorreu', evidence.externalActionsPerformed === false],
  ['nenhuma conexão remota ocorreu', evidence.remoteConnectionsPerformed === 0],
  ['nenhum backup foi executado', evidence.backupOperationsPerformed === 0],
  ['nenhum restore foi executado', evidence.restoreOperationsPerformed === 0],
  ['nenhuma dependência foi instalada', evidence.localDiagnostics.dependenciesInstalled === 0],
  ['nenhum arquivo foi excluído', evidence.localDiagnostics.filesDeleted === 0],
  ['lint foi aprovado', evidence.qualityChecks.lintPassed === true],
  ['typecheck foi aprovado', evidence.qualityChecks.typecheckPassed === true],
  ['build gerou 26 páginas', evidence.qualityChecks.buildExitCode === 0 && evidence.qualityChecks.buildPagesGenerated === 26],
  ['BUILD_ID foi gerado', evidence.qualityChecks.buildIdPresent === true],
  ['execução permanece em NO-GO', evidence.decision === 'NO_GO_BACKUP_AND_RESTORE'],
  ['próximo gate é somente leitura', evidence.nextGate === '9E.1-A_readonly_recovery_metadata_inventory'],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
