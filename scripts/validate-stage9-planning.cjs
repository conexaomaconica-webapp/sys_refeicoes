const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const hosting = read('docs/STAGE_9A_HOSTING_ARCHITECTURE.md');
const recovery = read('docs/STAGE_9B_BACKUP_RECOVERY_PLAN.md');

const checks = [
  ['9A permanece planejamento local', hosting.includes('sem contratação, criação de conta ou deploy')],
  ['Vercel Pro é recomendação explícita', hosting.includes('Vercel Pro como arquitetura preferencial')],
  ['Next.js 15 e Node 22 são cobertos', hosting.includes('Next.js 15') && hosting.includes('Node.js 22')],
  ['PWA e HTTPS são cobertos', hosting.includes('PWA') && hosting.includes('HTTPS')],
  ['região deve acompanhar Supabase', hosting.includes('região de Functions mais próxima')],
  ['segredos permanecem server-side', hosting.includes('SUPABASE_SERVICE_ROLE_KEY') && hosting.includes('server-side')],
  ['service role nunca é pública', !hosting.includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')],
  ['custos são apenas indicativos', hosting.includes('não é cotação')],
  ['deploy operacional permanece bloqueado', hosting.includes('NO-GO para contratação/publicação')],
  ['9B não executa backup remoto', recovery.includes('nenhum backup ou restore remoto executado')],
  ['RPO e RTO estão definidos', recovery.includes('RPO proposto') && recovery.includes('RTO proposto')],
  ['PITR é exigido antes da operação', recovery.includes('PITR de 7 dias antes do início da operação oficial')],
  ['backup diário isolado é insuficiente', recovery.includes('RPO potencial próximo de 24 horas')],
  [
    'Storage possui proteção separada',
    recovery.includes('os arquivos exigem') && recovery.includes('uma cópia separada'),
  ],
  ['três buckets são inventariados', ['student-photos', 'import-files', 'tenant-branding'].every((name) => recovery.includes(name))],
  ['exportação lógica não substitui PITR', recovery.includes('camada complementar, não substituta')],
  ['restore valida migrations e RLS', recovery.includes('Validar migrations 1–75') && recovery.includes('31 cenários RLS')],
  ['rollback do app é separado do banco', recovery.includes('procedimentos independentes')],
  ['retenção exige aprovação legal', recovery.includes('aprovação jurídica, contábil e LGPD')],
  [
    'testes pagos exigem nova autorização',
    recovery.includes('exige autorização') && recovery.includes('financeira e técnica separada'),
  ],
  ['terminal permanece fail-closed', recovery.includes('terminal permanece fail-closed')],
  ['fontes oficiais estão registradas', hosting.includes('https://vercel.com/docs/') && recovery.includes('https://supabase.com/docs/')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
