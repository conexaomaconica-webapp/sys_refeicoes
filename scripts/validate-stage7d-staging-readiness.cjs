const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'scripts/stage7d/staging-readiness-contract.json');
const inventorySqlPath = path.join(root, 'scripts/stage7d/staging-inventory-readonly.sql');
const planPath = path.join(root, 'docs/STAGE_7D4_STAGING_READINESS_PLAN.md');
const migrationPaths = [
  'supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql',
  'supabase/migrations/20261026000073_harden_scoped_read_policies.sql',
  'supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql',
];

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const inventorySql = fs.readFileSync(inventorySqlPath, 'utf8');
const plan = fs.readFileSync(planPath, 'utf8');
const migrations = migrationPaths.map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8'));
const checks = [];

function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

check('contrato possui versao conhecida', contract.contractVersion === 1);
check('contrato exige PostgreSQL 17', contract.postgresMajor === 17);
check('ordem das migrations e 72 73 74', JSON.stringify(contract.pendingMigrationVersions) === JSON.stringify([
  '20261026000072', '20261026000073', '20261027000074',
]));
check('inventario abre transacao read-only', /BEGIN TRANSACTION READ ONLY;/i.test(inventorySql));
check('inventario sempre encerra com rollback', /ROLLBACK;\s*$/i.test(inventorySql));
check('inventario limita tempo de consulta e lock', inventorySql.includes('statement_timeout') && inventorySql.includes('lock_timeout'));
check('inventario nao consulta linhas operacionais', !/FROM public\.(students|wallets|payments|recharges|meal_consumptions|offline_contingency_events)\b/i.test(inventorySql));
check('inventario nao contem mutacao', !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/im.test(inventorySql));
check('inventario registra RLS policies funcoes grants e indices', ['rlsEnabled', "'policies'", "'functions'", "'acl'", "'indexes'"].every((token) => inventorySql.includes(token)));
check('migration 72 converge policies offline explicitamente', migrations[0].includes('DROP POLICY %I') && migrations[0].includes('ENABLE ROW LEVEL SECURITY'));
check('migration 72 bloqueia RPCs legadas para clientes', migrations[0].includes('reconcile_offline_consumptions(JSONB)') && migrations[0].includes('get_terminal_shift_snapshot(UUID)'));
check('migration 73 mantem financeiro fail-closed', ['sel_wallets_staff', 'sel_wallet_tx_staff', 'sel_payments_staff', 'sel_recharges_staff'].every((token) => migrations[1].includes(token)) && !migrations[1].includes("'supervisor', 'unit_manager', 'finance'"));
check('migration 74 permanece operacional', !/public\.(wallets|wallet_transactions|payments|recharges|cash_shifts|cash_movements)\b/i.test(migrations[2]));
check('migration 74 fixa search_path e grants', migrations[2].includes("SET search_path = ''") && migrations[2].includes('FROM PUBLIC') && migrations[2].includes('TO authenticated'));
check('plano separa pre-commit pos-commit e restauracao', ['Pré-commit', 'Pós-commit', 'restauração'].every((token) => plan.includes(token)));
check('plano exige 31 cenarios RLS', plan.includes('31/31'));
check('plano cobre consistencia dos quatro indicadores', ['refeições servidas', 'volume por restaurante', 'utilização por categoria', 'comparativos por período'].every((token) => plan.includes(token)));
check('plano mantem financeiro bloqueado', plan.includes('indicadores financeiros') && plan.includes('fail-closed'));
check('plano define criterios de interrupcao', plan.includes('Critérios de interrupção'));
check('plano nao autoriza staging ou producao', plan.includes('NO-GO para execução em staging') && plan.includes('NO-GO para produção'));

function validateInventory(inventory) {
  const findings = [];
  const fail = (message) => findings.push(message);
  if (inventory.contractVersion !== contract.contractVersion) fail('versao do contrato divergente');
  if (Math.trunc(Number(inventory.serverVersionNum) / 10000) !== contract.postgresMajor) fail('PostgreSQL major diferente de 17');
  if (!inventory.session || inventory.session.isSuperuser || inventory.session.bypassRls) fail('sessao de inventario privilegiada');

  const applied = new Set(inventory.migrations || []);
  for (const version of contract.pendingMigrationVersions) {
    if (applied.has(version)) fail(`migration ${version} ja registrada; interromper e reconciliar`);
  }

  const relations = new Map((inventory.relations || []).map((item) => [item.name, item]));
  for (const relation of contract.requiredRelations) {
    if (!relations.has(relation)) fail(`relacao ausente: ${relation}`);
  }
  for (const relation of contract.rlsRequired) {
    if (relations.has(relation) && !relations.get(relation).rlsEnabled) fail(`RLS desabilitada: ${relation}`);
  }

  const columns = new Set((inventory.columns || []).map((item) => `${item.relation}.${item.name}`));
  for (const [relation, names] of Object.entries(contract.requiredColumns)) {
    for (const name of names) {
      if (!columns.has(`${relation}.${name}`)) fail(`coluna ausente: ${relation}.${name}`);
    }
  }

  const functions = (inventory.functions || []).map((item) => item.identity);
  for (const prefix of contract.requiredFunctionPrefixes) {
    if (!functions.some((identity) => identity.startsWith(prefix))) fail(`funcao ausente: ${prefix}`);
  }
  if (functions.some((identity) => identity.startsWith(contract.targetFunctionPrefix))) {
    fail('RPC v1 ja existe sem migration 74 registrada; drift deve ser reconciliado');
  }
  return findings;
}

const syntheticSafeInventory = {
  contractVersion: contract.contractVersion,
  serverVersionNum: 170000,
  session: { isSuperuser: false, bypassRls: false },
  migrations: [],
  relations: contract.requiredRelations.map((name) => ({
    name,
    rlsEnabled: contract.rlsRequired.includes(name),
  })),
  columns: Object.entries(contract.requiredColumns).flatMap(([relation, names]) =>
    names.map((name) => ({ relation, name }))),
  functions: contract.requiredFunctionPrefixes.map((prefix) => ({ identity: `${prefix})` })),
};
check('motor aceita inventario sintetico compativel', validateInventory(syntheticSafeInventory).length === 0);
check('motor bloqueia sessao BYPASSRLS', validateInventory({
  ...syntheticSafeInventory,
  session: { isSuperuser: false, bypassRls: true },
}).some((finding) => finding.includes('privilegiada')));
check('motor bloqueia RPC 74 fora do historico', validateInventory({
  ...syntheticSafeInventory,
  functions: [...syntheticSafeInventory.functions, { identity: `${contract.targetFunctionPrefix})` }],
}).some((finding) => finding.includes('drift')));
check('motor bloqueia relacao ausente', validateInventory({
  ...syntheticSafeInventory,
  relations: syntheticSafeInventory.relations.slice(1),
}).some((finding) => finding.includes('relacao ausente')));

const inventoryFlag = process.argv.indexOf('--inventory');
if (inventoryFlag >= 0) {
  const inventoryArg = process.argv[inventoryFlag + 1];
  if (!inventoryArg) throw new Error('--inventory exige um arquivo JSON');
  const inventoryPath = path.resolve(process.cwd(), inventoryArg);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const findings = validateInventory(inventory);
  check('inventario real atende aos gates de compatibilidade', findings.length === 0);
  for (const finding of findings) console.error(`BLOCK ${finding}`);
} else {
  console.log('INFO inventario de staging nao fornecido; compatibilidade real permanece NAO TESTADA');
}

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
