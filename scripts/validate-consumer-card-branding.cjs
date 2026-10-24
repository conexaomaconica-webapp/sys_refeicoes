const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const migration = read('supabase/migrations/20261022000065_add_consumer_card_branding.sql');
const layoutMigration = read('supabase/migrations/20261023000068_add_consumer_card_element_layout.sql');
const preferencesMigration = read('supabase/migrations/20261023000070_add_branding_element_preferences.sql');
const transformMigration = read('supabase/migrations/20261023000069_add_consumer_card_background_transform.sql');
const card = read('src/components/cards/ConsumerVirtualCard.tsx');
const settings = read('src/components/admin/ConsumerCardBrandingSettings.tsx');
const service = read('src/services/tenant.service.ts');
const terminalBackground = read('src/lib/terminal-background.ts');
const terminalPageSettings = read('src/components/admin/TerminalPageBrandingSettings.tsx');

const checks = [
  ['migration is additive', migration.includes('ADD COLUMN IF NOT EXISTS') && !migration.includes('DROP TABLE')],
  ['RLS is never disabled', !migration.includes('DISABLE ROW LEVEL SECURITY')],
  ['card update is Master-only', migration.includes("v_profile.role <> 'admin_general'") && migration.includes('update_tenant_consumer_card_branding')],
  ['public branding v6 exposes card appearance', migration.includes('get_public_tenant_branding_v6') && migration.includes('consumer_card_background_url')],
  ['card data stays dynamic', ['student.fullName', 'student.photoPath', 'student.status', 'balance', 'DynamicQRCode'].every((token) => card.includes(token))],
  ['integral card does not expose wallet balance', card.includes("requiresWallet ? formatCurrency") && card.includes("'Sem cobrança'")],
  ['Master can choose color or image', settings.includes("['color', 'image']") && settings.includes('uploadTenantConsumerCardBackground')],
  ['upload validates Master and file size', service.includes("profile.role !== 'admin_general'") && service.includes('5 * 1024 * 1024')],
  ['institutional card asset exists', exists('public/branding/consumer-card-ma.jpg')],
  ['operational background remains independent', terminalBackground.includes("id: 'institutional'") && terminalBackground.includes('radial-gradient(circle at 18% 18%')],
  ['full terminal page is Master-only', migration.includes('update_tenant_terminal_page_background') && migration.includes('Somente o usuario Master pode alterar o fundo completo do terminal')],
  ['full terminal page can use color or image', terminalPageSettings.includes("['color', 'image']") && terminalPageSettings.includes('uploadTenantTerminalPageBackground')],
  ['institutional terminal page asset exists', exists('public/branding/terminal-ma-institutional.jpg') && terminalPageSettings.includes('/branding/terminal-ma-institutional.jpg')],
  ['card layout migration is additive and keeps RLS', layoutMigration.includes('ADD COLUMN IF NOT EXISTS consumer_card_layout') && !layoutMigration.includes('DISABLE ROW LEVEL SECURITY') && !layoutMigration.includes('DROP TABLE')],
  ['card layout update is Master-only', layoutMigration.includes("v_profile.role <> 'admin_general'") && layoutMigration.includes('update_tenant_consumer_card_layout')],
  ['public branding v7 exposes safe coordinates', layoutMigration.includes('get_public_tenant_branding_v7') && layoutMigration.includes('consumer_card_layout JSONB')],
  ['six configurable elements are persisted', ['logo', 'title', 'qr', 'photo', 'name', 'balance'].every((token) => layoutMigration.includes(`'${token}'`))],
  ['admin exposes X and Y position controls', settings.includes('POSITION_CONTROLS') && settings.includes('type="range"') && settings.includes('updateTenantConsumerCardLayout')],
  ['virtual card consumes saved positions', card.includes('consumer_card_layout.logo') && card.includes('consumer_card_layout.balance') && card.includes('getConsumerCardElementStyle')],
  ['element preferences migration is additive and keeps RLS', preferencesMigration.includes('ADD COLUMN IF NOT EXISTS consumer_card_elements') && !preferencesMigration.includes('DISABLE ROW LEVEL SECURITY') && !preferencesMigration.includes('DROP TABLE')],
  ['card visibility and zoom are Master-only', preferencesMigration.includes("v_profile.role <> 'admin_general'") && preferencesMigration.includes('update_tenant_consumer_card_elements')],
  ['seven card elements support visibility and zoom', ['logo', 'title', 'qr', 'photo', 'name', 'status', 'balance'].every((token) => preferencesMigration.includes(`'${token}'`)) && settings.includes('elements[key].zoom')],
  ['virtual card applies visibility and zoom', card.includes('consumer_card_elements.status.visible') && card.includes('consumer_card_elements.balance.zoom')],
  ['background transform migration is additive and keeps RLS', transformMigration.includes('ADD COLUMN IF NOT EXISTS consumer_card_background_transform') && !transformMigration.includes('DISABLE ROW LEVEL SECURITY') && !transformMigration.includes('DROP TABLE')],
  ['background transform is Master-only and bounded', transformMigration.includes("v_profile.role <> 'admin_general'") && transformMigration.includes('v_zoom < 100 OR v_zoom > 200')],
  ['public branding v8 exposes background transform', transformMigration.includes('get_public_tenant_branding_v8') && transformMigration.includes('consumer_card_background_transform JSONB')],
  ['admin adjusts background position and zoom', settings.includes('Enquadramento da imagem') && settings.includes("['zoom', 'Ampliação'") && settings.includes('updateTenantConsumerCardBackgroundTransform')],
  ['virtual card applies background transform below dynamic data', card.includes('consumer_card_background_transform') && card.includes('getConsumerCardBackgroundImageStyle')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
