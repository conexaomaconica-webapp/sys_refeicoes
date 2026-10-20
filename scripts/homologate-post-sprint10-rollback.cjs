const crypto = require('node:crypto');
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

const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const terminalId = `HOMO-S10-${runId}`.slice(0, 50);
const registrations = {
  integral: `HOMO-INT-${runId}`,
  wallet: `HOMO-WAL-${runId}`,
  counter: `HOMO-CTR-${runId}`,
};
const studentIds = {
  integral: crypto.randomUUID(),
  wallet: crypto.randomUUID(),
  counter: crypto.randomUUID(),
};

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`FALHOU: ${message}`);
  passed += 1;
  console.log(`PASS ${message}`);
}

function asNumber(value) {
  return Number.parseFloat(String(value));
}

async function setAuthContext(userId) {
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

async function authenticatedQuery(sql, params = []) {
  await client.query('SAVEPOINT authenticated_query');
  await client.query('SET LOCAL ROLE authenticated');
  try {
    const result = await client.query(sql, params);
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT authenticated_query');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT authenticated_query');
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT authenticated_query');
    throw error;
  }
}

async function rpc(functionCall, params) {
  const result = await authenticatedQuery(`SELECT ${functionCall} AS result`, params);
  return result.rows[0].result;
}

async function main() {
  await client.connect();
  await client.query('BEGIN');

  let transactionOpen = true;
  try {
    const contextResult = await client.query(`
      SELECT p.id AS operator_id,
             p.tenant_id,
             u.id AS unit_id,
             u.institution_id,
             umt.meal_type_id
        FROM public.profiles AS p
        JOIN public.units AS u
          ON u.tenant_id = p.tenant_id
         AND u.status = 'active'
        JOIN public.unit_meal_types AS umt
          ON umt.unit_id = u.id
         AND umt.tenant_id = u.tenant_id
         AND umt.enabled = true
       WHERE p.status = 'active'
         AND p.role IN ('admin_general', 'operations_director')
       ORDER BY CASE p.role WHEN 'admin_general' THEN 1 ELSE 2 END,
                p.created_at,
                umt.created_at
       LIMIT 1
    `);
    assert(contextResult.rowCount === 1, 'contexto administrativo e refeicao ativa localizados');
    const context = contextResult.rows[0];

    const categoriesResult = await client.query(`
      SELECT id, code
        FROM public.student_categories
       WHERE tenant_id = $1
         AND code IN ('integral', 'partial', 'visitante')
         AND status = 'active'
    `, [context.tenant_id]);
    const categories = new Map(categoriesResult.rows.map((row) => [row.code, row.id]));
    assert(categories.has('integral'), 'categoria integral localizada');
    assert(categories.has('partial'), 'categoria parcial localizada');
    assert(categories.has('visitante'), 'categoria visitante localizada');

    await client.query(`
      UPDATE public.unit_meal_types
         SET start_time = NULL,
             end_time = NULL
       WHERE unit_id = $1
         AND meal_type_id = $2
    `, [context.unit_id, context.meal_type_id]);

    await client.query(`
      INSERT INTO public.students (
        id, tenant_id, institution_id, category_id,
        registration_number, full_name, status
      ) VALUES
        ($1, $4, $5, $6, $8, 'Homologacao Integral', 'active'),
        ($2, $4, $5, $7, $9, 'Homologacao Carteira', 'active'),
        ($3, $4, $5, $7, $10, 'Homologacao Balcao', 'active')
    `, [
      studentIds.integral,
      studentIds.wallet,
      studentIds.counter,
      context.tenant_id,
      context.institution_id,
      categories.get('integral'),
      categories.get('partial'),
      registrations.integral,
      registrations.wallet,
      registrations.counter,
    ]);

    await client.query(`
      INSERT INTO public.wallets (tenant_id, student_id, balance, status)
      VALUES ($1, $2, 100.00, 'active'),
             ($1, $3, 0.00, 'active')
    `, [context.tenant_id, studentIds.wallet, studentIds.counter]);

    await setAuthContext(context.operator_id);
    const access = await authenticatedQuery(
      'SELECT public.has_unit_access($1) AS allowed',
      [context.unit_id],
    );
    assert(access.rows[0].allowed === true, 'operador possui acesso a unidade');

    const noShift = await rpc(
      'public.consume_operator_terminal_meal($1, $2, $3, $4, $5)',
      [
        context.unit_id,
        registrations.integral,
        context.meal_type_id,
        `homolog-no-shift-${runId}`,
        terminalId,
      ],
    );
    assert(noShift.success === false && noShift.error_code === 'CASH_SHIFT_REQUIRED', 'terminal bloqueia consumo sem caixa aberto');

    const opening = await rpc(
      'public.open_operator_cash_shift($1, $2, $3, $4)',
      [context.unit_id, terminalId, context.meal_type_id, 100],
    );
    assert(opening.success === true && opening.cash_shift?.id, 'caixa aberto pelo operador');
    const shiftId = opening.cash_shift.id;

    const integral = await rpc(
      'public.consume_operator_terminal_meal($1, $2, $3, $4, $5)',
      [
        context.unit_id,
        registrations.integral,
        context.meal_type_id,
        `homolog-integral-${runId}`,
        terminalId,
      ],
    );
    assert(integral.success === true, 'refeicao integral aprovada');
    assert(asNumber(integral.financial?.student_price) === 0, 'refeicao integral sem cobranca');
    assert(integral.financial?.wallet_transaction_id == null, 'refeicao integral sem transacao de carteira');

    const walletBefore = await client.query(
      'SELECT balance FROM public.wallets WHERE student_id = $1',
      [studentIds.wallet],
    );
    const walletConsumption = await rpc(
      'public.consume_operator_terminal_meal($1, $2, $3, $4, $5)',
      [
        context.unit_id,
        registrations.wallet,
        context.meal_type_id,
        `homolog-wallet-${runId}`,
        terminalId,
      ],
    );
    assert(walletConsumption.success === true, 'refeicao parcial com saldo aprovada');
    const walletPrice = asNumber(walletConsumption.financial?.student_price);
    const walletAfter = await client.query(
      'SELECT balance FROM public.wallets WHERE student_id = $1',
      [studentIds.wallet],
    );
    assert(
      asNumber(walletAfter.rows[0].balance) === asNumber(walletBefore.rows[0].balance) - walletPrice,
      'carteira debitada pelo valor exato da refeicao',
    );
    const walletLedger = await client.query(`
      SELECT type, amount
        FROM public.wallet_transactions
       WHERE student_id = $1
       ORDER BY created_at DESC
       LIMIT 1
    `, [studentIds.wallet]);
    assert(
      walletLedger.rows[0]?.type === 'meal_debit' && asNumber(walletLedger.rows[0].amount) === -walletPrice,
      'ledger registra meal_debit negativo',
    );

    const preview = await rpc(
      'public.preview_operator_terminal_meal($1, $2, $3)',
      [context.unit_id, registrations.counter, context.meal_type_id],
    );
    const counterPrice = asNumber(preview.financial?.student_price);
    assert(preview.success === true && preview.requires_counter_payment === true, 'saldo insuficiente exige pagamento no balcao');
    assert(counterPrice > 0, 'pagamento avulso possui valor positivo');

    const counterIdempotency = `homolog-counter-${runId}`;
    const counterPayment = await rpc(
      'public.confirm_operator_terminal_payment($1, $2, $3, $4, $5, $6, $7)',
      [
        context.unit_id,
        registrations.counter,
        context.meal_type_id,
        terminalId,
        counterIdempotency,
        'cash',
        counterPrice + 5,
      ],
    );
    assert(counterPayment.success === true, 'pagamento avulso em dinheiro aprovado');
    assert(counterPayment.payment?.source === 'counter', 'pagamento identificado como receita de balcao');
    assert(asNumber(counterPayment.payment?.change_amount) === 5, 'troco calculado corretamente');
    assert(counterPayment.financial?.wallet_transaction_id == null, 'pagamento avulso nao gera transacao de carteira');

    const counterWalletState = await client.query(`
      SELECT w.balance,
             (SELECT count(*)::integer FROM public.wallet_transactions wt WHERE wt.student_id = w.student_id) AS ledger_count
        FROM public.wallets w
       WHERE w.student_id = $1
    `, [studentIds.counter]);
    assert(asNumber(counterWalletState.rows[0].balance) === 0, 'saldo da carteira permanece inalterado no pagamento avulso');
    assert(counterWalletState.rows[0].ledger_count === 0, 'ledger da carteira permanece vazio no pagamento avulso');

    const counterMovement = await client.query(`
      SELECT id, type, amount, payment_method, status, origin, meal_consumption_id
        FROM public.cash_movements
       WHERE cash_shift_id = $1
         AND idempotency_key = $2
    `, [shiftId, counterIdempotency]);
    assert(counterMovement.rowCount === 1, 'pagamento avulso gera um unico movimento de caixa');
    assert(
      counterMovement.rows[0].type === 'meal_sale' && counterMovement.rows[0].origin === 'student_counter_payment',
      'movimento classificado como venda avulsa de aluno',
    );

    const expectedAfterSale = await client.query(
      'SELECT expected_cash_balance FROM public.cash_shifts WHERE id = $1',
      [shiftId],
    );
    assert(asNumber(expectedAfterSale.rows[0].expected_cash_balance) === 100 + counterPrice, 'saldo esperado inclui somente a venda em dinheiro');

    const replay = await rpc(
      'public.confirm_operator_terminal_payment($1, $2, $3, $4, $5, $6, $7)',
      [
        context.unit_id,
        registrations.counter,
        context.meal_type_id,
        terminalId,
        counterIdempotency,
        'cash',
        counterPrice + 5,
      ],
    );
    assert(replay.success === true && replay.idempotent_replay === true, 'retry de pagamento e idempotente');

    const cancellation = await rpc(
      'public.cancel_meal_consumption($1, $2, $3)',
      [
        counterMovement.rows[0].meal_consumption_id,
        'financially_refunded',
        'Homologacao de estorno compensatorio',
      ],
    );
    assert(cancellation.success === true && cancellation.refund_cash_movement_id, 'estorno avulso cria movimento compensatorio');
    const refundState = await client.query(`
      SELECT
        count(*) FILTER (WHERE type = 'refund')::integer AS refunds,
        count(*) FILTER (WHERE id = $2 AND status = 'refunded')::integer AS refunded_sales
      FROM public.cash_movements
      WHERE cash_shift_id = $1
    `, [shiftId, counterMovement.rows[0].id]);
    assert(refundState.rows[0].refunds === 1 && refundState.rows[0].refunded_sales === 1, 'venda original marcada e estorno compensatorio preservado');

    const expectedAfterRefund = await client.query(
      'SELECT expected_cash_balance FROM public.cash_shifts WHERE id = $1',
      [shiftId],
    );
    assert(asNumber(expectedAfterRefund.rows[0].expected_cash_balance) === 100, 'estorno remove a venda do saldo fisico esperado');

    const visitor = await rpc(
      'public.register_operator_visitor_entry($1, $2, $3, $4)',
      [context.unit_id, context.meal_type_id, terminalId, 'pix'],
    );
    assert(visitor.success === true, 'visitante pago por Pix aprovado');
    const visitorMovement = await client.query(`
      SELECT type, payment_method, consumer_type
        FROM public.cash_movements
       WHERE cash_shift_id = $1
         AND meal_consumption_id = $2
       ORDER BY created_at DESC
       LIMIT 1
    `, [shiftId, visitor.consumption_id]);
    assert(
      visitorMovement.rows[0]?.type === 'visitor_sale' &&
      visitorMovement.rows[0]?.payment_method === 'pix' &&
      visitorMovement.rows[0]?.consumer_type === 'visitor',
      'visitante registrado separadamente com forma Pix',
    );
    const expectedAfterPix = await client.query(
      'SELECT expected_cash_balance FROM public.cash_shifts WHERE id = $1',
      [shiftId],
    );
    assert(asNumber(expectedAfterPix.rows[0].expected_cash_balance) === 100, 'Pix nao altera saldo fisico esperado');

    const supply = await rpc(
      'public.record_operator_cash_movement($1, $2, $3, $4, $5)',
      [shiftId, 'supply', 20, 'cash', 'Suprimento de homologacao'],
    );
    assert(supply.success === true, 'suprimento registrado');
    const bleed = await rpc(
      'public.record_operator_cash_movement($1, $2, $3, $4, $5)',
      [shiftId, 'bleed', 5, 'cash', 'Sangria de homologacao'],
    );
    assert(bleed.success === true, 'sangria registrada');

    const closingBase = await client.query(`
      SELECT expected_cash_balance,
             counter_cash_amount,
             counter_pix_amount,
             counter_card_amount,
             counter_refunds_amount
        FROM public.cash_shifts
       WHERE id = $1
    `, [shiftId]);
    assert(asNumber(closingBase.rows[0].expected_cash_balance) === 115, 'saldo fisico esperado considera fundo, suprimento e sangria');
    assert(asNumber(closingBase.rows[0].counter_pix_amount) > 0, 'total Pix conciliado separadamente');
    assert(asNumber(closingBase.rows[0].counter_refunds_amount) === counterPrice, 'total de estornos conciliado separadamente');

    const closing = await rpc(
      'public.close_operator_cash_shift($1, $2, $3)',
      [shiftId, 115, 'Fechamento balanceado de homologacao'],
    );
    assert(
      closing.success === true && closing.difference_status === 'balanced' && asNumber(closing.difference_amount) === 0,
      'fechamento de caixa balanceado',
    );

    await client.query('ROLLBACK');
    transactionOpen = false;

    const cleanupVerification = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM public.students WHERE id = ANY($1::uuid[])) AS students,
        (SELECT count(*)::integer FROM public.cash_shifts WHERE terminal_id = $2) AS shifts
    `, [Object.values(studentIds), terminalId]);
    assert(cleanupVerification.rows[0].students === 0, 'rollback remove alunos sinteticos');
    assert(cleanupVerification.rows[0].shifts === 0, 'rollback remove turno e movimentos sinteticos');

    console.log(`\n${passed}/${passed} validacoes integradas aprovadas.`);
    console.log('Persistencia de dados sinteticos: 0 (rollback confirmado).');
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // O PostgreSQL tambem reverte automaticamente ao encerrar a conexao.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const details = [
    error?.stack || error?.message || JSON.stringify(error),
    error?.code && `SQLSTATE: ${error.code}`,
    error?.detail && `DETAIL: ${error.detail}`,
    error?.where && `WHERE: ${error.where}`,
  ].filter(Boolean).join('\n');
  console.error(`Homologacao falhou: ${details}`);
  process.exit(1);
});
