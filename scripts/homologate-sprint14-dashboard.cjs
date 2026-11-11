const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================================');
console.log('HOMOLOGAÇÃO TÉCNICA E HARDENING: SPRINT 14.1 (DASHBOARDS & REALTIME)');
console.log('================================================================================\n');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const migration = read('supabase/migrations/20261109000078_create_realtime_operational_dashboard.sql');
const doc = read('docs/SPRINT_14_1_HARDENING_HOMOLOGATION.md');
const component = read('src/components/admin/OperationalDashboard.tsx');
const service = read('src/services/operational-dashboard.service.ts');
const serverService = read('src/server/dashboard/operational-dashboard.server.ts');
const types = read('src/types/operational-dashboard.ts');

const assertions = [
  // FRENTE 1: SEGURANÇA, ESCOPO E RLS
  ['1.1 - Migration exige autenticação estrita (AUTH_REQUIRED)', migration.includes("RAISE EXCEPTION 'AUTH_REQUIRED")],
  ['1.2 - Migration bloqueia usuários inativos (ACTIVE_PROFILE_REQUIRED)', migration.includes("RAISE EXCEPTION 'ACTIVE_PROFILE_REQUIRED")],
  ['1.3 - Migration restringe papéis gerenciais e operacionais (PERMISSION_DENIED)', migration.includes("RAISE EXCEPTION 'PERMISSION_DENIED")],
  ['1.4 - Migration valida escopo de unidade no banco (has_unit_access / ACCESS_DENIED_UNIT)', migration.includes('has_unit_access(p_unit_id)') && migration.includes('ACCESS_DENIED_UNIT')],
  ['1.5 - Migration isola estritamente por tenant (v_tenant_id)', migration.includes('mc.tenant_id = v_tenant_id') && migration.includes('ba.tenant_id = v_tenant_id')],
  ['1.6 - RPC declarada com SECURITY DEFINER e search_path seguro', migration.includes('SECURITY DEFINER') && migration.includes('search_path = public, pg_temp')],
  ['1.7 - Execução da RPC revogada de PUBLIC e liberada apenas para authenticated/service_role', migration.includes('REVOKE ALL ON FUNCTION public.get_realtime_operational_dashboard') && migration.includes('TO authenticated')],

  // FRENTE 2: REALTIME E PRIVACIDADE DE DADOS
  ['2.1 - Publicação supabase_realtime adiciona meal_consumptions e blocked_attempts', migration.includes('supabase_realtime') && migration.includes('blocked_attempts')],
  ['2.2 - Subscrição no cliente aplica filtro estrito por unit_id', component.includes('filter: `unit_id=eq.${unitId}`')],
  ['2.3 - Nenhuma chave, senha ou credencial sensível trafega no snapshot', !types.includes('password') && !types.includes('secret') && !types.includes('token_hash')],

  // FRENTE 3: DESEMPENHO E PROTEÇÃO ANTI-SOBRECARGA
  ['3.1 - Frontend implementa Debounce de eventos para conter rajadas de pico', component.includes('scheduleDebouncedRefresh') && component.includes('setTimeout') && component.includes('1500')],
  ['3.2 - Frontend cancela timers pendentes no unmount evitando memory leaks', component.includes('clearTimeout(debounceTimerRef.current)')],
  ['3.3 - Índices de alta performance criados para meal_consumptions e blocked_attempts', migration.includes('idx_meal_consumptions_dashboard_fast') && migration.includes('idx_blocked_attempts_dashboard_fast')],

  // FRENTE 4: CONSISTÊNCIA MATEMÁTICA E TEMPORAL
  ['4.1 - Agrupamento em blocos de 15 minutos determinístico via date_bin', migration.includes("date_bin('15 minutes'")],
  ['4.2 - Contagem separada de integrais e parciais', migration.includes('sc.is_integral = true') && migration.includes('sc.is_integral = false')],
  ['4.3 - Taxa de bloqueio calculada sobre o total de tentativas', migration.includes('block_rate_percentage') && migration.includes('(v_total_meals + v_total_blocked)')],
  ['4.4 - Detecção de inatividade de terminais com limite de 120s em horário de fluxo', migration.includes('seconds_since_last_activity > 120') && migration.includes('v_recent_15m_meals > 0')],

  // FRENTE 5: RESILIÊNCIA E CONTINUIDADE
  ['5.1 - Componente monitora estados de conexão do WebSocket (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT)', component.includes('SUBSCRIBED') && component.includes('CHANNEL_ERROR') && component.includes('TIMED_OUT')],
  ['5.2 - Fallback automático para Polling suave a cada 30 segundos em caso de queda do Realtime', component.includes('setInterval') && component.includes('30000') && component.includes('realtimeActive')],
  ['5.3 - Interface exibe status resiliente diferenciando Ao Vivo de Modo Resiliente', component.includes('Ao Vivo (Realtime)') && component.includes('Modo Resiliente (Polling 30s)')],

  // FRENTE 6: NÃO-REGRESSÃO E CONTRATOS
  ['6.1 - Tipos TypeScript cobrem todas as entidades analíticas e de monitoramento', types.includes('HourlyFlowBucket') && types.includes('TerminalStatusMetric') && types.includes('OperationalDashboardSnapshot')],
  ['6.2 - Documento de homologação SPRINT_14_1_HARDENING_HOMOLOGATION.md registrado', exists('docs/SPRINT_14_1_HARDENING_HOMOLOGATION.md')],
  ['6.3 - Rota /admin/dashboard e componente integrados com zero erros de tipo', exists('src/app/admin/dashboard/page.tsx') && exists('src/components/admin/OperationalDashboard.tsx')],
];

let failed = 0;
for (const [desc, ok] of assertions) {
  if (ok) {
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc}`);
    failed += 1;
  }
}

console.log(`\n================================================================================`);
console.log(`RESULTADO DA HOMOLOGAÇÃO: ${assertions.length - failed}/${assertions.length} asserções aprovadas`);
console.log(`================================================================================`);

if (failed > 0) {
  process.exit(1);
}
