const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const serviceRoleMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);
const passwordMatch = env.match(/CAIXA_TEST_PASSWORD=["']?([^"'\r\n]+)/);

if (!passwordMatch) throw new Error('CAIXA_TEST_PASSWORD não configurada em .env.local.');

const supabaseUrl = urlMatch[1];
const serviceRoleKey = serviceRoleMatch[1];
const anonKey = anonMatch[1];
const password = passwordMatch[1];

async function setup() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Temporarily delete SQL-only user e4444444-4444-4444-4444-444444444441 from auth.users
  await client.query("DELETE FROM auth.users WHERE email = 'caixa1@ufh.br'");

  // Create user via GoTrue Admin API
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'e4444444-4444-4444-4444-444444444441',
      email: 'caixa1@ufh.br',
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Operador Caixa 1' }
    })
  });

  const createdUser = await createRes.json();
  console.log('Created user status:', createRes.status, 'Created ID:', createdUser.id);

  // Ensure profile matches this ID
  await client.query(`
    INSERT INTO public.profiles (id, tenant_id, full_name, email, role, status)
    VALUES ($1, 'e1000000-0000-0000-0000-000000000001', 'Operador Caixa 1', 'caixa1@ufh.br', 'operator', 'active')
    ON CONFLICT (id) DO UPDATE SET role = 'operator', status = 'active', tenant_id = 'e1000000-0000-0000-0000-000000000001';
  `, [createdUser.id]);

  // Ensure user_unit_access exists
  await client.query(`
    INSERT INTO public.user_unit_access (user_id, unit_id, tenant_id)
    VALUES ($1, 'e2222222-2222-2222-2222-222222222221', 'e1000000-0000-0000-0000-000000000001')
    ON CONFLICT DO NOTHING;
  `, [createdUser.id]);

  // Now test login with anonKey!
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
  console.log('Login status:', loginRes.status, 'Access token obtained:', !!tokenData.access_token);

  if (tokenData.access_token) {
    // Test executeConsumeMeal RPC with the token!
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
        p_idempotency_key: 'test-real-auth-' + Date.now()
      })
    });
    console.log('consume_meal status:', rpcRes.status, 'Result:', await rpcRes.text());
  }

  await client.end();
}

setup();
