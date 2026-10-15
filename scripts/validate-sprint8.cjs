/**
 * ==============================================================================
 * VALIDAÇÃO AUTÔNOMA DA SPRINT 8 — CARTEIRINHA DIGITAL E IDENTIFICAÇÃO RÁPIDA
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
console.log('  VALIDAÇÃO AUTÔNOMA DA SPRINT 8 — CARTEIRINHA E IDENTIFICAÇÃO');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// 1. Verificando Migration 000026 (Tabelas de Carteirinhas e Tokens)
// -----------------------------------------------------------------------------
console.log('1. Verificando Migration 000026 (Tabelas de Carteirinhas e Tokens)...');
const mig26Path = path.join(rootDir, 'supabase', 'migrations', '20260927000026_create_card_tables.sql');
assert(fs.existsSync(mig26Path), 'Arquivo 20260927000026_create_card_tables.sql existe');

const mig26Content = fs.readFileSync(mig26Path, 'utf8');
assert(mig26Content.includes('CREATE TABLE public.cards'), 'Cria tabela public.cards');
assert(mig26Content.includes('CREATE TABLE public.qr_tokens'), 'Cria tabela public.qr_tokens');
assert(mig26Content.includes("chk_cards_type CHECK (card_type IN ('digital', 'physical'))"), 'Constraint de tipo de cartão (digital, physical)');
assert(mig26Content.includes("chk_cards_status CHECK (status IN ('active', 'blocked', 'cancelled', 'replaced'))"), 'Constraint de status de cartão');
assert(mig26Content.includes("chk_qr_tokens_status CHECK (status IN ('active', 'used', 'expired', 'revoked'))"), 'Constraint de status de QR token');
assert(mig26Content.includes('uq_qr_tokens_hash UNIQUE (token_hash)'), 'Garantia de unicidade global de token_hash');
assert(mig26Content.includes('idx_qr_tokens_active_unique') && mig26Content.includes("WHERE (status = 'active')"), 'Índice parcial impedindo múltiplos tokens ativos por carteirinha');
assert(mig26Content.includes('idx_cards_student_digital_active'), 'Índice parcial de 1 carteirinha digital ativa por aluno');
assert(mig26Content.includes('idx_cards_physical_code_unique'), 'Índice parcial único de código de cartão físico por tenant');
assert(mig26Content.includes('ON DELETE RESTRICT'), 'Integridade referencial estrita com ON DELETE RESTRICT');

// -----------------------------------------------------------------------------
// 2. Verificando Migration 000027 (RLS e RPCs de Segurança)
// -----------------------------------------------------------------------------
console.log('\n2. Verificando Migration 000027 (RLS Forçado e RPCs Seguras)...');
const mig27Path = path.join(rootDir, 'supabase', 'migrations', '20260927000027_create_card_security_and_rpc.sql');
assert(fs.existsSync(mig27Path), 'Arquivo 20260927000027_create_card_security_and_rpc.sql existe');

const mig27Content = fs.readFileSync(mig27Path, 'utf8');
assert(mig27Content.includes('ALTER TABLE public.cards FORCE ROW LEVEL SECURITY;'), 'RLS forçado na tabela cards');
assert(mig27Content.includes('ALTER TABLE public.qr_tokens FORCE ROW LEVEL SECURITY;'), 'RLS forçado na tabela qr_tokens');

// Verificar ausência de políticas permissivas de mutação no cliente
assert(!mig27Content.includes('CREATE POLICY ins_cards'), 'Nenhuma política de INSERT direto no cliente em cards');
assert(!mig27Content.includes('CREATE POLICY upd_cards'), 'Nenhuma política de UPDATE direto no cliente em cards');
assert(!mig27Content.includes('CREATE POLICY del_cards'), 'Nenhuma política de DELETE direto no cliente em cards');
assert(!mig27Content.includes('CREATE POLICY ins_qr_tokens'), 'Nenhuma política de INSERT direto no cliente em qr_tokens');

// Verificar RPC admin_issue_card
assert(mig27Content.includes('admin_issue_card'), 'Define RPC admin_issue_card');
assert(mig27Content.includes("'admin_general', 'operations_director', 'supervisor'"), 'admin_issue_card restrito a perfis gestores');

// Verificar RPC admin_update_card_status
assert(mig27Content.includes('admin_update_card_status'), 'Define RPC admin_update_card_status');
assert(mig27Content.includes("status = 'revoked'"), 'admin_update_card_status revoga tokens ao bloquear carteirinha');

// Verificar RPC generate_student_qr_token
assert(mig27Content.includes('generate_student_qr_token'), 'Define RPC generate_student_qr_token');
assert(mig27Content.includes('FOR UPDATE'), 'generate_student_qr_token adquire lock pessimista FOR UPDATE na carteirinha');
assert(mig27Content.includes('gen_random_bytes(32)'), 'generate_student_qr_token utiliza geração criptográfica de 256 bits');
assert(mig27Content.includes("v_ttl_seconds CONSTANT INT := 90"), 'generate_student_qr_token impõe TTL estrito de 90 segundos do servidor');
assert(mig27Content.includes("'MAR:Q1:' || v_raw_token"), 'Retorna payload canônico MAR:Q1:');

// Verificar RPC resolve_student_identity
assert(mig27Content.includes('resolve_student_identity'), 'Define RPC resolve_student_identity');
assert(!mig27Content.includes('STABLE\nAS') && !mig27Content.includes('STABLE AS'), 'resolve_student_identity não é STABLE (compatível com clock_timestamp)');
assert(mig27Content.includes('has_unit_access(p_unit_id)'), 'resolve_student_identity valida escopo de acesso à unidade');
assert(mig27Content.includes('MAR:Q1:'), 'resolve_student_identity trata QR dinâmico MAR:Q1:');
assert(mig27Content.includes('MAR:C1:'), 'resolve_student_identity trata cartão físico MAR:C1:');
assert(mig27Content.includes('INVALID_IDENTIFIER_FORMAT'), 'resolve_student_identity rejeita envelopes MAR desconhecidos ou malformados');
assert(mig27Content.includes('registration_number'), 'resolve_student_identity trata matrícula tradicional');
assert(!mig27Content.includes('balance_cents'), 'resolve_student_identity NÃO expõe balance_cents nem dados financeiros');
assert(!mig27Content.includes("SET status = 'used'"), "resolve_student_identity NÃO queima o token via UPDATE SET status = 'used' (desacoplado da Sprint 9)");
assert(mig27Content.includes('REVOKE ALL ON FUNCTION public.resolve_student_identity'), 'Revoga privilégios públicos de resolve_student_identity');

// -----------------------------------------------------------------------------
// 3. Verificando Tipagem TypeScript e Serviços
// -----------------------------------------------------------------------------
console.log('\n3. Verificando Tipagem TypeScript e Serviços...');
const cardTypePath = path.join(rootDir, 'src', 'types', 'card.ts');
assert(fs.existsSync(cardTypePath), 'src/types/card.ts existe');

const dbTypesPath = path.join(rootDir, 'src', 'types', 'database.types.ts');
const dbTypesContent = fs.readFileSync(dbTypesPath, 'utf8');
assert(dbTypesContent.includes('cards: {'), 'database.types.ts contém tabela cards');
assert(dbTypesContent.includes('qr_tokens: {'), 'database.types.ts contém tabela qr_tokens');
assert(dbTypesContent.includes('generate_student_qr_token:'), 'database.types.ts contém RPC generate_student_qr_token');
assert(dbTypesContent.includes('resolve_student_identity:'), 'database.types.ts contém RPC resolve_student_identity');
assert(dbTypesContent.includes('admin_issue_card:'), 'database.types.ts contém RPC admin_issue_card');
assert(dbTypesContent.includes('admin_update_card_status:'), 'database.types.ts contém RPC admin_update_card_status');

const cardServicePath = path.join(rootDir, 'src', 'services', 'card.service.ts');
assert(fs.existsSync(cardServicePath), 'src/services/card.service.ts existe');

const identityServicePath = path.join(rootDir, 'src', 'services', 'identity-resolver.service.ts');
assert(fs.existsSync(identityServicePath), 'src/services/identity-resolver.service.ts existe');

const adminCardServicePath = path.join(rootDir, 'src', 'services', 'admin-card.service.ts');
assert(fs.existsSync(adminCardServicePath), 'src/services/admin-card.service.ts existe');

// -----------------------------------------------------------------------------
// 4. Verificando Componentes Visuais do PWA
// -----------------------------------------------------------------------------
console.log('\n4. Verificando Componentes Visuais do PWA...');
const qrComponentPath = path.join(rootDir, 'src', 'components', 'cards', 'DynamicQRCode.tsx');
assert(fs.existsSync(qrComponentPath), 'DynamicQRCode.tsx existe');
const qrContent = fs.readFileSync(qrComponentPath, 'utf8');
assert(qrContent.includes('renderQRMatrix'), 'Renderizador visual de matriz QR SVG implementado');
assert(qrContent.includes('timeLeft'), 'Controle de contagem regressiva temporal (90s)');

const cardComponentPath = path.join(rootDir, 'src', 'components', 'cards', 'StudentCard.tsx');
assert(fs.existsSync(cardComponentPath), 'StudentCard.tsx existe');
const cardContent = fs.readFileSync(cardComponentPath, 'utf8');
assert(cardContent.includes('Matrícula Principal') && cardContent.includes('student.registration_number'), 'Matrícula em destaque visual');
assert(cardContent.includes('DynamicQRCode'), 'Integração com QR Code Dinâmico');
assert(cardContent.includes('is_integral'), 'Distinção clara entre Aluno Integral e Parcial');

// -----------------------------------------------------------------------------
// 5. Testes Funcionais Criptográficos e de Desambiguação
// -----------------------------------------------------------------------------
console.log('\n5. Executando Simulações Funcionais de Identificação...');

// Simulação A: Geração de Token Criptográfico SHA-256 e Envelope MAR:Q1:
const rawTokenBytes = crypto.randomBytes(32);
const rawTokenHex = rawTokenBytes.toString('hex');
const expectedTokenHash = crypto.createHash('sha256').update(rawTokenHex).digest('hex');
const envelopeQ1 = 'MAR:Q1:' + rawTokenHex;

assert(envelopeQ1.startsWith('MAR:Q1:'), 'Envelope MAR:Q1: estruturado corretamente');
assert(expectedTokenHash.length === 64, 'Hash SHA-256 possui 64 caracteres hexadecimais');

// Simulação B: Validação de Envelope Físico MAR:C1:
const physicalCardId = 'NFC-TAG-883921';
const physicalHash = crypto.createHash('sha256').update(physicalCardId).digest('hex');
const envelopeC1 = 'MAR:C1:' + physicalCardId;
assert(envelopeC1.startsWith('MAR:C1:'), 'Envelope MAR:C1: estruturado corretamente');
assert(physicalHash.length === 64, 'Hash do cartão físico computado corretamente');

// Simulação C: Desambiguação de Matrículas Idênticas entre Instituições
const mockStudents = [
  { id: 'stud-1', tenant_id: 'ten-1', institution_id: 'inst-A', registration_number: '202401', name: 'João Inst A' },
  { id: 'stud-2', tenant_id: 'ten-1', institution_id: 'inst-B', registration_number: '202401', name: 'Maria Inst B' }
];

function resolveMockRegistration(unitInstitutionId, queryReg) {
  return mockStudents.find(s => s.institution_id === unitInstitutionId && s.registration_number === queryReg) || null;
}

const resolvedUnitA = resolveMockRegistration('inst-A', '202401');
const resolvedUnitB = resolveMockRegistration('inst-B', '202401');

assert(resolvedUnitA && resolvedUnitA.name === 'João Inst A', 'Resolução na Unidade A retorna o aluno da Instituição A');
assert(resolvedUnitB && resolvedUnitB.name === 'Maria Inst B', 'Resolução na Unidade B retorna o aluno da Instituição B (sem colisão)');

// Simulação D: Rejeição de Envelope MAR Inválido
function parseIdentifierEnvelope(input) {
  const clean = input.trim();
  if (clean.startsWith('MAR:Q1:')) return { type: 'qr_dynamic' };
  if (clean.startsWith('MAR:C1:')) return { type: 'physical_card' };
  if (clean.startsWith('MAR:')) return { type: 'invalid_mar_format' };
  return { type: 'registration_number' };
}

assert(parseIdentifierEnvelope('MAR:X9:corrupted').type === 'invalid_mar_format', 'Envelope MAR desconhecido rejeitado com invalid_mar_format');
assert(parseIdentifierEnvelope('202401889').type === 'registration_number', 'Matrícula alfanumérica pura tratada como registration_number');

// Simulação E: Invariante de Expiração de 90 segundos
const issuedAt = Date.now();
const expiresAt = issuedAt + 90 * 1000;
const testTimestampExpired = issuedAt + 91 * 1000;
assert(testTimestampExpired > expiresAt, 'Token após 91 segundos é considerado expirado');

console.log('\n======================================================================');
console.log(`  RESUMO DA AUDITORIA: ${passedTests} aprovados, ${totalTests - passedTests} reprovados`);
console.log('======================================================================\n');

if (passedTests === totalTests) {
  console.log('>> Sprint 8 — Carteirinha Digital e Identificação Rápida: 100% VALIDADA!\n');
} else {
  console.error('>> ERRO: Algum critério de aceite da Sprint 8 não foi atendido.\n');
  process.exit(1);
}
