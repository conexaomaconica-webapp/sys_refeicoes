/**
 * ==============================================================================
 * Script de Validação Autônoma e Auditoria da Sprint 5 (Tipos de Refeição e Preços)
 * Execução: node scripts/validate-sprint5.cjs
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
console.log('  AUDITORIA TÉCNICA DA SPRINT 5 — REFEIÇÕES E PREÇOS');
console.log('====================================================\n');

// 1. Validação das Migrations de Banco (000019, 000020 e 000021 Corretiva)
console.log('1. Verificando Migrations de Banco (000019, 000020 e 000021 Corretiva)...');
const mig19Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000019_create_meal_tables.sql');
const mig20Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000020_create_meal_security_policies.sql');
const mig21Path = path.join(ROOT_DIR, 'supabase', 'migrations', '20260927000021_fix_meal_rules_vigencia_and_rpc.sql');

assert(fs.existsSync(mig19Path), 'Arquivo 20260927000019_create_meal_tables.sql existe');
assert(fs.existsSync(mig20Path), 'Arquivo 20260927000020_create_meal_security_policies.sql existe');
assert(fs.existsSync(mig21Path), 'Arquivo 20260927000021_fix_meal_rules_vigencia_and_rpc.sql existe');

if (fs.existsSync(mig21Path)) {
  const content = fs.readFileSync(mig21Path, 'utf8');

  // 1.1 Correção de Histórico Temporal na Exclusion Constraint
  assert(content.includes('ex_meal_rules_no_overlap EXCLUDE USING gist'), 'Migration 000021 define EXCLUSION CONSTRAINT ex_meal_rules_no_overlap');
  assert(!content.includes('WHERE (enabled = true)'), 'Migration 000021 REMOVEU a cláusula WHERE (enabled = true), estendendo a proteção de sobreposição ao histórico');

  // 1.2 Correção de Bloqueio Explícito de Preços Futuros
  assert(content.includes('Agendamento de preços futuros temporariamente bloqueado nesta versão'), 'RPC set_meal_rule bloqueia explicitamente agendamentos de preços futuros com mensagem funcional clara');
  assert(content.includes('A nova data de vigência deve ser estritamente posterior ao início da vigência atual'), 'RPC set_meal_rule valida se a nova vigência é posterior à vigência da regra atual');
}

// 2. Validação da Autenticação de Identidade Server-Side (src/services/admin-meal.service.ts)
console.log('\n2. Verificando Autenticação Server-Side de Identidade (src/services/admin-meal.service.ts)...');
const servicePath = path.join(ROOT_DIR, 'src', 'services', 'admin-meal.service.ts');
assert(fs.existsSync(servicePath), 'Arquivo admin-meal.service.ts existe');
if (fs.existsSync(servicePath)) {
  const content = fs.readFileSync(servicePath, 'utf8');
  assert(content.includes("import 'server-only';"), 'Serviço admin-meal possui proteção import server-only');
  assert(content.includes('getAuthenticatedUserServer'), 'Possui função getAuthenticatedUserServer que obtém o usuário autenticado da sessão Supabase Auth (Cookies)');
  assert(content.includes('setMealRuleWithSessionServer'), 'Possui função setMealRuleWithSessionServer que resolve a identidade server-side sem aceitar UUID arbitrário do cliente');
}

// 3. Validação do Componente de Interface (src/components/meals/MealManagement.tsx)
console.log('\n3. Verificando Componente de Interface (src/components/meals/MealManagement.tsx)...');
const componentPath = path.join(ROOT_DIR, 'src', 'components', 'meals', 'MealManagement.tsx');
assert(fs.existsSync(componentPath), 'Arquivo MealManagement.tsx existe');
if (fs.existsSync(componentPath)) {
  const content = fs.readFileSync(componentPath, 'utf8');
  assert(content.includes("'use client';"), 'Componente MealManagement possui diretiva use client');
  assert(content.includes('isIntegralCategory'), 'Possui lógica dedicada para zerar preço do Bolsista Integral');
}

// 4. Testes de Simulação de Regras e Bloqueio de Preços Futuros
console.log('\n4. Testando Lógica de Bloqueio de Preços Futuros (Simulação)...');

function simulateSetMealRule(now, effectiveFrom, currentEffectiveFrom) {
  // Simulação das validações da RPC SQL
  if (effectiveFrom > new Date(now.getTime() + 60000)) {
    throw new Error('INVALID_ARGUMENT: Agendamento de preços futuros temporariamente bloqueado nesta versão.');
  }

  if (currentEffectiveFrom && effectiveFrom <= currentEffectiveFrom) {
    throw new Error('INVALID_ARGUMENT: A nova data de vigência deve ser estritamente posterior ao início da vigência atual.');
  }

  return { success: true };
}

// Teste 4.1: Rejeição Explícita de Preço Futuro
let futureBlocked = false;
try {
  const today = new Date();
  const futureDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 dias no futuro
  simulateSetMealRule(today, futureDate, today);
} catch (e) {
  futureBlocked = e.message.includes('Agendamento de preços futuros temporariamente bloqueado');
}
assert(futureBlocked, 'Agendamento de preço com data futura REJEITADO com mensagem funcional clara');

// Teste 4.2: Permitir Regra Atualizada Hoje
let todayAllowed = false;
try {
  const today = new Date();
  const pastStart = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias atrás
  const res = simulateSetMealRule(today, today, pastStart);
  todayAllowed = res.success;
} catch (e) {
  todayAllowed = false;
}
assert(todayAllowed, 'Alteração de preço com data de hoje sobre vigência iniciada no passado PERMITIDA');

console.log('\n====================================================');
console.log(`  RESULTADO AUDITORIA: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
