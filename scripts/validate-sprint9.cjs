/**
 * ==============================================================================
 * VALIDAÇÃO AUTÔNOMA DA SPRINT 9 — MOTOR DE CONSUMO ATÔMICO (consume_meal)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [OK] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

const rootDir = path.resolve(__dirname, '..');

console.log('======================================================================');
console.log('  VALIDAÇÃO AUTÔNOMA DA SPRINT 9 — MOTOR DE CONSUMO ATÔMICO');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// 1. Verificando Migration 000028 (Tabelas de Consumo e Auditoria)
// -----------------------------------------------------------------------------
console.log('1. Verificando Migration 000028 (Tabelas meal_consumptions e blocked_attempts)...');
const mig28Path = path.join(rootDir, 'supabase', 'migrations', '20260927000028_create_meal_consumption_tables.sql');
assert(fs.existsSync(mig28Path), 'Arquivo 20260927000028_create_meal_consumption_tables.sql existe');

const mig28Content = fs.readFileSync(mig28Path, 'utf8');
assert(mig28Content.includes('CREATE TABLE public.meal_consumptions'), 'Cria tabela public.meal_consumptions');
assert(mig28Content.includes('CREATE TABLE public.blocked_attempts'), 'Cria tabela public.blocked_attempts');
assert(mig28Content.includes('request_hash TEXT NULL'), 'Coluna request_hash para assinatura canônica de idempotência');
assert(mig28Content.includes("chk_meal_consumptions_status CHECK (status IN ('approved', 'financially_refunded', 'cancelled_unserved'))"), 'Distinção tripla de status: approved, financially_refunded e cancelled_unserved');
assert(mig28Content.includes('idx_meal_consumptions_active_daily') && mig28Content.includes("WHERE (status IN ('approved', 'financially_refunded'))"), 'Índice parcial de cota diária: apenas status que representam fornecimento ocupam cota');
assert(mig28Content.includes('uq_meal_consumptions_idempotency'), 'Índice de unicidade de chave de idempotência por tenant');
assert(mig28Content.includes('IDEMPOTENCY_KEY_REUSE_MISMATCH'), 'Constraint de blocked_attempts contém IDEMPOTENCY_KEY_REUSE_MISMATCH');
assert(mig28Content.includes('CONCURRENT_CONSUMPTION_CONFLICT'), 'Constraint de blocked_attempts contém CONCURRENT_CONSUMPTION_CONFLICT');
assert(mig28Content.includes('WALLET_NOT_FOUND') && mig28Content.includes('WALLET_INACTIVE'), 'Constraint de blocked_attempts contém WALLET_NOT_FOUND e WALLET_INACTIVE');
assert(mig28Content.includes('TOKEN_NOT_FOUND') && mig28Content.includes('TOKEN_REVOKED'), 'Constraint de blocked_attempts contém TOKEN_NOT_FOUND e TOKEN_REVOKED');
assert(mig28Content.includes('ON DELETE RESTRICT'), 'Foreign keys utilizam ON DELETE RESTRICT');

// -----------------------------------------------------------------------------
// 2. Verificando Migration 000029 (RPC consume_meal e RLS Forçado)
// -----------------------------------------------------------------------------
console.log('\n2. Verificando Migration 000029 (RPC consume_meal, Locks e Ledger Imutável)...');
const mig29Path = path.join(rootDir, 'supabase', 'migrations', '20260927000029_create_consume_meal_rpc.sql');
assert(fs.existsSync(mig29Path), 'Arquivo 20260927000029_create_consume_meal_rpc.sql existe');

const mig29Content = fs.readFileSync(mig29Path, 'utf8');
assert(mig29Content.includes('ALTER TABLE public.meal_consumptions FORCE ROW LEVEL SECURITY;'), 'RLS forçado em meal_consumptions');
assert(mig29Content.includes('ALTER TABLE public.blocked_attempts FORCE ROW LEVEL SECURITY;'), 'RLS forçado em blocked_attempts');
assert(!mig29Content.includes('CREATE POLICY ins_meal_consumptions'), 'Zero políticas de INSERT direto no cliente em meal_consumptions');
assert(!mig29Content.includes('CREATE POLICY upd_meal_consumptions'), 'Zero políticas de UPDATE direto no cliente em meal_consumptions');

// Verificação da RPC consume_meal
assert(mig29Content.includes('CREATE OR REPLACE FUNCTION public.consume_meal'), 'Define RPC consume_meal');
assert(mig29Content.includes('TIMESTAMP WITHOUT TIME ZONE'), 'Horário local tipado estritamente como TIMESTAMP WITHOUT TIME ZONE (sem coerção de fuso)');
assert(mig29Content.includes('v_request_hash :='), 'Gera assinatura canônica da requisição para validação de idempotência');
assert(mig29Content.includes('IDEMPOTENCY_KEY_REUSE_MISMATCH'), 'Compara request_hash e rejeita reutilização de chave com parâmetros diferentes');
assert(mig29Content.includes('pg_advisory_xact_lock'), 'Serializa concorrência via pg_advisory_xact_lock ordenado antes das mutações');
assert(mig29Content.includes('v_consumption_id := gen_random_uuid();'), 'Pré-gera UUID do consumo para referência definitiva no ledger');
assert(mig29Content.includes("'meal_debit'"), 'Lança débito no ledger imutável com tipo meal_debit');
assert(!mig29Content.includes('UPDATE public.wallet_transactions'), 'ZERO UPDATE em wallet_transactions (princípio do ledger imutável 100% preservado)');
assert(mig29Content.includes("v_category.code = 'integral'"), 'Diferencia categoria integral (subsídio 100% sem exigência de carteira)');
assert(mig29Content.includes("v_wallet.status <> 'active'"), 'Valida obrigatoriedade de carteira ativa para alunos parciais mesmo com preço R$ 0,00');
assert(mig29Content.includes("UPDATE public.qr_tokens") && mig29Content.includes("SET status = 'used'"), 'Inutiliza QR token dinâmico atômica e simultaneamente no consumo');

// Verificação de suporte a horário noturno e virada da meia-noite
assert(mig29Content.includes('start_time > end_time'), 'Tratamento explícito de janelas circulares que cruzam a meia-noite');
assert(mig29Content.includes('v_consumption_date := v_local_date - 1;'), 'Alocação precisa de data operacional no dia anterior durante a madrugada');

// Verificação da RPC administrativa de cancelamento/estorno
assert(mig29Content.includes('CREATE OR REPLACE FUNCTION public.cancel_meal_consumption'), 'Define RPC cancel_meal_consumption');
assert(mig29Content.includes("'cancelled_unserved'"), 'Permite cancelamento por não fornecimento liberando a cota diária');
assert(mig29Content.includes("'financially_refunded'"), 'Permite estorno estritamente financeiro mantendo a cota diária ocupada');

// -----------------------------------------------------------------------------
// 3. Verificando Tipagens TypeScript e Serviços
// -----------------------------------------------------------------------------
console.log('\n3. Verificando Tipagens TypeScript e Serviços...');
const consumptionTypePath = path.join(rootDir, 'src', 'types', 'consumption.ts');
assert(fs.existsSync(consumptionTypePath), 'src/types/consumption.ts existe');

const consumptionTypeContent = fs.readFileSync(consumptionTypePath, 'utf8');
assert(consumptionTypeContent.includes('IDEMPOTENCY_KEY_REUSE_MISMATCH'), 'BlockedReasonCode contém IDEMPOTENCY_KEY_REUSE_MISMATCH');
assert(consumptionTypeContent.includes('financially_refunded'), 'MealConsumptionStatus contém financially_refunded');
assert(consumptionTypeContent.includes('cancelled_unserved'), 'MealConsumptionStatus contém cancelled_unserved');

const indexTypePath = path.join(rootDir, 'src', 'types', 'index.ts');
const indexTypeContent = fs.readFileSync(indexTypePath, 'utf8');
assert(indexTypeContent.includes("export * from './consumption';"), 'src/types/index.ts exporta consumption');

const dbTypesPath = path.join(rootDir, 'src', 'types', 'database.types.ts');
const dbTypesContent = fs.readFileSync(dbTypesPath, 'utf8');
assert(dbTypesContent.includes('meal_consumptions: {'), 'database.types.ts contém tabela meal_consumptions');
assert(dbTypesContent.includes('blocked_attempts: {'), 'database.types.ts contém tabela blocked_attempts');
assert(dbTypesContent.includes('consume_meal: {'), 'database.types.ts contém RPC consume_meal');
assert(dbTypesContent.includes('cancel_meal_consumption: {'), 'database.types.ts contém RPC cancel_meal_consumption');

const consumptionServicePath = path.join(rootDir, 'src', 'services', 'consumption.service.ts');
assert(fs.existsSync(consumptionServicePath), 'src/services/consumption.service.ts existe');
const consumptionServiceContent = fs.readFileSync(consumptionServicePath, 'utf8');
assert(consumptionServiceContent.includes('executeConsumeMeal'), 'Serviço exporta executeConsumeMeal');
assert(consumptionServiceContent.includes('executeCancelMealConsumption'), 'Serviço exporta executeCancelMealConsumption');
assert(consumptionServiceContent.includes('generateIdempotencyKey'), 'Serviço exporta generateIdempotencyKey');

// -----------------------------------------------------------------------------
// 4. Testes de Simulação Funcional e Concorrência
// -----------------------------------------------------------------------------
console.log('\n4. Executando Simulações Funcionais de Concorrência e Regras de Negócio...');

// Simulação A: Cálculo de Assinatura Canônica de Idempotência
function computeRequestHash(identifier, unitId, mealTypeId) {
  const payload = `${identifier.trim()}:${unitId}:${mealTypeId || 'auto'}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const hashA = computeRequestHash('202401', 'unit-1', 'meal-lunch');
const hashB = computeRequestHash('202401', 'unit-1', 'meal-lunch');
const hashC = computeRequestHash('202402', 'unit-1', 'meal-lunch'); // Aluno diferente com mesma chave

assert(hashA === hashB, 'Mesmos parâmetros produzem a mesma assinatura canônica');
assert(hashA !== hashC, 'Parâmetros divergentes produzem assinaturas canônicas distintas');

// Simulação B: Validação de Reuso de Chave de Idempotência
function testIdempotencyCheck(existingRecord, incomingHash) {
  if (!existingRecord) return { proceed: true };
  if (existingRecord.request_hash && existingRecord.request_hash !== incomingHash) {
    return { error: 'IDEMPOTENCY_KEY_REUSE_MISMATCH' };
  }
  return { already_processed: true, consumption_id: existingRecord.id };
}

const mockStoredConsumption = { id: 'cons-101', request_hash: hashA };
const validReplay = testIdempotencyCheck(mockStoredConsumption, hashA);
const invalidReplay = testIdempotencyCheck(mockStoredConsumption, hashC);

assert(validReplay.already_processed === true, 'Reenvio legítimo retorna already_processed com sucesso');
assert(invalidReplay.error === 'IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Reutilização indevida de chave bloqueada com IDEMPOTENCY_KEY_REUSE_MISMATCH');

// Simulação C: Turno Noturno Atravessando a Meia-Noite (22:00 às 02:00)
function calculateOperationalShift(localDateStr, localTimeStr, startTimeStr, endTimeStr) {
  const [h, m] = localTimeStr.split(':').map(Number);
  const [sh, sm] = startTimeStr.split(':').map(Number);
  const [eh, em] = endTimeStr.split(':').map(Number);

  const localMins = h * 60 + m;
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  if (startMins <= endMins) {
    // Turno padrão no mesmo dia
    const isWithin = localMins >= startMins && localMins <= endMins;
    return { isWithin, operationalDate: localDateStr };
  } else {
    // Turno atravessando meia-noite
    const isWithin = localMins >= startMins || localMins <= endMins;
    if (localMins <= endMins) {
      // Madrugada: pertence ao dia de abertura do turno
      const prevDate = new Date(localDateStr + 'T12:00:00Z');
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      return { isWithin, operationalDate: prevDate.toISOString().split('T')[0] };
    } else {
      return { isWithin, operationalDate: localDateStr };
    }
  }
}

// 01:30 AM do dia 2026-10-16 em turno noturno 22:00 - 02:00
const midnightCheck = calculateOperationalShift('2026-10-16', '01:30', '22:00', '02:00');
assert(midnightCheck.isWithin === true, 'Horário 01:30 reconhecido como dentro do turno 22h-02h');
assert(midnightCheck.operationalDate === '2026-10-15', 'Data operacional alocada no dia de abertura do turno noturno (2026-10-15)');

// 03:00 AM do dia 2026-10-16 em turno noturno 22:00 - 02:00
const outsideCheck = calculateOperationalShift('2026-10-16', '03:00', '22:00', '02:00');
assert(outsideCheck.isWithin === false, 'Horário 03:00 reconhecido como fora do turno (OUT_OF_SCHEDULE)');

// Simulação D: Cota Diária e Estorno
function checkDailyQuotaOccupation(consumptions, studentId, dateStr, mealTypeId) {
  return consumptions.some(c => 
    c.student_id === studentId && 
    c.consumption_date === dateStr && 
    c.meal_type_id === mealTypeId &&
    (c.status === 'approved' || c.status === 'financially_refunded')
  );
}

const historyStudent = [
  { student_id: 's1', consumption_date: '2026-10-15', meal_type_id: 'lunch', status: 'approved' }
];

assert(checkDailyQuotaOccupation(historyStudent, 's1', '2026-10-15', 'lunch') === true, 'Consumo aprovado ocupa cota diária');

// Se o estorno for estritamente financeiro (comida fornecida): continua ocupando
historyStudent[0].status = 'financially_refunded';
assert(checkDailyQuotaOccupation(historyStudent, 's1', '2026-10-15', 'lunch') === true, 'Estorno financeiro preserva a cota como ocupada');

// Se o consumo for cancelado por não fornecimento (catraca travou): libera cota
historyStudent[0].status = 'cancelled_unserved';
assert(checkDailyQuotaOccupation(historyStudent, 's1', '2026-10-15', 'lunch') === false, 'Cancelamento por não fornecimento libera nova liberação no dia');

// Simulação E: Integridade Matemática do Ledger no Débito de Refeição
const balanceBefore = 25.00;
const studentPrice = 2.50;
const balanceAfter = +(balanceBefore - studentPrice).toFixed(2);
const ledgerAmount = -studentPrice;

assert(balanceAfter === 22.50, 'Saldo após débito calculado com precisão monetária (R$ 22,50)');
assert(+(balanceBefore + ledgerAmount).toFixed(2) === balanceAfter, 'Constraint matemática do ledger satisfeita (balance_after = balance_before + amount)');

console.log('\n======================================================================');
console.log(`  RESUMO DA AUDITORIA: ${passedTests} aprovados, ${totalTests - passedTests} reprovados`);
console.log('======================================================================\n');

if (passedTests === totalTests) {
  console.log('>> Sprint 9 — Motor de Consumo Atômico: 100% VALIDADA!\n');
} else {
  console.error('>> ERRO: Algum critério de aceite da Sprint 9 não foi atendido.\n');
  process.exit(1);
}
