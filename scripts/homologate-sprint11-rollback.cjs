const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/);
if (!match) throw new Error('SUPABASE_DB_URL não configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});
const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const marker = `HOMO-S11-${runId}`;
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) { passed++; console.log(`PASS ${message}`); }
  else { failed++; console.error(`FAIL ${message}`); }
}

async function setAuthContext(userId) {
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
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

async function expectError(work, label) {
  try { await work(); check(false, label); }
  catch { check(true, label); }
}

async function stage(context, filename, hash, rows) {
  const result = await authenticatedQuery(`
    SELECT public.stage_import_batch_v2(
      $1, $2::public.import_mode, $3, $4, $5, $6,
      $7, $8, $9::jsonb, $10::date
    ) AS id
  `, [
    context.institution_id, 'general', filename,
    `${context.tenant_id}/${context.institution_id}/${marker}/${filename}`,
    hash, 1024, false, false, JSON.stringify(rows), '2026-10-19',
  ]);
  return result.rows[0].id;
}

async function main() {
  await client.connect();
  const baseline = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.students) AS students,
      (SELECT count(*)::int FROM public.imports) AS imports,
      (SELECT count(*)::int FROM public.import_rows) AS import_rows,
      (SELECT count(*)::int FROM public.student_category_history) AS history,
      (SELECT count(*)::int FROM public.wallets) AS wallets,
      (SELECT count(*)::int FROM public.wallet_transactions) AS wallet_transactions
  `);

  await client.query('BEGIN');
  let open = true;
  try {
    const contextResult = await client.query(`
      SELECT p.id AS user_id, p.tenant_id, i.id AS institution_id
      FROM public.profiles p
      JOIN public.institutions i ON i.tenant_id = p.tenant_id AND i.status = 'active'
      WHERE p.status = 'active' AND p.role IN ('admin_general', 'operations_director')
      ORDER BY CASE p.role WHEN 'admin_general' THEN 1 ELSE 2 END, p.created_at, i.created_at
      LIMIT 1
    `);
    check(contextResult.rowCount === 1, 'contexto administrativo de testes localizado');
    if (contextResult.rowCount !== 1) throw new Error('Sem contexto administrativo para homologação.');
    const context = contextResult.rows[0];

    const categoriesResult = await client.query(`
      SELECT id, code FROM public.student_categories
      WHERE tenant_id = $1 AND code IN ('partial', 'integral') AND status = 'active'
    `, [context.tenant_id]);
    const categories = new Map(categoriesResult.rows.map((row) => [row.code, row.id]));
    check(categories.has('partial') && categories.has('integral'), 'categorias parcial e integral localizadas');
    if (!categories.has('partial') || !categories.has('integral')) throw new Error('Categorias obrigatórias ausentes.');

    await setAuthContext(context.user_id);
    const existingId = crypto.randomUUID();
    const existingRegistration = `${marker}-EXISTING`;
    const existing = await client.query(`
      INSERT INTO public.students (
        id, tenant_id, institution_id, category_id, registration_number, full_name, status
      ) VALUES ($1, $2, $3, $4, $5, 'Aluno Sintetico Existente', 'active')
      RETURNING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_iso
    `, [existingId, context.tenant_id, context.institution_id, categories.get('partial'), existingRegistration]);
    const wallet = await client.query(`
      INSERT INTO public.wallets (tenant_id, student_id, balance, status)
      VALUES ($1, $2, 42.50, 'active') RETURNING id, balance
    `, [context.tenant_id, existingId]);
    const walletId = wallet.rows[0].id;
    const walletBefore = Number(wallet.rows[0].balance);
    const ledgerBefore = await client.query('SELECT count(*)::int AS count FROM public.wallet_transactions WHERE wallet_id = $1', [walletId]);

    const rows = [];
    rows.push({
      row_number: 2,
      registration_number: existingRegistration,
      full_name: 'Aluno Sintetico Existente',
      action: 'update', status: 'pending', errors: [], warnings: [], student_id: existingId,
      raw_data: { matricula: existingRegistration, nome: 'Aluno Sintetico Existente', categoria: 'integral' },
      normalized_data: { registration_number: existingRegistration, full_name: 'Aluno Sintetico Existente', category_code: 'integral', category_id: categories.get('integral'), academic_status: 'active' },
      before_snapshot: { id: existingId, category_id: categories.get('partial'), updated_at: existing.rows[0].updated_at_iso },
    });
    for (let index = 1; index < 980; index++) {
      const registration = `${marker}-${String(index).padStart(4, '0')}`;
      rows.push({
        row_number: index + 2, registration_number: registration, full_name: `Aluno Sintetico ${index}`,
        action: 'insert', status: 'pending', errors: [], warnings: [],
        raw_data: { matricula: registration, nome: `Aluno Sintetico ${index}`, categoria: 'partial' },
        normalized_data: { registration_number: registration, full_name: `Aluno Sintetico ${index}`, category_code: 'partial', category_id: categories.get('partial'), academic_status: 'active' },
      });
    }
    for (let index = 0; index < 20; index++) {
      rows.push({
        row_number: 982 + index, registration_number: '', full_name: '', action: 'error', status: 'pending',
        raw_data: { matricula: '', nome: '', referencia: `${marker}-ERRO-${index}` },
        errors: ['Matrícula é obrigatória.', 'Nome completo é obrigatório.'], warnings: [],
      });
    }
    check(rows.length === 1000, 'lote sintético possui exatamente 1.000 linhas');

    const mainHash = crypto.createHash('sha256').update(`${marker}-main`).digest('hex');
    const importId = await stage(context, `${marker}-1000.csv`, mainHash, rows);
    const staged = await client.query('SELECT total_rows, valid_rows, error_rows, status FROM public.imports WHERE id = $1', [importId]);
    check(staged.rows[0].total_rows === 1000 && staged.rows[0].valid_rows === 980 && staged.rows[0].error_rows === 20, 'preview registra 1.000 totais, 980 válidas e 20 rejeições');

    const processed = await authenticatedQuery('SELECT public.confirm_and_process_import($1) AS result', [importId]);
    const result = processed.rows[0].result;
    check(result.processed === 980 && result.failed === 0 && result.skipped === 20, 'confirmação processa 980 e isola 20 sem falhas de execução');
    check(result.status === 'completed_with_errors', 'lote finaliza como completed_with_errors');

    const rowState = await client.query(`
      SELECT
        count(*) FILTER (WHERE status = 'processed')::int AS processed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'skipped' AND action = 'error')::int AS rejected
      FROM public.import_rows WHERE import_id = $1
    `, [importId]);
    const runtimeErrors = await client.query(`
      SELECT row_number, registration_number, errors
      FROM public.import_rows
      WHERE import_id = $1 AND status = 'failed'
      ORDER BY row_number
    `, [importId]);
    if (runtimeErrors.rowCount > 0) console.log('DIAGNÓSTICO falhas do lote principal:', runtimeErrors.rows);
    check(rowState.rows[0].processed === 980 && rowState.rows[0].failed === 0 && rowState.rows[0].rejected === 20, 'manifesto mantém 980 processadas e 20 rejeições identificáveis');

    const studentState = await client.query(`
      SELECT category_id FROM public.students WHERE id = $1
    `, [existingId]);
    check(studentState.rows[0].category_id === categories.get('integral'), 'aluno parcial é atualizado para integral');
    const history = await client.query('SELECT count(*)::int AS count FROM public.student_category_history WHERE import_id = $1', [importId]);
    check(history.rows[0].count === 980, 'histórico registra as 980 mudanças/inclusões processadas');
    const walletAfter = await client.query('SELECT balance FROM public.wallets WHERE id = $1', [walletId]);
    const ledgerAfter = await client.query('SELECT count(*)::int AS count FROM public.wallet_transactions WHERE wallet_id = $1', [walletId]);
    check(Number(walletAfter.rows[0].balance) === walletBefore, 'saldo residual da carteira é preservado');
    check(ledgerAfter.rows[0].count === ledgerBefore.rows[0].count, 'ledger da carteira permanece inalterado');

    await expectError(
      () => stage(context, `${marker}-duplicate.csv`, mainHash, rows),
      'reenvio do mesmo hash é bloqueado',
    );
    await expectError(
      () => authenticatedQuery('SELECT public.confirm_and_process_import($1)', [importId]),
      'confirmação repetida do mesmo lote é bloqueada',
    );

    const cancelRegistration = `${marker}-CANCEL`;
    const cancelRows = [{
      row_number: 2, registration_number: cancelRegistration, full_name: 'Aluno Cancelado', action: 'insert', status: 'pending', errors: [], warnings: [],
      raw_data: { matricula: cancelRegistration, nome: 'Aluno Cancelado', categoria: 'partial' },
      normalized_data: { registration_number: cancelRegistration, full_name: 'Aluno Cancelado', category_id: categories.get('partial'), academic_status: 'active' },
    }];
    const cancelId = await stage(context, `${marker}-cancel.csv`, crypto.createHash('sha256').update(`${marker}-cancel`).digest('hex'), cancelRows);
    const cancelled = await authenticatedQuery('SELECT public.cancel_import($1) AS result', [cancelId]);
    check(cancelled.rows[0].result === true, 'lote em preview pode ser cancelado');
    await expectError(
      () => authenticatedQuery('SELECT public.confirm_and_process_import($1)', [cancelId]),
      'lote cancelado não pode ser confirmado',
    );
    const cancelledStudent = await client.query('SELECT count(*)::int AS count FROM public.students WHERE registration_number = $1', [cancelRegistration]);
    check(cancelledStudent.rows[0].count === 0, 'cancelamento não cria aluno');

    const concurrentId = crypto.randomUUID();
    const concurrentRegistration = `${marker}-CONCURRENT`;
    await client.query(`
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, registration_number, full_name, status)
      VALUES ($1, $2, $3, $4, $5, 'Aluno Concorrente', 'active')
    `, [concurrentId, context.tenant_id, context.institution_id, categories.get('partial'), concurrentRegistration]);
    const concurrentRows = [{
      row_number: 2, registration_number: concurrentRegistration, full_name: 'Atualização da Planilha', action: 'update', status: 'pending', errors: [], warnings: [], student_id: concurrentId,
      raw_data: { matricula: concurrentRegistration, nome: 'Atualização da Planilha', categoria: 'integral' },
      normalized_data: { registration_number: concurrentRegistration, full_name: 'Atualização da Planilha', category_id: categories.get('integral'), academic_status: 'active' },
      before_snapshot: { id: concurrentId, updated_at: '2000-01-01T00:00:00.000Z' },
    }];
    const concurrentImportId = await stage(context, `${marker}-concurrent.csv`, crypto.createHash('sha256').update(`${marker}-concurrent`).digest('hex'), concurrentRows);
    const concurrentProcessed = await authenticatedQuery('SELECT public.confirm_and_process_import($1) AS result', [concurrentImportId]);
    check(concurrentProcessed.rows[0].result.failed === 1, 'conflito concorrente é isolado como falha da linha');
    const concurrentStudent = await client.query('SELECT full_name, category_id FROM public.students WHERE id = $1', [concurrentId]);
    check(concurrentStudent.rows[0].full_name === 'Aluno Concorrente' && concurrentStudent.rows[0].category_id === categories.get('partial'), 'snapshot obsoleto não sobrescreve o aluno');

    const inTransaction = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.students WHERE registration_number LIKE $1) AS students,
        (SELECT count(*)::int FROM public.imports WHERE original_filename LIKE $1) AS imports
    `, [`${marker}%`]);
    check(inTransaction.rows[0].students >= 981 && inTransaction.rows[0].imports === 3, 'dados sintéticos existem somente dentro da transação de homologação');

    await client.query('ROLLBACK');
    open = false;

    const after = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.students) AS students,
        (SELECT count(*)::int FROM public.imports) AS imports,
        (SELECT count(*)::int FROM public.import_rows) AS import_rows,
        (SELECT count(*)::int FROM public.student_category_history) AS history,
        (SELECT count(*)::int FROM public.wallets) AS wallets,
        (SELECT count(*)::int FROM public.wallet_transactions) AS wallet_transactions,
        (SELECT count(*)::int FROM public.students WHERE registration_number LIKE $1) AS marker_students,
        (SELECT count(*)::int FROM public.imports WHERE original_filename LIKE $1) AS marker_imports
    `, [`${marker}%`]);
    for (const key of ['students', 'imports', 'import_rows', 'history', 'wallets', 'wallet_transactions']) {
      check(after.rows[0][key] === baseline.rows[0][key], `rollback restaura contagem de ${key}`);
    }
    check(after.rows[0].marker_students === 0 && after.rows[0].marker_imports === 0, 'rollback não deixa resíduos identificáveis');

    console.log(`RESULTADO: ${passed} PASS, ${failed} FAIL`);
    if (failed > 0) throw new Error(`${failed} validação(ões) falharam.`);
  } finally {
    if (open) await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`HOMOLOGAÇÃO SPRINT 11 REPROVADA: ${error.message}`);
  process.exit(1);
});
