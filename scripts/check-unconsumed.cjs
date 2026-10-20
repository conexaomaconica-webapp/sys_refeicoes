const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function check() {
  await client.connect();
  const res = await client.query(`
    SELECT s.registration_number, s.full_name, sc.code as cat_code, w.balance,
           sc.payment_mode,
           (SELECT count(*) FROM meal_consumptions mc WHERE mc.student_id = s.id AND mc.consumption_date = CURRENT_DATE) as consumos_hoje
    FROM students s
    JOIN student_categories sc ON sc.id = s.category_id
    LEFT JOIN wallets w ON w.student_id = s.id
    WHERE sc.payment_mode = 'wallet' AND sc.code <> 'integral'
    ORDER BY s.registration_number
  `);
  console.log('Status dos estudantes:', res.rows);
  await client.end();
}

check();
