const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');
const dbUrlMatch = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);

if (!dbUrlMatch) {
  console.error('SUPABASE_DB_URL nao encontrada no .env.local.');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrlMatch[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function verify() {
  await client.connect();
  try {
    const signatures = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('consume_meal', 'preview_terminal_meal')
      ORDER BY proname, arguments
    `);

    console.log('Assinaturas:');
    for (const row of signatures.rows) {
      console.log(`- ${row.proname}(${row.arguments})`);
    }

    const operator = await client.query(
      "SELECT id FROM auth.users WHERE email = 'operador@marefeicoes.com' LIMIT 1"
    );
    if (operator.rowCount === 0) throw new Error('Operador de teste nao encontrado.');

    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [operator.rows[0].id]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, false)",
      [JSON.stringify({ sub: operator.rows[0].id, role: 'authenticated' })]
    );

    const preview = await client.query(
      `SELECT public.preview_terminal_meal($1, $2, $3) AS result`,
      [
        'e2222222-2222-2222-2222-222222222221',
        'RA900001',
        'e5555555-5555-5555-5555-555555555552',
      ]
    );

    const result = preview.rows[0].result;
    console.log('Preview executada:', {
      success: result?.success,
      error_code: result?.error_code || null,
      category_code: result?.student?.category_code || null,
    });

    const walletEnum = await client.query(`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'wallet_transaction_type'
      ORDER BY enumsortorder
    `);
    console.log('Tipos da carteira:', walletEnum.rows.map((row) => row.enumlabel));

    await client.query('BEGIN');
    try {
      const partialPreview = await client.query(
        `SELECT public.preview_terminal_meal($1, $2, $3) AS result`,
        [
          'e2222222-2222-2222-2222-222222222221',
          'RA100901',
          'e5555555-5555-5555-5555-555555555552',
        ]
      );
      console.log('Preview parcial:', partialPreview.rows[0].result);

      const partialConsume = await client.query(
        `SELECT public.consume_meal($1, $2, $3, $4, $5) AS result`,
        [
          'e2222222-2222-2222-2222-222222222221',
          'RA100901',
          'e5555555-5555-5555-5555-555555555552',
          `verify-rollback-${Date.now()}`,
          'CAIXA-01',
        ]
      );
      console.log('Consumo parcial (rollback):', partialConsume.rows[0].result);
    } catch (error) {
      console.log('Erro no consumo parcial (rollback):', error.message);
    } finally {
      await client.query('ROLLBACK');
    }

    await client.query('BEGIN');
    try {
      const terminalId = 'VERIFY-ROLLBACK';
      const unitId = 'e2222222-2222-2222-2222-222222222221';
      const mealTypeId = 'e5555555-5555-5555-5555-555555555552';
      const candidate = await client.query(`
        SELECT s.registration_number, coalesce(w.balance, 0) AS balance
        FROM public.students s
        JOIN public.student_categories sc ON sc.id = s.category_id
        LEFT JOIN public.wallets w ON w.student_id = s.id
        WHERE s.tenant_id = 'e1000000-0000-0000-0000-000000000001'
          AND s.status = 'active'
          AND sc.payment_mode = 'wallet'
          AND sc.code <> 'integral'
          AND coalesce(w.balance, 0) < 12
          AND NOT EXISTS (
            SELECT 1 FROM public.meal_consumptions mc
            WHERE mc.student_id = s.id
              AND mc.unit_id = $1
              AND mc.meal_type_id = $2
              AND mc.consumption_date = CURRENT_DATE
              AND mc.status = 'approved'
          )
        ORDER BY coalesce(w.balance, 0), s.registration_number
        LIMIT 1
      `, [unitId, mealTypeId]);

      if (candidate.rowCount > 0) {
        const registration = candidate.rows[0].registration_number;
        await client.query(
          'SELECT public.open_operator_cash_shift($1, $2, $3, $4)',
          [unitId, terminalId, mealTypeId, 0]
        );
        const counterPayment = await client.query(
          'SELECT public.confirm_operator_terminal_payment($1, $2, $3, $4, $5, $6, $7) AS result',
          [unitId, registration, mealTypeId, terminalId, `verify-payment-${Date.now()}`, 'cash', 20]
        );
        console.log('Pagamento no caixa (rollback):', {
          registration,
          previous_balance: candidate.rows[0].balance,
          success: counterPayment.rows[0].result?.success,
          payment: counterPayment.rows[0].result?.payment,
          balance_remaining: counterPayment.rows[0].result?.financial?.balance_remaining,
        });
      } else {
        console.log('Pagamento no caixa (rollback): sem candidato de saldo insuficiente.');
      }
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
}

verify().catch((error) => {
  console.error('Falha na verificacao:', error.message || error.code || error.name);
  process.exit(1);
});
