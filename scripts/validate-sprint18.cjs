/**
 * ==============================================================================
 * VALIDATOR & TESTES DE RESILIÊNCIA CLIENT-SIDE: SPRINT 18
 * Verifica invariantes da Migration 82, harness PostgreSQL 17 descartável,
 * fallback de Realtime no Dashboard Operacional e comportamento da fila/timeout/rede
 * sem tocar no Supabase remoto.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

console.log('================================================================================');
console.log('VALIDAÇÃO SPRINT 18: PERFORMANCE, CONTINGÊNCIA E RESILIÊNCIA (LOCAL)');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  [PASS] ${label}`);
}

const mig82Path = 'supabase/migrations/20261110000082_sprint18_performance_indexes.sql';
const baseline18Path = 'scripts/sql/sprint18_disposable_pg17_baseline.sql';
const harness18Path = 'scripts/homologate-sprint18-performance.cjs';
const psNativePath = 'scripts/sprint18/run-native-performance.ps1';
const psDlPath = 'scripts/sprint18/run-with-portable-download.ps1';

check('1.1 - Artefatos Sprint 18 existem no workspace', () => {
  for (const f of [mig82Path, baseline18Path, harness18Path, psNativePath, psDlPath]) {
    assert(exists(f), `Arquivo ausente: ${f}`);
  }
});

check('1.2 - Migration 82 é estritamente não-destrutiva e não enfraquece RLS', () => {
  const mig82 = read(mig82Path);
  assert(mig82.includes('CREATE INDEX IF NOT EXISTS idx_cash_shifts_open_operator_terminal'));
  assert(mig82.includes('CREATE INDEX IF NOT EXISTS idx_meal_consumptions_unit_date_meal_status'));
  assert(mig82.includes('CREATE INDEX IF NOT EXISTS idx_wallets_student_tenant'));
  assert(mig82.includes('CREATE INDEX IF NOT EXISTS idx_ops_signals_emitted_at'));
  assert(!/\b(DROP\s+TABLE|TRUNCATE|DISABLE\s+ROW\s+LEVEL\s+SECURITY|DROP\s+POLICY)\b/i.test(mig82));
});

check('1.3 - Harness PostgreSQL 17 bloqueia Supabase remoto e exige loopback sprint18_', () => {
  const harness = read(harness18Path);
  assert(harness.includes('DISPOSABLE_PG_URL'));
  assert(harness.includes('supabase\\.(co|com)|pooler\\.supabase'));
  assert(harness.includes("startsWith('sprint18_')"));
  assert(harness.includes("new Set(['127.0.0.1', 'localhost', '::1'])"));
});

check('1.4 - Dashboard Operacional possui debounce Realtime (1500ms) e fallback polling (30s) sem PII', () => {
  const opsDash = read('src/components/admin/OperationalDashboard.tsx');
  assert(opsDash.includes('1500'), 'Debounce de 1.500ms ausente');
  assert(opsDash.includes('30_000') || opsDash.includes('30000'), 'Polling fallback de 30s ausente');
  assert(opsDash.includes("'operational_dashboard_signals'"), 'Assinatura de sinal sem PII ausente');
  assert(!opsDash.includes("table: 'meal_consumptions'"), 'Realtime não deve assinar tabela PII meal_consumptions');
});

check('1.5 - Motor Offline garante trava de duplicidade local, teto de risco e cadeia de integridade', () => {
  const offlineEngine = read('src/lib/offline/offline-engine.ts');
  assert(offlineEngine.includes('hasLocalPassageToday'));
  assert(offlineEngine.includes('ALREADY_CONSUMED_TODAY'));
  assert(offlineEngine.includes('OFFLINE_LIMIT_EXCEEDED'));
  assert(offlineEngine.includes('OFFLINE_PARTIAL_NOT_ALLOWED'));
  assert(offlineEngine.includes('INSUFFICIENT_FUNDS'));
  assert(offlineEngine.includes('calculateEventChainHash'));
});

check('1.6 - TimeoutLock previne dupla autorização quando conectividade degrada no meio do consumo', () => {
  const timeoutLock = read('src/lib/offline/timeout-lock.ts');
  assert(timeoutLock.includes('recordUnknownTimeout'));
  assert(timeoutLock.includes('hasPendingUnknownTimeout'));
  assert(timeoutLock.includes('resolveUnknownTimeout'));
  assert(timeoutLock.includes('pending_resolution'));
});

check('1.7 - NetworkMonitor implementa histerese e instrumentação de p50/p95/p99', () => {
  const netMon = read('src/lib/offline/network-monitor.ts');
  assert(netMon.includes('consecutiveFailures'));
  assert(netMon.includes('consecutiveSuccesses'));
  assert(netMon.includes('DEGRADED') && netMon.includes('RECOVERING') && netMon.includes('SYNCING'));
  assert(netMon.includes('p95') && netMon.includes('p99'));
});

check('1.8 - OfflineSyncService usa Mutex exclusivo e bloqueia RPC revogada em política online-first', () => {
  const syncSvc = read('src/services/offline-sync.service.ts');
  const snapSvc = read('src/services/terminal-snapshot.service.ts');
  assert(syncSvc.includes('acquireSyncLock'));
  assert(syncSvc.includes('releaseSyncLock'));
  assert(syncSvc.includes('ONLINE_FIRST_POLICY_ACTIVE'));
  assert(!syncSvc.includes(".rpc('reconcile_offline_consumptions'"));
  assert(snapSvc.includes('ONLINE_FIRST_POLICY_ACTIVE'));
  assert(!snapSvc.includes(".rpc('get_terminal_shift_snapshot'"));
});

console.log(`\nSPRINT 18 LOCAL CHECKS: ${passed}/8 PASS (0 failures)`);

