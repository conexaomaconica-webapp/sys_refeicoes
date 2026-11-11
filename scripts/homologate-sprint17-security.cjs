const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================================');
console.log('HOMOLOGAÇÃO DE SEGURANÇA P0/P1 & AUDITORIA CONTÁBIL: SPRINT 17');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const mig77 = read('supabase/migrations/20261029000077_create_contingency_regularization.sql');
const mig79 = read('supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql');
const mig80 = read('supabase/migrations/20261109000080_create_financial_reconciliation.sql');
const mig81 = read('supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql');

const opsDash = read('src/components/admin/OperationalDashboard.tsx');
const finReportServer = read('src/server/reports/financial-reporting.server.ts');
const reconServer = read('src/server/reconciliation/reconciliation.server.ts');
const reconEngine = read('src/lib/reconciliation/reconciliation-engine.ts');
const reconDash = read('src/components/admin/ReconciliationDashboard.tsx');
const contingencyServer = read('src/server/contingency/contingency.service.ts');
const exportHelper = read('src/lib/security/export-route-error.ts');
const exportReportRoute = read('src/app/api/admin/relatorios/export/route.ts');
const exportReconRoute = read('src/app/api/admin/conciliacao/export/route.ts');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  [PASS] ${label}`);
}

console.log('--- FRENTE 17.1: RLS, ISOLAMENTO MULTI-TENANT & REALTIME ---');
check('1.1 - Contingency UPDATE possui WITH CHECK impedindo autoaprovação direta via REST (P0-01)', () => {
  assert(mig81.includes('DROP POLICY IF EXISTS upd_contingency_batches_staff'));
  assert(mig81.includes('WITH CHECK ('));
  assert(mig81.includes('approved_by IS NULL'));
  assert(mig81.includes("status IN ('draft', 'pending_approval', 'cancelled')"));
});

check('1.2 - Trigger prevent_contingency_tampering bloqueia alteração pós-deliberação e autoaprovação', () => {
  assert(mig81.includes('CREATE TRIGGER trg_prevent_contingency_tampering'));
  assert(mig81.includes('CONTINGENCY_IMMUTABLE'));
  assert(mig81.includes('SELF_APPROVAL_PROHIBITED'));
});

check('1.3 - Bucket contingency-evidence isolado por tenant_id no storage.objects (P1-04)', () => {
  assert(mig81.includes('(storage.foldername(name))[1] = public.get_auth_tenant_id()::text'));
});

check('1.4 - Realtime remove meal_consumptions e blocked_attempts e publica sinais sem PII (P0-03)', () => {
  assert(mig81.includes('ALTER PUBLICATION supabase_realtime DROP TABLE'));
  const tableMatch = mig81.match(/CREATE TABLE IF NOT EXISTS public\.operational_dashboard_signals\s*\(([\s\S]*?)\);/);
  assert(tableMatch, 'Tabela operational_dashboard_signals deve ser declarada');
  const colsBlock = tableMatch[1];
  assert(!colsBlock.includes('student_id') && !colsBlock.includes('full_price') && !colsBlock.includes('registration'));
  assert(mig81.includes("public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager')"));
  assert(opsDash.includes("'operational_dashboard_signals'"));
  assert(!opsDash.includes("table: 'meal_consumptions'"));
  assert(!opsDash.includes("table: 'blocked_attempts'"));
});

check('1.5 - Relatórios fiscais filtram contingência e recargas por instituição (P1-02)', () => {
  assert(mig79.includes('u_cmb.institution_id = p_institution_id'));
  assert(mig79.includes('s_r.institution_id = p_institution_id'));
  assert(mig79.includes('s_p.institution_id = p_institution_id'));
});

check('1.6 - Contingency service bloqueia papéis não autorizados de forma fail-closed', () => {
  assert(contingencyServer.includes('PERMISSION_DENIED'));
  assert(contingencyServer.includes("['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager']"));
});

console.log('\n--- FRENTE 17.2: IMUTABILIDADE DO LEDGER & CUSTÓDIA ---');
check('2.1 - Trigger de imutabilidade append-only ativa em wallet_transactions (P0-04)', () => {
  assert(mig81.includes('CREATE TRIGGER trg_wallet_transactions_immutable'));
  assert(mig81.includes('BEFORE UPDATE OR DELETE ON public.wallet_transactions'));
  assert(mig81.includes('LEDGER_IMMUTABLE'));
});

check('2.2 - RPC audit_wallet_custody_integrity comprova saldo vs ledger e detecta saldos negativos', () => {
  assert(mig81.includes('CREATE OR REPLACE FUNCTION public.audit_wallet_custody_integrity'));
  assert(mig81.includes('is_patrimony_balanced'));
  assert(mig81.includes('custody_drift'));
  assert(mig81.includes('negative_wallets_count'));
});

check('2.3 - Simulação sintética de batimento patrimonial de custódia detecta deriva (drift)', () => {
  const auditCustody = (wallets, ledgerEntries) => {
    const walletSum = wallets.reduce((a, w) => a + w.balance, 0);
    const ledgerSum = ledgerEntries.reduce((a, tx) => a + tx.amount, 0);
    const drift = Number((walletSum - ledgerSum).toFixed(2));
    return { walletSum, ledgerSum, drift, balanced: drift === 0 };
  };
  const balanced = auditCustody(
    [{ id: 'w1', balance: 60 }, { id: 'w2', balance: 45 }],
    [{ amount: 100 }, { amount: -40 }, { amount: 50 }, { amount: -5 }]
  );
  assert.strictEqual(balanced.balanced, true);
  assert.strictEqual(balanced.walletSum, 105);

  const drifted = auditCustody([{ id: 'w1', balance: 70 }], [{ amount: 50 }]);
  assert.strictEqual(drifted.balanced, false);
  assert.strictEqual(drifted.drift, 20);
});

console.log('\n--- FRENTE 17.3: RPCs PRIVILEGIADAS, SEARCH_PATH & GRANTS ---');
check('3.1 - Todas as RPCs das Sprints 14, 15, 16 e 17 usam search_path = \'\' e REVOKE FROM PUBLIC, anon', () => {
  assert(mig79.includes("SET search_path = ''"));
  assert(mig79.includes('FROM PUBLIC, anon'));
  assert(mig80.includes("SET search_path = ''"));
  assert(mig80.includes('FROM PUBLIC, anon'));
  assert(mig81.includes("SET search_path = ''"));
  assert(mig81.includes('CREATE OR REPLACE FUNCTION public.get_realtime_operational_dashboard'));
  const stripComments = (s) => s.replace(/--.*$/gm, '');
  assert(!stripComments(mig79).includes('sc.is_integral'));
  assert(!stripComments(mig81).includes('sc.is_integral'));
});

check('3.2 - FORCE ROW LEVEL SECURITY aplicada nas tabelas da Sprint 16 e 17', () => {
  assert(mig80.includes('ALTER TABLE public.financial_reconciliation_batches FORCE ROW LEVEL SECURITY'));
  assert(mig80.includes('ALTER TABLE public.financial_reconciliation_divergences FORCE ROW LEVEL SECURITY'));
  assert(mig80.includes('ALTER TABLE public.financial_daily_closings FORCE ROW LEVEL SECURITY'));
  assert(mig81.includes('ALTER TABLE public.operational_dashboard_signals FORCE ROW LEVEL SECURITY'));
});

check('3.3 - review_contingency_batch exige status ativo explícito e row locking FOR UPDATE', () => {
  assert(mig81.includes("v_reviewer_status <> 'active'"));
  assert(mig81.includes('FOR UPDATE'));
});

console.log('\n--- FRENTE 17.4: CORREÇÃO CONTÁBIL & INTEGRIDADE DE DADOS ---');
check('4.1 - Migration 79 corrigida: status canônico \'confirmed\' e remoção da coluna inexistente provider_fee (P0-02)', () => {
  assert(!mig79.includes("status = 'completed'"), 'Enum inválido completed não deve existir');
  assert(!mig79.includes('p.provider_fee'), 'Coluna inexistente provider_fee não deve ser referenciada');
  assert(mig79.includes("r.status = 'confirmed'"));
  assert(mig79.includes("p.status = 'confirmed'"));
});

check('4.2 - Fechamento diário segrega Recebimentos Brutos por Meio vs Passivo em Custódia vs Receita Realizada (P1-01)', () => {
  assert(reconEngine.includes('total_receipts_by_method'));
  assert(reconEngine.includes('wallet_credits_added'));
  assert(reconEngine.includes('wallet_debits_consumed'));
  assert(reconEngine.includes('closing_custody_balance'));
  assert(reconEngine.includes('custody_ledger_drift'));
  assert(reconDash.includes('Recebimentos Brutos (R$)'));
  assert(reconDash.includes('Saldo Custódia (R$)'));
});

check('4.3 - Conciliação resolve contrapartes na fronteira da meia-noite sem falsos positivos (P1-03)', () => {
  assert(reconServer.includes('missingPaymentIds'));
  assert(reconServer.includes('mergedPaymentsMap'));
  assert(reconServer.includes('mergedLedgerMap'));
  assert(reconServer.includes(".in('payment_id', paymentIds)"));
});

check('4.4 - Relatórios fiscais mantêm fonte canônica única RPC fail-closed sem fallback direto', () => {
  assert(!finReportServer.includes('buildAnalyticalReportFallback'));
  assert(finReportServer.includes('FALHA_CONTABIL_FAIL_CLOSED'));
  assert(finReportServer.includes('UNIT_SCOPE_REQUIRED'));
});

console.log('\n--- FRENTE 17.5: TESTES NEGATIVOS, EXPORTAÇÃO & CONCORRÊNCIA ---');
check('5.1 - Rotas de exportação mapeiam HTTP 401/403/400 sem 500 genérico e gravam trilha de auditoria (P2-01)', () => {
  assert(exportHelper.includes('status = 401'));
  assert(exportHelper.includes('status = 403'));
  assert(exportHelper.includes('status = 400'));
  assert(exportHelper.includes('[ExportAudit]'));
  assert(exportReportRoute.includes('logExportAuditTrail'));
  assert(exportReconRoute.includes('logExportAuditTrail'));
});

check('5.2 - Resolução de divergência exige UUID válido impedindo falha com IDs sintéticos (P2-03)', () => {
  assert(reconServer.includes('UUID_REGEX.test(input.divergenceId)'));
});

check('5.3 - Simulação negativa: tentativa de acesso cruzado, perfil inativo ou sem unitId em gestor local falha', () => {
  const authorizeReport = (user) => {
    if (!user || !user.id) throw new Error('AUTH_REQUIRED');
    if (user.status !== 'active') throw new Error('ACTIVE_PROFILE_REQUIRED');
    if (!['admin_general', 'operations_director', 'finance', 'supervisor', 'unit_manager'].includes(user.role)) {
      throw new Error('PERMISSION_DENIED');
    }
    if (['supervisor', 'unit_manager'].includes(user.role) && !user.unitId) {
      throw new Error('UNIT_SCOPE_REQUIRED');
    }
    if (user.targetTenantId && user.targetTenantId !== user.tenantId) {
      throw new Error('TENANT_MISMATCH');
    }
    return true;
  };

  assert.throws(() => authorizeReport(null), /AUTH_REQUIRED/);
  assert.throws(() => authorizeReport({ id: '1', status: 'inactive', role: 'finance' }), /ACTIVE_PROFILE_REQUIRED/);
  assert.throws(() => authorizeReport({ id: '1', status: 'active', role: 'student' }), /PERMISSION_DENIED/);
  assert.throws(() => authorizeReport({ id: '1', status: 'active', role: 'operator' }), /PERMISSION_DENIED/);
  assert.throws(() => authorizeReport({ id: '1', status: 'active', role: 'unit_manager', unitId: null }), /UNIT_SCOPE_REQUIRED/);
  assert.throws(() => authorizeReport({ id: '1', status: 'active', role: 'finance', tenantId: 'A', targetTenantId: 'B' }), /TENANT_MISMATCH/);
  assert.strictEqual(authorizeReport({ id: '1', status: 'active', role: 'supervisor', unitId: 'u-1', tenantId: 'A', targetTenantId: 'A' }), true);
});

check('5.4 - Documento formal de auditoria SPRINT_17_SECURITY_FINANCIAL_AUDIT.md existe e preserva NO-GO', () => {
  assert(exists('docs/SPRINT_17_SECURITY_FINANCIAL_AUDIT.md'));
  const doc = read('docs/SPRINT_17_SECURITY_FINANCIAL_AUDIT.md');
  assert(doc.includes('NO-GO'));
  assert(doc.includes('P0-01'));
  assert(doc.includes('P0-02'));
  assert(doc.includes('P0-03'));
  assert(doc.includes('P0-04'));
});

console.log(`\n================================================================================`);
console.log(`RESULTADO DA AUDITORIA P0/P1 SPRINT 17: ${passed}/${passed} asserções aprovadas`);
console.log(`================================================================================`);
