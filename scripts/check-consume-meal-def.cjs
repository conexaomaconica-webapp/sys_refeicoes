const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function checkConsumeMeal() {
  await client.connect();
  const res = await client.query(`
    SELECT pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    WHERE p.proname = 'consume_meal';
  `);
  if (res.rows.length > 0) {
    const def = res.rows[0].def;
    console.log('consume_meal encontrado. Contém EXCEPTION?', def.includes('EXCEPTION'));
    console.log('Contém LOCK_TIMEOUT_EXCEEDED?', def.includes('LOCK_TIMEOUT_EXCEEDED'));
    console.log('Contém lock_not_available?', def.includes('lock_not_available'));
    const debitIndex = def.indexOf("'debit'");
    console.log('Trecho do ledger:', debitIndex >= 0 ? def.slice(debitIndex - 100, debitIndex + 180) : 'nao encontrado');
    const insertIndex = def.indexOf('INSERT INTO public.meal_consumptions');
    console.log('Trecho do consumo:', insertIndex >= 0 ? def.slice(insertIndex, insertIndex + 850) : 'nao encontrado');
  } else {
    console.log('consume_meal NÃO encontrado.');
  }

  // Conferir constraint chk_blocked_attempts_reason
  const resChk = await client.query(`
    SELECT pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    WHERE c.conname = 'chk_blocked_attempts_reason';
  `);
  if (resChk.rows.length > 0) {
    console.log('chk_blocked_attempts_reason:', resChk.rows[0].def);
    console.log('Constraint contém LOCK_TIMEOUT_EXCEEDED?', resChk.rows[0].def.includes('LOCK_TIMEOUT_EXCEEDED'));
  }

  await client.end();
}

checkConsumeMeal();
