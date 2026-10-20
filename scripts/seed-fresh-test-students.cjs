const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function seed() {
  await client.connect();

  const tenantId = 'e1000000-0000-0000-0000-000000000001';
  const catIntegral = await client.query("SELECT id FROM student_categories WHERE code = 'integral' LIMIT 1");
  const integralId = catIntegral.rows[0].id;

  const catParcial = await client.query("SELECT id FROM student_categories WHERE code = 'parcial' LIMIT 1");
  const parcialId = catParcial.rows[0].id;

  const id1 = 'f1000000-0000-0000-0000-000000000001';
  const id2 = 'f1000000-0000-0000-0000-000000000002';

  await client.query(`DELETE FROM meal_consumptions WHERE student_id IN ($1, $2)`, [id1, id2]);
  await client.query(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE student_id IN ($1, $2))`, [id1, id2]);
  await client.query(`DELETE FROM wallets WHERE student_id IN ($1, $2)`, [id1, id2]);
  await client.query(`DELETE FROM students WHERE id IN ($1, $2) OR registration_number IN ('RA900001', 'RA900002')`, [id1, id2]);

  const instRes = await client.query("SELECT id FROM institutions WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  const institutionId = instRes.rows[0].id;

  // 1. Bolsista Integral Fresco (R$ 0,00)
  await client.query(`
    INSERT INTO students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
    VALUES ($1, $2, $3, $4, 'Lucas Silva (Bolsista Integral)', 'RA900001', 'active')
  `, [id1, tenantId, institutionId, integralId]);

  // 2. Aluno Parcial Fresco com Saldo R$ 50,00
  await client.query(`
    INSERT INTO students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
    VALUES ($1, $2, $3, $4, 'Mariana Costa (Parcial Saldo R$50)', 'RA900002', 'active')
  `, [id2, tenantId, institutionId, parcialId]);

  await client.query(`
    INSERT INTO wallets (student_id, tenant_id, balance)
    VALUES ($1, $2, 50.00)
  `, [id2, tenantId]);

  console.log('Alunos de demonstração criados com sucesso:');
  console.log('- RA900001: Lucas Silva (Bolsista Integral - Isento R$ 0,00)');
  console.log('- RA900002: Mariana Costa (Aluno Parcial - Saldo R$ 50,00)');
  console.log('- RA100001: Estudante Teste 1 (Já consumiu hoje - Gera ALREADY_CONSUMED_TODAY)');
  console.log('- RA101451: Estudante Teste 1451 (Saldo R$ 1,00 < R$ 3,50 - Gera INSUFFICIENT_FUNDS)');
  console.log('- RA101481: Estudante Teste 1481 (Suspenso - Gera STUDENT_INACTIVE)');

  await client.end();
}

seed();
