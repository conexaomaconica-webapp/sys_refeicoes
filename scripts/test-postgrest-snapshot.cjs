const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);

const supabaseUrl = urlMatch[1];
const anonKey = anonMatch[1];

async function testFetch() {
  const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: 'operador@marefeicoes.com', password: 'OpSeguro#2026!Ru' })
  });

  const authData = await loginRes.json();
  const token = authData.access_token;

  console.log('--- 1. Perfil do usuário via REST ---');
  const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,role,tenant_id,status`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  console.log('Profiles:', await profRes.json());

  console.log('\n--- 2. Students sem joins nem filtros ---');
  const stdRes = await fetch(`${supabaseUrl}/rest/v1/students?select=id,registration_number,tenant_id&limit=5`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  console.log('Students simples:', await stdRes.json());

  console.log('\n--- 3. RPC resolve_student_identity ---');
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_student_identity`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_unit_id: 'e2222222-2222-2222-2222-222222222221', p_identifier: 'RA100001' })
  });
  console.log('RPC resolve_student_identity status:', rpcRes.status, await rpcRes.text());
}

testFetch().catch(console.error);
