const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/)[1];
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/)[1];
const client = createClient(url, key);

async function run() {
  const loginRes = await client.auth.signInWithPassword({
    email: 'operador@marefeicoes.com',
    password: 'OpSeguro#2026!Ru'
  });
  console.log('Login:', loginRes.error ? loginRes.error : 'OK');

  const res = await client
    .from('students')
    .select('id, registration_number, full_name, status, category:student_categories(code), wallet:wallets(balance)')
    .limit(5);

  console.log('Error:', res.error);
  console.log('Data length:', res.data ? res.data.length : 0);
  console.log('Data sample:', JSON.stringify(res.data, null, 2));
}

run();
