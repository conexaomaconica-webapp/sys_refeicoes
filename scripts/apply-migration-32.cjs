const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function apply() {
  await client.connect();

  console.log('1. Aplicando Migration 32...');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260927000032_create_terminal_snapshot_rpc.sql'), 'utf8');
  await client.query(sql);
  console.log('   Migration 32 aplicada com sucesso!');

  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000032', 'create_terminal_snapshot_rpc')
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log('2. Testando get_terminal_shift_snapshot como operador@marefeicoes.com...');
  const opUser = await client.query("SELECT id, email FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const res = await client.query('SELECT public.get_terminal_shift_snapshot($1::uuid) as snapshot;', [unitId]);
  const snapshotData = res.rows[0].snapshot;
  console.log('   Total de alunos no snapshot retornado pela RPC:', snapshotData.length);
  if (snapshotData.length > 0) {
    console.log('   Amostra do 1º aluno do snapshot:', snapshotData[0]);
  }

  await client.end();
}

apply().catch(console.error);
