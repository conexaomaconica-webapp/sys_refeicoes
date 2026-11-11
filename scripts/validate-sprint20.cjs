/**
 * ==============================================================================
 * SPRINT 20 — VALIDAÇÃO FUNCIONAL INTEGRADA, UI, SEGURANÇA E ACABAMENTO
 * Verifica todas as correções P0/P1 implementadas na Sprint 20 e ausência de
 * mojibake UTF-8 em todo src/. Não acessa Supabase remoto nem aplica migrations.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

console.log('================================================================================');
console.log('SPRINT 20: VALIDAÇÃO FUNCIONAL, INTEGRAÇÃO E ACABAMENTO (LOCAL)');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  [PASS] ${label}`);
}

function walkTs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

check('20.1 - Upload de evidência de contingência usa prefixo tenant_id compatível com RLS Storage (P0-01)', () => {
  const src = read('src/app/admin/contingencia/actions.ts');
  assert(src.includes('profile.tenant_id'), 'Action deve resolver tenant_id do perfil autenticado');
  assert(src.includes('${profile.tenant_id}/batches/${filename}'), 'Path de upload deve iniciar com tenant_id');
  assert(!src.includes("filePath = `batches/${filename}`"), 'Path legado sem tenant_id deve ter sido removido');
});

check('20.2 - Auditoria histórica /admin/caixa consulta movimentações por cash_shift_id específico (P0-02)', () => {
  const svc = read('src/services/cash-shift.service.ts');
  const page = read('src/app/admin/caixa/page.tsx');
  assert(svc.includes('async getShiftMovements(cashShiftId: string)'), 'Serviço deve expor getShiftMovements');
  assert(svc.includes(".eq('cash_shift_id', cashShiftId)"), 'Query deve filtrar por cash_shift_id');
  assert(page.includes('cashShiftService.getShiftMovements(shift.id)'), 'Página deve usar shift.id em handleOpenDetails');
});

check('20.3 - Conciliação lê financial_reconciliation_batches real e remove alert() bloqueante (P0-03)', () => {
  const srv = read('src/server/reconciliation/reconciliation.server.ts');
  const ui = read('src/components/admin/ReconciliationDashboard.tsx');
  assert(srv.includes("'financial_reconciliation_batches'"), 'Server deve consultar lote persistido real');
  assert(!srv.includes("id: 'batch-live-audit'"), 'ID sintético batch-live-audit deve ter sido substituído');
  assert(!/\balert\s*\(/.test(ui), 'ReconciliationDashboard não deve usar alert() nativo do navegador');
  assert(ui.includes('resolutionError'), 'Modal deve exibir erro inline de resolução');
});

check('20.4 - Terminal PDV corrige furto de foco keepFocus, fullscreenchange, timeout lock e QR cross-tenant (P0-04)', () => {
  const term = read('src/components/terminal/ReceptionTerminal.tsx');
  assert(term.includes('!showReportsModal'), 'keepFocus não pode roubar foco com F7 aberto');
  assert(term.includes('!showDiagnostics') && term.includes('!showCalculator'), 'keepFocus deve respeitar modais auxiliares');
  assert(term.includes("'fullscreenchange'"), 'Tela cheia deve sincronizar evento fullscreenchange');
  assert(term.includes('resolveUnknownTimeout('), 'Operador deve poder desbloquear timeout após conferência F7');
  assert(!term.includes('RA900001') && !term.includes('VISITANTE01'), 'Atalhos mock de RAs devem ter sido removidos');
  assert(!term.includes('OFFLINE_CONTINGENCY_LOGGED'), 'Estado morto OFFLINE_CONTINGENCY_LOGGED deve ter sido removido');

  const act = read('src/app/terminal/actions.ts');
  assert(act.includes('QR_TENANT_MISMATCH'), 'QR de outro tenant deve lançar erro explícito');
});

check('20.5 - Inicialização do Terminal sem UUIDs Sprint 1, suporte multi-unidade e preço real meal_rules (P0-05)', () => {
  const page = read('src/app/terminal/page.tsx');
  assert(!page.includes('e1000000-0000-0000-0000-000000000001'), 'UUID mock Sprint 1 removido');
  assert(!page.includes('operador@marefeicoes.com'), 'Atalho de credencial mock removido');
  assert(page.includes('unitOptions') && page.includes('handleUnitChange'), 'Seletor multi-unidade ativo');
  assert(page.includes(".from('meal_rules')"), 'Preço obtido de meal_rules no banco');
});

check('20.6 - Exportação CSV de ShiftReportsModal usa UTF-8 BOM e sanitizeCellForExport (P0-06)', () => {
  const modal = read('src/components/terminal/ShiftReportsModal.tsx');
  assert(modal.includes('\\uFEFF'), 'BOM UTF-8 obrigatório para Excel Windows');
  assert(modal.includes('sanitizeCellForExport'), 'Sanitização contra CSV Formula Injection ativa');
});

check('20.7 - Home / limpa de debug Sprint 1 e Hub /admin completo com Contingência e Integrações (P1-01)', () => {
  const home = read('src/app/page.tsx');
  const adminHome = read('src/app/admin/page.tsx');
  assert(!home.includes('Auditoria Sprint 1'), 'Botão/modal debug removido da página raiz');
  assert(adminHome.includes('/admin/contingencia') && adminHome.includes('/admin/integracoes'), 'Cards ausentes incluídos em /admin');
  assert(!adminHome.includes('Próximas funcionalidades'), 'Seção vazia removida de /admin');
});

check('20.8 - Portal do Comensal e Contas: imutabilidade, clipboard, cartão honesto, nav mobile e loading (P1-02)', () => {
  const dash = read('src/components/consumer/ConsumerDashboard.tsx');
  const fa = read('src/app/conta/primeiro-acesso/FirstAccessForm.tsx');
  const rec = read('src/app/conta/esqueci-senha/RecoveryRequestForm.tsx');
  const rst = read('src/app/conta/redefinir-senha/ResetPasswordForm.tsx');

  assert(!dash.includes('initialData.student.photoPath ='), 'Mutação direta de prop removida');
  assert(dash.includes('pixCopied') && dash.includes('Código Pix copiado!'), 'Feedback de cópia Pix implementado');
  assert(dash.includes("rechargeMethod === 'credit_card'"), 'Aviso explícito para cartão sem tokenização externa');
  assert(dash.includes('Navegação rápida mobile'), 'Barra de navegação inferior mobile PWA presente');
  assert(fa.includes('loadingInstitutions'), 'Loading explícito em Primeiro Acesso');
  assert(rec.includes('setError(') && rec.includes('useBrand'), 'Feedback de erro e branding em Esqueci Senha');
  assert(rst.includes('EyeOff') && rst.includes('useBrand'), 'Alternador de visibilidade e branding em Redefinir Senha');
});

check('20.9 - Zero strings UTF-8 corrompidas (mojibake) em todo o diretório src/', () => {
  const badHits = [];
  for (const file of walkTs(path.join(root, 'src'))) {
    const content = fs.readFileSync(file, 'utf8');
    if (/Ã[£¡ª­³¢º©]|Â[^\w]|ï¿½|\uFFFD/.test(content)) {
      badHits.push(path.relative(root, file));
    }
  }
  assert.strictEqual(badHits.length, 0, `Mojibake detectado em: ${badHits.join(', ')}`);
});

check('20.10 - Fechamento diário persistido, concorrente e imutável sem mutações retroativas no ledger (P2-02)', () => {
  const mig83 = read('supabase/migrations/20261110000083_sprint20_daily_closing_persistence.sql');
  const srv = read('src/server/reconciliation/reconciliation.server.ts');
  const act = read('src/app/admin/conciliacao/actions.ts');
  const ui = read('src/components/admin/ReconciliationDashboard.tsx');

  assert(mig83.includes('uq_daily_closing_tenant_date_consolidated'), 'Índice único consolidado obrigatório');
  assert(mig83.includes('close_financial_daily_period'), 'RPC close_financial_daily_period obrigatória');
  assert(mig83.includes('pg_advisory_xact_lock'), 'Serialização concorrente obrigatória');
  assert(mig83.includes('IMMUTABLE_DAILY_CLOSING'), 'Trigger de imutabilidade obrigatório');
  assert(mig83.includes('SECURITY DEFINER') && mig83.includes("SET search_path = ''"), 'RPC deve ser SECURITY DEFINER com search_path vazio');
  assert(mig83.includes('REVOKE ALL ON FUNCTION public.close_financial_daily_period(UUID, DATE, UUID, TEXT) FROM PUBLIC, anon'));
  assert(mig83.includes('DAILY_CLOSING_ALREADY_EXISTS'), 'Trava idempotente obrigatória');
  assert(!/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.(wallets|wallet_transactions)\b/i.test(mig83), 'Fechamento não pode alterar o ledger');

  assert(srv.includes("'financial_daily_closings'"), 'Servidor deve consultar fechamentos persistidos');
  assert(srv.includes('closeFinancialDailyPeriodServer'), 'Servidor deve expor closeFinancialDailyPeriodServer');
  assert(act.includes('closeDailyFinancialPeriodAction'), 'Server action de fechamento diário obrigatória');
  assert(ui.includes('Fechar Dia / Persistir Fechamento') && ui.includes('Fechamento Persistido'));
  assert((ui.match(/overflow-x-auto/g) || []).length >= 2, 'Tabelas de divergências e fechamento devem suportar scroll horizontal responsivo');
});

check('20.11 - Saneamento do offline legado para política online-first fail-closed (P2-03)', () => {
  const syncSvc = read('src/services/offline-sync.service.ts');
  const snapSvc = read('src/services/terminal-snapshot.service.ts');
  const cashSvc = read('src/services/cash-shift.service.ts');

  assert(syncSvc.includes('ONLINE_FIRST_POLICY_ACTIVE') && !syncSvc.includes(".rpc('reconcile_offline_consumptions'"));
  assert(snapSvc.includes('ONLINE_FIRST_POLICY_ACTIVE') && !snapSvc.includes(".rpc('get_terminal_shift_snapshot'"));
  assert(!cashSvc.includes('async registerVisitor(') && !cashSvc.includes('register_operator_visitor_entry'));
});

check('20.12 - Fundo inicial de caixa sem valor hardcoded de R$ 100,00 na abertura (P3-01)', () => {
  const cashModal = read('src/components/terminal/CashShiftModal.tsx');
  assert(!cashModal.includes("useState<string>('100.00')"), 'Hardcode 100.00 no estado inicial deve estar removido');
  assert(cashModal.includes("setOpenInitialFloat('')"), 'Modal deve limpar o troco inicial ao abrir sem turno ativo');
});

console.log(`\nSPRINT 20 VALIDATION CHECKS: ${passed}/12 PASS (0 failures)`);
