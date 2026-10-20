const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function diagnose() {
  await client.connect();

  const opUser = await client.query("SELECT id, email FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  console.log('--- Testando query de wallets como operador ---');
  try {
    const walletsRes = await client.query('SELECT count(*) FROM public.wallets;');
    console.log('Wallets visíveis sob RLS para operador:', walletsRes.rows[0].count);
  } catch (err) {
    console.error('Erro ao consultar wallets:', err.message);
  }

  console.log('\n--- Testando relacionamento entre students e wallets ---');
  try {
    const relRes = await client.query(`
      SELECT s.id, s.registration_number, w.balance 
      FROM public.students s 
      LEFT JOIN public.wallets w ON w.student_id = s.id 
      LIMIT 3;
    `);
    console.log('Join students e wallets:', relRes.rows);
  } catch (err) {
    console.error('Erro no join:', err.message);
  }

  await client.end();
}

diagnose().catch(console.error);
