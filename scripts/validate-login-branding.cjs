const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261022000064_add_login_portal_branding.sql');
const portalLogin = read('src/components/auth/PortalLogin.tsx');
const consumerLogin = read('src/app/conta/login/page.tsx');
const consumerPortal = read('src/app/consumer/page.tsx');
const consumerDashboard = read('src/components/consumer/ConsumerDashboard.tsx');
const middleware = read('src/lib/supabase/middleware.ts');
const settings = read('src/components/admin/LoginBrandingSettings.tsx');
const service = read('src/services/tenant.service.ts');
const identityLayout = read('src/app/admin/identidade/layout.tsx');
const preferencesMigration = read('supabase/migrations/20261023000070_add_branding_element_preferences.sql');
const panelMigration = read('supabase/migrations/20261023000071_add_login_panel_positions.sql');

const checks = [
  ['migration is additive', migration.includes('ADD COLUMN IF NOT EXISTS') && !migration.includes('DROP TABLE')],
  ['RLS is never disabled', !migration.includes('DISABLE ROW LEVEL SECURITY')],
  ['public branding v5 exposes four login images', migration.includes('get_public_tenant_branding_v5') && (migration.match(/login_.*background_url/g) || []).length >= 8],
  ['backend update is Master-only', migration.includes("v_profile.role <> 'admin_general'") && migration.includes('update_tenant_login_branding')],
  ['identity route remains Master-only', identityLayout.includes("profile.role !== 'admin_general'")],
  ['uploads validate role and file limit', service.includes("profile.role !== 'admin_general'") && service.includes('5 * 1024 * 1024')],
  ['four responsive image controls exist', ['staff_login_background_url', 'staff_login_mobile_background_url', 'consumer_login_background_url', 'consumer_login_mobile_background_url'].every((field) => settings.includes(field))],
  ['consumer has a dedicated login route', consumerLogin.includes('audience="consumer"')],
  ['consumer portal redirects to the account login', consumerPortal.includes("redirect('/conta/login')")],
  ['consumer logout returns to the account login', consumerDashboard.includes("router.replace('/conta/login')")],
  ['inactive consumer account returns to the account login', middleware.includes("['/consumer', '/conta']") && middleware.includes("? '/conta/login'")],
  ['portals reject incompatible roles', portalLogin.includes("profile.role !== 'student'") && portalLogin.includes("profile.role === 'student'") && portalLogin.includes('auth.signOut()')],
  ['login form stays semantic HTML', portalLogin.includes('<form') && portalLogin.includes('autoComplete="current-password"')],
  ['login element preferences are additive and Master-only', preferencesMigration.includes('ADD COLUMN IF NOT EXISTS login_element_visibility') && preferencesMigration.includes('update_tenant_login_element_visibility') && preferencesMigration.includes("v_profile.role <> 'admin_general'")],
  ['decorative login elements can be hidden', settings.includes('ELEMENT_CONFIG') && portalLogin.includes('login_element_visibility')],
  ['login panel migration is additive and Master-only', panelMigration.includes('ADD COLUMN IF NOT EXISTS login_panel_positions') && panelMigration.includes("v_profile.role <> 'admin_general'") && !panelMigration.includes('DISABLE ROW LEVEL SECURITY')],
  ['four responsive login positions are persisted', ['staff_desktop', 'staff_mobile', 'consumer_desktop', 'consumer_mobile'].every((target) => panelMigration.includes(`'${target}'`))],
  ['Master controls X and Y in each preview', settings.includes('positionTarget') && settings.includes('updateTenantLoginPanelPositions') && settings.includes("(['x', 'y'] as const)" )],
  ['portal consumes responsive panel positions', portalLogin.includes('login_panel_positions') && portalLogin.includes('--login-panel-mobile-x') && portalLogin.includes('--login-panel-desktop-x')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
