const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function check() {
  await client.connect();
  const profiles = await client.query('SELECT id, full_name, role, status, tenant_id FROM public.profiles');
  console.log('Profiles:', profiles.rows);
  const users = await client.query('SELECT id, email, encrypted_password FROM auth.users');
  console.log('Auth users:', users.rows.map(u => ({ id: u.id, email: u.email })));
  await client.end();
}

check();
