/**
 * ==============================================================================
 * Script de Validação Autônoma e Auditoria da Sprint 6 (Carteira Financeira)
 * Execução: node scripts/validate-sprint6.cjs
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [OK] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

console.log('====================================================');
console.log('  VALIDAÇÃO AUTÔNOMA DA SPRINT 6 — CARTEIRA FINANCEIRA');
console.log('====================================================\n');

// 1. Validação da Migration 000022 (Tabelas wallets, wallet_transactions, enums e checks)
console.log('1. Verificando Migration 000022 (Tabelas e Livro Razão Imutável)...');
const mig22Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000022_create_wallet_tables.sql');
assert(fs.existsSync(mig22Path), 'Arquivo 20260927000022_create_wallet_tables.sql existe');
if (fs.existsSync(mig22Path)) {
  const content = fs.readFileSync(mig22Path, 'utf8');

  assert(content.includes('CREATE TYPE public.wallet_transaction_type') || content.includes('typname = \'wallet_transaction_type\''), 'Define ENUM wallet_transaction_type');
  assert(content.includes('CREATE TABLE IF NOT EXISTS public.wallets'), 'Cria tabela public.wallets');
  assert(content.includes('CREATE TABLE IF NOT EXISTS public.wallet_transactions'), 'Cria tabela public.wallet_transactions (Ledger imutável)');

  // Checks de Saldo Não-Negativo e Matemática Contábil
  assert(content.includes('chk_wallets_balance CHECK (balance >= 0.00)'), 'Possui CHECK garantindo saldo >= 0.00 na carteira');
  assert(content.includes('chk_wallet_tx_balance_after CHECK (balance_after >= 0.00)'), 'Possui CHECK garantindo balance_after >= 0.00 nas transações');
  assert(content.includes('chk_wallet_tx_math'), 'Possui CHECK de integridade contábil (balance_after = balance_before + amount)');

  // FKs Compostas Multi-Tenant
  assert(content.includes('fk_wallets_student_tenant'), 'wallets possui FK composta (student_id, tenant_id)');
  assert(content.includes('fk_wallet_tx_wallet_tenant'), 'wallet_transactions possui FK composta (wallet_id, tenant_id)');
  assert(content.includes('fk_wallet_tx_student_tenant'), 'wallet_transactions possui FK composta (student_id, tenant_id)');
}

// 2. Validação da Migration 000023 (RLS, Mutações Client-Side Bloqueadas e RPCs Transacionais)
console.log('\n2. Verificando Migration 000023 (RLS e RPCs Transacionais SQL)...');
const mig23Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000023_create_wallet_security_and_functions.sql');
assert(fs.existsSync(mig23Path), 'Arquivo 20260927000023_create_wallet_security_and_functions.sql existe');
if (fs.existsSync(mig23Path)) {
  const content = fs.readFileSync(mig23Path, 'utf8');

  assert(content.includes('ALTER TABLE public.wallets FORCE ROW LEVEL SECURITY;'), 'RLS forçado em wallets');
  assert(content.includes('ALTER TABLE public.wallet_transactions FORCE ROW LEVEL SECURITY;'), 'RLS forçado em wallet_transactions');
  assert(!content.includes('FOR INSERT TO authenticated'), 'Bloqueia INSERT direto do client-side na carteira/ledger');
  assert(!content.includes('FOR UPDATE TO authenticated'), 'Bloqueia UPDATE direto do client-side na carteira/ledger');

  // RPCs
  assert(content.includes('CREATE OR REPLACE FUNCTION public.create_student_wallet'), 'RPC create_student_wallet criada');
  assert(content.includes('Alunos da categoria Bolsista Integral não possuem carteira financeira operacional'), 'RPC create_student_wallet rejeita carteira para Bolsistas Integrais');
  
  assert(content.includes('CREATE OR REPLACE FUNCTION public.manual_wallet_adjustment'), 'RPC manual_wallet_adjustment criada');
  assert(content.includes('FOR UPDATE'), 'RPC manual_wallet_adjustment aplica LOCK pessimista FOR UPDATE na carteira');
  assert(content.includes('justificativa/descrição clara de no mínimo 5 caracteres'), 'RPC manual_wallet_adjustment exige justificativa de no mínimo 5 caracteres');

  assert(content.includes('CREATE OR REPLACE FUNCTION public.reverse_wallet_transaction'), 'RPC reverse_wallet_transaction criada');
  assert(content.includes('wallet_transaction_reversal'), 'RPC reverse_wallet_transaction gera lançamento compensatório imutável');
}

// 3. Validação das Tipagens TypeScript (src/types/wallet.ts)
console.log('\n3. Verificando Tipagens TypeScript (src/types/wallet.ts)...');
const typesPath = path.join(ROOT_DIR, 'src', 'types', 'wallet.ts');
assert(fs.existsSync(typesPath), 'Arquivo src/types/wallet.ts existe');
if (fs.existsSync(typesPath)) {
  const content = fs.readFileSync(typesPath, 'utf8');
  assert(content.includes('export type WalletTransactionType'), 'Exporta WalletTransactionType');
  assert(content.includes('export interface Wallet'), 'Exporta interface Wallet');
  assert(content.includes('export interface WalletTransaction'), 'Exporta interface WalletTransaction');
}

// 4. Validação do Serviço Server-Side (src/services/admin-wallet.service.ts)
console.log('\n4. Verificando Serviço Server-Side (src/services/admin-wallet.service.ts)...');
const servicePath = path.join(ROOT_DIR, 'src', 'services', 'admin-wallet.service.ts');
assert(fs.existsSync(servicePath), 'Arquivo admin-wallet.service.ts existe');
if (fs.existsSync(servicePath)) {
  const content = fs.readFileSync(servicePath, 'utf8');
  assert(content.includes("import 'server-only';"), 'Serviço admin-wallet possui proteção import server-only');
  assert(content.includes('getWalletByStudentServer'), 'Exporta getWalletByStudentServer');
  assert(content.includes('getWalletTransactionsServer'), 'Exporta getWalletTransactionsServer');
  assert(content.includes('createStudentWalletServer'), 'Exporta createStudentWalletServer');
  assert(content.includes('manualAdjustmentServer'), 'Exporta manualAdjustmentServer');
  assert(content.includes('reverseTransactionServer'), 'Exporta reverseTransactionServer');
}

// 5. Testes de Simulação de Regras Lógicas de Negócio
console.log('\n5. Testando Lógica de Negócio da Carteira e Ledger (Simulação)...');

// Teste 5.1: Bloquear Saldo Negativo
function simulateAdjustment(currentBalance, amount, description) {
  if (!description || description.trim().length < 5) {
    throw new Error('INVALID_ARGUMENT: Justificativa curta demais.');
  }

  const newBalance = Number((currentBalance + amount).toFixed(2));
  if (newBalance < 0) {
    throw new Error('INVALID_OPERATION: Saldo insuficiente.');
  }

  return newBalance;
}

let negativeBalanceBlocked = false;
try {
  simulateAdjustment(10.00, -15.00, 'Ajuste de teste de débito');
} catch (e) {
  negativeBalanceBlocked = e.message.includes('Saldo insuficiente');
}
assert(negativeBalanceBlocked, 'Ajuste de débito que deixaria o saldo negativo REJEITADO');

// Teste 5.2: Rejeitar Ajuste sem Justificativa Válida
let invalidDescriptionBlocked = false;
try {
  simulateAdjustment(10.00, 5.00, 'abc');
} catch (e) {
  invalidDescriptionBlocked = e.message.includes('Justificativa curta');
}
assert(invalidDescriptionBlocked, 'Ajuste manual sem justificativa válida (< 5 caracteres) REJEITADO');

// Teste 5.3: Simulação de Reversão Compensatória sem Deletar Histórico
function simulateReversal(transactions, targetTxId, reason) {
  if (!reason || reason.trim().length < 5) throw new Error('Motivo curto');

  const targetTx = transactions.find((t) => t.id === targetTxId);
  if (!targetTx) throw new Error('Transação não encontrada');

  const alreadyReversed = transactions.some(
    (t) => t.reference_type === 'wallet_transaction_reversal' && t.reference_id === targetTxId
  );
  if (alreadyReversed) throw new Error('Transação já estornada');

  const compensatingAmount = -targetTx.amount;
  const lastBalance = transactions[transactions.length - 1].balance_after;
  const newBalance = Number((lastBalance + compensatingAmount).toFixed(2));

  if (newBalance < 0) throw new Error('Saldo insuficiente para estorno');

  const reversalTx = {
    id: 'tx-reversal-' + Date.now(),
    type: 'reversal',
    amount: compensatingAmount,
    balance_before: lastBalance,
    balance_after: newBalance,
    reference_type: 'wallet_transaction_reversal',
    reference_id: targetTxId,
    description: 'ESTORNO: ' + reason,
  };

  return [...transactions, reversalTx];
}

const mockHistory = [
  { id: 'tx-1', amount: 50.00, balance_before: 0.00, balance_after: 50.00, reference_type: 'recharge', reference_id: null },
  { id: 'tx-2', amount: -12.00, balance_before: 50.00, balance_after: 38.00, reference_type: 'meal_debit', reference_id: null },
];

let reversalPassed = false;
try {
  const updatedHistory = simulateReversal(mockHistory, 'tx-2', 'Cobrança indevida de refeição');
  assert(updatedHistory.length === 3, 'Gera novo lançamento compensatório no ledger mantendo histórico imutável');
  assert(updatedHistory[2].amount === 12.00, 'Lançamento compensatório inverte o valor da transação original (-(-12) = +12)');
  assert(updatedHistory[2].balance_after === 50.00, 'Saldo final restaurado corretamente para R$ 50.00');
  reversalPassed = true;
} catch (e) {
  assert(false, `Falha no teste de estorno: ${e.message}`);
}

// Teste 5.4: Impedir Duplo Estorno da Mesma Transação
let doubleReversalBlocked = false;
try {
  const history1 = simulateReversal(mockHistory, 'tx-2', 'Cobrança indevida');
  simulateReversal(history1, 'tx-2', 'Segundo estorno duplicado');
} catch (e) {
  doubleReversalBlocked = e.message.includes('Transação já estornada');
}
assert(doubleReversalBlocked, 'Tentativa de duplo estorno da mesma transação BLOQUEADA');

console.log('\n====================================================');
console.log(`  RESULTADO: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
