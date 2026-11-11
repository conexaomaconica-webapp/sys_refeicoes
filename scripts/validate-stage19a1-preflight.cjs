/**
 * ==============================================================================
 * STAGE 19A.1 — PREFLIGHT READ-ONLY LOCAL DOS GATES PARA O PILOTO
 * Execução estritamente offline/local:
 * - Zero conexões remotas com Supabase ou gateways.
 * - Zero exposição de segredos ou dados pessoais.
 * - Valida artefatos, scripts, restrições de rollback e prontidão booleana local.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

console.log('================================================================================');
console.log('STAGE 19A.1: PREFLIGHT READ-ONLY DE GATES DO PILOTO (OFFLINE)');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const exists = (f) => fs.existsSync(path.join(root, f));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  [PASS] ${label}`);
}

const requiredArtifacts = [
  'docs/STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md',
  'docs/STAGE_9E1B_LOGICAL_BACKUP.md',
  'docs/STAGE_9E2_PAYMENT_SANDBOX_PLAN.md',
  'docs/STAGE_9E2_PAYMENT_SANDBOX_EXECUTION.md',
  'docs/STAGE_9E4_HOSTED_ROLLBACK_RUNBOOK.md',
  'docs/STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md',
  'docs/SPRINT_17_SECURITY_FINANCIAL_AUDIT.md',
  'docs/SPRINT_17_1_TRANSACTIONAL_HOMOLOGATION.md',
  'docs/SPRINT_18_PERFORMANCE_STRESS_HOMOLOGATION.md',
  'docs/SPRINT_19A_PILOT_PREPARATION.md',
  'docs/STAGE_19A1_PILOT_GATES_EXECUTION_PLAN.md',
  'scripts/sql/stage19a1_migrations_79_82_readonly_checks.sql',
  'scripts/sql/sprint17_1_rollback_79_80_81.sql',
  'scripts/stage9e/preflight-payment-sandbox.cjs',
  'scripts/stage9e/validate-stage9e1b.cjs',
  'scripts/stage9e/validate-evidence.cjs',
];

check('1. Inventário completo de documentos, templates e scripts dos 6 gates existe', () => {
  for (const file of requiredArtifacts) {
    assert(exists(file), `Artefato obrigatório ausente: ${file}`);
  }
});

check('2. Cadeia de migrations 79–82 existe em supabase/migrations/', () => {
  const migrations = [
    'supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql',
    'supabase/migrations/20261109000080_create_financial_reconciliation.sql',
    'supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql',
    'supabase/migrations/20261110000082_sprint18_performance_indexes.sql',
  ];
  for (const m of migrations) {
    assert(exists(m), `Migration ausente: ${m}`);
  }
});

check('3. Script SQL de verificação pós-aplicação (79–82) é estritamente read-only', () => {
  const sql = read('scripts/sql/stage19a1_migrations_79_82_readonly_checks.sql');
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i.test(sql.replace(/--.*$/gm, '')), 'SQL read-only não pode conter DDL/DML');
});

check('4. Documento Stage 19A.1 preserva Sprint 19B e Produção em NO-GO', () => {
  const plan = read('docs/STAGE_19A1_PILOT_GATES_EXECUTION_PLAN.md');
  assert(plan.includes('NO-GO'), 'Documento deve registrar explicitamente NO-GO');
  assert(plan.includes('G1') && plan.includes('G6'), 'Documento deve cobrir matriz de gates G1 a G6');
});

check('5. Rollback SQL 79–81 preserva trava anti-perda ROLLBACK_BLOCKED_DATA_EXISTS', () => {
  const rb = read('scripts/sql/sprint17_1_rollback_79_80_81.sql');
  assert(rb.includes('ROLLBACK_BLOCKED_DATA_EXISTS'));
});

// Leitura booleana segura de .env.local (sem exibir nem vazar valores!)
let envFlags = { envLocalFound: false, asaasKey: false, mpToken: false, supabaseUrl: false };
const envLocalPath = path.join(root, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/);
  const hasNonEmpty = (key) => lines.some((l) => new RegExp(`^${key}=.+`).test(l.trim()) && !l.trim().startsWith('#'));
  envFlags = {
    envLocalFound: true,
    asaasKey: hasNonEmpty('ASAAS_API_KEY'),
    mpToken: hasNonEmpty('MERCADOPAGO_ACCESS_TOKEN'),
    supabaseUrl: hasNonEmpty('NEXT_PUBLIC_SUPABASE_URL'),
  };
}

let diskFreeGB = null;
try {
  const stat = fs.statfsSync('C:\\');
  diskFreeGB = Number(((stat.bavail * stat.bsize) / 1073741824).toFixed(2));
} catch {
  diskFreeGB = null;
}

console.log('\n--- TELEMETRIA BOOLEANA OFFLINE (SEM SEGREDOS E SEM REDE) ---');
console.log(`  Espaço livre C:\\          : ${diskFreeGB !== null ? `${diskFreeGB} GB` : 'indisponível'} (mínimo para 9E.1-C portátil: 1.60 GB)`);
console.log(`  .env.local presente       : ${envFlags.envLocalFound ? 'SIM' : 'NÃO'}`);
console.log(`  NEXT_PUBLIC_SUPABASE_URL  : ${envFlags.supabaseUrl ? 'CONFIGURADA (acesso remoto bloqueado na 19A.1)' : 'AUSENTE'}`);
console.log(`  ASAAS_API_KEY             : ${envFlags.asaasKey ? 'PRESENTE (validar prefixo sandbox em 9E.2)' : 'AUSENTE -> G3 Sandbox BLOQUEADO'}`);
console.log(`  MERCADOPAGO_ACCESS_TOKEN  : ${envFlags.mpToken ? 'PRESENTE' : 'AUSENTE -> MP Sandbox BLOQUEADO'}`);
console.log(`\nSTAGE 19A.1 PREFLIGHT CHECKS: ${passed}/5 PASS (0 chamadas remotas)`);

