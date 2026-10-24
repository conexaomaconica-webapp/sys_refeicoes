const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261022000067_create_consumer_first_access.sql');
const identity = read('src/lib/security/consumer-identity.ts');
const parser = read('src/services/import-parser.service.ts');
const importService = read('src/services/admin-import.service.ts');
const firstAccess = read('src/services/consumer-first-access.service.ts');
const activation = read('src/app/conta/ativar/actions.ts');
const recovery = read('src/app/conta/esqueci-senha/actions.ts');
const middleware = read('src/lib/supabase/middleware.ts');
const confirmRoute = read('src/app/auth/confirm/route.ts');
const environment = read('.env.example');

const checks = [
  ['CPF lookup uses a private HMAC key', identity.includes("createHmac('sha256'") && identity.includes('CONSUMER_IDENTITY_HMAC_KEY')],
  ['CPF checksum is validated server-side', identity.includes('export function isValidCpf') && firstAccess.includes('isValidCpf(input.cpf)')],
  ['raw import manifests mask CPF', parser.includes("'[DADO PESSOAL PROTEGIDO]'") && importService.includes('delete row.normalized_data.cpf')],
  ['migration stores only protected CPF lookup material', migration.includes('cpf_lookup_hash TEXT') && migration.includes('cpf_last4 TEXT')],
  ['attempt log has forced RLS and no client policy', migration.includes('FORCE ROW LEVEL SECURITY') && !migration.includes('CREATE POLICY')],
  ['public response does not disclose whether identity matched', firstAccess.includes('GENERIC_MESSAGE') && firstAccess.includes("outcome: 'rejected' | 'rate_limited'")],
  ['first access is rate limited', firstAccess.includes('(count || 0) >= 5') && firstAccess.includes('15 * 60 * 1000')],
  ['identity match uses tenant, institution, registration and CPF HMAC', firstAccess.includes(".eq('registration_number', registrationNumber)") && firstAccess.includes(".eq('cpf_lookup_hash', hashCpf(input.cpf))")],
  ['missing imported email enters administrative review', firstAccess.includes("first_access_status: 'pending_review'")],
  ['eligible consumers receive an email invitation', firstAccess.includes('inviteUserByEmail') && firstAccess.includes("must_change_password: true")],
  ['activation validates account ownership and optional photo', activation.includes("profile.role !== 'student'") && activation.includes('photo.size > 5 * 1024 * 1024')],
  ['password recovery is consumer-controlled', recovery.includes('resetPasswordForEmail') && middleware.includes('must_change_password')],
  ['email token confirmation is server-side', confirmRoute.includes('verifyOtp') && confirmRoute.includes('token_hash')],
  ['private HMAC configuration is documented', environment.includes('CONSUMER_IDENTITY_HMAC_KEY=') && !environment.includes('NEXT_PUBLIC_CONSUMER_IDENTITY')],
  ['RLS is never disabled', !migration.includes('DISABLE ROW LEVEL SECURITY')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) process.exit(1);
