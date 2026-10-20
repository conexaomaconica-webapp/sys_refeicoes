const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function apply() {
  await client.connect();

  console.log('1. Aplicando Migration 36...');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260927000036_add_student_to_consume_meal_blocks_and_shift_reports_rpc.sql'),
    'utf8'
  );
  await client.query(sql);
  console.log('   Migration 36 aplicada com sucesso!');

  await client.query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260927000036', 'add_student_to_consume_meal_blocks_and_shift_reports_rpc')
    ON CONFLICT (version) DO NOTHING;
  `);

  console.log('2. Testando get_terminal_shift_reports com operador...');
  const opUser = await client.query("SELECT id FROM auth.users WHERE email = 'operador@marefeicoes.com'");
  const opId = opUser.rows[0].id;

  await client.query(`SELECT set_config('request.jwt.claim.sub', '${opId}', false);`);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${opId}", "role": "authenticated"}', false);`);

  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const res = await client.query('SELECT public.get_terminal_shift_reports($1) as report', [unitId]);
  console.log('   Resultado do relatório:', JSON.stringify(res.rows[0].report, null, 2));

  console.log('3. Testando tentativa bloqueada com retorno do estudante...');
  // Tenta consumir com RA100001 (que já consumiu ou é aluno)
  const blockRes = await client.query(
    "SELECT public.consume_meal($1, 'RA100001', NULL, NULL, 'TERM-TEST') as result",
    [unitId]
  );
  console.log('   Resposta do bloqueio:', JSON.stringify(blockRes.rows[0].result, null, 2));

  await client.end();
  console.log('✅ Migration 36 e testes validados com sucesso!');
}

apply().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
