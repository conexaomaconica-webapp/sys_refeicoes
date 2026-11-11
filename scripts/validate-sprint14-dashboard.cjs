const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- VALIDATING SPRINT 14: OPERATIONAL DASHBOARDS & PEAK MONITORING ---');

const migrationPath = path.join(__dirname, '../supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql');
const servicePath = path.join(__dirname, '../src/services/operational-dashboard.service.ts');
const serverServicePath = path.join(__dirname, '../src/server/dashboard/operational-dashboard.server.ts');
const typesPath = path.join(__dirname, '../src/types/operational-dashboard.ts');
const componentPath = path.join(__dirname, '../src/components/admin/OperationalDashboard.tsx');
const pagePath = path.join(__dirname, '../src/app/admin/dashboard/page.tsx');
const shellPath = path.join(__dirname, '../src/components/admin/AdminShell.tsx');
const adminHomePath = path.join(__dirname, '../src/app/admin/page.tsx');

// 1. Verificar arquivos essenciais da Sprint 14
assert(fs.existsSync(migrationPath), 'Migration 20261109000078_create_realtime_operational_dashboard.sql must exist');
assert(fs.existsSync(servicePath), 'Client service operational-dashboard.service.ts must exist');
assert(fs.existsSync(serverServicePath), 'Server service operational-dashboard.server.ts must exist');
assert(fs.existsSync(typesPath), 'TypeScript contracts operational-dashboard.ts must exist');
assert(fs.existsSync(componentPath), 'Interactive component OperationalDashboard.tsx must exist');
assert(fs.existsSync(pagePath), 'Route /admin/dashboard/page.tsx must exist');
console.log('✓ All Sprint 14 files and modules exist');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

// 2. Integridade e Segurança de RLS / Publicações Realtime
assert(!migrationSql.includes('DROP TABLE'), 'Migration must not drop any table');
assert(!migrationSql.includes('DISABLE ROW LEVEL SECURITY'), 'RLS must NEVER be disabled');
assert(migrationSql.includes('supabase_realtime'), 'Must ensure supabase_realtime publication contains meal_consumptions and blocked_attempts');
assert(migrationSql.includes('blocked_attempts'), 'Must publish blocked_attempts for real-time monitoring');
console.log('✓ Supabase Realtime publication and RLS verified');

// 3. Estrutura e Métricas da RPC get_realtime_operational_dashboard
assert(migrationSql.includes('get_realtime_operational_dashboard'), 'Must declare get_realtime_operational_dashboard RPC');
assert(migrationSql.includes('SECURITY DEFINER'), 'RPC must execute as SECURITY DEFINER with search_path safety');
assert(migrationSql.includes("search_path = public, pg_temp"), 'RPC must secure search_path');
assert(migrationSql.includes('has_unit_access'), 'RPC must strictly validate user unit scope via has_unit_access');
assert(migrationSql.includes('date_bin'), 'Must compute 15-minute time buckets with date_bin');
assert(migrationSql.includes('15 minutes'), 'Must group peak flow in 15-minute intervals');
assert(migrationSql.includes('speed_per_minute'), 'Must calculate line speed per minute');
assert(migrationSql.includes('is_idle_alert'), 'Must compute is_idle_alert for terminals inactive > 2 minutes');
assert(migrationSql.includes('120'), 'Must enforce 120 seconds threshold for idle alert in peak');
console.log('✓ RPC get_realtime_operational_dashboard analytical queries and idle detection verified');

// 4. Verificação dos Contratos TypeScript
const typesCode = fs.readFileSync(typesPath, 'utf8');
assert(typesCode.includes('HourlyFlowBucket'), 'Must declare HourlyFlowBucket type');
assert(typesCode.includes('BlockedReasonMetric'), 'Must declare BlockedReasonMetric type');
assert(typesCode.includes('TerminalStatusMetric'), 'Must declare TerminalStatusMetric type');
assert(typesCode.includes('OperationalDashboardSummary'), 'Must declare OperationalDashboardSummary type');
assert(typesCode.includes('OperationalDashboardSnapshot'), 'Must declare OperationalDashboardSnapshot type');
console.log('✓ TypeScript analytical interfaces verified');

// 5. Verificação da Interface do Usuário (OperationalDashboard.tsx)
const componentCode = fs.readFileSync(componentPath, 'utf8');
assert(componentCode.includes('postgres_changes'), 'Component must subscribe to postgres_changes via Supabase Realtime');
assert(
  componentCode.includes('operational_dashboard_signals') ||
    (componentCode.includes('meal_consumptions') && componentCode.includes('blocked_attempts')),
  'Component must listen to hardened operational_dashboard_signals or legacy tables'
);
assert(componentCode.includes('is_idle_alert'), 'Component must render visual warning for idle terminals');
assert(componentCode.includes('summary.speed_per_minute'), 'Component must display line speed metric');
assert(componentCode.includes('hourly_flow'), 'Component must render 15-minute hourly flow chart');
assert(componentCode.includes('blocked_reasons'), 'Component must show rejection details');
assert(componentCode.includes('category_breakdown'), 'Component must render consumption by category');
console.log('✓ Realtime listeners, peak charts and idle alerts in component verified');

// 6. Verificação da Integração de Navegação
const shellCode = fs.readFileSync(shellPath, 'utf8');
assert(shellCode.includes('/admin/dashboard'), 'AdminShell must link to /admin/dashboard');

const adminHomeCode = fs.readFileSync(adminHomePath, 'utf8');
assert(adminHomeCode.includes('/admin/dashboard'), 'Admin Home must feature Dashboard Operacional module');
console.log('✓ Navigation and admin shell integration verified');

console.log('\n--- ALL SPRINT 14 VERIFICATIONS PASSED (6/6) ---');

