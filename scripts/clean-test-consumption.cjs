const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function clean() {
  await client.connect();
  await client.query("DELETE FROM meal_consumptions WHERE student_id = 'f1000000-0000-0000-0000-000000000001'");
  console.log('Cleaned test consumption for RA900001');
  await client.end();
}

clean();
