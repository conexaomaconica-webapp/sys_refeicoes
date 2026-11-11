const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/features/intelligence/contracts.ts',
  'src/features/intelligence/indicator-catalog.ts',
  'src/features/intelligence/access-policy.ts',
  'src/features/intelligence/providers/synthetic-intelligence.provider.ts',
].map((file) => path.join(root, file));
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-validation-'));

const program = ts.createProgram(sourceFiles, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  rootDir: path.join(root, 'src'),
  outDir: outputDir,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
});
const emit = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
  process.exit(1);
}

const { SyntheticIntelligenceProvider } = require(path.join(outputDir, 'features/intelligence/providers/synthetic-intelligence.provider.js'));
const { SYNTHETIC_DEMO_ACCESS } = require(path.join(outputDir, 'features/intelligence/contracts.js'));
const { evaluateRemoteIntegrationReadiness, intelligenceRolePolicies } = require(path.join(outputDir, 'features/intelligence/access-policy.js'));
const { intelligenceIndicatorCatalog, remoteIntegrationGates } = require(path.join(outputDir, 'features/intelligence/indicator-catalog.js'));

const checks = [];
function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

async function run() {
  const provider = new SyntheticIntelligenceProvider();
  const allFilters = { period: 'october', unit: 'all', category: 'all' };
  const all = await provider.getSnapshot({ filters: allFilters, access: SYNTHETIC_DEMO_ACCESS });
  check('fornecedor padrão é exclusivamente sintético', provider.sourceKind === 'synthetic' && all.status === 'ready' && all.snapshot.source.synthetic);
  check('refeições servidas preservam contrato homologado', all.status === 'ready' && all.snapshot.summary.mealsServed === 62480);
  check('comparativo por período possui base anterior', all.status === 'ready' && all.snapshot.summary.previousMealsServed === 58720 && all.snapshot.summary.periodVariation === 6.4);
  check('volume por restaurante preserva soma base', all.status === 'ready' && all.snapshot.units.reduce((total, unit) => total + unit.meals, 0) === 62480);
  check('utilização por categoria preserva 100 por cento', all.status === 'ready' && all.snapshot.audience.categories.reduce((total, category) => total + category.percentage, 0) === 100);

  const north = await provider.getSnapshot({ filters: { ...allFilters, unit: 'north' }, access: SYNTHETIC_DEMO_ACCESS });
  check('filtro unitário não aplica redução dupla', north.status === 'ready' && north.snapshot.units.length === 1 && north.snapshot.units[0].meals === 19680);
  const partial = await provider.getSnapshot({ filters: { ...allFilters, category: 'partial' }, access: SYNTHETIC_DEMO_ACCESS });
  check('filtro de categoria retorna composição coerente', partial.status === 'ready' && partial.snapshot.audience.categories.length === 1 && partial.snapshot.audience.categories[0].percentage === 100 && partial.snapshot.audience.categories[0].meals === 21243);
  check('conceitos financeiros permanecem separados', all.status === 'ready' && all.snapshot.summary.faceValue !== all.snapshot.summary.confirmedRecharges && all.snapshot.summary.confirmedRecharges !== all.snapshot.summary.custodyBalance);

  const empty = await new SyntheticIntelligenceProvider('empty').getSnapshot({ filters: allFilters, access: SYNTHETIC_DEMO_ACCESS });
  const unavailable = await new SyntheticIntelligenceProvider('unavailable').getSnapshot({ filters: allFilters, access: SYNTHETIC_DEMO_ACCESS });
  check('cenário vazio é explícito', empty.status === 'empty');
  check('cenário indisponível é seguro e repetível', unavailable.status === 'unavailable' && unavailable.retryable);
  const remoteOnSynthetic = await provider.getSnapshot({ filters: allFilters, access: { mode: 'authenticated', tenantId: 'tenant-a', institutionIds: [], unitIds: [], role: 'admin_general', profileStatus: 'active' } });
  check('fornecedor sintético rejeita contexto remoto', remoteOnSynthetic.status === 'unavailable' && !remoteOnSynthetic.retryable);

  const operational = intelligenceIndicatorCatalog.find((item) => item.id === 'meals_served');
  const approvedGates = [...remoteIntegrationGates, ...operational.blockedBy];
  const adminAccess = { mode: 'authenticated', tenantId: 'tenant-a', institutionIds: [], unitIds: [], role: 'admin_general', profileStatus: 'active' };
  check('integração remota inicia bloqueada', !evaluateRemoteIntegrationReadiness('meals_served', adminAccess).eligible);
  check('contrato permite elegibilidade somente após todos os gates', evaluateRemoteIntegrationReadiness('meals_served', adminAccess, approvedGates).eligible);
  const supervisorAccess = { ...adminAccess, role: 'supervisor', unitIds: ['unit-a'] };
  check('supervisor não recebe indicador financeiro', !evaluateRemoteIntegrationReadiness('custody_balance', supervisorAccess, [...remoteIntegrationGates, ...intelligenceIndicatorCatalog.find((item) => item.id === 'custody_balance').blockedBy]).eligible);
  check('operador e estudante permanecem sem dashboard', ['operator', 'student'].every((role) => intelligenceRolePolicies.find((policy) => policy.role === role).dashboardAccess === 'none'));

  const scopedFiles = [
    'src/features/intelligence/contracts.ts',
    'src/features/intelligence/indicator-catalog.ts',
    'src/features/intelligence/access-policy.ts',
    'src/features/intelligence/providers/synthetic-intelligence.provider.ts',
    'src/features/intelligence/use-intelligence-snapshot.ts',
    'src/components/intelligence-demo/IntelligenceDemo.tsx',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  check('arquitetura da Etapa 6 não importa Supabase', !/from\s+['"][^'"]*supabase|createClient\s*\(|getAdminClient\s*\(/i.test(scopedFiles));
  check('protótipo consome a abstração por hook', scopedFiles.includes('useIntelligenceSnapshot(filters)'));

  let failures = 0;
  for (const [name, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
    if (!passed) failures += 1;
  }
  console.log(`\n${checks.length - failures}/${checks.length} checks passed.`);
  fs.rmSync(outputDir, { recursive: true, force: true });
  if (failures) process.exit(1);
}

run().catch((error) => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
