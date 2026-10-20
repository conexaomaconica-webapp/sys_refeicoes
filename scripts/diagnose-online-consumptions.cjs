const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function setAuthContext(c, userId, role = 'authenticated') {
  if (userId) {
    await c.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
    await c.query(`SELECT set_config('request.jwt.claim.role', '${role}', false);`);
    await c.query(`SELECT set_config('request.jwt.claims', '{"sub": "${userId}", "role": "${role}"}', false);`);
  }
}

async function test() {
  await client.connect();
  const operator1Id = 'e4444444-4444-4444-4444-444444444441';
  await setAuthContext(client, operator1Id);

  const catIntegralId = 'e3333333-3333-3333-3333-333333333331';
  await client.query(`UPDATE public.student_categories SET code = 'integral' WHERE id = '${catIntegralId}';`);

  const studentRes = await client.query(`SELECT * FROM public.students WHERE registration_number = 'RA100001';`);
  console.log('Student RA100001:', studentRes.rows[0]);

  const unitId = 'e2222222-2222-2222-2222-222222222221';
  const mealCafeId = 'e5555555-5555-5555-5555-555555555551';

  const res = await client.query(`
    SELECT public.consume_meal(
      p_unit_id := '${unitId}',
      p_identifier := 'RA100001',
      p_meal_type_id := '${mealCafeId}',
      p_terminal_id := 'TERM-01',
      p_idempotency_key := 'DIAGNOSE_KEY_002'
    ) AS r;
  `);

  console.log('consume_meal result com code=integral:', res.rows[0].r);

  const countConsumptions = await client.query(`SELECT count(*)::int as total FROM public.meal_consumptions;`);
  console.log('Total consumptions:', countConsumptions.rows[0].total);

  await client.end();
}

test().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
