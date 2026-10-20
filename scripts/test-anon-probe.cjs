const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const anonMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);

const supabaseUrl = urlMatch[1];
let anonKey = anonMatch[1];

if (anonKey.startsWith('m')) {
  anonKey = anonKey.slice(1);
}

async function test() {
  console.log('Testing with cleaned anon key:', anonKey.substring(0, 15) + '...');
  const probeRes = await fetch(`${supabaseUrl}/rest/v1/units?select=id&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    }
  });
  console.log('Units probe status:', probeRes.status, await probeRes.text());

  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_meal`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_unit_id: 'e2222222-2222-2222-2222-222222222221',
      p_identifier: 'RA900001',
      p_meal_type_id: 'e5555555-5555-5555-5555-555555555552',
      p_terminal_id: 'TERM-01',
      p_idempotency_key: 'test-' + Date.now()
    })
  });
  console.log('RPC consume_meal status:', rpcRes.status, await rpcRes.text());
}

test();
