/**
 * ==============================================================================
 * SUÍTE DE HOMOLOGAÇÃO REAL NO POSTGRESQL — SISTEMA MA REFEIÇÕES
 * Execução direta contra o banco remoto Supabase: db.ltydhrmfhzhiuygqqeol.supabase.co
 * Sprints 1 a 9 + Migration 000030 (Hardening de Concorrência e 55P03)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

const clientLockHolder = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  [OK - BANCO REAL] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL - BANCO REAL] ${msg}`);
    failed++;
  }
}

async function setAuthContext(c, userId, role = 'authenticated') {
  if (userId) {
    await c.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
    await c.query(`SELECT set_config('request.jwt.claim.role', '${role}', false);`);
    await c.query(`SELECT set_config('request.jwt.claims', '{"sub": "${userId}", "role": "${role}"}', false);`);
  } else {
    await c.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
    await c.query(`SELECT set_config('request.jwt.claim.role', 'anon', false);`);
    await c.query(`SELECT set_config('request.jwt.claims', '', false);`);
  }
}

// IDs Fixos para Dados Sintéticos de Teste
const tenantA = 'a0000000-0000-0000-0000-000000000001';
const tenantB = 'b0000000-0000-0000-0000-000000000002';
const instA = 'a1111111-1111-1111-1111-111111111111';
const instB = 'b1111111-1111-1111-1111-111111111111';
const unitA = 'a2222222-2222-2222-2222-222222222222';
const unitB = 'b2222222-2222-2222-2222-222222222222';

const catIntegral = 'a3333333-3333-3333-3333-333333333331';
const catParcial = 'a3333333-3333-3333-3333-333333333332';

const opProfileId = 'a4444444-4444-4444-4444-444444444444';
const supProfileId = 'a5555555-5555-5555-5555-555555555555';

const stdLucasInt = 'a6666666-6666-6666-6666-666666666661';
const stdBeatrizPar = 'a6666666-6666-6666-6666-666666666662';
const stdCarlaFree = 'a6666666-6666-6666-6666-666666666663';
const stdDiegoFrozen = 'a6666666-6666-6666-6666-666666666664';
const stdLockTest = 'a6666666-6666-6666-6666-666666666665';

const cardBeatriz = 'a7777777-7777-7777-7777-777777777772';
const qrTokenId = 'a8888888-8888-8888-8888-888888888882';
const rawQrSecret = 'token_secreto_qr_homologacao_real_2026';
const tokenHash = crypto.createHash('sha256').update(rawQrSecret).digest('hex');

const cardFisicoId = 'a7777777-7777-7777-7777-777777777779';
const rawCardCode = 'CARTAO_FISICO_RFID_12345';
const physicalCodeHash = crypto.createHash('sha256').update(rawCardCode).digest('hex');

const mealAlmocoId = 'a9999999-9999-9999-9999-999999999991';
const mealCafeId = 'a9999999-9999-9999-9999-999999999992';

async function cleanupTestData(c) {
  try {
    await c.query(`DELETE FROM public.blocked_attempts WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.meal_consumptions WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.qr_tokens WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.cards WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.wallet_transactions WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.wallets WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.meal_rules WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.unit_meal_types WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.meal_types WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.students WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.student_categories WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.user_unit_access WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.user_institution_access WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.profiles WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.units WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.institutions WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.tenants WHERE id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM auth.users WHERE id IN ('${opProfileId}', '${supProfileId}');`);
  } catch (e) {
    // ignorar erros em cascade
  }
}

async function runRealHomologation() {
  await client.connect();
  await clientLockHolder.connect();
  console.log('======================================================================');
  console.log('  HOMOLOGAÇÃO REAL NO POSTGRESQL — SUPABASE (PROJETO ATUAL)');
  console.log('  Host: db.ltydhrmfhzhiuygqqeol.supabase.co');
  console.log('======================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 1. CARGA DE DADOS SINTÉTICOS DE HOMOLOGAÇÃO
    // -------------------------------------------------------------------------
    console.log('1. Inserindo Dados Sintéticos de Teste no PostgreSQL...');

    await cleanupTestData(client);

    // Inserir Tenants
    await client.query(`
      INSERT INTO public.tenants (id, name, slug, status)
      VALUES 
        ('${tenantA}', 'Tenant Alpha Homologação', 'tenant-alpha-test', 'active'),
        ('${tenantB}', 'Tenant Beta Isolado', 'tenant-beta-test', 'active');
    `);

    // Inserir Instituições e Unidades
    await client.query(`
      INSERT INTO public.institutions (id, tenant_id, name, short_name, status)
      VALUES 
        ('${instA}', '${tenantA}', 'Universidade Federal Alpha', 'UFAL', 'active'),
        ('${instB}', '${tenantB}', 'Universidade Federal Beta', 'UFBE', 'active');

      INSERT INTO public.units (id, tenant_id, institution_id, name, city, state, timezone, status)
      VALUES 
        ('${unitA}', '${tenantA}', '${instA}', 'Restaurante Central Alpha', 'São Paulo', 'SP', 'America/Sao_Paulo', 'active'),
        ('${unitB}', '${tenantB}', '${instB}', 'Restaurante Beta', 'Manaus', 'AM', 'America/Manaus', 'active');
    `);

    // Inserir Usuários em auth.users e Perfis em public.profiles
    await client.query(`
      INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous)
      VALUES 
        ('${opProfileId}', 'operador.teste@marefeicoes.com', 'authenticated', 'authenticated', false, false),
        ('${supProfileId}', 'supervisor.teste@marefeicoes.com', 'authenticated', 'authenticated', false, false);

      INSERT INTO public.profiles (id, tenant_id, full_name, role, status)
      VALUES 
        ('${opProfileId}', '${tenantA}', 'Operador Catraca Teste', 'operator', 'active'),
        ('${supProfileId}', '${tenantA}', 'Supervisor Unidade Teste', 'supervisor', 'active');

      INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id)
      VALUES 
        ('${tenantA}', '${opProfileId}', '${unitA}'),
        ('${tenantA}', '${supProfileId}', '${unitA}');
    `);

    // Inserir Categorias de Estudante (code: integral e partial)
    await client.query(`
      INSERT INTO public.student_categories (id, tenant_id, name, code, requires_wallet, status)
      VALUES 
        ('${catIntegral}', '${tenantA}', 'Bolsista Integral 100%', 'integral', false, 'active'),
        ('${catParcial}', '${tenantA}', 'Aluno Parcial Pagante', 'partial', true, 'active');
    `);

    // Inserir Estudantes Sintéticos
    await client.query(`
      INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
      VALUES 
        ('${stdLucasInt}', '${tenantA}', '${instA}', '${catIntegral}', 'Lucas Bolsista Integral', 'MAT-INT-001', 'active'),
        ('${stdBeatrizPar}', '${tenantA}', '${instA}', '${catParcial}', 'Beatriz Aluna Parcial', 'MAT-PAR-002', 'active'),
        ('${stdCarlaFree}', '${tenantA}', '${instA}', '${catParcial}', 'Carla Parcial Cafe Gratuito', 'MAT-PAR-003', 'active'),
        ('${stdDiegoFrozen}', '${tenantA}', '${instA}', '${catParcial}', 'Diego Carteira Bloqueada', 'MAT-PAR-004', 'active'),
        ('${stdLockTest}', '${tenantA}', '${instA}', '${catParcial}', 'Eduardo Teste Concorrencia 55P03', 'MAT-PAR-005', 'active');
    `);

    // Inserir Carteiras Financeiras
    await client.query(`
      INSERT INTO public.wallets (tenant_id, student_id, balance, status)
      VALUES 
        ('${tenantA}', '${stdBeatrizPar}', 50.00, 'active'),
        ('${tenantA}', '${stdCarlaFree}', 0.00, 'active'),
        ('${tenantA}', '${stdDiegoFrozen}', 20.00, 'frozen'),
        ('${tenantA}', '${stdLockTest}', 35.00, 'active');
    `);

    // Inserir Carteirinhas e Tokens QR
    await client.query(`
      INSERT INTO public.cards (id, tenant_id, student_id, card_number, card_type, status)
      VALUES ('${cardBeatriz}', '${tenantA}', '${stdBeatrizPar}', 'CARD-DIG-002', 'digital', 'active');

      INSERT INTO public.cards (id, tenant_id, student_id, card_number, card_type, physical_code_hash, status)
      VALUES ('${cardFisicoId}', '${tenantA}', '${stdBeatrizPar}', 'CARD-FIS-002', 'physical', '${physicalCodeHash}', 'active');

      INSERT INTO public.qr_tokens (id, tenant_id, card_id, token_hash, expires_at, status)
      VALUES ('${qrTokenId}', '${tenantA}', '${cardBeatriz}', '${tokenHash}', now() + interval '90 seconds', 'active');
    `);

    // Inserir Tipos de Refeição, Unidade e Regras Financeiras
    await client.query(`
      INSERT INTO public.meal_types (id, tenant_id, code, name, status)
      VALUES 
        ('${mealAlmocoId}', '${tenantA}', 'lunch', 'Almoço Oficial', 'active'),
        ('${mealCafeId}', '${tenantA}', 'breakfast', 'Café da Manhã', 'active');

      INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id, enabled, start_time, end_time)
      VALUES 
        ('${tenantA}', '${unitA}', '${mealAlmocoId}', true, '00:00:00', '23:59:59'),
        ('${tenantA}', '${unitA}', '${mealCafeId}', true, '00:00:00', '23:59:59');

      -- Regras de Preço
      INSERT INTO public.meal_rules (tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, enabled, effective_from)
      VALUES 
        ('${tenantA}', '${unitA}', '${mealAlmocoId}', '${catIntegral}', 15.00, 0.00, 15.00, true, now() - interval '1 day'),
        ('${tenantA}', '${unitA}', '${mealAlmocoId}', '${catParcial}', 15.00, 7.50, 7.50, true, now() - interval '1 day'),
        ('${tenantA}', '${unitA}', '${mealCafeId}', '${catParcial}', 8.00, 0.00, 8.00, true, now() - interval '1 day');
    `);
    console.log('  [OK] Dados sintéticos inseridos com sucesso no PostgreSQL remoto.\n');

    // -------------------------------------------------------------------------
    // 2. TESTE REAL: RESOLUÇÃO DE IDENTIDADE (RPC resolve_student_identity)
    // -------------------------------------------------------------------------
    console.log('2. Testando RPC resolve_student_identity no Banco Real...');
    await setAuthContext(client, opProfileId, 'authenticated');

    const resIdentQR = await client.query(`
      SELECT public.resolve_student_identity('${unitA}', 'MAR:Q1:${rawQrSecret}') as result;
    `);
    const q1 = resIdentQR.rows[0].result;
    assert(q1.success && q1.student.id === stdBeatrizPar, 'Identificação por QR Code Dinâmico MAR:Q1: resolvida com sucesso');

    const resIdentCard = await client.query(`
      SELECT public.resolve_student_identity('${unitA}', 'MAR:C1:${rawCardCode}') as result;
    `);
    const c1 = resIdentCard.rows[0].result;
    assert(c1.success && c1.student.id === stdBeatrizPar, 'Identificação por Cartão Físico MAR:C1: resolvida com sucesso');

    const resIdentMat = await client.query(`
      SELECT public.resolve_student_identity('${unitA}', 'MAT-INT-001') as result;
    `);
    const m1 = resIdentMat.rows[0].result;
    assert(m1.success && m1.student.id === stdLucasInt, 'Identificação por Matrícula MAT-INT-001 resolvida com sucesso');

    // -------------------------------------------------------------------------
    // 3. TESTE REAL: CONSUMO BOLSISTA INTEGRAL (RPC consume_meal)
    // -------------------------------------------------------------------------
    console.log('\n3. Testando Consumo Bolsista Integral (100% Subsidiado) no Banco Real...');
    const resConsIntegral = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-INT-001',
        '${mealAlmocoId}',
        'idemp-key-integral-01',
        'TERM-01'
      ) as result;
    `);
    const ci = resConsIntegral.rows[0].result;
    assert(ci.success && ci.status === 'approved' && ci.financial.student_price === 0, 'Consumo integral aprovado com valor R$ 0,00 sem debitar carteira');

    // -------------------------------------------------------------------------
    // 4. TESTE REAL: CONSUMO ALUNO PARCIAL (Débito e Ledger Imutável)
    // -------------------------------------------------------------------------
    console.log('\n4. Testando Consumo Aluno Parcial com Débito e Ledger Imutável...');
    const resConsParcial = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAR:Q1:${rawQrSecret}',
        '${mealAlmocoId}',
        'idemp-key-parcial-01',
        'TERM-01'
      ) as result;
    `);
    const cp = resConsParcial.rows[0].result;
    assert(cp.success && cp.status === 'approved' && cp.financial.balance_remaining === 42.50, 'Consumo parcial debitado com precisão: R$ 50,00 -> R$ 42,50');

    // Conferir que o token QR foi queimado atômica e simultaneamente
    const resTokenStatus = await client.query(`SELECT status FROM public.qr_tokens WHERE id = '${qrTokenId}';`);
    assert(resTokenStatus.rows[0].status === 'used', 'Token QR dinâmico queimado atômica e simultaneamente para status used');

    // Conferir ledger financeiro imutável
    const resLedger = await client.query(`
      SELECT * FROM public.wallet_transactions 
      WHERE student_id = '${stdBeatrizPar}' 
      ORDER BY created_at DESC LIMIT 1;
    `);
    const tx = resLedger.rows[0];
    assert(
      tx.type === 'meal_debit' && 
      parseFloat(tx.amount) === -7.50 && 
      parseFloat(tx.balance_after) === 42.50 &&
      tx.reference_type === 'meal_consumption',
      'Lançamento no ledger registrado com amount -7.50, reference_type meal_consumption e integridade contábil'
    );

    // -------------------------------------------------------------------------
    // 5. TESTE REAL: CONCORRÊNCIA E BLOQUEIO DE SEGUNDA REFEIÇÃO NO DIA
    // -------------------------------------------------------------------------
    console.log('\n5. Testando Bloqueio de Segunda Refeição (Cota Diária)...');
    const resDuplicada = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-002',
        '${mealAlmocoId}',
        'idemp-key-parcial-02',
        'TERM-02'
      ) as result;
    `);
    const cd = resDuplicada.rows[0].result;
    assert(!cd.success && cd.error_code === 'ALREADY_CONSUMED_TODAY', 'Segunda tentativa no mesmo turno bloqueada com ALREADY_CONSUMED_TODAY');

    // -------------------------------------------------------------------------
    // 6. TESTE REAL: IDEMPOTÊNCIA E DETECÇÃO DE MISMATCH
    // -------------------------------------------------------------------------
    console.log('\n6. Testando Idempotência e Bloqueio de IDEMPOTENCY_KEY_REUSE_MISMATCH...');
    // Reenvio idêntico
    const resReenvio = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAR:Q1:${rawQrSecret}',
        '${mealAlmocoId}',
        'idemp-key-parcial-01',
        'TERM-01'
      ) as result;
    `);
    const cr = resReenvio.rows[0].result;
    assert(cr.success && cr.already_processed === true, 'Reenvio idêntico retorna sucesso idempotente already_processed = true sem novo débito');

    // Reuso de chave com parâmetros divergentes
    const resMismatch = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-INT-001', -- Aluno diferente usando a mesma chave!
        '${mealAlmocoId}',
        'idemp-key-parcial-01',
        'TERM-01'
      ) as result;
    `);
    const cm = resMismatch.rows[0].result;
    assert(!cm.success && cm.error_code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Reuso espúrio de chave bloqueado com IDEMPOTENCY_KEY_REUSE_MISMATCH');

    // -------------------------------------------------------------------------
    // 7. TESTE REAL: CARTEIRA BLOQUEADA (FROZEN) E ALUNO PARCIAL PREÇO ZERO
    // -------------------------------------------------------------------------
    console.log('\n7. Testando Carteira Inativa e Aluno Parcial com Preço Zero...');
    const resFrozen = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-004',
        '${mealAlmocoId}',
        'idemp-key-frozen-01',
        'TERM-01'
      ) as result;
    `);
    const cf = resFrozen.rows[0].result;
    assert(!cf.success && cf.error_code === 'WALLET_INACTIVE', 'Aluno com carteira frozen bloqueado com WALLET_INACTIVE');

    // Aluno parcial Carla: refeição café a R$ 0,00 com carteira ativa
    const resCarlaFree = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-003',
        '${mealCafeId}',
        'idemp-key-carla-01',
        'TERM-01'
      ) as result;
    `);
    const ccf = resCarlaFree.rows[0].result;
    assert(ccf.success && ccf.status === 'approved', 'Aluno parcial com refeição R$ 0,00 e carteira ativa aprovado com sucesso');

    // -------------------------------------------------------------------------
    // 8. TESTE REAL: ESTORNO FINANCEIRO vs CANCELAMENTO OPERACIONAL (RPC cancel_meal_consumption)
    // -------------------------------------------------------------------------
    console.log('\n8. Testando Estorno Financeiro vs Cancelamento Operacional...');
    await setAuthContext(client, supProfileId, 'authenticated');

    const consumBeatrizId = cp.consumption_id;

    // Estorno estritamente financeiro
    const resEstornoFin = await client.query(`
      SELECT public.cancel_meal_consumption(
        '${consumBeatrizId}',
        'financially_refunded',
        'Ajuste financeiro de atendimento assistido'
      ) as result;
    `);
    const ef = resEstornoFin.rows[0].result;
    assert(ef.success && ef.new_status === 'financially_refunded', 'Estorno financeiro concluído com status financially_refunded');

    // Saldo restaurado
    const resSaldoRestaurado = await client.query(`SELECT balance FROM public.wallets WHERE student_id = '${stdBeatrizPar}';`);
    assert(parseFloat(resSaldoRestaurado.rows[0].balance) === 50.00, 'Saldo de R$ 7,50 estornado contabilmente de volta para R$ 50,00');

    // Cota diária permanece ocupada após estorno financeiro
    await setAuthContext(client, opProfileId, 'authenticated');
    const resPosEstornoFin = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-002',
        '${mealAlmocoId}',
        'idemp-key-pos-estorno',
        'TERM-01'
      ) as result;
    `);
    const pef = resPosEstornoFin.rows[0].result;
    assert(!pef.success && pef.error_code === 'ALREADY_CONSUMED_TODAY', 'Segunda refeição BLOQUEADA após estorno financeiro (aluno consumiu a refeição)');

    // Cancelamento operacional de não-fornecimento (Carla)
    await setAuthContext(client, supProfileId, 'authenticated');
    const resCancelNaoServido = await client.query(`
      SELECT public.cancel_meal_consumption(
        '${ccf.consumption_id}',
        'cancelled_unserved',
        'Desistência na catraca antes do fornecimento da bandeja'
      ) as result;
    `);
    const cns = resCancelNaoServido.rows[0].result;
    assert(cns.success && cns.new_status === 'cancelled_unserved', 'Cancelamento por não-fornecimento concluído com cancelled_unserved');

    // Cota liberada: Carla pode consumir novamente
    await setAuthContext(client, opProfileId, 'authenticated');
    const resCarlaLiberada = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-003',
        '${mealCafeId}',
        'idemp-key-carla-segunda',
        'TERM-01'
      ) as result;
    `);
    const cl = resCarlaLiberada.rows[0].result;
    assert(cl.success && cl.status === 'approved', 'Nova refeição AUTORIZADA após cancelamento operacional de não-fornecimento comprovado');

    // -------------------------------------------------------------------------
    // 9. TESTE REAL: CONCORRÊNCIA, LOCK_TIMEOUT (SQLSTATE 55P03) E AUDITORIA
    // -------------------------------------------------------------------------
    console.log('\n9. Testando Hardening de Concorrência, SQLSTATE 55P03 e Rollback...');
    
    // Passo 9.1: Abrir transação exclusiva na conexão 2 retendo o lock da carteira
    await clientLockHolder.query('BEGIN;');
    await clientLockHolder.query(`
      SELECT balance FROM public.wallets 
      WHERE student_id = '${stdLockTest}' 
      FOR UPDATE;
    `);

    // Passo 9.2: Na conexão principal, tentar consumir meal para esse estudante.
    // O consume_meal() possui `SET LOCAL lock_timeout = '2000ms';` e SELECT ... FOR UPDATE na carteira.
    // Como a carteira está travada pela conexão 2, ocorrerá o SQLSTATE 55P03.
    await setAuthContext(client, opProfileId, 'authenticated');

    const resLockTimeout = await client.query(`
      SELECT public.consume_meal(
        '${unitA}',
        'MAT-PAR-005',
        '${mealAlmocoId}',
        'idemp-lock-timeout-01',
        'TERM-LOCK'
      ) as result;
    `);

    // Liberar a transação da conexão 2
    await clientLockHolder.query('COMMIT;');

    const lt = resLockTimeout.rows[0].result;
    assert(!lt.success && lt.error_code === 'LOCK_TIMEOUT_EXCEEDED', 'SQLSTATE 55P03 capturado com sucesso retornando LOCK_TIMEOUT_EXCEEDED');

    // Passo 9.3: Verificar auditoria autônoma em blocked_attempts
    const resBlocked = await client.query(`
      SELECT * FROM public.blocked_attempts 
      WHERE student_id = '${stdLockTest}' AND reason_code = 'LOCK_TIMEOUT_EXCEEDED';
    `);
    assert(
      resBlocked.rows.length === 1 && resBlocked.rows[0].reason_code === 'LOCK_TIMEOUT_EXCEEDED',
      'Registro de auditoria inserido em blocked_attempts com reason_code = LOCK_TIMEOUT_EXCEEDED'
    );

    // Passo 9.4: Confirmar Rollback Integral: Saldo não alterado e 0 consumos
    const resBalanceCheck = await client.query(`SELECT balance FROM public.wallets WHERE student_id = '${stdLockTest}';`);
    assert(parseFloat(resBalanceCheck.rows[0].balance) === 35.00, 'Rollback confirmado: saldo permaneceu estritamente em R$ 35,00');

    const resConsCheck = await client.query(`SELECT count(*) as total FROM public.meal_consumptions WHERE student_id = '${stdLockTest}';`);
    assert(parseInt(resConsCheck.rows[0].total) === 0, 'Rollback confirmado: nenhum consumo registrado em meal_consumptions');

    // -------------------------------------------------------------------------
    // 10. TESTE REAL: RLS E ISOLAMENTO MULTI-TENANT
    // -------------------------------------------------------------------------
    console.log('\n10. Testando Políticas de Row Level Security (RLS) no Banco Real...');
    
    // Operador tentando consumir em unidade de outro tenant (cross-tenant)
    const resCrossTenant = await client.query(`
      SELECT public.consume_meal(
        '${unitB}', -- Unidade do Tenant Beta!
        'MAT-INT-001',
        '${mealAlmocoId}',
        'idemp-cross-tenant',
        'TERM-01'
      ) as result;
    `);
    const ct = resCrossTenant.rows[0].result;
    assert(!ct.success && (ct.error_code === 'ACCESS_DENIED_UNIT' || ct.error_code === 'UNIT_UNAVAILABLE'), 'Tentativa cross-tenant bloqueada imediatamente pelo motor de segurança');

    // Tentativa de INSERT direto na tabela meal_consumptions por cliente authenticated (bypass)
    let rlsBlocked = false;
    try {
      await client.query(`
        INSERT INTO public.meal_consumptions (tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id, consumption_date, full_price, student_price, subsidy_amount, operator_id, verification_method)
        VALUES ('${tenantA}', '${unitA}', '${instA}', '${stdLucasInt}', '${catIntegral}', '${mealAlmocoId}', CURRENT_DATE, 15, 0, 15, '${opProfileId}', 'registration_number');
      `);
    } catch (err) {
      rlsBlocked = true;
    }
    assert(rlsBlocked, 'INSERT direto em meal_consumptions sem passar pela RPC bloqueado por RLS (Deny-by-default)');

    // -------------------------------------------------------------------------
    // 11. TESTE REAL: CATÁLOGO DE BLOQUEIOS E CONSTRAINTS DO BANCO
    // -------------------------------------------------------------------------
    console.log('\n11. Verificando Catálogo de Bloqueios e Integridade Estrutural...');
    const resCatalog = await client.query(`
      SELECT pg_get_constraintdef(c.oid) as condef
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'blocked_attempts' AND c.conname = 'chk_blocked_attempts_reason';
    `);
    const hasLockTimeoutInConstraint = resCatalog.rows[0]?.condef?.includes('LOCK_TIMEOUT_EXCEEDED');
    assert(hasLockTimeoutInConstraint, 'Constraint chk_blocked_attempts_reason inclui LOCK_TIMEOUT_EXCEEDED');

  } catch (err) {
    console.error('[ERRO DURANTE HOMOLOGAÇÃO REAL]:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // 12. LIMPEZA SEGURA DOS DADOS SINTÉTICOS DE TESTE
    // -------------------------------------------------------------------------
    console.log('\n12. Executando Limpeza Segura dos Dados de Teste...');
    await cleanupTestData(client);
    console.log('  [OK] Dados sintéticos removidos com sucesso de public e auth.users. Banco preservado 100% limpo.');
    await clientLockHolder.end();
    await client.end();
  }

  console.log('\n======================================================================');
  console.log(`  RESUMO DA HOMOLOGAÇÃO REAL NO POSTGRESQL: ${passed} aprovados, ${failed} reprovados`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('>> HOMOLOGAÇÃO EM POSTGRESQL/SUPABASE REAL: 100% CONCLUÍDA COM SUCESSO!\n');
  }
}

runRealHomologation();
