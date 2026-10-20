const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20261019000044_stabilize_counter_payments_and_cash_reconciliation.sql');
const terminal = read('src/components/terminal/ReceptionTerminal.tsx');
const terminalPage = read('src/app/terminal/page.tsx');
const consumptionService = read('src/services/consumption.service.ts');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['migration 44 is additive', migration.includes('Migration aditiva')],
  ['counter payment has no wallet credit', !/INSERT INTO public\.wallet_transactions[\s\S]{0,900}terminal_counter_payment/.test(migration)],
  ['dedicated counter consumption path', migration.includes('consume_meal_counter_payment')],
  ['cash movement idempotency', migration.includes('uq_cash_movements_shift_idempotency')],
  ['cash/pix/card totals separated', ['counter_cash_amount', 'counter_pix_amount', 'counter_card_amount'].every((field) => migration.includes(field))],
  ['cash-only expected drawer balance', migration.includes('expected_cash_balance')],
  ['counter refunds are compensating movements', migration.includes("'counter_payment_refund'")],
  ['counter refund requires financial role', migration.includes("'admin_general', 'operations_director', 'finance'")],
  ['unit scope is checked on cancellation', migration.includes('public.has_unit_access(v_consumption.unit_id)')],
  ['cash shift is required for receipt', migration.includes('CASH_SHIFT_REQUIRED')],
  ['legacy wallet bridges are identified', migration.includes('legacy_wallet_bridge')],
  ['offline reconciliation revoked', migration.includes('REVOKE ALL ON FUNCTION public.reconcile_offline_consumptions')],
  ['terminal does not authorize offline meals', !terminal.includes('processOfflineMealConsumption')],
  ['terminal does not auto-sync offline queue', !terminal.includes('executeOfflineSync')],
  ['terminal does not download offline snapshot', !terminalPage.includes('downloadShiftSnapshot')],
  ['visitor payment method reaches RPC', consumptionService.includes("p_payment_method: params.paymentMethod || 'cash'")],
  ['runtime is Node 22+', packageJson.engines?.node === '>=22.0.0'],
  ['package manager is pinned', packageJson.packageManager === 'pnpm@12.6.0'],
  ['runtime dependencies are pinned', Object.values(packageJson.dependencies).every((version) => !String(version).startsWith('^'))],
  ['development dependencies are pinned', Object.values(packageJson.devDependencies).every((version) => !String(version).startsWith('^'))],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
