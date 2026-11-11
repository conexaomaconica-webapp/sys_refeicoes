# Sprint 20.13 / 20.13.1 — Módulo de Ajustes e Regularizações de Refeições (Retroativo por Data e Ajuste Inteligente Mensal)

**Data:** 11/11/2026  
**Documento de Referência:** [STUDY_SMART_RETROACTIVE_MEAL_ADJUSTMENTS.md](file:///c:/Sys_MArefeicoes/docs/STUDY_SMART_RETROACTIVE_MEAL_ADJUSTMENTS.md)  
**Restrições Preservadas:** Zero acesso ao Supabase remoto, zero aplicação remota de migrations, zero backups, zero pagamentos ou dados reais, zero deploy/push/commit.  
**Status Local Código / Unitário / Build:** **Concluído e Compilado (`tsc 0`, `eslint 0`, `build 34/34`, `validate-sprint20-13 8/8`)**  
**Status Transacional PostgreSQL 17 (Migration 84):** **Pendente de Execução Local por Espaço em Disco (`C:` com `273.6 MB` livres vs `750 MB` exigidos para baixar/extrair os binários EDB de `381 MB`)**  
**Status Produção:** **NO-GO**

---

## 1. Entregas Implementadas por Fase

### Fase A — Integridade, Cross-Batch, Categoria Histórica, Multi-Turno e Campanhas (`Migration 84`)
Arquivo: [20261111000084_sprint20_smart_meal_adjustments.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261111000084_sprint20_smart_meal_adjustments.sql)

1. **Unicidade Absoluta por Estudante, Turno e Data + Resolução Histórica de Categoria:**
   - Função `public.get_student_category_on_date(tenant_id, student_id, service_date)` resolve a categoria vigente do estudante na `service_date` consultando `public.student_category_history` (com fallback em `students.category_id`).
   - Trigger `trg_enforce_contingency_item_uniqueness` (`enforce_contingency_item_uniqueness`, `SECURITY DEFINER`, `SET search_path = ''`) com `pg_advisory_xact_lock`, garantindo no máximo 1 consumo individual por `(tenant_id, student_id, service_date, meal_type_id)` em qualquer origem (`meal_consumptions`, lotes `draft`/`pending_approval`/`approved`, ou concorrência), independentemente da categoria (`DUPLICATE_REGULAR_CONSUMPTION`, `DUPLICATE_CROSS_BATCH_ITEM`). Permite turnos distintos no mesmo dia (ex.: Almoço e Jantar).
   - Quando o lote informa `category_id`, o trigger exige aderência estrita com a categoria vigente do estudante na `service_date` (`CATEGORY_MISMATCH`), impedindo reclassificação arbitrária para categoria mais subsidiada.
   - Trigger `trg_prevent_batch_scope_change_with_items` impedindo alterar data ou refeição em lote com itens nominais vinculados.
2. **Calendário Operacional por Unidade (`unit_operating_calendar`):**
   - Tabela com `FORCE ROW LEVEL SECURITY`, índice único `uq_unit_operating_calendar_scope` e RPC `upsert_unit_operating_calendar`.
3. **Campanhas Mensais Multi-Turno e Linhas por Categoria (`meal_adjustment_campaigns`):**
   - Suporte a seleção de múltiplos turnos (`selected_meal_type_ids UUID[]`, `meal_type_id` opcional em campanhas multi-turno) e matriz `distribution_lines JSONB` (`meal_type_id + category_id + quantity`), mantendo `allocated_meals_count + unallocated_pending_meals = proven_total_meals`, `FORCE ROW LEVEL SECURITY`, trigger `trg_prevent_campaign_tampering` e bloqueio de autoaprovação (`SELF_APPROVAL_PROHIBITED`).
   - Extensão aditiva em `contingency_meal_batches` (`adjustment_modality`, `campaign_id`, `is_individual_confirmed`).
4. **RPCs Seguras (`SECURITY DEFINER`, `SET search_path = ''`, `REVOKE FROM PUBLIC, anon`):**
   - `preview_contingency_date_context`: consulta regular, ajustes ativos, calendário e fechamento diário (`financial_daily_closings`).
   - `submit_retroactive_date_distribution`: submissão atômica da Modalidade 1 com múltiplas linhas `(turno + categoria obrigatória + modalidade + quantidade)`, validando `unit_meal_types.enabled = true` (`UNIT_MEAL_TYPE_DISABLED`), regra tarifária ativa na data em `meal_rules` (`RULE_NOT_EFFECTIVE`), categoria obrigatória (`CATEGORY_REQUIRED`), calendário e unicidade individual.
   - `submit_smart_adjustment_campaign`: valida turnos habilitados em `unit_meal_types`, linhas de distribuição `SUM <= proven_total_meals`, categoria obrigatória em todas as alocações (`CATEGORY_REQUIRED`), `meal_rules` ativa na `service_date` (`RULE_NOT_EFFECTIVE`), divergência de categoria (`CATEGORY_MISMATCH`), referência documental (`DOCUMENT_REFERENCE_REQUIRED`), e retém saldo sem base diária como pendência mensal.
   - `review_smart_adjustment_campaign`: aprovação/rejeição segregada com bloqueio `FOR UPDATE`.
   - Atualização compatível de `get_consolidated_financial_report` segregando `contingency_identified_*`, `contingency_aggregated_*` e `unallocated_pending_meals_total` (estritamente informativo, sem somar em faturamento/subsídio e sem alterar `wallets` ou `wallet_transactions`).

---

### Fase B — Motor Inteligente Determinístico (Por Turno e Categoria)
- Contratos TypeScript em [adjustments.ts](file:///c:/Sys_MArefeicoes/src/types/adjustments.ts).
- Motor puro em [smart-gap-analyzer.ts](file:///c:/Sys_MArefeicoes/src/lib/adjustments/smart-gap-analyzer.ts):
  - `resolveStudentCategoryOnDate` e `distributeByLargestRemainder` (Hamilton).
  - `analyzeMonthlyMealGaps` agora filtra lacunas por `categoryId` vigente na `service_date` (`student_category_history` + `meal_rules`), contabiliza explicitamente `excluded_duplicates_count`, `existing_regular_count` e `existing_adjustment_count`, e nunca converte ausência estatística em consumo individual automático.
- Orquestração server-side em [smart-adjustment.service.ts](file:///c:/Sys_MArefeicoes/src/server/adjustments/smart-adjustment.service.ts) (`getMealAdjustmentsWorkspaceData` carregando `unit_meal_types` e `meal_rules` dinamicamente do banco, `previewMultiShiftsDateServer`, `analyzeMonthlySmartMultiServer` analisando separadamente cada linha `Turno × Categoria`, e `submitRetroactiveDateDistributionServer`) + server actions em [actions.ts](file:///c:/Sys_MArefeicoes/src/app/admin/ajustes-refeicoes/actions.ts).

---

### Fase C — Interface Unificada (`/admin/ajustes-refeicoes`)
- Página [page.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/ajustes-refeicoes/page.tsx) e componente [MealAdjustmentsManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/ajustes-refeicoes/MealAdjustmentsManager.tsx):
  - **Turnos e Categorias 100% Dinâmicos:** check-boxes multi-seleção carregados de `unit_meal_types.enabled = true`; categorias filtradas por `meal_rules` vigentes para unidade/turno/data (sem listas fixas no código e sem opção "Sem categoria").
  - **Aba 1 (`Modalidade 1: Retroativo por Data Específica`):** seleção múltipla de turnos, teto de quantidade comprovada, linhas `(Turno × Categoria × Modalidade × Quantidade)` com busca de alunos filtrada por categoria para Tipo A, prévia multi-turno por data e modal de prévia final antes da gravação via `submitRetroactiveDateDistributionAction`.
  - **Aba 2 (`Modalidade 2: Ajuste Inteligente Mensal`):** seleção múltipla de turnos, teto comprovado, construtor de linhas `(Turno × Categoria × Quantidade)` (`SUM <= total comprovado`), análise por linha exibindo Solicitada, Existentes, Lacunas, **Duplicidades Excluídas**, Confirmada e Pendente, **painel nominal imediato de alunos elegíveis SEM consumo** por data (`Ver Nomes`) e **resumo consolidado por estudante na competência** (dias sem consumo aptos vs dias já consumidos/em lote bloqueados), Submodo A (agregado editável por data) e Submodo B (reconciliação individual assistida listando todos os comensais aptos sem consumo na data), além da **Prévia Final Consolidada** discriminada por `Turno × Categoria × Data`.
  - **Calendário Operacional + Pendências Mensais + Histórico Único:** preservados integralmente, incluindo badges multi-turno.
- Navegação integrada em [AdminShell.tsx](file:///c:/Sys_MArefeicoes/src/components/admin/AdminShell.tsx) e [admin/page.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/page.tsx), com redirecionamento autenticado em [contingencia/page.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/contingencia/page.tsx) preservando redirecionamento `307 -> /login` sem sessão.

---

### Fase D — Integração nos Relatórios Financeiros
- [financial-reporting.ts](file:///c:/Sys_MArefeicoes/src/types/financial-reporting.ts), [financial-excel.ts](file:///c:/Sys_MArefeicoes/src/lib/reports/financial-excel.ts) e [FinancialReportingDashboard.tsx](file:///c:/Sys_MArefeicoes/src/components/admin/FinancialReportingDashboard.tsx) atualizados para exibir distintamente:
  - Regularizações Individuais Comprovadas (`contingency_identified_meals`)
  - Regularizações Agregadas (`contingency_aggregated_meals`)
  - Pendências Mensais Sem Data Alocada (`unallocated_pending_meals_total`, apenas informativo / não faturado)

---

## 2. Evidências Executadas e Pendências Remanescentes

| Verificação | Comando | Resultado Observado |
| :--- | :--- | :--- |
| **Testes Unitários Motor + Estrutura 20.13 / 20.13.1** | `node scripts/validate-sprint20-13.cjs` | **8/8 PASS (0 falhas)** |
| **TypeScript Check** | `pnpm exec tsc --noEmit` | **0 erros** (código `0`) |
| **ESLint** | `pnpm run lint` (`eslint src`) | **0 erros** (código `0`) |
| **Build de Produção Next.js** | `pnpm run build` | **34/34 páginas compiladas** (código `0`) |
| **Smoke HTTP & Guards Local** | `node scripts/smoke-sprint20-routes.cjs` | Validado em execução dedicada |
| **Regressões Sprints `13`, `14`, `15`, `16`, `17.1`, `18`, `20`, `Estágio 7/7C/8A/19A.1` e Estabilização** | `validate-sprint13..20` + `validate-stage*` + `validate-post-sprint10-stabilization` | **Todas aprovadas (0 falhas)** |
| **Homologação Transacional PG 17 (Migration 84)** | `scripts/sprint20/run-migration84-portable.ps1` + [homologate-sprint20-13-transactional.cjs](file:///c:/Sys_MArefeicoes/scripts/homologate-sprint20-13-transactional.cjs) | **Pendente de execução nesta estação** por falta de espaço livre em `C:` (`265.4 MB` livres; necessário `>= 750 MB` para baixar o ZIP de `381 MB` do PostgreSQL 17.11) |

### Pendências Remanescentes
1. Liberar pelo menos `~800 MB` na unidade `C:` (ou apontar `$PostgresBin` para um binário PostgreSQL 17 já extraído) e executar `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sprint20/run-migration84-portable.ps1` para obter a evidência transacional real da Migration 84 (já atualizada com testes 20.13.1 em [homologate-sprint20-13-transactional.cjs](file:///c:/Sys_MArefeicoes/scripts/homologate-sprint20-13-transactional.cjs)).
2. Inspeção visual interativa em Chrome (`1280×800`, `768×1024`, `390×844`) com sessão autenticada em staging após aplicação controlada das migrations `79`–`84`.
3. **Produção permanece em NO-GO** até conclusão dos gates externos (`G1` restauração, `G2` migrations `79`–`84`, `G3` sandbox pagamentos e `PHY-01..PHY-16`).

