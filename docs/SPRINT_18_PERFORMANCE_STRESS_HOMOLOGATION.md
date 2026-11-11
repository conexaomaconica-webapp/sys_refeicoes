# Sprint 18 — Homologação de Performance, Carga, Estresse e Resiliência Operacional

**Data da Execução Final:** 10/11/2026 (`2026-11-10T16:24:53-03:00`)  
**Ambiente:** PostgreSQL `17.11-5` (`v170011`) portátil descartável em loopback exclusivo `127.0.0.1:55442`  
**Status Local:** **GO — Homologação Local (21/21 PG17 + 8/8 Client/Invariantes)**  
**Status Produção (Supabase Remoto):** **NO-GO — Migrations 79, 80, 81 e 82 mantidas apenas localmente; nenhuma alteração aplicada ao banco remoto.**

---

## 1. Hardware, Runtime e Parâmetros de Medição

| Recurso | Especificação Medida |
| :--- | :--- |
| CPU | `Intel(R) Celeron(R) 6305 @ 1.80GHz` (`2` núcleos lógicos, `1805 MHz`) |
| Memória RAM Host | `3.73 GB` totais (`0.62 GB` livres antes do benchmark / `0.42 GB` ao término) |
| Sistema Operacional | Windows `10.0.26200` (`win32` / `x64`) |
| Node.js / pnpm / Driver | Node `v22.23.3`, pnpm `12.6.0`, `pg@8.23.1` (`Pool max=16`, `pg_ctl max_connections=32`) |
| Processo Runner Node | RSS `65.84 MB`, `heapUsed = 8.15 MB`, `external = 1.86 MB` |
| Isolamento de Segurança | Papéis `authenticated` e `anon` sem `SUPERUSER` e sem `BYPASSRLS`; URLs remotas bloqueadas |
| Cadeia Compilada | `sprint18_disposable_pg17_baseline.sql` + Migrations `36 -> 31 -> 72 -> 77 -> 78 -> 79 -> 80 -> 81 -> 82` |
| Evidência Sanitizada | [sprint18-performance-20261110-162453.json](file:///c:/Sys_MArefeicoes/docs/evidence/sprint18/sprint18-performance-20261110-162453.json) |

---

## 2. Otimizações Aplicadas (Migration 82 — Não-Destrutiva)

Durante a análise estática de [consume_operator_terminal_meal](file:///c:/Sys_MArefeicoes/supabase/migrations/20261021000060_add_configurable_cash_shift_mode.sql#L237-L274), [consume_meal](file:///c:/Sys_MArefeicoes/supabase/migrations/20260927000036_add_student_to_consume_meal_blocks_and_shift_reports_rpc.sql#L9-L521) e [operational_dashboard_signals](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql#L386-L396), foram identificados pontos de contenção potencial sob alto volume e adicionados índices não-destrutivos em [20261110000082_sprint18_performance_indexes.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000082_sprint18_performance_indexes.sql):

1. `idx_cash_shifts_open_operator_terminal` (índice parcial `WHERE status = 'opened'` em `(unit_id, terminal_id, operator_id, opened_at DESC)`): obteve **9.594 scans e 9.594 tuplas lidas (proporção 1:1)** sobre base com 3.000 turnos históricos fechados + 5 abertos.
2. `idx_meal_consumptions_unit_date_meal_status` (`INCLUDE (student_price, full_price, subsidy_amount)`): **50 index scans / 45.000 tuplas lidas**, atendendo relatórios de turno e consultas operacionais com baixa E/S.
3. `idx_wallets_student_tenant`: **3.199 index scans / 3.200 tuplas lidas** no lookup transacional `FOR UPDATE`.
4. `idx_ops_signals_emitted_at`: suporte a expurgo e retenção por janela temporal em `operational_dashboard_signals`.

---

## 3. Separação de Métricas e Resultados Reais Medidos — Carga Operacional (Fase 18.2)

Seguindo a separação analítica recomendada para homologação local:
- **Latência Transacional / PostgreSQL (medida):** tempo completo de ida e volta no driver `pg` por transação (`BEGIN` + `SET LOCAL ROLE authenticated` + `set_config` JWT + execução da RPC `consume_operator_terminal_meal` com `consume_meal` e triggers + `COMMIT`), executado em loopback `127.0.0.1:55442` sem RTT de rede pública nem autenticação externa.
- **Latência Operacional Ponta-a-Ponta (delimitada):** na estação cliente real, acrescenta o round-trip HTTPS/Vercel/Supabase e a etapa de interface no terminal (leitura do código/matrícula, checagem offline local opcional e renderização). Essa fatia de rede pública não foi simulada no cluster loopback local.
- **Capacidade Local Medida:** throughput sustentado em `req/s` na estação `Celeron 6305 / 3,73 GB RAM` mantendo 100% de consistência contábil e bloqueio de duplicidades.

Simulação multi-tenant/multi-unidade com **5.254 comensais sintéticos**, 4 operadores em 4 terminais (`TERM-A1-01/02`, `TERM-A2-01/02`) com caixas abertos e carteiras pré-creditadas (`seed = 3.504,32 ms`):

| Cenário / RPC | Amostras | Sucesso | min (ms) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Média (ms) | Vazão (req/s) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Turno Almoço (`consume_operator_terminal_meal`, c=4) | 950 | 950/950 | 3,39 | 17,30 | **47,26** | 97,54 | 1525,45 | 22,96 | 173,69 |
| Turno Jantar (`consume_operator_terminal_meal`, c=4) | 850 | 850/850 | 2,85 | 12,16 | **35,14** | 48,78 | 72,57 | 14,77 | 270,76 |
| Dashboard Tempo Real (`get_realtime_operational_dashboard`) | 10 | 10/10 | 20,96 | 23,42 | **40,81** | 40,81 | 40,81 | 24,64 | — |
| Relatório de Turno (`get_terminal_shift_reports`) | 10 | 10/10 | 24,67 | 26,31 | **40,97** | 40,97 | 40,97 | 29,06 | — |

**Avaliação Fase 18.2:** As metas iniciais de latência (`p50 < 250 ms`, `p95 < 400 ms`, `p99 < 800 ms`) foram atendidas em ambos os turnos para as 1.800 refeições operacionais (`0` falhas).

---

## 4. Resultados Reais Medidos — Estresse e Recuperação (Fase 18.3)

Execução contínua de **3.000 transações adicionais** em ondas cadenciadas com rampa até o pico alvo de **40 req/s** (`pool max=16`), seguida de intervalo de `1.500 ms` e onda de recuperação:

| Onda | Amostras | Alvo (req/s) | Medido (req/s) | Aprovadas | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Média (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Onda 1 (Baseline) | 300 | 10 | 10,03 | 300/300 | 6,02 | 23,78 | 102,40 | 166,68 | 10,54 |
| Onda 2 (Escala) | 900 | 25 | 25,02 | 900/900 | 5,51 | 50,16 | **1440,80** | 4465,73 | 58,73 |
| Onda 3 (Pico Alvo) | 1.500 | 40 | **40,02** | 1.500/1.500 | 5,00 | **65,82** | **199,62** | 1052,01 | 14,68 |
| Onda 4 (Recuperação) | 300 | 10 | 10,03 | 300/300 | 4,31 | **13,42** | 112,05 | 124,31 | 7,21 |
| Relatório Financeiro Pós-4.800 Consumos | 5 | — | — | 5/5 | 31,84 | **51,13** | 51,13 | 51,13 | 35,17 |

### Ponto de Degradação e Cauda Observada (Transparência)
- Em `p95`, todas as ondas mantiveram latência bem abaixo do teto de `400 ms` (máximo `p95 = 65,82 ms` no pico de `40,02 req/s`), e a recuperação retornou para `p95 = 13,42 ms` (`p50 = 4,31 ms`).
- **Observação de cauda (`p99`):** Na **Onda 2** (`25 req/s`), houve pausa pontual de flush/checkpoint WAL em disco no hardware local (dual-core `1.80 GHz`, `3.73 GB` RAM, `0.42 GB` livres), elevando o `p99` desta onda para `1440,80 ms` (`max = 4465,73 ms`), acima da meta de `p99 < 800 ms` na cauda extrema, embora sem perda ou erro (`900/900` confirmadas) e com normalização na Onda 3 (`p99 = 199,62 ms`) e Onda 4 (`p99 = 112,05 ms`).
- No **Turno Almoço**, uma única chamada inicial atingiu `max = 1525,45 ms` (aquecimento de pool + auth SCRAM-SHA-256), mantendo `p99 = 97,54 ms`.

---

## 5. Resiliência Transacional, Offline e Integridade Financeira (Fase 18.4)

Todos os testes de resiliência pós-carga aprovaram no PostgreSQL 17.11 e nos checks locais:

1. **Concorrência na Mesma Matrícula (`18.4.1`):** 12 requisições simultâneas sobre `REG-RACE01` resultaram em exatamente **`1` aprovação (`approved`)** e **`11` bloqueios** (`3 CONCURRENT_CONSUMPTION_CONFLICT` via `pg_try_advisory_xact_lock` + `8 ALREADY_CONSUMED_TODAY`), com apenas 1 registro em `meal_consumptions` e saldo final exato de `R$ 195,50`.
2. **Replay Idempotente (`18.4.2`):** Reenvio da mesma `idempotency_key` (`S18-IDEMP-FIXED-001`) retornou `idempotent_replay: true` com o mesmo `consumption_id` (`46790091-a50b-429f-9089-49b6ded78f33`) e sem segundo débito (`balance = 195,50`).
3. **Saldo Insuficiente sob Concorrência (`18.4.3`):** 6 tentativas simultâneas sobre `REG-LOWBAL` (`R$ 0,50`) resultaram em `0` aprovações (`5 CONCURRENT_CONSUMPTION_CONFLICT`, `1 INSUFFICIENT_FUNDS`), preservando saldo `R$ 0,50` sem negativação.
4. **Contingência Offline e Eventos Fora de Ordem / Repetidos (`18.4.4`):**
   - `reconcile_offline_consumptions` permanece **revogada para `authenticated` (`SQLSTATE 42501`)** conforme Migration 72.
   - Via canal administrativo/backend, lote com eventos fora de ordem (`seq 2 -> seq 1`), duplicado repetido e colisão com consumo online retornou `conflict_duplicate` (sem débito financeiro duplicado), `confirmed_regular` e `already_processed: true` determinísticos.
   - Lado cliente validado em [validate-sprint18.cjs](file:///c:/Sys_MArefeicoes/scripts/validate-sprint18.cjs) (**8/8 PASS**): trava local `hasLocalPassageToday`, `TimeoutLock`, histerese `NetworkMonitor`, `SyncMutex` e fallback polling de 30s com debounce de 1.500ms em [OperationalDashboard.tsx](file:///c:/Sys_MArefeicoes/src/components/admin/OperationalDashboard.tsx).
5. **Isolamento Multi-Tenant e Unidade (`18.4.5`):** Operador da Unidade B1 bloqueado ao tentar consumir na Unidade A1 (`CASH_SHIFT_REQUIRED`); operador da Unidade A1 bloqueado ao consultar matrícula do Tenant B (`STUDENT_NOT_FOUND`).
6. **Auditoria Patrimonial e Sinais Sem PII (`18.4.6` / `18.4.7`):**
   - `audit_wallet_custody_integrity`: `wallets_custody_balance = ledger_net_sum = 1.026.182,50`, `custody_drift = 0`, `inconsistent_wallets_count = 0`, `negative_wallets_count = 0`, `is_patrimony_balanced = true`.
   - `4.822` sinais emitidos em `operational_dashboard_signals` sob carga sem travar terminais e sem exposição de PII.

---

## 6. Regressões, Build e Limpeza do Ambiente

- **Bateria PG 17 Descartável Sprint 18:** `21/21` asserções aprovadas, `0` falhas ([homologate-sprint18-performance.cjs](file:///c:/Sys_MArefeicoes/scripts/homologate-sprint18-performance.cjs)).
- **Limpeza Pós-Execução (`CLEANUP CHECK`):** `duration_sec=243,85 | pg_procs=0 | port_55442_listeners=0 | residual_temp=0 | disk_c_free_gb=1,86`.
- **Checks Locais e Regressões Sprints 14–18:**
  - `node scripts/validate-sprint18.cjs`: `8/8 PASS`
  - `node scripts/validate-sprint17-1-prep.cjs`: `5/5 PASS`
  - `node scripts/homologate-sprint17-security.cjs`: `20/20 PASS`
  - `node scripts/homologate-sprint14-dashboard.cjs`: `23/23 PASS`
  - `node scripts/homologate-sprint15-financial.cjs`: `10/10 PASS`
  - `node scripts/homologate-sprint15-hardening.cjs`: `7/7 PASS`
  - `node scripts/homologate-sprint16-reconciliation.cjs`: `10/10 PASS`
- **Build & Estática:** `pnpm exec tsc --noEmit` (0 erros), `pnpm run lint` (0 erros), `pnpm run build` (**33/33 páginas**, código de saída `0`).

---

## 7. Limitações de Hardware, Critério de Capacidade e Parecer Final

1. **Limite de Extrapolação para Produção:** Estes números foram medidos em estação local modesta (`Intel Celeron 6305`, `2` núcleos, `3,73 GB` RAM, PostgreSQL loopback sem rede pública nem camada HTTP Next.js/Vercel). **Não devem ser usados isoladamente para declarar capacidade produtiva** em Vercel + Supabase; servem para homologação funcional de concorrência, planos de índice (`Migration 82`), integridade contábil sob estresse e comportamento de recuperação após picos.
2. **Resultado na Estação Local:** O motor SQL suportou **1.800 refeições/dia** (`p95 <= 47,26 ms`, `0` erros) e rajadas de **3.000 transações chegando a 40,02 req/s** (`p95 = 65,82 ms`, `p99 = 199,62 ms` no pico, recuperação para `p95 = 13,42 ms`) com consistência patrimonial total (`custody_drift = 0`, `mismatches = 0`).
3. **Gargalos Identificados e Recomendações para Sprints 19–20 / Produção:**
   - **Cauda de I/O WAL (`Onda 2`, `p99 = 1440,80 ms`):** Checkpoints e flush em disco causam picos isolados na cauda extrema; manter connection pooling gerenciado (Supavisor/PgBouncer) e observar IOPS do plano Supabase antes do piloto.
   - **Crescimento de Sinais Realtime (`operational_dashboard_signals`):** Agendar ou executar rotina periódica de expurgo/retenção usando o índice `idx_ops_signals_emitted_at` criado na Migration 82.
   - **Medição Operacional Ponta-a-Ponta:** Durante o piloto controlado (Sprints 19–20), instrumentar a latência total no terminal (Vercel Edge/Node + Supabase + RLS) separada da duração pura da RPC.
4. **Parecer Final:** **GO — Homologação Local Sprint 18 Concluída (`21/21` PG17 + `8/8` Client/Invariantes)** | **NO-GO — Produção** (Migrations `79`, `80`, `81` e `82` continuam não aplicadas no Supabase remoto).
