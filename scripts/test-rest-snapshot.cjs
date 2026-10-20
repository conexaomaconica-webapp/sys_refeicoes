const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/)[1];
const anon = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/)[1];

async function test() {
  const loginRes = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'operador@marefeicoes.com', password: 'OpSeguro#2026!Ru' })
  });
  const token = (await loginRes.json()).access_token;
  const snapRes = await fetch(url + '/rest/v1/rpc/get_terminal_shift_snapshot', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_unit_id: 'e2222222-2222-2222-2222-222222222221' })
  });
  console.log('Snapshot status:', snapRes.status);
  const data = await snapRes.json();
  console.log('Alunos no snapshot via REST:', data.length);
  console.log('Aluno 1:', data[0]);
}

test();
