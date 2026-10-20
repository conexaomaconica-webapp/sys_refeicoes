const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const serviceRoleMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);
const passwordMatch = env.match(/CAIXA_TEST_PASSWORD=["']?([^"'\r\n]+)/);

if (!passwordMatch) throw new Error('CAIXA_TEST_PASSWORD não configurada em .env.local.');

const supabaseUrl = urlMatch[1];
const serviceRoleKey = serviceRoleMatch[1];
const anonKey = anonMatch[1];
const password = passwordMatch[1];

async function updatePasswordViaAdmin() {
  const userId = 'e4444444-4444-4444-4444-444444444441';
  console.log('Updating password for user', userId, 'via GoTrue admin API...');
  
  const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password,
      email_confirm: true
    })
  });

  const adminData = await adminRes.json();
  console.log('Admin update status:', adminRes.status, 'User email:', adminData.email);

  // Now test login with anon key!
  const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'caixa1@ufh.br',
      password
    })
  });

  const tokenData = await loginRes.json();
  console.log('Login status:', loginRes.status, 'User email:', tokenData.user?.email);

  if (tokenData.access_token) {
    console.log('SUCCESS! Access token generated for caixa1@ufh.br');
    
    // Test consume_meal with this token!
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_meal`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_unit_id: 'e2222222-2222-2222-2222-222222222221',
        p_identifier: 'RA900001',
        p_meal_type_id: 'e5555555-5555-5555-5555-555555555552',
        p_terminal_id: 'TERM-01',
        p_idempotency_key: 'test-auth-success-' + Date.now()
      })
    });
    console.log('consume_meal status:', rpcRes.status, 'Response:', await rpcRes.text());
  }
}

updatePasswordViaAdmin();
