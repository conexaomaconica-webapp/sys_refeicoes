# SPRINT 17 — AUDITORIA CONTÁBIL FINAL, SEGURANÇA P0 E HARDENING DE RLS

**Data da Auditoria:** 10/11/2026  
**Escopo:** Repositório local, migrations `000001` a `000081`, atenção especial às migrations `77`, `78`, `79`, `80`, serviços server-side, rotas de exportação, Realtime e regras contábeis.  
**Acesso Remoto:** Não realizado (nenhuma migration aplicada remotamente).  
**PostgreSQL Local Descartável:** Indisponível no ambiente (`psql` e `docker` ausentes). Testes transacionais reais em banco registrados como **PENDENTES**.  
**Parecer Local:** **GO** (para correções implementadas e validação estática/sintética local)  
**Parecer de Produção:** **NO-GO** (produção, dados reais e aplicação das migrations 79, 80 e 81 aguardam homologação transacional e autorização explícita).

---

## 1. Matriz de Vulnerabilidades Encontradas (P0 / P1 / P2)

| ID | Severidade | Frente | Vulnerabilidade / Inconsistência Identificada | Causa Raiz | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **P0-01** | **P0** | RLS / Contingência | Autoaprovação direta de lotes de contingência via PostgREST/REST por `unit_manager` ou `supervisor` | Política `upd_contingency_batches_staff` (Migration 77) possuía `USING` permitindo `operator_id = auth.uid()` sem cláusula `WITH CHECK` restringindo `status` e `approved_by`, nem trigger bloqueando adulteração. | **Corrigido localmente** |
| **P0-02** | **P0** | Financeiro / SQL | Falha de execução em `get_consolidated_financial_report` (Migration 79) | Queries comparavam `r.status = 'completed'` e `p.status = 'completed'` contra ENUMs cujo valor canônico é `'confirmed'`, e somavam coluna inexistente `p.provider_fee` em `public.payments`. | **Corrigido localmente** |
| **P0-03** | **P0** | Realtime / Privacidade | Publicação de `meal_consumptions` e `blocked_attempts` no `supabase_realtime` transmitia dados pessoais e valores financeiros por WebSocket; `operator` tinha leitura RLS | Mesmo com descarte do payload no frontend, `postgres_changes` envia a linha inteira (`student_id`, `registration_attempted`, `full_price`, `subsidy_amount`, `wallet_transaction_id`). | **Corrigido localmente** |
| **P0-04** | **P0** | Ledger / Carteiras | Ausência de trigger de imutabilidade no banco em `wallet_transactions` | Apenas políticas RLS impediam `UPDATE`/`DELETE` pelo papel `authenticated`; não havia barreira de trigger impedindo mutação por `service_role` ou RPC defeituosa. | **Corrigido localmente** |
| **P1-01** | **P1** | Contabilidade | Equívoco conceitual em fechamento diário (Sprint 16): soma de `Pix + Cartão + Dinheiro` rotulada como "Passivo sob Custódia Gerado" | Meios de recebimento representam entradas brutas de caixa/gateway, não a obrigação patrimonial devida aos alunos (`wallets.balance` conciliado com `wallet_transactions`). | **Corrigido localmente** |
| **P1-02** | **P1** | Multi-Instituição | Vazamento entre instituições nos relatórios fiscais da Migration 79 quando `p_institution_id` é informado | `contingency_meal_batches`, `recharges` e `payments` não aplicavam filtro por instituição via `units.institution_id` e `students.institution_id`. | **Corrigido localmente** |
| **P1-03** | **P1** | Conciliação | Falsos positivos de conciliação na fronteira da meia-noite (`reconciliation.server.ts`) | Consultas paralelas filtravam `payments` e `wallet_transactions` separadamente por `[startDate, endDate]`, desconectando confirmações ocorridas após `00:00` do dia seguinte. | **Corrigido localmente** |
| **P1-04** | **P1** | Storage / Tenant | Políticas do bucket `contingency-evidence` (Migration 77) sem prefixo de tenant | `sel_contingency_evidence_staff` e `ins_contingency_evidence_staff` validavam papel ativo, mas não restringiam `(storage.foldername(name))[1] = get_auth_tenant_id()::text`. | **Corrigido localmente** |
| **P1-05** | **P1** | RPCs Privilegiadas | Padronização de `search_path`, `REVOKE anon` e checagem explícita de status ativo | Migrations 78, 79 e 80 usavam `search_path = public, pg_temp` e `REVOKE FROM PUBLIC` em vez do padrão estrito `search_path = ''` + `FROM PUBLIC, anon`. Serviço de contingência não rejeitava `operator`/`student` antes da query. | **Corrigido localmente** |
| **P2-01** | **P2** | Exportação / Auditoria | Rotas de exportação retornavam HTTP 500 para erros de permissão (403/401/400) e careciam de log padronizado | `catch (err)` convertia `PERMISSION_DENIED` e `UNIT_SCOPE_REQUIRED` em status 500; sanitização de nome de arquivo e trilha auditável padronizadas. | **Corrigido localmente** |
| **P2-02** | **P2** | Performance / Escala | Leitura irrestrita de `recharges` no dashboard de conciliação | Query buscava todas as recargas do tenant sem filtrar pelos `paymentIds` do período analisado. | **Corrigido localmente** |
| **P2-03** | **P2** | Conciliação / UX | Tentativa de resolver divergência sintética (`dyn-div-*`) antes de persistir lote oficial | Faltava validação de formato UUID em `resolveDivergenceActionServer`, gerando erro de sintaxe SQL ao invés de orientação clara ao auditor. | **Corrigido localmente** |

---

## 2. Evidências e Arquivos Afetados

### Migrations Auditadas e Ajustadas (Mantidas Locais — Sem Aplicação Remota)
- [`supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql`](file:///c:/Sys_MArefeicoes/supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql): correção P0-02 (`'confirmed'`, remoção de `p.provider_fee`), P1-02 (filtros institucionais em contingência/recargas/pagamentos), P1-05 (`search_path = ''`, `FROM PUBLIC, anon`).
- [`supabase/migrations/20261109000080_create_financial_reconciliation.sql`](file:///c:/Sys_MArefeicoes/supabase/migrations/20261109000080_create_financial_reconciliation.sql): atualização de `financial_daily_closings` (P1-01), inclusão de `refund_mismatch`, `FORCE ROW LEVEL SECURITY`, `get_auth_user_status() = 'active'`, `search_path = ''`, `FROM PUBLIC, anon`.
- [`supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql`](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql): migration corretiva local endereçando P0-01 (`WITH CHECK` + trigger `prevent_contingency_tampering`), P0-03 (`operational_dashboard_signals` sem PII + remoção de `meal_consumptions` e `blocked_attempts` da publicação `supabase_realtime`), P0-04 (`trg_wallet_transactions_immutable`), P1-01 (`audit_wallet_custody_integrity`), P1-04 (isolamento no bucket `contingency-evidence`) e P1-05.

### Código Aplicação e Documentação Afetados
- [`src/components/admin/OperationalDashboard.tsx`](file:///c:/Sys_MArefeicoes/src/components/admin/OperationalDashboard.tsx): subscrição Realtime migrada para `operational_dashboard_signals`.
- [`src/types/reconciliation.ts`](file:///c:/Sys_MArefeicoes/src/types/reconciliation.ts), [`src/lib/reconciliation/reconciliation-engine.ts`](file:///c:/Sys_MArefeicoes/src/lib/reconciliation/reconciliation-engine.ts), [`src/lib/reports/reconciliation-excel.ts`](file:///c:/Sys_MArefeicoes/src/lib/reports/reconciliation-excel.ts), [`src/server/reconciliation/reconciliation.server.ts`](file:///c:/Sys_MArefeicoes/src/server/reconciliation/reconciliation.server.ts), [`src/components/admin/ReconciliationDashboard.tsx`](file:///c:/Sys_MArefeicoes/src/components/admin/ReconciliationDashboard.tsx): segregação contábil de recebimentos brutos vs saldo efetivo de custódia + batimento patrimonial via `audit_wallet_custody_integrity`, resolução de fronteira da meia-noite e validação UUID.
- [`src/server/contingency/contingency.service.ts`](file:///c:/Sys_MArefeicoes/src/server/contingency/contingency.service.ts): bloqueio fail-closed para perfis não autorizados.
- [`src/lib/security/export-route-error.ts`](file:///c:/Sys_MArefeicoes/src/lib/security/export-route-error.ts), [`src/app/api/admin/relatorios/export/route.ts`](file:///c:/Sys_MArefeicoes/src/app/api/admin/relatorios/export/route.ts), [`src/app/api/admin/conciliacao/export/route.ts`](file:///c:/Sys_MArefeicoes/src/app/api/admin/conciliacao/export/route.ts): mapeamento HTTP 401/403/400, sanitização de cabeçalho e log de auditoria não-sensível.
- [`docs/SPRINT_16_FINANCIAL_RECONCILIATION.md`](file:///c:/Sys_MArefeicoes/docs/SPRINT_16_FINANCIAL_RECONCILIATION.md): equação contábil de custódia corrigida.

---

## 3. Correções Implementadas (Resumo Técnico)

1. **Eliminação de Autoaprovação e Adulteração em Contingência (P0-01):** Política `upd_contingency_batches_staff` com `WITH CHECK` explícito somada à trigger `trg_prevent_contingency_tampering` garantindo imutabilidade de lotes deliberados e dupla aprovação obrigatória.
2. **Realtime Livre de PII e Dados Financeiros (P0-03):** `meal_consumptions` e `blocked_attempts` retiradas da publicação `supabase_realtime`. Eventos passam a ser sinalizados por `operational_dashboard_signals` (`id`, `tenant_id`, `unit_id`, `signal_type`, `emitted_at`), com RLS restrita a perfis gerenciais com `has_unit_access(unit_id)`.
3. **Imutabilidade Física do Ledger e Prova Patrimonial (P0-04 / P1-01):** Trigger `trg_wallet_transactions_immutable` bloqueia qualquer `UPDATE`/`DELETE` em `wallet_transactions`. Nova RPC `audit_wallet_custody_integrity` comprova matematicamente se `SUM(wallets.balance)` coincide com `SUM(wallet_transactions.amount)` e sinaliza qualquer deriva (`custody_drift`).
4. **Segregação Contábil na Conciliação e Fechamento Diário (P1-01):** `Pix + Cartão + Dinheiro` agora são tratados explicitamente como **Recebimentos Brutos por Meio**, distintos dos **Créditos Efetivos no Ledger**, **Débitos de Consumo** e do **Passivo Real em Custódia** devido aos comensais.
5. **Correção de Runtime SQL na Migration 79 (P0-02 / P1-02):** Substituição de `'completed'` pelo enum canônico `'confirmed'`, remoção de referência inexistente a `provider_fee` e inclusão de filtro institucional em contingência, recargas e pagamentos.

---

## 4. Testes Executados e Resultados

### 4.1 Testes Locais Automatizados (Código, Regras e Dados Sintéticos)
| Suíte | Escopo | Resultado | Observações |
| :--- | :--- | :---: | :--- |
| `scripts/homologate-sprint17-security.cjs` | Auditoria P0/P1 das Frentes 17.1 a 17.5 (RLS, Realtime, Ledger, Custódia, Negativos) | **20/20 PASS** | Testes estáticos de contratos SQL/TS + simulações sintéticas isoladas |
| `scripts/validate-sprint13-contingency.cjs` | Regressão Sprint 13 (Contingência) | **7/7 PASS** | Preservação da dupla aprovação |
| `scripts/validate-sprint14-dashboard.cjs` & `homologate-sprint14-dashboard.cjs` | Regressão Sprint 14 / 14.1 (Dashboard & Realtime) | **6/6 & 23/23 PASS** | Validada migração do listener para `operational_dashboard_signals` |
| `scripts/validate-sprint15-reporting.cjs`, `homologate-sprint15-financial.cjs`, `homologate-sprint15-hardening.cjs` | Regressão Sprint 15 / 15.1 / 15.2 (Relatórios Fiscais & Fail-Closed) | **7/7, 10/10 & 7/7 PASS** | Verificação de RPC canônica única e correção de enum/colunas |
| `scripts/validate-sprint16.cjs` & `homologate-sprint16-reconciliation.cjs` | Regressão Sprint 16 (Conciliação & Fechamento) | **7/7 & 10/10 PASS** | Verificação de segregação de custódia e recebimentos |
| `pnpm exec tsc --noEmit`, `eslint` & `pnpm run build` | Compilação TypeScript, Lint e Build Next.js 15 completo | **Executados pós-edição** | Garantem estabilidade do build sem alterações na infraestrutura |

### 4.2 Testes Transacionais em PostgreSQL Real (SEM `SUPERUSER` / `BYPASSRLS`)
> **STATUS: PENDENTE (Não executado neste ambiente)**  
> Conforme verificado no ambiente local, não há instância local do PostgreSQL (`psql`) nem Docker disponíveis. Portanto, os seguintes cenários **NÃO foram homologados transacionalmente em banco ativo** e **não podem ser tratados como aprovados até execução em staging**:
> 1. Aplicação física sequencial das migrations `79`, `80` e `81` sobre schema remoto/staging real.
> 2. Simulação com sessão autenticada JWT (`authenticated`, sem `BYPASSRLS`) tentando:
>    - `UPDATE contingency_meal_batches SET status = 'approved'` como `unit_manager`/`supervisor` (validação em runtime do `WITH CHECK` e trigger);
>    - `UPDATE`/`DELETE` em `wallet_transactions` com `service_role` (validação da trigger `trg_wallet_transactions_immutable`);
>    - Subscrição WebSocket Realtime em `operational_dashboard_signals` por usuários de Tenant B, usuário inativo e papel `operator`, além de confirmação de revogação imediata após mudança de vínculo;
>    - Execução real de `get_consolidated_financial_report`, `run_financial_reconciliation_audit` e `audit_wallet_custody_integrity` sobre dados sintéticos no Postgres.

---

## 5. Riscos Residuais

1. **Drift Remoto Pré-Aplicação das Migrations 79, 80 e 81:** A migration 78 já foi aplicada remotamente, portanto `meal_consumptions` e `blocked_attempts` continuam na publicação `supabase_realtime` remota até que a migration 81 seja autorizada e aplicada.
2. **Modelagem Canônica de `unit_id` em Carteiras/Pagamentos/Recargas (herdado da Etapa 7A):** Estudantes, carteiras e recargas online vinculam-se à instituição (`students.institution_id`), não necessariamente a uma única unidade física (`unit_id`). Por isso, leituras globais de custódia permanecem bloqueadas para `unit_manager`/`supervisor`.
3. **Aprovação Contábil Formal de Regras de Taxas de Gateway e Estornos:** A apuração de taxas em `payments.raw_response->>'fee'` depende da estrutura efetiva retornada pelos webhooks Asaas/Mercado Pago em Sandbox oficial.
4. **Capacidade sob Concorrência Real (Sprint 18):** O impacto de triggers de sinalização (`operational_dashboard_signals`) e locks sob carga de 1.700 a 2.000 refeições/dia nos horários de pico ainda requer validação em testes de carga (Sprint 18).

---

## 6. Dependências de Homologação Externa

Antes de autorizar o avanço para **GO em staging/produção**:
1. Autorização explícita do usuário para aplicar as migrations locais **79, 80 e 81** em ambiente de staging/Supabase.
2. Execução de suíte transacional contra PostgreSQL real usando papéis `authenticated` (sem `BYPASSRLS`) e validação dos canais Realtime no Supabase.
3. Validação contábil formal com a controladoria/financeiro sobre a definição de passivo de custódia, taxas de gateway e tratativa de divergências.
4. Homologação com credenciais oficiais de **Sandbox** do Asaas e Mercado Pago para confirmação de campos de taxas (`fee`) e eventos de estorno (`refunded`).

---

## 7. Parecer Final da Sprint 17

- **Auditoria e Correções Locais:** **GO** *(vulnerabilidades P0-01 a P0-04, P1-01 a P1-05 e P2-01 a P2-03 mapeadas, corrigidas localmente e documentadas).*
- **Homologação Transacional Remota e Produção:** **NO-GO** *(migrations 79, 80 e 81 não aplicadas remotamente; testes transacionais em PostgreSQL registrados como pendentes).*
