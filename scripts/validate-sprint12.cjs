const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261022000063_create_consumer_pwa.sql');
const page = read('src/app/consumer/page.tsx');
const dashboard = read('src/components/consumer/ConsumerDashboard.tsx');
const actions = read('src/app/consumer/actions.ts');
const rechargeService = read('src/services/recharge.service.ts');
const login = read('src/app/(auth)/login/page.tsx');
const portalLogin = read('src/components/auth/PortalLogin.tsx');
const layout = read('src/app/layout.tsx');
const dynamicQr = read('src/components/cards/DynamicQRCode.tsx');
const manifest = JSON.parse(read('public/manifest.json'));
const packageJson = JSON.parse(read('package.json'));
const serviceWorker = read('public/sw.js');
const staticAssets = serviceWorker.slice(
  serviceWorker.indexOf('const STATIC_ASSETS'),
  serviceWorker.indexOf('];', serviceWorker.indexOf('const STATIC_ASSETS')) + 2
);

const checks = [
  [
    'consumer route requires the student role',
    page.includes("profile.role !== 'student'"),
  ],
  [
    'login directs students to the consumer portal',
    (login + portalLogin).includes("profile.role === 'student'") &&
      (login + portalLogin).includes("'/consumer'"),
  ],
  [
    'integral consumers do not execute financial queries',
    page.includes('category.requires_wallet') &&
      page.includes('Promise.resolve([{ data: null }, { data: [] }]'),
  ],
  [
    'integral menu omits every financial entry',
    dashboard.includes('...(isFinancial') &&
      dashboard.includes("id: 'wallet'") &&
      dashboard.includes("id: 'recharge'") &&
      dashboard.includes("id: 'ledger'"),
  ],
  [
    'financial RLS also excludes integral consumers',
    ['wallets', 'wallet_transactions', 'payments', 'recharges'].every((table) =>
      migration.includes(`ON public.${table}`)
    ) && migration.match(/category\.requires_wallet = true/g)?.length >= 4,
  ],
  [
    'recharge checks ownership before gateway access',
    rechargeService.includes('student.user_id !== user.id') &&
      rechargeService.includes("student.status !== 'active'"),
  ],
  [
    'ledger comes directly from wallet transactions',
    page.includes("from('wallet_transactions')") &&
      dashboard.includes('initialData.transactions.map'),
  ],
  [
    'meal history is scoped through RLS',
    page.includes("from('meal_consumptions')") &&
      page.includes(".eq('student_id', student.id)"),
  ],
  [
    'digital card is provisioned by an owner-only RPC',
    migration.includes('ensure_my_digital_card') &&
      migration.includes("v_profile.role <> 'student'") &&
      migration.includes("v_card.status <> 'active'"),
  ],
  [
    'low balance preference is persisted securely',
    migration.includes('consumer_preferences') &&
      migration.includes('upsert_my_consumer_preferences') &&
      !migration.includes('DISABLE ROW LEVEL SECURITY'),
  ],
  [
    'realtime covers meals and wallet updates',
    dashboard.includes("table: 'meal_consumptions'") &&
      dashboard.includes("table: 'wallet_transactions'"),
  ],
  ['PWA registers a service worker', layout.includes('PwaRegistration')],
  [
    'manifest opens the consumer portal',
    manifest.display === 'standalone' && manifest.start_url === '/consumer',
  ],
  [
    'offline fallback does not cache private consumer HTML',
    staticAssets.includes("'/offline.html'") && !staticAssets.includes("'/consumer'"),
  ],
  ['consumer actions are server-side', actions.startsWith("'use server';")],
  [
    'digital card renders a scanner-compatible QR code',
    packageJson.dependencies.qrcode === '1.5.4' &&
      dynamicQr.includes("import QRCode from 'qrcode'") &&
      dynamicQr.includes('QRCode.toDataURL(payload'),
  ],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
