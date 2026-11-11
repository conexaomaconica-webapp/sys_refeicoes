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

  const newLayout = {
    logo: { x: 50, y: 10 },
    title: { x: 50, y: 14 },
    qr: { x: 50, y: 39 },
    photo: { x: 20, y: 65 },
    name: { x: 58, y: 64 },
    status: { x: 58, y: 72 },
    balance: { x: 50, y: 86 },
  };

  const newElements = {
    logo: { visible: true, zoom: 130 },
    title: { visible: false, zoom: 100 },
    qr: { visible: true, zoom: 100 },
    photo: { visible: true, zoom: 100 },
    name: { visible: true, zoom: 100 },
    status: { visible: true, zoom: 100 },
    balance: { visible: true, zoom: 100 },
  };

  await client.query(`
    UPDATE tenant_branding
    SET consumer_card_layout = $1,
        consumer_card_elements = $2,
        updated_at = now();
  `, [JSON.stringify(newLayout), JSON.stringify(newElements)]);

  console.log('✓ Coordenadas do layout do cartão atualizadas com sucesso no banco de dados!');
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
