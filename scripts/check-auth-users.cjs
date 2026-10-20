const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function checkAuthCols() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, is_nullable, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'auth' AND table_name = 'users'
    ORDER BY ordinal_position;
  `);
  console.log('Colunas de auth.users:', res.rows.map(r => `${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));
  await client.end();
}

checkAuthCols();
