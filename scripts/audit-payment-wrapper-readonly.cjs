const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!match) throw new Error('SUPABASE_DB_URL nao configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const result = await client.query(`
      WITH definitions AS (
        SELECT
          pg_get_functiondef(
            'public.confirm_operator_terminal_payment(uuid,text,uuid,text,text,text,numeric)'::regprocedure
          ) AS wrapper_definition,
          pg_get_functiondef(
            'public.confirm_terminal_meal_payment(uuid,text,uuid,text,text,text,numeric)'::regprocedure
          ) AS counter_definition
      )
      SELECT
        position('INSERT INTO public.wallets' IN wrapper_definition) > 0
          AS wrapper_creates_wallet,
        position('terminal_counter_payment' IN wrapper_definition) > 0
          AS wrapper_creates_technical_recharge,
        position('wallet_credit_transaction_id' IN wrapper_definition) > 0
          AS wrapper_returns_wallet_credit,
        position('confirm_terminal_meal_payment' IN wrapper_definition) > 0
          AS wrapper_delegates_to_counter,
        position('consume_meal_counter_payment' IN counter_definition) > 0
          AS counter_uses_separate_consumption,
        position('''source'', ''counter''' IN counter_definition) > 0
          AS counter_marks_counter_source
      FROM definitions
    `);

    console.log(result.rows[0]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Falha na auditoria read-only: ${error.message}`);
  process.exit(1);
});
