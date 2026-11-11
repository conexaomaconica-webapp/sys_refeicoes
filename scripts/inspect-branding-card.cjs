const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');
const dbUrlMatch = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

const client = new Client({
  connectionString: dbUrlMatch[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT consumer_card_layout, consumer_card_elements, consumer_card_background_mode, consumer_card_background_url, logo_url FROM tenant_branding LIMIT 1;');
  console.log('Branding atual:', JSON.stringify(res.rows[0], null, 2));

  const studentRes = await client.query('SELECT id, full_name, registration_number, photo_path FROM students LIMIT 5;');
  console.log('Alunos de exemplo:', studentRes.rows);

  await client.end();
}

run().catch(console.error);
