const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const workflow = read('.github/workflows/quality-gate.yml');
const live = read('src/app/api/health/live/route.ts');
const ready = read('src/app/api/health/ready/route.ts');
const health = read('src/lib/health.ts');
const environment = read('docs/ENVIRONMENT_VARIABLES.md');
const report = read('docs/STAGE_9C_CICD_ROLLBACK.md');
const verifier = read('scripts/release/verify-deployment.cjs');
const envChecker = read('scripts/release/check-environment.cjs');
const nextConfig = read('next.config.mjs');
const webhook = read('src/app/api/webhooks/payments/[provider]/route.ts');

const checks = [
  ['workflow possui privilégio somente leitura', workflow.includes('contents: read')],
  ['checkout não persiste credenciais', workflow.includes('persist-credentials: false')],
  ['workflow fixa Node 22 e pnpm 12.6.0', workflow.includes('node-version: 22.x') && workflow.includes('version: 12.6.0')],
  ['workflow instala lockfile congelado', workflow.includes('pnpm install --frozen-lockfile')],
  ['workflow executa quality gate', workflow.includes('pnpm run ci:check')],
  ['workflow não possui credencial Vercel', !/VERCEL_(TOKEN|ORG_ID|PROJECT_ID)/.test(workflow)],
  ['workflow não publica', !/\b(vercel deploy|vercel --prod|supabase db push)\b/.test(workflow)],
  ['workflow usa somente configuração sintética', workflow.includes('synthetic-ci') && !workflow.includes('secrets.')],
  ['liveness é dinâmica e sanitizada', live.includes("dynamic = 'force-dynamic'") && live.includes("{ status: 'ok' }")],
  ['readiness retorna 503 em falha', ready.includes('status: ready ? 200 : 503')],
  ['health não consulta Supabase nem dados', !/(createClient|supabase|\.from\()/.test(live + ready + health)],
  ['health não expõe nomes de variáveis', !ready.includes('REQUIRED_VALUES')],
  ['health desabilita cache', health.includes("'Cache-Control': 'no-store, max-age=0'")],
  ['readiness exige HMAC robusta', health.includes('CONSUMER_IDENTITY_HMAC_KEY') && health.includes('< 32')],
  ['readiness distingue produção Vercel de next start local', health.includes("VERCEL_ENV !== 'production'")],
  ['inventário separa variáveis públicas e privadas', environment.includes('Classe') && environment.includes('server-side')],
  ['service role nunca recebe prefixo público', !environment.includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')],
  ['DB URL fica fora do runtime web', environment.includes('SUPABASE_DB_URL') && environment.includes('não integra o runtime web')],
  ['verificador remoto exige HTTPS', verifier.includes("baseUrl.protocol !== 'https:'")],
  ['verificador cobre health e páginas', verifier.includes('/api/health/live') && verifier.includes('/login')],
  ['verificador não imprime erros internos', verifier.includes("error.name") && !verifier.includes('error.message')],
  ['validador de ambiente não imprime valores', !envChecker.includes('console.log(values') && !envChecker.includes('JSON.stringify(values')],
  ['Permissions-Policy está configurada', nextConfig.includes("key: 'Permissions-Policy'" )],
  ['HSTS está configurado', nextConfig.includes("key: 'Strict-Transport-Security'" )],
  ['webhook devolve erro genérico', webhook.includes("error: 'Erro interno no processamento do webhook'" )],
  ['webhook não registra objeto de exceção', !webhook.includes("console.error('[Webhook Error]:', error)")],
  ['rollback do app é separado do banco', report.includes('não reverte PostgreSQL') && report.includes('plano 9B')],
  ['publicação continua NO-GO', report.includes('NO-GO para publicação')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
