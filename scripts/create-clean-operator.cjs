const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const serviceRoleMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);
const passwordMatch = env.match(/OPERATOR_TEST_PASSWORD=["']?([^"'\r\n]+)/);

if (!passwordMatch) throw new Error('OPERATOR_TEST_PASSWORD não configurada em .env.local.');

const supabaseUrl = urlMatch[1];
const serviceRoleKey = serviceRoleMatch[1];
const anonKey = anonMatch[1];
const password = passwordMatch[1];

async function createOperator() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const email = 'operador@marefeicoes.com';
  // 1. Create via GoTrue Admin API
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Operador de Caixa' }
    })
  });

  const userData = await createRes.json();
  console.log('Create GoTrue user status:', createRes.status, 'ID:', userData.id);

  if (!userData.id) {
    console.error('Failed to create:', userData);
    await client.end();
    return;
  }

  const userId = userData.id;
  const tenantId = 'e1000000-0000-0000-0000-000000000001';
  const unitId = 'e2222222-2222-2222-2222-222222222221';

  // 2. Insert Profile and Unit Access
  await client.query(`
    INSERT INTO public.profiles (id, tenant_id, full_name, email, role, status)
    VALUES ($1, $2, 'Operador de Caixa', $3, 'operator', 'active')
    ON CONFLICT (id) DO UPDATE SET role = 'operator', status = 'active';
  `, [userId, tenantId, email]);

  await client.query(`
    INSERT INTO public.user_unit_access (user_id, unit_id, tenant_id)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING;
  `, [userId, unitId, tenantId]);

  console.log('Profile and unit access inserted for', userId);

  // 3. Test Login via standard anon key
  const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const tokenData = await loginRes.json();
  console.log('Login status:', loginRes.status, 'User:', tokenData.user?.email);

  if (tokenData.access_token) {
    console.log('Testing RPC consume_meal with real operator token...');
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_meal`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_unit_id: unitId,
        p_identifier: 'RA900001',
        p_meal_type_id: 'e5555555-5555-5555-5555-555555555552',
        p_terminal_id: 'TERM-01',
        p_idempotency_key: 'test-real-op-' + Date.now()
      })
    });

    console.log('RPC Status:', rpcRes.status, 'Response:', await rpcRes.text());
  }

  await client.end();
}

createOperator();
