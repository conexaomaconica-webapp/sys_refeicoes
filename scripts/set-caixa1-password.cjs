const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const passwordMatch = env.match(/CAIXA_TEST_PASSWORD=["']?([^"'\r\n]+)/);
if (!passwordMatch) throw new Error('CAIXA_TEST_PASSWORD não configurada em .env.local.');
const password = passwordMatch[1];
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function setPass() {
  await client.connect();
  await client.query(`
    UPDATE auth.users
    SET encrypted_password = crypt($1, gen_salt('bf')),
        email_confirmed_at = NOW(),
        last_sign_in_at = NOW(),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}',
        raw_user_meta_data = '{"full_name":"Operador Caixa 1"}',
        aud = 'authenticated',
        role = 'authenticated'
    WHERE email = 'caixa1@ufh.br'
  `, [password]);
  console.log('Password for caixa1@ufh.br updated from local environment.');
  await client.end();
}

setPass();
