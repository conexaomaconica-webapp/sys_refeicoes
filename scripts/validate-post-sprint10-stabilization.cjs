const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20261019000044_stabilize_counter_payments_and_cash_reconciliation.sql');
const terminal = read('src/components/terminal/ReceptionTerminal.tsx');
const terminalPage = read('src/app/terminal/page.tsx');
const brandProvider = read('src/components/branding/BrandProvider.tsx');
const cashShiftModal = read('src/components/terminal/CashShiftModal.tsx');
const consumptionService = read('src/services/consumption.service.ts');
const visitorDailyLimitMigration = read('supabase/migrations/20261020000055_fix_repeated_visitor_sales.sql');
const terminalBackgroundMigration = read('supabase/migrations/20261020000056_add_terminal_center_background.sql');
const terminalLayoutMigration = read('supabase/migrations/20261020000057_add_terminal_layout_variant.sql');
const visitorChangeMigration = read('supabase/migrations/20261020000058_add_visitor_cash_change.sql');
const staleCashShiftMigration = read('supabase/migrations/20261021000059_block_stale_cash_shift_operations.sql');
const configurableCashShiftMigration = read('supabase/migrations/20261021000060_add_configurable_cash_shift_mode.sql');
const partialCashSettlementMigration = read('supabase/migrations/20261021000061_add_partial_cash_settlements.sql');
const adminCashPage = read('src/app/admin/caixa/page.tsx');
const identityPage = read('src/app/admin/identidade/page.tsx');
const nextConfig = read('next.config.mjs');
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
  ['terminal does not advertise a disabled offline queue', !terminal.includes('pendentesQueueCount') && !terminal.includes('handleTriggerSync') && terminal.includes('Offline bloqueado')],
  ['visitor KPI shows quantity without monetary value', terminal.includes('{visitantesCount}') && !terminal.includes('visitantesTotalValor')],
  ['cash KPI uses expected drawer balance', terminal.includes("label: 'Dinheiro em caixa', value: `R$ ${expectedDrawerBalance.toFixed(2)}`")],
  ['financial privacy also masks the header cash balance', terminal.includes("Caixa: ${showKpiValues ? `R$ ${expectedDrawerBalance.toFixed(2)}` : '••••••'}")],
  ['terminal background migration is additive and keeps RLS', terminalBackgroundMigration.includes('ADD COLUMN IF NOT EXISTS terminal_background_mode') && terminalBackgroundMigration.includes('GREATEST(') && !terminalBackgroundMigration.includes('pg_catalog.greatest') && !terminalBackgroundMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['terminal background remains admin-only', terminalBackgroundMigration.includes("v_profile.role <> 'admin_general'")],
  ['terminal offers optional preset and image backgrounds', terminal.includes('getTerminalBackgroundStyle') && identityPage.includes("['none', 'Sem fundo']") && identityPage.includes("['image', 'Minha foto']")],
  ['terminal layout migration is additive and keeps RLS', terminalLayoutMigration.includes('ADD COLUMN IF NOT EXISTS terminal_layout_variant') && terminalLayoutMigration.includes("DEFAULT 'classic'") && !terminalLayoutMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['terminal layout selection remains admin-only', terminalLayoutMigration.includes("v_profile.role <> 'admin_general'")],
  ['classic and operational terminal layouts are selectable', terminal.includes("branding.terminal_layout_variant === 'operational_dashboard'") && identityPage.includes("['classic', 'Clássico'") && identityPage.includes("['operational_dashboard', 'Painel Operacional'")],
  ['operational shortcuts preserve role checks', terminal.includes("['admin_general', 'operations_director', 'unit_manager', 'supervisor', 'finance'].includes(operatorRole)") && terminal.includes("operatorRole === 'admin_general'")],
  ['offline test mode stays fail-safe and can return online', terminal.includes('Voltar ao modo online') && terminal.includes('nenhuma refeição será liberada, cobrada ou guardada para sincronização')],
  ['visitor cash change migration is additive and keeps RLS', visitorChangeMigration.includes('register_operator_visitor_entry_v2') && visitorChangeMigration.includes('amount_received = v_received') && visitorChangeMigration.includes('change_amount = v_change') && !visitorChangeMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['visitor cash modal calculates change before confirmation', terminal.includes('Dinheiro recebido') && terminal.includes('Confirmar dinheiro e liberar') && terminal.includes("handleRegisterVisitorDirect('cash'")],
  ['terminal exposes explicit meal shift selection', terminal.includes('Selecionar turno') && terminal.includes('onMealTypeChange') && terminalPage.includes(".from('unit_meal_types')")],
  ['stale cash shifts require controlled closing', terminal.includes('isStaleCashShift') && cashShiftModal.includes('Este caixa foi aberto em') && cashShiftModal.includes("setTab(requestCloseShift || staleShift ? 'close' : 'summary')")],
  ['stale cash shift migration blocks new operations without auto-closing', staleCashShiftMigration.includes("'STALE_CASH_SHIFT'") && staleCashShiftMigration.includes("AT TIME ZONE 'America/Sao_Paulo'") && !staleCashShiftMigration.includes("SET status = 'closed'") && !staleCashShiftMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['cash shift mode migration is additive and keeps RLS', configurableCashShiftMigration.includes("ADD COLUMN IF NOT EXISTS cash_shift_mode") && configurableCashShiftMigration.includes("'per_meal', 'daily'") && !configurableCashShiftMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['daily cash keeps meal eligibility and same-day boundary', configurableCashShiftMigration.includes("cs.cash_shift_mode = 'daily' OR cs.meal_type_id = p_meal_type_id") && configurableCashShiftMigration.includes("AT TIME ZONE 'America/Sao_Paulo'")],
  ['cash shift mode cannot change with an open cash shift', configurableCashShiftMigration.includes("Feche todos os caixas abertos da unidade")],
  ['cash shift mode management is scoped by role and unit', configurableCashShiftMigration.includes("'admin_general', 'operations_director', 'unit_manager'") && configurableCashShiftMigration.includes('public.has_unit_access(p_unit_id)')],
  ['admin offers per-meal and daily modes', adminCashPage.includes("handleUpdateUnitMode(setting, 'per_meal')") && adminCashPage.includes("handleUpdateUnitMode(setting, 'daily')")],
  ['daily mode permits meal selection while cash remains open', terminal.includes("cashShiftMode === 'per_meal'") && terminal.includes('displayedMealTypeName')],
  ['partial cash settlement is additive and keeps RLS', partialCashSettlementMigration.includes('CREATE TABLE IF NOT EXISTS public.cash_shift_partial_settlements') && partialCashSettlementMigration.includes('ENABLE ROW LEVEL SECURITY') && !partialCashSettlementMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['partial settlement keeps daily cash open', partialCashSettlementMigration.includes("v_shift.cash_shift_mode <> 'daily'") && !partialCashSettlementMigration.includes("SET status = 'closed'")],
  ['partial withdrawal creates an auditable bleed', partialCashSettlementMigration.includes("'bleed'::VARCHAR") && partialCashSettlementMigration.includes('withdrawal_movement_id')],
  ['different physical terminals can be configured', terminalPage.includes('ma-refeicoes-physical-terminal-id') && terminalPage.includes('TERM-02')],
  ['partial settlement is available in daily cash UI', cashShiftModal.includes('Baixa Parcial') && cashShiftModal.includes('recordPartialSettlement')],
  ['development output is isolated from production builds', nextConfig.includes("'.next-dev'") && packageJson.scripts?.dev?.includes('--turbopack')],
  ['terminal does not download offline snapshot', !terminalPage.includes('downloadShiftSnapshot')],
  ['terminal light theme does not recolor modal backdrops and action buttons', terminal.includes("'terminal-theme-light'") && !terminal.includes("'terminal-theme-light terminal-light-surface'")],
  ['cash balance remains readable in light mode', cashShiftModal.includes("theme === 'light' ? 'text-emerald-950' : 'text-white'")],
  ['visitor payment errors stay visible in the active modal', terminal.includes('visitorPaymentError') && terminal.includes('role="alert"')],
  ['visitor payment keyboard shortcuts are scoped to the modal', terminal.includes('handleVisitorPaymentShortcut') && terminal.includes("shortcut === '1' || shortcut === 'd'") && terminal.includes("shortcut === '3' || shortcut === 'c'")],
  ['visitor sales restore the existing multi-meal contract', visitorDailyLimitMigration.includes("category.allow_multi_meal OR category.code = 'visitante'")],
  ['historical multi-meal flags are reconciled without deleting consumptions', visitorDailyLimitMigration.includes('UPDATE public.meal_consumptions') && !visitorDailyLimitMigration.includes('DELETE FROM public.meal_consumptions')],
  ['personal daily uniqueness remains active', visitorDailyLimitMigration.includes("indexname = 'idx_meal_consumptions_active_daily'") && visitorDailyLimitMigration.includes("NOT allow_multi_meal")],
  ['visitor correction keeps RLS enabled', !visitorDailyLimitMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['terminal resolves units through RLS', terminalPage.includes(".from('units')")],
  ['authenticated terminal resolves the tenant branding slug', terminalPage.includes(".from('tenants')") && terminalPage.includes('selectTenantSlug(tenant.slug)') && brandProvider.includes("ma-refeicoes-tenant-slug")],
  ['terminal does not require explicit unit link for global roles', !terminalPage.includes(".from('user_unit_access')")],
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
