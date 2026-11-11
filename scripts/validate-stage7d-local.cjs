const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql');
const contractPath = path.join(root, 'src/features/intelligence/operational-contracts.ts');
const providerPath = path.join(root, 'src/features/intelligence/providers/rpc-operational-intelligence.provider.ts');
const catalogPath = path.join(root, 'src/features/intelligence/indicator-catalog.ts');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage7d-validation-'));

const sql = fs.readFileSync(migrationPath, 'utf8');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const providerSource = fs.readFileSync(providerPath, 'utf8');
const catalogSource = fs.readFileSync(catalogPath, 'utf8');
const checks = [];

function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

function expectThrow(name, operation) {
  let threw = false;
  try { operation(); } catch { threw = true; }
  check(name, threw);
}

async function run() {
  const program = ts.createProgram([contractPath, providerPath, catalogPath], {
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
  check('contratos TypeScript compilam isoladamente', diagnostics.length === 0);
  if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));

  const providerModule = require(path.join(outputDir, 'features/intelligence/providers/rpc-operational-intelligence.provider.js'));
  const catalogModule = require(path.join(outputDir, 'features/intelligence/indicator-catalog.js'));
  const {
    RpcOperationalIntelligenceProvider,
    buildOperationalIntelligenceRpcArgs,
    parseOperationalIntelligenceRpcPayload,
  } = providerModule;

  check('RPC possui versão explícita', sql.includes('get_operational_intelligence_v1') && contractSource.includes('stage7d-operational-v1'));
  check('RPC é somente leitura estável', /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/i.test(sql));
  check('RPC fixa search_path vazio', /SET search_path = ''/i.test(sql));
  check('tenant deriva exclusivamente de auth uid', sql.includes('v_uid UUID := auth.uid()') && !/p_tenant_id/i.test(sql));
  check('perfil ativo é obrigatório', sql.includes("v_profile.status <> 'active'"));
  check('operador e estudante não são autorizados', sql.includes("v_profile.role NOT IN") && !/NOT IN \([^)]*'operator'/s.test(sql) && !/NOT IN \([^)]*'student'/s.test(sql));
  check('escopo de unidade usa atribuição explícita', sql.includes('public.user_unit_access') && sql.includes('UNIT_SCOPE_REQUIRED'));
  check('escopo institucional usa atribuição explícita', sql.includes('public.user_institution_access') && sql.includes('INSTITUTION_SCOPE_REQUIRED'));
  check('filtros fora do escopo são recusados', ['INSTITUTION_SCOPE_FORBIDDEN', 'UNIT_SCOPE_FORBIDDEN', 'CATEGORY_SCOPE_FORBIDDEN'].every((token) => sql.includes(token)));
  check('filtros têm limite defensivo', /cardinality\(p_institution_ids\) > 100/.test(sql) && /INVALID_FILTER_SET/.test(sql));
  check('períodos usam fim exclusivo', sql.includes('consumption.consumption_date < p_period_end') && sql.includes('consumption.consumption_date < p_previous_end'));
  check('períodos comparáveis têm mesma duração', sql.includes('PERIODS_MUST_HAVE_EQUAL_DURATION') && sql.includes('v_duration > 366'));
  check('somente refeições fisicamente servidas são contadas', sql.includes("consumption.status IN ('approved', 'financially_refunded')"));
  check('fontes operacionais são explícitas', ['public.meal_consumptions', 'public.units', 'public.student_categories'].every((source) => sql.includes(source)));
  check('domínio financeiro não é consultado', !/public\.(wallets|wallet_transactions|payments|recharges|cash_shifts|cash_movements)\b/i.test(sql));
  check('quatro indicadores constam na resposta', ['meals_served', 'volume_by_unit', 'utilization_by_category', 'period_comparison'].every((key) => sql.includes(`'${key}'`)));
  check('execução pública e anônima é revogada', /REVOKE ALL[\s\S]+FROM PUBLIC;/i.test(sql) && /REVOKE ALL[\s\S]+FROM anon;/i.test(sql));
  check('somente authenticated recebe execução', /GRANT EXECUTE[\s\S]+TO authenticated;/i.test(sql));
  check('migration é aditiva e não destrutiva', !/\b(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.|INSERT INTO|DISABLE ROW LEVEL SECURITY)\b/i.test(sql));
  check('adaptador não importa cliente Supabase', !/supabase|createClient|getAdminClient/i.test(providerSource));

  const unitA = '11111111-1111-4111-8111-111111111111';
  const unitB = '22222222-2222-4222-8222-222222222222';
  const institution = '33333333-3333-4333-8333-333333333333';
  const categoryA = '44444444-4444-4444-8444-444444444444';
  const categoryB = '55555555-5555-4555-8555-555555555555';
  const query = {
    currentPeriod: { startDate: '2026-10-01', endDateExclusive: '2026-11-01' },
    previousPeriod: { startDate: '2026-09-01', endDateExclusive: '2026-10-02' },
    institutionIds: [institution],
    unitIds: [unitA, unitA, unitB],
    categoryIds: [categoryA, categoryB],
  };
  const args = buildOperationalIntelligenceRpcArgs(query);
  check('argumentos reais usam datas e UUIDs', args.p_period_start === '2026-10-01' && args.p_period_end === '2026-11-01' && args.p_unit_ids.length === 2);
  expectThrow('data inválida falha de forma segura', () => buildOperationalIntelligenceRpcArgs({ ...query, currentPeriod: { startDate: '27/10/2026', endDateExclusive: '2026-11-01' } }));
  expectThrow('períodos desiguais são recusados', () => buildOperationalIntelligenceRpcArgs({ ...query, previousPeriod: { startDate: '2026-09-01', endDateExclusive: '2026-10-01' } }));
  expectThrow('lista vazia não amplia escopo', () => buildOperationalIntelligenceRpcArgs({ ...query, unitIds: [] }));
  expectThrow('UUID inválido é recusado', () => buildOperationalIntelligenceRpcArgs({ ...query, unitIds: ['not-a-uuid'] }));

  const payload = {
    schema_version: 'stage7d-operational-v1',
    generated_at: '2026-10-27T12:00:00Z',
    periods: {
      current: { start_date: '2026-10-01', end_date_exclusive: '2026-11-01' },
      previous: { start_date: '2026-09-01', end_date_exclusive: '2026-10-02' },
    },
    applied_scope: { institution_ids: [institution], unit_ids: [unitA, unitB], category_ids: [categoryA, categoryB] },
    meals_served: 10,
    volume_by_unit: [
      { unit_id: unitA, institution_id: institution, unit_name: 'Central', meals_served: 6, previous_meals_served: 5, variation_percent: 20 },
      { unit_id: unitB, institution_id: institution, unit_name: 'Norte', meals_served: 4, previous_meals_served: 3, variation_percent: 33.33 },
    ],
    utilization_by_category: [
      { category_id: categoryA, category_code: 'integral', category_name: 'Integral', meals_served: 7, percentage: 70 },
      { category_id: categoryB, category_code: 'partial', category_name: 'Parcial', meals_served: 3, percentage: 30 },
    ],
    period_comparison: { current_meals_served: 10, previous_meals_served: 8, variation_percent: 25 },
  };
  const parsed = parseOperationalIntelligenceRpcPayload(payload);
  check('payload RPC é convertido ao contrato de domínio', parsed.mealsServed === 10 && parsed.volumeByUnit[0].unitName === 'Central' && parsed.periodComparison.variationPercent === 25);
  expectThrow('totais inconsistentes são recusados', () => parseOperationalIntelligenceRpcPayload({ ...payload, meals_served: 11 }));
  expectThrow('versão incompatível é recusada', () => parseOperationalIntelligenceRpcPayload({ ...payload, schema_version: 'future' }));

  const calls = [];
  const executor = { invoke: async (name, rpcArgs) => { calls.push([name, rpcArgs]); return { data: payload, error: null }; } };
  const provider = new RpcOperationalIntelligenceProvider(executor);
  const activeAccess = { mode: 'authenticated', tenantId: 'tenant-local', institutionIds: [institution], unitIds: [unitA, unitB], role: 'admin_general', profileStatus: 'active' };
  const ready = await provider.getOperationalSnapshot(query, activeAccess);
  check('provider invoca somente a RPC homologável', ready.status === 'ready' && calls.length === 1 && calls[0][0] === 'get_operational_intelligence_v1');
  const inactive = await provider.getOperationalSnapshot(query, { ...activeAccess, profileStatus: 'inactive' });
  check('provider bloqueia perfil inativo antes do executor', inactive.status === 'unavailable' && calls.length === 1);
  const operator = await provider.getOperationalSnapshot(query, { ...activeAccess, role: 'operator' });
  check('provider bloqueia perfil sem dashboard antes do executor', operator.status === 'unavailable' && calls.length === 1);
  const failed = await new RpcOperationalIntelligenceProvider({ invoke: async () => ({ data: null, error: { message: 'denied' } }) }).getOperationalSnapshot(query, activeAccess);
  check('erro da RPC não vaza detalhe interno', failed.status === 'unavailable' && !failed.reason.includes('denied'));

  const operational = catalogModule.intelligenceIndicatorCatalog.filter((item) => item.classification === 'operational');
  const financial = catalogModule.intelligenceIndicatorCatalog.filter((item) => item.classification === 'financial');
  check('quatro indicadores operacionais estão preparados localmente', operational.length === 4 && operational.every((item) => item.integrationStatus === 'prepared-local'));
  check('indicadores financeiros permanecem bloqueados', financial.length === 4 && financial.every((item) => item.integrationStatus === 'blocked'));
  check('catálogo mantém gates de staging e desempenho', catalogSource.includes('schema e policies de staging') && catalogSource.includes('concorrência e SLA'));

  let failures = 0;
  for (const [name, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
    if (!passed) failures += 1;
  }
  console.log(`RESULT passed=${checks.length - failures} failed=${failures} total=${checks.length}`);
  if (failures) process.exitCode = 1;
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(outputDir, { recursive: true, force: true }));
