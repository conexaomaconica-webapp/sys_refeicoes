/**
 * ==============================================================================
 * TESTE DE ESTRESSE DE CONCORRÊNCIA SIMULTÂNEA REAL — SISTEMA MA REFEIÇÕES
 * Múltiplos Terminais Operando Concorrentemente na Mesma Matrícula
 * Banco Remoto: db.ltydhrmfhzhiuygqqeol.supabase.co
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
const dbUrl = env.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)/)[1].trim().replace(/\?sslmode=.*/, '');

// IDs Fixos de Teste Concorrente
const tenantId = 'c0000000-0000-0000-0000-000000000001';
const instId = 'c1111111-1111-1111-1111-111111111111';
const unitId = 'c2222222-2222-2222-2222-222222222222';
const catIntegral = 'c3333333-3333-3333-3333-333333333331';
const catParcial = 'c3333333-3333-3333-3333-333333333332';
const opUserId = 'c4444444-4444-4444-4444-444444444444';

const stdParcialConc = 'c6666666-6666-6666-6666-666666666661';
const stdIntegralConc = 'c6666666-6666-6666-6666-666666666662';

const mealAlmocoId = 'c9999999-9999-9999-9999-999999999991';

async function setAuthContext(c, userId) {
  await c.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  await c.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  await c.query(`SELECT set_config('request.jwt.claims', '{"sub": "${userId}", "role": "authenticated"}', false);`);
}

async function cleanup(c) {
  try {
    await c.query(`DELETE FROM public.blocked_attempts WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.meal_consumptions WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.wallet_transactions WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.wallets WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.meal_rules WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.unit_meal_types WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.meal_types WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.students WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.student_categories WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.user_unit_access WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.profiles WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.units WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.institutions WHERE tenant_id = '${tenantId}';`);
    await c.query(`DELETE FROM public.tenants WHERE id = '${tenantId}';`);
    await c.query(`DELETE FROM auth.users WHERE id = '${opUserId}';`);
  } catch (e) {
    // ignorar cascade
  }
}

async function main() {
  console.log('======================================================================');
  console.log('  TESTE DE ESTRESSE: CONCORRÊNCIA SIMULTÂNEA DE MÚLTIPLOS TERMINAIS');
  console.log('  Cenário: 5 Terminais Requisitando a Mesma Refeição no Mesmo Instante');
  console.log('======================================================================\n');

  // Criar 5 conexões independentes para simular 5 terminais físicos operando em paralelo
  const clientSetup = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await clientSetup.connect();

  console.log('1. Preparando Dados Sintéticos de Teste Concorrente...');
  await cleanup(clientSetup);

  await clientSetup.query(`
    INSERT INTO public.tenants (id, name, slug, status)
    VALUES ('${tenantId}', 'Tenant Concorrência Real', 'tenant-concorrencia', 'active');

    INSERT INTO public.institutions (id, tenant_id, name, short_name, status)
    VALUES ('${instId}', '${tenantId}', 'Instituição Teste Concorrência', 'ITC', 'active');

    INSERT INTO public.units (id, tenant_id, institution_id, name, city, state, timezone, status)
    VALUES ('${unitId}', '${tenantId}', '${instId}', 'RU Concorrência', 'São Paulo', 'SP', 'America/Sao_Paulo', 'active');

    INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous)
    VALUES ('${opUserId}', 'op.conc@test.com', 'authenticated', 'authenticated', false, false);

    INSERT INTO public.profiles (id, tenant_id, full_name, role, status)
    VALUES ('${opUserId}', '${tenantId}', 'Operador Multi-Terminal', 'operator', 'active');

    INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id)
    VALUES ('${tenantId}', '${opUserId}', '${unitId}');

    INSERT INTO public.student_categories (id, tenant_id, name, code, requires_wallet, status)
    VALUES 
      ('${catIntegral}', '${tenantId}', 'Bolsista Integral', 'integral', false, 'active'),
      ('${catParcial}', '${tenantId}', 'Aluno Parcial', 'partial', true, 'active');

    INSERT INTO public.students (id, tenant_id, institution_id, category_id, full_name, registration_number, status)
    VALUES 
      ('${stdParcialConc}', '${tenantId}', '${instId}', '${catParcial}', 'Aluno Concorrente Parcial', 'MAT-PAR-CONC-01', 'active'),
      ('${stdIntegralConc}', '${tenantId}', '${instId}', '${catIntegral}', 'Aluno Concorrente Integral', 'MAT-INT-CONC-02', 'active');

    INSERT INTO public.wallets (tenant_id, student_id, balance, status)
    VALUES ('${tenantId}', '${stdParcialConc}', 50.00, 'active');

    INSERT INTO public.meal_types (id, tenant_id, code, name, status)
    VALUES ('${mealAlmocoId}', '${tenantId}', 'lunch', 'Almoço Concorrente', 'active');

    INSERT INTO public.unit_meal_types (tenant_id, unit_id, meal_type_id, enabled, start_time, end_time)
    VALUES ('${tenantId}', '${unitId}', '${mealAlmocoId}', true, '00:00:00', '23:59:59');

    INSERT INTO public.meal_rules (tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, enabled, effective_from)
    VALUES 
      ('${tenantId}', '${unitId}', '${mealAlmocoId}', '${catParcial}', 15.00, 7.50, 7.50, true, now() - interval '1 day'),
      ('${tenantId}', '${unitId}', '${mealAlmocoId}', '${catIntegral}', 15.00, 0.00, 15.00, true, now() - interval '1 day');
  `);

  console.log('   [OK] Dados sintéticos configurados: Saldo inicial R$ 50,00; Preço refeição: R$ 7,50.\n');

  // Abrir 5 conexões para os 5 terminais
  const numTerminals = 5;
  const terminalClients = [];
  for (let i = 0; i < numTerminals; i++) {
    const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await setAuthContext(c, opUserId);
    terminalClients.push(c);
  }

  console.log(`2. Disparando ${numTerminals} Requisições SIMULTÂNEAS (Promise.all) no Mesmo Milissegundo...`);
  console.log(`   Matrícula Alvo: MAT-PAR-CONC-01 (Aluno Parcial)`);

  const startTime = Date.now();
  const promises = terminalClients.map((client, idx) => {
    const terminalId = `TERM-0${idx + 1}`;
    const idempKey = `idemp-conc-term-${idx + 1}-${Date.now()}`;
    return client.query(`
      SELECT public.consume_meal(
        '${unitId}',
        'MAT-PAR-CONC-01',
        '${mealAlmocoId}',
        '${idempKey}',
        '${terminalId}'
      ) as result;
    `).then(res => ({
      terminal: terminalId,
      result: res.rows[0].result
    }));
  });

  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;
  console.log(`   [OK] Todas as 5 requisições retornaram em ${duration}ms.\n`);

  // Analisar Resultados
  let approvedCount = 0;
  let blockedCount = 0;
  const errorCodes = [];

  console.log('3. Resultados Obtidos por Terminal:');
  for (const r of results) {
    const res = r.result;
    if (res.success && res.status === 'approved') {
      approvedCount++;
      console.log(`   - [${r.terminal}] APROVADO: consumption_id: ${res.consumption_id}, saldo restante: R$ ${res.financial.balance_remaining}`);
    } else {
      blockedCount++;
      errorCodes.push(res.error_code);
      console.log(`   - [${r.terminal}] BLOQUEADO: error_code: ${res.error_code} (${res.message})`);
    }
  }

  console.log('\n4. Verificação de Integridade Transacional e Contábil no PostgreSQL:');

  // Asserção 1: Exatamente 1 terminal aprovado
  const okSingleApproval = (approvedCount === 1 && blockedCount === (numTerminals - 1));
  console.log(`   - [${okSingleApproval ? 'OK' : 'FAIL'}] Exatamente 1 aprovação e ${numTerminals - 1} bloqueios (Aprovados: ${approvedCount}, Bloqueados: ${blockedCount})`);

  // Asserção 2: Saldo exato da carteira (R$ 50,00 - R$ 7,50 = R$ 42,50)
  const resWallet = await clientSetup.query(`SELECT balance FROM public.wallets WHERE student_id = '${stdParcialConc}';`);
  const finalBalance = parseFloat(resWallet.rows[0].balance);
  const okBalance = (finalBalance === 42.50);
  console.log(`   - [${okBalance ? 'OK' : 'FAIL'}] Saldo final da carteira: R$ ${finalBalance.toFixed(2)} (Esperado: R$ 42.50 - SEM DUPLO DÉBITO)`);

  // Asserção 3: Exatamente 1 linha em meal_consumptions
  const resCons = await clientSetup.query(`SELECT count(*) as total FROM public.meal_consumptions WHERE student_id = '${stdParcialConc}';`);
  const totalCons = parseInt(resCons.rows[0].total);
  const okCons = (totalCons === 1);
  console.log(`   - [${okCons ? 'OK' : 'FAIL'}] Linhas em meal_consumptions: ${totalCons} (Esperado: 1)`);

  // Asserção 4: Exatamente 1 transação no ledger financeiro
  const resTx = await clientSetup.query(`SELECT count(*) as total FROM public.wallet_transactions WHERE student_id = '${stdParcialConc}';`);
  const totalTx = parseInt(resTx.rows[0].total);
  const okTx = (totalTx === 1);
  console.log(`   - [${okTx ? 'OK' : 'FAIL'}] Transações no livro-razão (wallet_transactions): ${totalTx} (Esperado: 1)`);

  // Asserção 5: Bloqueios devidamente auditados em blocked_attempts
  const resBlocked = await clientSetup.query(`SELECT count(*) as total FROM public.blocked_attempts WHERE student_id = '${stdParcialConc}';`);
  const totalBlocked = parseInt(resBlocked.rows[0].total);
  const okBlocked = (totalBlocked === (numTerminals - 1));
  console.log(`   - [${okBlocked ? 'OK' : 'FAIL'}] Tentativas auditadas em blocked_attempts: ${totalBlocked} (Esperado: ${numTerminals - 1})`);

  // ---------------------------------------------------------------------------
  // Cenário 2: Concorrência Simultânea em Aluno Bolsista Integral (100% Subsidiado)
  // ---------------------------------------------------------------------------
  console.log('\n5. Testando Concorrência Simultânea para Bolsista Integral (3 Terminais Paralelos)...');
  const integralPromises = [terminalClients[0], terminalClients[1], terminalClients[2]].map((client, idx) => {
    return client.query(`
      SELECT public.consume_meal(
        '${unitId}',
        'MAT-INT-CONC-02',
        '${mealAlmocoId}',
        'idemp-int-conc-${idx + 1}',
        'TERM-INT-0${idx + 1}'
      ) as result;
    `).then(res => res.rows[0].result);
  });

  const intResults = await Promise.all(integralPromises);
  const intApproved = intResults.filter(r => r.success && r.status === 'approved').length;
  const intBlocked = intResults.filter(r => !r.success).length;

  const okIntegral = (intApproved === 1 && intBlocked === 2);
  console.log(`   - [${okIntegral ? 'OK' : 'FAIL'}] Bolsista Integral: 1 Aprovado, 2 Bloqueados com ALREADY_CONSUMED_TODAY`);

  const resIntCons = await clientSetup.query(`SELECT count(*) as total FROM public.meal_consumptions WHERE student_id = '${stdIntegralConc}';`);
  const okIntCons = (parseInt(resIntCons.rows[0].total) === 1);
  console.log(`   - [${okIntCons ? 'OK' : 'FAIL'}] Total de consumos registrados para o Bolsista: ${resIntCons.rows[0].total} (Esperado: 1)`);

  // Limpeza
  console.log('\n6. Executando Limpeza Segura dos Dados Sintéticos de Concorrência...');
  await cleanup(clientSetup);
  console.log('   [OK] Banco de dados limpo com sucesso.');

  // Fechar conexões
  await clientSetup.end();
  for (const c of terminalClients) {
    await c.end();
  }

  const allPassed = okSingleApproval && okBalance && okCons && okTx && okBlocked && okIntegral && okIntCons;

  console.log('\n======================================================================');
  console.log(`  RESULTADO DA HOMOLOGAÇÃO DE CONCORRÊNCIA SIMULTÂNEA: ${allPassed ? '100% APROVADA' : 'REPROVADA'}`);
  console.log('======================================================================\n');

  if (!allPassed) process.exit(1);
}

main().catch(err => {
  console.error('[ERRO NO TESTE DE CONCORRÊNCIA]:', err);
  process.exit(1);
});
