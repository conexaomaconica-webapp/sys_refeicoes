const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const nextConfig = read('next.config.mjs');
const packageJson = JSON.parse(read('package.json'));
const report = read('docs/STAGE_9D1_BUILD_STABILIZATION.md');

const checks = [
  ['worker de build Webpack está habilitado', nextConfig.includes('webpackBuildWorker: true')],
  ['otimização de memória do Next 15 está habilitada', nextConfig.includes('webpackMemoryOptimizations: true')],
  ['cache customizado continua limitado ao build', nextConfig.includes("phase !== PHASE_DEVELOPMENT_SERVER")],
  ['erros TypeScript não são ignorados', !nextConfig.includes('ignoreBuildErrors')],
  ['ESLint não é ignorado na configuração', !nextConfig.includes('ignoreDuringBuilds')],
  ['script de lint permanece ativo', packageJson.scripts.lint === 'eslint src'],
  ['script de typecheck permanece ativo', packageJson.scripts.typecheck === 'tsc --noEmit'],
  ['build permanece produção Next completo', packageJson.scripts.build.includes('next build')],
  ['validação 9D permanece disponível', Boolean(packageJson.scripts['validate:stage9d'])],
  ['relatório exige código zero', report.includes('código de saída zero')],
  ['relatório exige BUILD_ID', report.includes('BUILD_ID')],
  ['publicação permanece NO-GO', report.includes('NO-GO para publicação')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
