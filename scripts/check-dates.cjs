const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function check() {
  await client.connect();
  const res = await client.query('SELECT consumed_at::date as dia, count(*) FROM public.meal_consumptions GROUP BY consumed_at::date ORDER BY dia DESC');
  console.log('Consumos por data:', res.rows);
  const sample = await client.query('SELECT id, registration_number, full_name, status FROM public.students WHERE registration_number IN (\'RA100001\', \'RA100901\', \'RA101451\', \'RA101481\')');
  console.log('Estudantes de teste:', sample.rows);
  await client.end();
}

check();
