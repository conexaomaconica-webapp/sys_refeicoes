/**
 * ==============================================================================
 * SPRINT 20.13 — VALIDAÇÃO UNITÁRIA E ESTRUTURAL: AJUSTES E REGULARIZAÇÕES
 * Executa testes unitários reais sobre o motor smart-gap-analyzer.ts (transpilado
 * em memória via TypeScript compiler) e verifica invariantes da Migration 84, UI,
 * rotas e integração de relatórios.
 * ==============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');
const ts = require('typescript');

console.log('================================================================================');
console.log('SPRINT 20.13: VALIDAÇÃO DO MOTOR INTELIGENTE, UI, ROTAS E MIGRATION 84');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadTsModule(relPath) {
  const fullPath = path.join(root, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled.outputText);
  fn(mod.exports, require, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

const analyzer = loadTsModule('src/lib/adjustments/smart-gap-analyzer.ts');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  [PASS] ${label}`);
}

check('1.1 - Motor exclui dias não operacionais (calendário/fins de semana) e categorias inelegíveis', () => {
  const res = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-10',
    mealTypeId: 'meal-lunch',
    unitMealEnabled: true,
    provenTotalMeals: 12,
    students: [
      {
        id: 'st-1',
        registration_number: '2026001',
        full_name: 'Ana Regular',
        category_id: 'cat-1',
        category_name: 'Parcial',
        status: 'active',
        created_at: '2026-09-01',
      },
      {
        id: 'st-expired',
        registration_number: '2026002',
        full_name: 'Bruno Expirado',
        category_id: 'cat-exp',
        category_name: 'Expirada',
        status: 'active',
        created_at: '2026-09-01',
      },
    ],
    rules: [
      { category_id: 'cat-1', enabled: true, effective_from: '2026-01-01', effective_to: null },
      { category_id: 'cat-exp', enabled: true, effective_from: '2026-01-01', effective_to: '2026-10-31' },
    ],
    calendarOverrides: [
      { unit_id: 'u1', calendar_date: '2026-11-02', is_operating: false, reason: 'Finados' },
    ],
    lookbackOperatingDates: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
    lookbackConsumptions: [
      { student_id: 'st-1', consumption_date: '2026-10-20', meal_type_id: 'meal-lunch' },
      { student_id: 'st-1', consumption_date: '2026-10-21', meal_type_id: 'meal-lunch' },
      { student_id: 'st-1', consumption_date: '2026-10-22', meal_type_id: 'meal-lunch' },
      { student_id: 'st-1', consumption_date: '2026-10-23', meal_type_id: 'meal-lunch' },
      { student_id: 'st-expired', consumption_date: '2026-10-20', meal_type_id: 'meal-lunch' },
      { student_id: 'st-expired', consumption_date: '2026-10-21', meal_type_id: 'meal-lunch' },
      { student_id: 'st-expired', consumption_date: '2026-10-22', meal_type_id: 'meal-lunch' },
    ],
    monthRegularConsumptions: [
      { student_id: 'st-1', consumption_date: '2026-11-03', meal_type_id: 'meal-lunch' },
    ],
    existingBatchItemsInMonth: [
      { student_id: 'st-1', service_date: '2026-11-04', meal_type_id: 'meal-lunch' },
    ],
    existingBatchMealsByDate: { '2026-11-04': 1 },
  });

  const opDates = res.days.map((d) => d.date);
  assert(!opDates.includes('2026-11-02'), 'Feriado marcado no calendário não deve aparecer nos dias operacionais');
  assert(!opDates.includes('2026-11-01') && !opDates.includes('2026-11-07') && !opDates.includes('2026-11-08'), 'Fins de semana sem atividade devem ficar fora');

  const day03 = res.days.find((d) => d.date === '2026-11-03');
  const day04 = res.days.find((d) => d.date === '2026-11-04');
  const day05 = res.days.find((d) => d.date === '2026-11-05');
  assert.strictEqual(day03.gap_candidates.length, 0, 'Consumo regular deve excluir lacuna');
  assert.strictEqual(day04.gap_candidates.length, 0, 'Item já existente em lote deve excluir lacuna');
  assert.strictEqual(day05.gap_candidates.length, 1, 'Apenas estudante elegível st-1 aparece como candidato');
  assert.strictEqual(day05.gap_candidates[0].student_id, 'st-1', 'Categoria expirada st-expired não deve aparecer');
});

check('1.2 - Sem evidência física por dia, todo saldo comprovado permanece como pendência mensal sem forçar alocação', () => {
  const res = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-10',
    mealTypeId: 'meal-lunch',
    unitMealEnabled: true,
    provenTotalMeals: 50,
    students: [
      { id: 'st-1', registration_number: '2026001', full_name: 'Ana', category_id: 'cat-1', category_name: 'Parcial', status: 'active' },
    ],
    rules: [{ category_id: 'cat-1', enabled: true, effective_from: '2026-01-01', effective_to: null }],
    calendarOverrides: [],
    lookbackOperatingDates: ['2026-10-20', '2026-10-21', '2026-10-22'],
    lookbackConsumptions: [
      { student_id: 'st-1', consumption_date: '2026-10-20', meal_type_id: 'meal-lunch' },
      { student_id: 'st-1', consumption_date: '2026-10-21', meal_type_id: 'meal-lunch' },
      { student_id: 'st-1', consumption_date: '2026-10-22', meal_type_id: 'meal-lunch' },
    ],
    monthRegularConsumptions: [],
    existingBatchItemsInMonth: [],
    existingBatchMealsByDate: {},
  });

  assert.strictEqual(res.recommended_allocated_total, 0, 'Sem contagem física diária, auto_allocatable deve ser 0');
  assert.strictEqual(res.unallocated_pending_meals, 50, 'Saldo integral sem base diária deve ficar em pendência mensal');
  assert.strictEqual(res.suggested_conference_total, 50, 'Sugestão indicativa soma exatamente 50 para conferência');
});

check('1.3 - Com evidência física diária e dia fechado, respeita divergência direta e restrição de fechamento', () => {
  const res = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-06',
    mealTypeId: 'meal-lunch',
    unitMealEnabled: true,
    provenTotalMeals: 20,
    students: [],
    rules: [],
    calendarOverrides: [],
    lookbackOperatingDates: ['2026-10-20'],
    lookbackConsumptions: [],
    monthRegularConsumptions: [],
    existingBatchItemsInMonth: [],
    existingBatchMealsByDate: {},
    dailyServedEvidence: {
      '2026-11-03': { physicalTotalServed: 10, sourceRef: 'Mapa Cozinha 03/11' },
      '2026-11-04': { physicalTotalServed: 6, sourceRef: 'Mapa Cozinha 04/11' },
      '2026-11-05': { physicalTotalServed: 4, sourceRef: 'Mapa Cozinha 05/11' },
    },
    closedDates: ['2026-11-03'],
    allowClosedDates: false,
  });

  const d03 = res.days.find((d) => d.date === '2026-11-03');
  assert.strictEqual(d03.is_closed_period, true);
  assert.strictEqual(d03.auto_allocatable_qty, 0, 'Dia fechado não recebe alocação automática quando allowClosedDates=false');
  assert.strictEqual(res.recommended_allocated_total, 10, 'Apenas 6 + 4 dos dias abertos são alocados automaticamente');
  assert.strictEqual(res.unallocated_pending_meals, 10, 'Diferença restante permanece como pendência');
});

check('1.4 - Migration 84 define trava cross-batch, calendário operacional, campanhas e relatórios segregados', () => {
  const mig84 = read('supabase/migrations/20261111000084_sprint20_smart_meal_adjustments.sql');
  assert(mig84.includes('enforce_contingency_item_uniqueness'), 'Trigger cross-batch obrigatória');
  assert(mig84.includes('DUPLICATE_CROSS_BATCH_ITEM'), 'Código de erro cross-batch obrigatório');
  assert(mig84.includes('unit_operating_calendar') && mig84.includes('upsert_unit_operating_calendar'));
  assert(mig84.includes('meal_adjustment_campaigns') && mig84.includes('submit_smart_adjustment_campaign'));
  assert(mig84.includes('review_smart_adjustment_campaign') && mig84.includes('SELF_APPROVAL_PROHIBITED'));
  assert(mig84.includes('FORCE ROW LEVEL SECURITY'));
  assert(mig84.includes('contingency_identified_meals') && mig84.includes('unallocated_pending_meals_total'));
  assert(!/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.(wallets|wallet_transactions)\b/i.test(mig84), 'Migration 84 nunca altera carteiras ou ledger');
});

check('1.5 - UI, rotas e relatórios integram /admin/ajustes-refeicoes preservando /admin/contingencia', () => {
  const shell = read('src/components/admin/AdminShell.tsx');
  const adminHome = read('src/app/admin/page.tsx');
  const ui = read('src/app/admin/ajustes-refeicoes/MealAdjustmentsManager.tsx');
  const repUi = read('src/components/admin/FinancialReportingDashboard.tsx');
  const repExcel = read('src/lib/reports/financial-excel.ts');

  assert(shell.includes('/admin/ajustes-refeicoes'));
  assert(adminHome.includes('/admin/ajustes-refeicoes') && adminHome.includes('/admin/contingencia'));
  assert(ui.includes('Modalidade 1: Retroativo por Data Específica'));
  assert(ui.includes('Modalidade 2: Ajuste Inteligente Mensal'));
  assert(ui.includes('Lacunas são indícios estatísticos, nunca prova de consumo'));
  assert(ui.includes('Calendário Operacional'));
  assert(repUi.includes('unallocated_pending_meals_total') && repExcel.includes('Pendências Mensais Sem Data Alocada'));
});

check('1.6 - Motor multi-categoria, resolução histórica na data e bloqueio cross-category de duplicidades', () => {
  const history = [
    {
      student_id: 'st-shift-cat',
      previous_category_id: 'cat-par',
      new_category_id: 'cat-int',
      effective_from: '2026-11-05',
      created_at: '2026-11-05T08:00:00Z',
    },
  ];
  const baseStudents = [
    {
      id: 'st-shift-cat',
      registration_number: 'RA9001',
      full_name: 'Carlos Migração',
      category_id: 'cat-int', // Categoria atual mudou em 05/11
      category_name: 'Integral',
      status: 'active',
      created_at: '2026-09-01',
    },
  ];
  const baseRules = [
    { category_id: 'cat-par', enabled: true, effective_from: '2026-01-01', effective_to: null },
    { category_id: 'cat-int', enabled: true, effective_from: '2026-01-01', effective_to: null },
  ];
  const lookbackDates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  const lookbackLunch = lookbackDates.map((d) => ({
    student_id: 'st-shift-cat',
    consumption_date: d,
    meal_type_id: 'meal-lunch',
  }));
  const lookbackDinner = lookbackDates.map((d) => ({
    student_id: 'st-shift-cat',
    consumption_date: d,
    meal_type_id: 'meal-dinner',
  }));

  // Análise de Almoço na categoria Parcial: deve aparecer em 03/11 e 04/11 (pré-mudança), mas ser excluído em 04/11 se tiver consumo regular em 03/11, e nunca aparecer em 05/11+
  const parLunch = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-06',
    mealTypeId: 'meal-lunch',
    categoryId: 'cat-par',
    categoryNamesById: { 'cat-par': 'Parcial', 'cat-int': 'Integral' },
    unitMealEnabled: true,
    provenTotalMeals: 5,
    students: baseStudents,
    categoryHistory: history,
    rules: baseRules,
    calendarOverrides: [],
    lookbackOperatingDates: lookbackDates,
    lookbackConsumptions: lookbackLunch,
    monthRegularConsumptions: [
      { student_id: 'st-shift-cat', consumption_date: '2026-11-03', meal_type_id: 'meal-lunch' },
    ],
    existingBatchItemsInMonth: [],
    existingBatchMealsByDate: {},
  });

  const par03 = parLunch.days.find((d) => d.date === '2026-11-03');
  const par04 = parLunch.days.find((d) => d.date === '2026-11-04');
  const par05 = parLunch.days.find((d) => d.date === '2026-11-05');
  assert.strictEqual(par03.gap_candidates.length, 0, 'Em 03/11 já consumiu almoço -> excluído como duplicidade');
  assert.strictEqual(parLunch.excluded_duplicates_count, 1, 'Deve contabilizar exatamente 1 duplicidade excluída');
  assert.strictEqual(par04.gap_candidates.length, 1, 'Em 04/11 categoria histórica ainda era Parcial');
  assert.strictEqual(par04.gap_candidates[0].category_id, 'cat-par');
  assert.strictEqual(par05.gap_candidates.length, 0, 'Em 05/11 já migrou para Integral -> não aparece em Parcial');

  // Análise de Jantar na categoria Integral em 05/11: mesmo turno/dia distinto (Jantar no dia com Almoço em lote ou normal) deve ser permitido
  const intDinner = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-06',
    mealTypeId: 'meal-dinner',
    categoryId: 'cat-int',
    categoryNamesById: { 'cat-par': 'Parcial', 'cat-int': 'Integral' },
    unitMealEnabled: true,
    provenTotalMeals: 5,
    students: baseStudents,
    categoryHistory: history,
    rules: baseRules,
    calendarOverrides: [],
    lookbackOperatingDates: lookbackDates,
    lookbackConsumptions: lookbackDinner,
    monthRegularConsumptions: [
      { student_id: 'st-shift-cat', consumption_date: '2026-11-05', meal_type_id: 'meal-lunch' },
    ],
    existingBatchItemsInMonth: [],
    existingBatchMealsByDate: {},
  });

  const din04 = intDinner.days.find((d) => d.date === '2026-11-04');
  const din05 = intDinner.days.find((d) => d.date === '2026-11-05');
  assert.strictEqual(din04.gap_candidates.length, 0, 'Em 04/11 ainda não era Integral');
  assert.strictEqual(din05.gap_candidates.length, 1, 'Em 05/11 é Integral e consumo de almoço não bloqueia jantar');
});

check('1.7 - Sprint 20.13.1: Turnos dinâmicos, categoria obrigatória, RPC retroativa multi-linha e UI multi-turno', () => {
  const mig84 = read('supabase/migrations/20261111000084_sprint20_smart_meal_adjustments.sql');
  const ui = read('src/app/admin/ajustes-refeicoes/MealAdjustmentsManager.tsx');

  for (const token of [
    'get_student_category_on_date',
    'submit_retroactive_date_distribution',
    'CATEGORY_REQUIRED',
    'CATEGORY_MISMATCH',
    'UNIT_MEAL_TYPE_DISABLED',
    'RULE_NOT_EFFECTIVE',
    'selected_meal_type_ids',
    'distribution_lines',
  ]) {
    assert(mig84.includes(token), `Migration 84 deve conter ${token}`);
  }

  assert(ui.includes('unitMealTypes') && ui.includes('mealRules'), 'UI deve carregar turnos e regras do banco dinamicamente');
  assert(!ui.includes('Sem categoria fixa') && !ui.includes('Sem categoria (apuração manual)'), 'Categoria obrigatória sem opção vazia genérica');
  assert(ui.includes('submitRetroactiveDateDistributionAction') && ui.includes('analyzeMonthlySmartMultiAction'));
  assert(ui.includes('Prévia Final Consolidada — Ajuste Inteligente Mensal'));
  assert(ui.includes('Alunos Elegíveis SEM CONSUMO') && ui.includes('eligible_students_summary'));
});

check('1.8 - Listagem nominal retorna alunos ativos da categoria sem consumo mesmo sem histórico prévio (e exclui quem já consumiu)', () => {
  const res = analyzer.analyzeMonthlyMealGaps({
    competenceMonth: '2026-11',
    todayDate: '2026-11-05',
    mealTypeId: 'meal-lunch',
    categoryId: 'cat-par',
    categoryNamesById: { 'cat-par': 'Parcial' },
    unitMealEnabled: true,
    provenTotalMeals: 4,
    students: [
      { id: 's-new', registration_number: 'RA2001', full_name: 'Maria Nova Sem Consumo', category_id: 'cat-par', category_name: 'Parcial', status: 'active' },
      { id: 's-ate', registration_number: 'RA2002', full_name: 'João Já Consumiu', category_id: 'cat-par', category_name: 'Parcial', status: 'active' },
    ],
    rules: [{ category_id: 'cat-par', enabled: true, effective_from: '2026-01-01', effective_to: null }],
    calendarOverrides: [],
    lookbackOperatingDates: ['2026-10-20'],
    lookbackConsumptions: [],
    monthRegularConsumptions: [
      { student_id: 's-ate', consumption_date: '2026-11-03', meal_type_id: 'meal-lunch' },
    ],
    existingBatchItemsInMonth: [],
    existingBatchMealsByDate: {},
  });

  const d03 = res.days.find((d) => d.date === '2026-11-03');
  assert.strictEqual(d03.eligible_non_consumers.length, 1, 'Apenas Maria deve constar em 03/11');
  assert.strictEqual(d03.eligible_non_consumers[0].student_id, 's-new');
  assert.strictEqual(d03.already_consumed_count, 1, 'João deve constar como já consumido/bloqueado');
  const joaoSummary = res.eligible_students_summary.find((s) => s.student_id === 's-ate');
  assert(joaoSummary && joaoSummary.consumed_dates.includes('2026-11-03') && !joaoSummary.available_dates.includes('2026-11-03'));
});

console.log(`\nSPRINT 20.13 VALIDATION CHECKS: ${passed}/8 PASS (0 failures)`);

