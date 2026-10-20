const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);
const passwordMatch = env.match(/CAIXA_TEST_PASSWORD=["']?([^"'\r\n]+)/);
if (!passwordMatch) throw new Error('CAIXA_TEST_PASSWORD não configurada em .env.local.');

const supabaseUrl = urlMatch[1];
const anonKey = anonMatch[1];
const password = passwordMatch[1];

async function testLogin() {
  const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'caixa1@ufh.br', password }),
  });

  const tokenData = await loginRes.json();
  console.log('Login status:', loginRes.status, 'User email:', tokenData.user?.email);
  if (!tokenData.access_token) {
    console.error('Failed to get access token:', tokenData);
    return;
  }

  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_meal`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_unit_id: 'e2222222-2222-2222-2222-222222222221',
      p_identifier: 'RA900001',
      p_meal_type_id: 'e5555555-5555-5555-5555-555555555552',
      p_terminal_id: 'TERM-01',
      p_idempotency_key: `test-auth-${Date.now()}`,
    }),
  });
  console.log('consume_meal with operator JWT status:', rpcRes.status, await rpcRes.text());
}

testLogin();
