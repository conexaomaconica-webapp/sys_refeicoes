/**
 * ==============================================================================
 * SUÍTE DE HOMOLOGAÇÃO REAL — SPRINT 10 (MÓDULO 10.4)
 * Reconciliação de Contingência Offline, Idempotência e Tratamento de Conflitos
 * Execução direta contra o banco PostgreSQL
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
  ssl: { rejectUnauthorized: false },
});

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  [OK - HOMOLOGAÇÃO] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL - HOMOLOGAÇÃO] ${msg}`);
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

// Identificadores Fixos para Homologação
const tenantA = 'd1000000-0000-0000-0000-000000000001';
const tenantB = 'd1000000-0000-0000-0000-000000000002';
const instA = 'd1111111-1111-1111-1111-111111111111';
const instB = 'd1111111-1111-1111-1111-111111111112';
const unitA = 'd2222222-2222-2222-2222-222222222221';
const unitB = 'd2222222-2222-2222-2222-222222222222';

const catIntegral = 'd3333333-3333-3333-3333-333333333331';
const catParcial = 'd3333333-3333-3333-3333-333333333332';

const opAProfileId = 'd4444444-4444-4444-4444-444444444441';
const opBProfileId = 'd4444444-4444-4444-4444-444444444442';

const stdLucasInt = 'd6666666-6666-6666-6666-666666666661';
const stdBeatrizPar = 'd6666666-6666-6666-6666-666666666662';
const stdCarlaBroke = 'd6666666-6666-6666-6666-666666666663';
const stdDiegoInactive = 'd6666666-6666-6666-6666-666666666664';

const mealAlmocoId = 'd9999999-9999-9999-9999-999999999991';

async function cleanupTestData(c) {
  try {
    await c.query(`DELETE FROM public.offline_contingency_events WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.blocked_attempts WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
    await c.query(`DELETE FROM public.meal_consumptions WHERE tenant_id IN ('${tenantA}', '${tenantB}');`);
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
    await c.query(`DELETE FROM auth.users WHERE id IN ('${opAProfileId}', '${opBProfileId}');`);
  } catch (e) {
    // ignorar erros
  }
}

async function runHomologation() {
  console.log('======================================================================');
  console.log('  HOMOLOGAÇÃO MÓDULO 10.4 — RECONCILIAÇÃO OFFLINE E CONFLITOS');
  console.log('======================================================================\n');

  await client.connect();

  // 1. Aplicar Migration 31 se ainda não existir
  console.log('1. Aplicando Migration 31 (offline_contingency_events e reconcile_offline_consumptions)...');
  const migration31Sql = fs.readFileSync(
    path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000031_create_offline_contingency_tables_and_rpc.sql'),
    'utf8'
  );
  await client.query(migration31Sql);
  assert(true, 'Migration 31 aplicada e verificada no banco com sucesso.');

  // 2. Limpeza e Carga de Dados Sintéticos de Teste
  console.log('\n2. Preparando Dados de Teste Sintéticos Isolados...');
  await cleanupTestData(client);

  // Tenants
  await client.query(`INSERT INTO public.tenants (id, name, slug) VALUES ('${tenantA}', 'Tenant A Refeições', 'tenant-a-test');`);
  await client.query(`INSERT INTO public.tenants (id, name, slug) VALUES ('${tenantB}', 'Tenant B Refeições', 'tenant-b-test');`);

  // Instituições e Unidades
  await client.query(`INSERT INTO public.institutions (id, tenant_id, name, short_name) VALUES ('${instA}', '${tenantA}', 'Universidade A', 'UNIA');`);
  await client.query(`INSERT INTO public.institutions (id, tenant_id, name, short_name) VALUES ('${instB}', '${tenantB}', 'Universidade B', 'UNIB');`);

  await client.query(`INSERT INTO public.units (id, tenant_id, institution_id, name, city, state, timezone) VALUES ('${unitA}', '${tenantA}', '${instA}', 'RU Central A', 'São Paulo', 'SP', 'America/Sao_Paulo');`);
  await client.query(`INSERT INTO public.units (id, tenant_id, institution_id, name, city, state, timezone) VALUES ('${unitB}', '${tenantB}', '${instB}', 'RU Central B', 'Rio de Janeiro', 'RJ', 'America/Sao_Paulo');`);

  // Operadores
  await client.query(`INSERT INTO auth.users (id, email) VALUES ('${opAProfileId}', 'op.a@test.com'), ('${opBProfileId}', 'op.b@test.com');`);
  await client.query(`INSERT INTO public.profiles (id, tenant_id, full_name, email, role, status) VALUES 
    ('${opAProfileId}', '${tenantA}', 'Operador Caixa A', 'op.a@test.com', 'operator', 'active'),
    ('${opBProfileId}', '${tenantA}', 'Operador Caixa B (Substituto)', 'op.b@test.com', 'operator', 'active');`);

  await client.query(`INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES 
    ('${tenantA}', '${opAProfileId}', '${unitA}'),
    ('${tenantA}', '${opBProfileId}', '${unitA}');`);

  // Categorias de Alunos
  await client.query(`INSERT INTO public.student_categories (id, tenant_id, name, code, requires_wallet) VALUES 
    ('${catIntegral}', '${tenantA}', 'Bolsista Integral', 'bolsista_integral', false),
    ('${catParcial}', '${tenantA}', 'Aluno Parcial', 'parcial', true);`);

  // Alunos
  await client.query(`INSERT INTO public.students (id, tenant_id, institution_id, category_id, registration_number, full_name, status) VALUES 
    ('${stdLucasInt}', '${tenantA}', '${instA}', '${catIntegral}', '20261001', 'Lucas Integral Silva', 'active'),
    ('${stdBeatrizPar}', '${tenantA}', '${instA}', '${catParcial}', '20261002', 'Beatriz Parcial Souza', 'active'),
    ('${stdCarlaBroke}', '${tenantA}', '${instA}', '${catParcial}', '20261003', 'Carla Parcial Sem Saldo', 'active'),
    ('${stdDiegoInactive}', '${tenantA}', '${instA}', '${catParcial}', '20261004', 'Diego Inativo', 'inactive');`);

  // Carteiras
  // Beatriz tem R$ 15,00 (suficiente)
  const walletBeatrizId = 'e7777777-7777-7777-7777-777777777772';
  await client.query(`INSERT INTO public.wallets (id, tenant_id, student_id, balance, status) VALUES ('${walletBeatrizId}', '${tenantA}', '${stdBeatrizPar}', 15.00, 'active');`);

  // Carla tem apenas R$ 1,00 (insuficiente para refeição de R$ 3,50, simula saldo desatualizado no snapshot)
  const walletCarlaId = 'e7777777-7777-7777-7777-777777777773';
  await client.query(`INSERT INTO public.wallets (id, tenant_id, student_id, balance, status) VALUES ('${walletCarlaId}', '${tenantA}', '${stdCarlaBroke}', 1.00, 'active');`);

  // Tipo de Refeição e Regra de Preço
  await client.query(`INSERT INTO public.meal_types (id, tenant_id, name, code, status) VALUES ('${mealAlmocoId}', '${tenantA}', 'Almoço', 'lunch', 'active');`);
  await client.query(`INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id, start_time, end_time, enabled) VALUES ('${tenantA}', '${unitA}', '${mealAlmocoId}', '00:00:00', '23:59:59', true);`);

  await client.query(`INSERT INTO public.meal_rules (tenant_id, unit_id, category_id, meal_type_id, full_price, student_price, subsidy_amount, effective_from) VALUES 
    ('${tenantA}', '${unitA}', '${catIntegral}', '${mealAlmocoId}', 10.00, 0.00, 10.00, '2026-01-01 00:00:00Z'),
    ('${tenantA}', '${unitA}', '${catParcial}', '${mealAlmocoId}', 10.00, 3.50, 6.50, '2026-01-01 00:00:00Z');`);

  assert(true, 'Estrutura sintética de dados carregada com sucesso.');

  // Configurar contexto JWT como Operador A
  await setAuthContext(client, opAProfileId);

  // =========================================================================
  // CENÁRIO 1: Lote de 50 Eventos Offline Bounded
  // =========================================================================
  console.log('\n--- CENÁRIO 1: Lote de 50 Eventos Offline Bounded ---');
  const batch50 = [];
  for (let i = 1; i <= 50; i++) {
    batch50.push({
      id: crypto.randomUUID(),
      terminal_id: 'TERM-01',
      unit_id: unitA,
      operator_id: opAProfileId,
      student_id: stdLucasInt,
      registration_attempted: '20261001',
      meal_type_id: mealAlmocoId,
      device_timestamp: new Date().toISOString(),
      sequence_num: i,
      idempotency_key: `TERM-01_SEQ_${i}_IDEM_1`,
      previous_event_hash: 'HASH_PREV',
      integrity_hash: `INTEG_HASH_${i}`,
    });
  }

  // O primeiro evento deve aprovar Lucas (Integral), e os outros 49 devem ser detectados como duplicidade offline (conflito preservado)
  const resBatch50 = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify(batch50)]);
  const results1 = resBatch50.rows[0].result;
  assert(results1.length === 50, `Lote de 50 eventos processado integralmente (retornou ${results1.length} decisões).`);
  assert(results1[0].status === 'confirmed_regular', 'Primeiro evento de Lucas confirmado como regular.');
  assert(results1[1].status === 'conflict_duplicate', 'Segundo evento de Lucas em contingência registrado como conflict_duplicate.');
  assert(results1[49].status === 'conflict_duplicate', 'Quinquagésimo evento preservado como conflito de auditoria.');

  // =========================================================================
  // CENÁRIO 2: Reenvio Simultâneo / Idempotência Estrita
  // =========================================================================
  console.log('\n--- CENÁRIO 2: Reenvio Idêntico de Evento Já Conciliado ---');
  const resReplay = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([batch50[0]])]);
  const replayDecision = resReplay.rows[0].result[0];
  assert(replayDecision.already_processed === true, 'Reenvio do mesmo evento retornou already_processed = true.');
  assert(replayDecision.status === 'confirmed_regular', 'Status retornado coincide com a decisão persistida original.');

  // =========================================================================
  // CENÁRIO 3: Dois Terminais Offline Registrando a Mesma Matrícula Parcial
  // =========================================================================
  console.log('\n--- CENÁRIO 3: Dois Terminais Offline com Mesma Matrícula Parcial (Beatriz) ---');
  const eventTerm1 = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-01',
    unit_id: unitA,
    operator_id: opAProfileId,
    student_id: stdBeatrizPar,
    registration_attempted: '20261002',
    meal_type_id: mealAlmocoId,
    device_timestamp: '2026-10-16T12:00:00Z',
    sequence_num: 51,
    idempotency_key: 'BEATRIZ_TERM1_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const eventTerm2 = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-02',
    unit_id: unitA,
    operator_id: opAProfileId,
    student_id: stdBeatrizPar,
    registration_attempted: '20261002',
    meal_type_id: mealAlmocoId,
    device_timestamp: '2026-10-16T12:05:00Z',
    sequence_num: 1,
    idempotency_key: 'BEATRIZ_TERM2_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  // Reconciliar Terminal 1
  const resTerm1 = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventTerm1])]);
  assert(resTerm1.rows[0].result[0].status === 'confirmed_regular', 'Terminal 1: Refeição regular de Beatriz confirmada.');
  assert(resTerm1.rows[0].result[0].financial_debit_applied === true, 'Terminal 1: Débito financeiro efetuado com sucesso.');

  // Reconciliar Terminal 2 (Mesma refeição e dia, liberada em terminal desconectado)
  const resTerm2 = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventTerm2])]);
  assert(resTerm2.rows[0].result[0].status === 'conflict_duplicate', 'Terminal 2: Conflito de duplicidade offline preservado.');
  assert(resTerm2.rows[0].result[0].financial_debit_applied === false, 'Terminal 2: SEGUNDO DÉBITO FINANCEIRO REJEITADO!');

  // Auditoria no Livro-Razão Financeiro: Beatriz deve ter tido exatamente 1 débito de R$ 3,50 (Saldo: 15,00 - 3,50 = 11,50)
  const walletCheck = await client.query(`SELECT balance FROM public.wallets WHERE student_id = '${stdBeatrizPar}';`);
  const finalBalance = Number(walletCheck.rows[0].balance);
  assert(finalBalance === 11.50, `Saldo da carteira de Beatriz é exatamente R$ 11,50 (sofreu apenas 1 débito, sem duplicação).`);

  const txCountCheck = await client.query(`SELECT COUNT(*) FROM public.wallet_transactions WHERE student_id = '${stdBeatrizPar}';`);
  assert(Number(txCountCheck.rows[0].count) === 1, 'Exatamente 1 transação de débito gravada no livro-razão imutável.');

  // =========================================================================
  // CENÁRIO 4: Matrícula Parcial com Saldo Desatualizado (Carla)
  // =========================================================================
  console.log('\n--- CENÁRIO 4: Saldo Insuficiente Pós-Fato (Carla) ---');
  const eventCarla = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-01',
    unit_id: unitA,
    operator_id: opAProfileId,
    student_id: stdCarlaBroke,
    registration_attempted: '20261003',
    meal_type_id: mealAlmocoId,
    device_timestamp: new Date().toISOString(),
    sequence_num: 52,
    idempotency_key: 'CARLA_TERM1_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const resCarla = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventCarla])]);
  assert(resCarla.rows[0].result[0].status === 'pending_administrative_review', 'Carla: Retida em pending_administrative_review.');
  assert(resCarla.rows[0].result[0].error_code === 'INSUFFICIENT_FUNDS_POST_FACTUM', 'Motivo registrado: INSUFFICIENT_FUNDS_POST_FACTUM.');

  // Conferir que NÃO gerou saldo negativo na carteira
  const walletCarlaCheck = await client.query(`SELECT balance FROM public.wallets WHERE student_id = '${stdCarlaBroke}';`);
  assert(Number(walletCarlaCheck.rows[0].balance) === 1.00, 'Saldo de Carla mantido em R$ 1,00 (NENHUM SALDO NEGATIVO AUTOMÁTICO).');

  // =========================================================================
  // CENÁRIO 5: Aluno Inativo na Base Central (Diego)
  // =========================================================================
  console.log('\n--- CENÁRIO 5: Matrícula Inativa (Diego) ---');
  const eventDiego = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-01',
    unit_id: unitA,
    operator_id: opAProfileId,
    student_id: stdDiegoInactive,
    registration_attempted: '20261004',
    meal_type_id: mealAlmocoId,
    device_timestamp: new Date().toISOString(),
    sequence_num: 53,
    idempotency_key: 'DIEGO_TERM1_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const resDiego = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventDiego])]);
  assert(resDiego.rows[0].result[0].status === 'pending_administrative_review', 'Diego: Fato físico preservado para análise administrativa de suspensão.');

  // =========================================================================
  // CENÁRIO 6: Tentativa de Conciliação Cross-Tenant (Unidade de Outro Tenant)
  // =========================================================================
  console.log('\n--- CENÁRIO 6: Isolamento Multi-Tenant Estrito ---');
  const eventCrossTenant = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-01',
    unit_id: unitB, // Unidade do Tenant B
    operator_id: opAProfileId,
    student_id: stdLucasInt,
    registration_attempted: '20261001',
    meal_type_id: mealAlmocoId,
    device_timestamp: new Date().toISOString(),
    sequence_num: 54,
    idempotency_key: 'CROSS_TENANT_ATTEMPT_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const resCross = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventCrossTenant])]);
  assert(resCross.rows[0].result[0].status === 'failed_irrecoverable', 'Cross-tenant rejeitado com status failed_irrecoverable.');
  assert(resCross.rows[0].result[0].error_code === 'UNIT_TENANT_MISMATCH', 'Erro explícito: UNIT_TENANT_MISMATCH.');

  // =========================================================================
  // CENÁRIO 7: Troca de Operador (Operador B envia fila iniciada por Operador A)
  // =========================================================================
  console.log('\n--- CENÁRIO 7: Troca de Operador no Mesmo Terminal ---');
  await setAuthContext(client, opBProfileId); // Operador B autenticado

  const eventOpB = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-01',
    unit_id: unitA,
    operator_id: opAProfileId, // Gravado pelo Operador A no turno anterior
    student_id: stdBeatrizPar,
    registration_attempted: '20261002',
    meal_type_id: mealAlmocoId,
    device_timestamp: new Date().toISOString(),
    sequence_num: 55,
    idempotency_key: 'OP_HANDOVER_TEST_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const resOpB = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventOpB])]);
  assert(resOpB.rows[0].result.length === 1, 'Operador B conseguiu transmitir lote de contingência pendente do Operador A.');

  // =========================================================================
  // CENÁRIO 8: Conflito Simultâneo com Consumo Registrado Online Previamente
  // =========================================================================
  console.log('\n--- CENÁRIO 8: Conflito com Consumo Online Pré-existente ---');
  // Aluno novo para o teste
  const stdJulio = 'd6666666-6666-6666-6666-666666666669';
  await client.query(`INSERT INTO public.students (id, tenant_id, institution_id, category_id, registration_number, full_name, status) 
    VALUES ('${stdJulio}', '${tenantA}', '${instA}', '${catIntegral}', '20261009', 'Julio Online Test', 'active');`);

  // Julio consumiu online no início do turno
  await client.query(`INSERT INTO public.meal_consumptions (
    tenant_id, unit_id, institution_id, student_id, category_id, meal_type_id,
    consumption_date, consumed_at, full_price, student_price, subsidy_amount,
    operator_id, terminal_id, verification_method, idempotency_key, status
  ) VALUES (
    '${tenantA}', '${unitA}', '${instA}', '${stdJulio}', '${catIntegral}', '${mealAlmocoId}',
    CURRENT_DATE, now() - INTERVAL '1 hour', 10.00, 0.00, 10.00,
    '${opAProfileId}', 'TERM-ONLINE', 'registration_number', 'JULIO_ONLINE_001', 'approved'
  );`);

  // Terminal offline registrou Julio às 12:30 sem saber do consumo online
  const eventJulioOffline = {
    id: crypto.randomUUID(),
    terminal_id: 'TERM-OFFLINE-01',
    unit_id: unitA,
    operator_id: opAProfileId,
    student_id: stdJulio,
    registration_attempted: '20261009',
    meal_type_id: mealAlmocoId,
    device_timestamp: new Date().toISOString(),
    sequence_num: 1,
    idempotency_key: 'JULIO_OFFLINE_DUP_001',
    previous_event_hash: 'HASH',
    integrity_hash: 'HASH',
  };

  const resJulio = await client.query(`SELECT public.reconcile_offline_consumptions($1::jsonb) AS result;`, [JSON.stringify([eventJulioOffline])]);
  assert(resJulio.rows[0].result[0].status === 'conflict_duplicate', 'Consumo offline pós-online conciliado com status conflict_duplicate.');

  // =========================================================================
  // CENÁRIO 9: Verificação de Integridade e Persistência do Livro de Contingência
  // =========================================================================
  console.log('\n--- CENÁRIO 9: Auditoria do Livro de Contingência (offline_contingency_events) ---');
  const countEvents = await client.query(`SELECT COUNT(*) FROM public.offline_contingency_events WHERE tenant_id = '${tenantA}';`);
  const totalEventsInDb = Number(countEvents.rows[0].count);
  assert(totalEventsInDb >= 55, `Todas as entregas físicas foram preservadas no banco oficial (${totalEventsInDb} eventos registrados).`);

  const conflictsCount = await client.query(`SELECT COUNT(*) FROM public.offline_contingency_events WHERE tenant_id = '${tenantA}' AND status = 'conflict_duplicate';`);
  assert(Number(conflictsCount.rows[0].count) >= 50, 'Todos os conflitos de duplicidade foram indexados para auditoria administrativa.');

  // Finalização
  console.log('\n======================================================');
  console.log(`RESULTADO DA HOMOLOGAÇÃO: ${passed} PASSARAM, ${failed} FALHARAM`);
  console.log('======================================================\n');

  await cleanupTestData(client);
  await client.end();

  if (failed > 0) {
    process.exit(1);
  }
}

runHomologation().catch(async (err) => {
  console.error('❌ Erro na execução da homologação:', err);
  try { await cleanupTestData(client); } catch {}
  try { await client.end(); } catch {}
  process.exit(1);
});
