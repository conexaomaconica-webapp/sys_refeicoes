# SPRINT 17.1 — HOMOLOGAÇÃO TRANSACIONAL DE SEGURANÇA E INTEGRIDADE (MIGRATIONS 79, 80 E 81)

**Data:** 10/11/2026  
**Escopo:** Execução transacional real em PostgreSQL 17.11 portátil descartável (`127.0.0.1:55441`), espaço verificado em `C:` (`1,87 GB` antes do download; `1,74 GB` antes do `initdb`; `1,87 GB` após limpeza), auditoria de compatibilidade das migrations `77` a `81`, rollback seguro contra perda de dados e suíte com 10 cenários transacionais (35 asserções) sem `SUPERUSER`/`BYPASSRLS`.  
**Execução em PostgreSQL 17.11 Portátil Descartável:** **CONCLUÍDA (`35/35` asserções aprovadas, `0` falhas, duração `138,44s`)**  
**Status da Preparação e Homologação Transacional Local:** **GO (Local — 35/35 PASS)**  
**Status de Produção e Aplicação Remota:** **NO-GO**

---

## 1. Achados Críticos Descobertos na Fase 1 (Auditoria de Baseline vs Schema Real)

Ao confrontar linha a linha as migrations `77` a `81` com o baseline fiel das tabelas criadas nas migrations `01` a `76`, a preparação da Sprint 17.1 identificou **4 incompatibilidades reais de schema** que causariam erro imediato de execução no PostgreSQL e **1 brecha complementar de integridade no ledger**:

| ID | Origem | Falha Real Identificada | Correção Implementada |
| :--- | :--- | :--- | :--- |
| **17.1-S01** | Migrations 78 e 79 | Ambas referenciavam a coluna inexistente `sc.is_integral` em `public.student_categories`. O schema real usa `sc.code = 'integral'` (migrations 10 e 34). | Migration 79 atualizada para `(sc.code = 'integral') AS is_integral`. Migration 81 substitui `get_realtime_operational_dashboard` corrigindo todas as ocorrências para `sc.code = 'integral'`. |
| **17.1-S02** | Migration 77 (`submit_contingency_batch`) e `contingency.service.ts` | Consultavam `meal_types.is_active = true`, porém `public.meal_types` possui `status = 'active'` (migration 19). `operational-dashboard.server.ts` ordenava por `sort_order` inexistente. | Corrigidos [`contingency.service.ts`](file:///c:/Sys_MArefeicoes/src/server/contingency/contingency.service.ts) e [`operational-dashboard.server.ts`](file:///c:/Sys_MArefeicoes/src/server/dashboard/operational-dashboard.server.ts) para usar `status = 'active'` e `order('name')`. Migration 81 substitui `submit_contingency_batch`. |
| **17.1-S03** | Migration 77 (`submit_contingency_batch`) | Consultava colunas inexistentes em `public.meal_rules`: `subsidy_value`, `is_active` e `valid_until`. O schema real (migration 19) usa `subsidy_amount`, `enabled`, `effective_from`, `effective_to` e `unit_id`. | Migration 81 substitui `submit_contingency_batch` usando `mr.subsidy_amount`, `mr.enabled = true`, `mr.unit_id = p_unit_id`, `mr.effective_from`/`mr.effective_to` e checagem explícita de usuário ativo. |
| **17.1-S04** | Migration 81 (`wallet_transactions`) | A trigger `BEFORE UPDATE OR DELETE FOR EACH ROW` não intercepta comandos `TRUNCATE` em PostgreSQL. | Adicionada `BEFORE TRUNCATE FOR EACH STATEMENT` (`trg_wallet_transactions_no_truncate`) e `REVOKE UPDATE, DELETE, TRUNCATE ON public.wallet_transactions FROM PUBLIC, anon, authenticated`. |

---

## 2. Compatibilidade, Ordem de Aplicação e Rollback

### 2.1 Ordem Sequencial Segura
1. Baseline preexistente (`000001` a `000076`)
2. `20261029000077_create_contingency_regularization.sql` *(já aplicada no ambiente remoto segundo histórico)*
3. `20261109000078_create_realtime_operational_dashboard.sql` *(já aplicada no ambiente remoto segundo histórico)*
4. `20261109000079_create_financial_reporting_rpcs.sql` *(local — pendente)*
5. `20261109000080_create_financial_reconciliation.sql` *(local — pendente)*
6. `20261110000081_sprint17_p0_security_and_accounting_hardening.sql` *(local — corretiva e endurecimento P0 — pendente)*

### 2.2 Plano de Rollback Reverso (`81 -> 80 -> 79`) e Proteção Contra Perda de Dados
Preparado em [`scripts/sql/sprint17_1_rollback_79_80_81.sql`](file:///c:/Sys_MArefeicoes/scripts/sql/sprint17_1_rollback_79_80_81.sql):
- **Trava Anti-Perda de Dados:** Aborta com `ROLLBACK_BLOCKED_DATA_EXISTS` caso existam registros em `financial_reconciliation_batches`, `financial_reconciliation_divergences` ou `financial_daily_closings`. Rollback de schema **não** substitui restauração integral (backup lógico Etapa 9E.1-B / PITR).
- **Restauração Completa Pré-81:** Quando as tabelas novas estão vazias, remove triggers, funções e tabelas de 79/80/81 na ordem reversa **e restaura explicitamente** a publicação `supabase_realtime` anterior (`meal_consumptions`, `blocked_attempts`) e as políticas pré-81 (`upd_contingency_batches_staff`, `sel_contingency_evidence_staff`, `ins_contingency_evidence_staff`).

### 2.3 Diagnóstico dos Binários Portáteis PostgreSQL 17.11 e Espaço em Disco
- **Espaço livre verificado no volume `C:`:** `2,17 GB`
- **Binários localizados em `C:\MARefeicoes-Backups\.tools\postgresql-17.11-5\pgsql\bin`:**
  - Versão: `postgres (PostgreSQL) 17.11`
  - `postgres.exe`: `F5DBFD059F8088B9511A02FC014E659369996FC7D3E88E47658B1CFA2FBB02D2`
  - `initdb.exe`: `D385519A50D2CD5E143E86C2C10ACFE0D44D3039D714C8211B804011BCA2409F`
  - `pg_ctl.exe`: `9885AC53AF9D67C76C1DDDE87C19E6B15539D7C482BCA70CD5EAD5DAD0B7CE3C`
  - `psql.exe`: `C290C7F0A3335F290F8C18011A1E5AFA03EE3CDD628697A5F3E767E5F1D3D10D`
- **Motivo do bloqueio em `initdb.exe`:** A pasta `C:\MARefeicoes-Backups\.tools\postgresql-17.11-5\pgsql` retida da Etapa 9E.1-B contém exclusivamente `bin\`. Ao executar [`scripts/sprint17_1/run-native-disposable.ps1`](file:///c:/Sys_MArefeicoes/scripts/sprint17_1/run-native-disposable.ps1), o `initdb.exe` falhou com `file "C:/MARefeicoes-Backups/.tools/postgresql-17.11-5/pgsql/share/postgres.bki" does not exist`.
- **Dependência para conclusão dos 10 cenários transacionais:** Autorização explícita do usuário para download temporário (com verificação SHA-256) e descarte imediato pós-execução do pacote oficial `postgresql-17.11-5-windows-x64-binaries.zip` (`~381 MB`, respeitando os `2,17 GB` livres em `C:` removendo o ZIP antes de extrair ou extraindo apenas em `%TEMP%`).

---

## 3. Matriz de Testes Transacionais (Execução Final em PostgreSQL 17.11 — `10/11/2026`)

Evidências sanitizadas preservadas:
- Log completo final: [`docs/evidence/sprint17_1/sprint17_1-transactional-20261110-152426.log`](file:///c:/Sys_MArefeicoes/docs/evidence/sprint17_1/sprint17_1-transactional-20261110-152426.log)
- JSON estruturado final: [`docs/evidence/sprint17_1/sprint17_1-transactional-20261110-152426.json`](file:///c:/Sys_MArefeicoes/docs/evidence/sprint17_1/sprint17_1-transactional-20261110-152426.json)
- Tempo total da orquestração final (download + verificação SHA-256 + extração seletiva + `initdb` + 35 asserções + limpeza): **`138,44s`**
- Comprovação de limpeza final: `pg_procs=0`, `port_55441_listeners=0`, `residual_temp=0`, `disk_c_free_gb=1,87`.

### Falhas Descobertas e Resolvidas ao Longo das Rodadas
1. **Privilégios explícitos de tabela ausentes após `CREATE TABLE` nas Migrations 77/80/81:** Adicionados `GRANT`s explícitos nas Migrations 80 e 81 (`contingency_meal_batches`, `contingency_batch_items`, `financial_reconciliation_*`, `financial_daily_closings`, `operational_dashboard_signals`), permitindo a avaliação efetiva da RLS (`WITH CHECK` e `trg_prevent_contingency_tampering`).
2. **Isolamento via `SAVEPOINT` para queries como proprietário (`asOwner`):** `C3.2`/`C3.3a`/`C3.3b`/`C10.3` encapsuladas em `SAVEPOINT sp_owner`.
3. **Dupla comprovação de proteção contra `TRUNCATE` em `wallet_transactions` (`C3.3a` e `C3.3b`):**
   - **`C3.3a` (`TRUNCATE public.wallet_transactions` sem `CASCADE`):** rejeitado pela constraint FK de `financial_reconciliation_divergences(ledger_tx_id)` com `SQLSTATE 0A000`.
   - **`C3.3b` (`TRUNCATE public.wallet_transactions CASCADE`):** contorna a barreira de FK e dispara a trigger `trg_wallet_transactions_no_truncate` (`BEFORE TRUNCATE`), rejeitado com `LEDGER_IMMUTABLE` (`SQLSTATE 42501`).

| # | Cenário Transacional Executado no PG 17.11 | Papel / Contexto | Resultado Final |
| :-: | :--- | :--- | :---: |
| 0 | Ambiente descartável (`v170011`, `data_dir` exclusivo, `127.0.0.1:55441`, `authenticated`/`anon` sem `SUPERUSER`/`BYPASSRLS`, cadeia 77→81) | Cluster descartável | **PASS (5/5)** |
| 1 | Isolamento entre tenants (`TENANT_MISMATCH`), unidades (`ACCESS_DENIED_UNIT`) e Storage `contingency-evidence` (`SELECT` e `INSERT` cruzado com `FORCE RLS`) | `authenticated` (`finB`, `mgrA1`) | **PASS (4/4)** |
| 2 | Submissão de contingência (`meal_rules`/`meal_types`), bloqueio de autoaprovação via `UPDATE` (`WITH CHECK`), bloqueio `FORBIDDEN`/`SELF_APPROVAL_PROHIBITED`, aprovação por diretor e imutabilidade pós-aprovação (`CONTINGENCY_IMMUTABLE`) | `authenticated` (`mgrA1`, `dirA`) | **PASS (6/6)** |
| 3 | Imutabilidade do ledger: `UPDATE` (`C3.1`), `DELETE` (`C3.2`), `TRUNCATE` sem `CASCADE` (`C3.3a` → `0A000`), `TRUNCATE CASCADE` (`C3.3b` → `LEDGER_IMMUTABLE` `42501`) e `INSERT` append-only legítimo (`C3.4`) | `authenticated` e owner | **PASS (5/5)** |
| 4 | Batimento patrimonial `SUM(wallets.balance) == SUM(wallet_transactions.amount)` (`96,00`) e detecção de deriva (`+10,00`) via `audit_wallet_custody_integrity` | `authenticated` (`finA`) | **PASS (2/2)** |
| 5–6 | Segregação contábil (receita `4,00`, subsídio `104,50`, recargas `100,00`, custódia `96,00`, taxa JSON `2,50`) e filtro por instituição `A2` | `authenticated` (`finA`) | **PASS (2/2)** |
| 7 | Detecção dos 5 tipos de divergência (`missing`, `mismatch`, `refund_mismatch`, `cancelled_with_credit`, `orphan`) e idempotência na re-execução | `authenticated` (`finA`) | **PASS (1/1)** |
| 8 | Inspeção `pg_proc`/`aclexplode` nas 6 RPCs (`SECURITY DEFINER`, `search_path=''`, zero `EXECUTE` para `PUBLIC`/`anon`) | Catálogo `pg_proc` | **PASS (1/1)** |
| 9 | Rejeição fail-closed de `anon`, usuário inativo (`ACTIVE_PROFILE_REQUIRED`), supervisor sem unidade (`UNIT_SCOPE_REQUIRED`) e exclusão de `operator` em sinais Realtime | `anon`, `inactA`, `supA1`, `opA1` | **PASS (4/4)** |
| 10 | `get_realtime_operational_dashboard`, publicação `supabase_realtime` apenas com `operational_dashboard_signals`, trava de rollback com dados (`ROLLBACK_BLOCKED_DATA_EXISTS`), rollback limpo 81→80→79 preservando dados pré-79 e reaplicação 79→80→81 | `authenticated` (`mgrA1`) e owner | **PASS (5/5)** |

---

## 4. Fase 3 — Limites entre PostgreSQL Puro, Supabase Realtime e Storage

| Camada | O que PostgreSQL Puro Valida | O que Exige Ambiente Supabase Real (NÃO Aprovado Ainda) |
| :--- | :--- | :--- |
| **PostgreSQL / RLS** | Existência da publicação `supabase_realtime`, ausência de `meal_consumptions`/`blocked_attempts` na publicação, presença de `operational_dashboard_signals`, execução da trigger `emit_operational_dashboard_signal` e avaliação das políticas RLS em `SELECT`. | — |
| **Supabase Realtime (`walrus` / WebSocket)** | Não reproduzível em Postgres puro. | Handshake JWT via WebSocket, entrega efetiva apenas aos inscritos autorizados da unidade, inspeção de frame trafegado e **corte imediato de entrega após revogação de acesso em sessão já aberta**. |
| **Supabase Storage HTTP** | Avaliação das políticas SQL em `storage.objects` (`sel_contingency_evidence_staff` / `ins_contingency_evidence_staff` com prefixo de tenant). | Upload/download real via API Storage assinada, validação de MIME/tamanho (`15MB`) e bloqueio HTTP 403 entre tenants na CDN/Gateway do Storage. |

---

## 5. Regressões Locais Executadas Após as Correções

| Suíte / Comando | Resultado | Escopo |
| :--- | :---: | :--- |
| `node scripts/validate-sprint17-1-prep.cjs` | **5/5 PASS** | Baseline restrito, trava anti-Supabase, compatibilidade de schema 77–81, ordem de rollback |
| `node scripts/validate-sprint13-contingency.cjs` | **7/7 PASS** | Integridade do módulo de contingência |
| `node scripts/validate-sprint14-dashboard.cjs` & `homologate-sprint14-dashboard.cjs` | **6/6 & 23/23 PASS** | Dashboard operacional e transição para `operational_dashboard_signals` |
| `node scripts/validate-sprint15-reporting.cjs`, `homologate-sprint15-financial.cjs`, `homologate-sprint15-hardening.cjs` | **7/7, 10/10 & 7/7 PASS** | Relatórios fiscais e fonte canônica única fail-closed |
| `node scripts/validate-sprint16.cjs` & `homologate-sprint16-reconciliation.cjs` | **7/7 & 10/10 PASS** | Conciliação financeira e segregação contábil |
| `node scripts/homologate-sprint17-security.cjs` | **20/20 PASS** | Hardening P0/P1/P2 da Sprint 17 |
| `pnpm exec eslint` (arquivos alterados) | **Código 0** | Zero erros e zero warnings |
| `pnpm exec tsc --noEmit` | **Código 0** | Zero erros de tipagem |
| `pnpm run build` | **Código 0 (`33/33`)** | Build de produção Next.js 15 completo |

---

## 6. Riscos Residuais e Critérios para Staging

1. **Realtime WebSocket e Storage HTTP em Staging:** A publicação `supabase_realtime` (com `operational_dashboard_signals` apenas) e as políticas SQL em `storage.objects` foram validadas em PostgreSQL 17.11 puro, porém a transmissão WebSocket `walrus` sob revogação de sessão e os endpoints HTTP do Storage requerem validação em projeto Supabase de staging.
2. **Aprovação Contábil Formal:** Regras de taxas de gateway e definição contábil do passivo sob custódia aguardam validação final da controladoria.

---

## 7. Parecer Final da Sprint 17.1

- **Preparação, Correções de Schema/Grants e Regressões Locais:** **GO**
- **Homologação Transacional em PostgreSQL 17.11 Portátil (`127.0.0.1:55441`):** **GO (`35/35` asserções aprovadas, `0` falhas)**
- **Aplicação Remota das Migrations 79, 80 e 81 / Produção:** **NO-GO**

