const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
function envValue(name) {
  const match = env.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)`, 'm'));
  if (!match) throw new Error(`${name} não configurada em .env.local.`);
  return match[1].trim();
}

const dbUrl = envValue('SUPABASE_DB_URL').replace(/\?sslmode=.*/, '');
const supabaseUrl = envValue('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = envValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const newPassword = envValue('OPERATOR_TEST_PASSWORD');
const oldPassword = envValue('OPERATOR_PREVIOUS_PASSWORD');

async function rotatePassword() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const email = 'operador@marefeicoes.com';
  console.log('1. Invalidando senha anterior e definindo nova senha segura...');
  await client.query(`
    UPDATE auth.users
    SET encrypted_password = crypt($1, gen_salt('bf')),
        updated_at = NOW()
    WHERE email = $2;
  `, [newPassword, email]);

  console.log('   Senha atualizada com sucesso no banco de dados.');
  await client.end();

  console.log('2. Verificando que a senha anterior foi invalidada...');
  const testOldRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: oldPassword }),
  });
  const oldData = await testOldRes.json();
  if (testOldRes.status !== 200) {
    console.log('   [SUCESSO] Senha anterior rejeitada pelo Supabase GoTrue:', oldData.error_description || oldData.msg || oldData.message);
  } else {
    console.error('   [FALHA] Senha anterior ainda foi aceita!');
  }

  console.log('3. Verificando que a nova senha funciona...');
  const testNewRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: newPassword }),
  });
  const newData = await testNewRes.json();
  if (testNewRes.status === 200 && newData.access_token) {
    console.log('   [SUCESSO] Nova senha autenticada com sucesso para:', newData.user.email);
  } else {
    console.error('   [FALHA] Nova senha falhou ao autenticar:', newData);
  }
}

rotatePassword().catch(console.error);
