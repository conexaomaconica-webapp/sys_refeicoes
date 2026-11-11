# SPRINT 16 — CONCILIAÇÃO FINANCEIRA AUTOMÁTICA E FECHAMENTO

**Data de Implementação:** 09/11/2026  
**Status do Módulo:** Concluído Localmente (Ambiente Mock / Sandbox)  
**Status de Produção:** **NO-GO** (Aguardando homologação remota transacional com credenciais oficiais de Sandbox)  
**Ambiente de Execução:** Local / Testes Sintéticos de Auditoria  

---

## 1. Resumo Executivo e Objetivos

A **Sprint 16** estabelece o motor de **Conciliação Financeira Automática e Fechamento Diário** do Sistema MA Refeições. Seu objetivo é confrontar, de forma contínua e matemática, as cobranças processadas nos gateways de pagamento (Asaas e Mercado Pago) com os lançamentos efetivos no Livro-Razão Imutável (`wallet_transactions`), detectando divergências, duplicidades e inconsistências antes que se tornem passivos operacionais.

### Prioridades Estruturais:
1. **Identificar e Classificar Primeiro:** A conciliação audita, classifica por severidade e alerta. **É estritamente proibido criar lançamentos compensatórios automáticos** sem análise e homologação humana.
2. **Segregação Rigorosa de Contas:** Manter separadas as contas de **Recebimentos Brutos** (Pix/Cartão/Dinheiro), **Passivo Circulante sob Custódia** (recargas de carteira) e **Receita Realizada** (consumo de refeição debitado na catraca).
3. **Idempotência e Trilha Imutável:** Garantir que webhooks duplicados ou recebidos com latência não causem créditos duplicados ou falhas no livro-razão.

---

## 2. Fontes Canônicas e Arquitetura do Batimento

O motor de conciliação opera sobre três fontes canônicas de dados:

```text
[ Gateway de Pagamento ] ──(Webhook/API)──▶ public.payments (Cobrança)
                                                │
                                                ▼
                                         public.recharges (Ordem de Recarga)
                                                │
                                                ▼
[ Livro-Razão Imutável ] ◀──(RPC Atômica)── public.wallet_transactions (Crédito)
```

| Fonte Canônica | Tabela | Papel Contábil |
| :--- | :--- | :--- |
| **Cobrança Gateway** | `public.payments` | Comprova se a instituição financeira confirmou o recebimento dos fundos (`status = 'confirmed'`). |
| **Ordem de Recarga** | `public.recharges` | Registra a intenção de crédito vinculada à carteira do comensal (`wallet_id`). |
| **Livro-Razão (Ledger)** | `public.wallet_transactions` | Fonte da verdade do saldo. Imutável (sem `UPDATE`/`DELETE`). Somente transações com `reference_type = 'payment'` representam recargas. |
| **Consumo Operacional** | `public.meal_consumptions` | Fato gerador da **Receita Realizada** (`student_price`) e do **Subsídio Institucional** (`subsidy_amount`). |

---

## 3. Matriz de Classificação de Divergências

Quando uma discrepância é detectada pelo motor, ela é registrada na tabela `financial_reconciliation_divergences` com a respectiva severidade:

| Tipo de Divergência | Severidade | Causa Raiz | Impacto Operacional |
| :--- | :---: | :--- | :--- |
| **`missing_ledger_credit`** | **CRÍTICA** | Cobrança confirmada no gateway, mas sem lançamento no ledger. | Comensal pagou mas não recebeu saldo na carteira. |
| **`orphan_ledger_credit`** | **CRÍTICA** | Lançamento de recarga no ledger sem cobrança confirmada correspondente. | Crédito indevido na carteira sem lastro financeiro. |
| **`cancelled_with_credit`** | **CRÍTICA** | Cobrança cancelada ou falha no gateway, mas com saldo mantido no ledger. | Risco de fraude ou consumo com pagamento estornado. |
| **`amount_mismatch`** | **ALTA** | Valor pago no gateway difere do valor lançado no ledger. | Saldo creditado a maior ou a menor. |
| **`refund_mismatch`** | **ALTA** | Estorno no gateway sem compensação ou com saldo insuficiente na carteira. | Divergência de saldo em estornos. |
| **`delayed_webhook`** | **MÉDIA** | Webhook recebido com latência superior a 1 hora. | Atraso na liberação do saldo para o comensal. |
| **`duplicate_webhook_attempt`** | **BAIXA** | Notificação repetida interceptada com sucesso pela barreira de idempotência. | Informativo de segurança. |

---

## 4. Fechamento Financeiro Diário

O fechamento diário consolida o fluxo financeiro de cada dia e unidade restaurante, segregando rigorosamente os meios de recebimento, a obrigação patrimonial em custódia e o faturamento realizado:

$$\text{Recebimentos Brutos por Meio} = \text{Pix} + \text{Cartão} + \text{Dinheiro (Caixa)}$$

$$\text{Passivo Efetivo sob Custódia} = \sum \text{wallets.balance} = \sum (\text{Créditos} - \text{Consumos} - \text{Estornos} \pm \text{Ajustes no Ledger})$$

$$\text{Faturamento Bruto Entregue} = \text{Receita Realizada (Comensais)} + \text{Subsídios Regulares} + \text{Subsídios de Contingência}$$

- **Status Equilibrado (`balanced`):** Zero divergências abertas no período e deriva patrimonial igual a zero ($\text{Saldo Carteiras} - \sum \text{Ledger} = 0,00$).
- **Status Divergente (`divergent`):** Existem divergências pendentes de resolução manual ou deriva patrimonial detectada.

---

## 5. Estrutura de Banco de Dados (Migration 80)

Arquivo: `supabase/migrations/20261109000080_create_financial_reconciliation.sql` *(mantido localmente)*

- **Tabelas Criadas:**
  - `financial_reconciliation_batches`: Lotes de auditoria com resumo de transações e volume auditado.
  - `financial_reconciliation_divergences`: Histórico auditável de divergências com campos `resolved_by`, `resolved_at` e `resolution_notes`.
  - `financial_daily_closings`: Registro diário consolidado por tenant, data e unidade.
- **Segurança (RLS):**
  - `FORCE ROW LEVEL SECURITY` ativa em todas as tabelas, restrita a `admin_general`, `operations_director` e `finance`.
  - Gestores locais (`unit_manager`, `supervisor`) possuem acesso restrito aos fechamentos da sua própria unidade.
- **RPC `run_financial_reconciliation_audit`:**
  - Função `SECURITY DEFINER` com `search_path = ''` e execução revogada de `PUBLIC` e `anon`.
  - Execução atômica com validação rigorosa de tenant e fail-closed.

---

## 6. Módulo Administrativo e Exportação Segura

- **Área Dedicada:** `/admin/conciliacao`
- **Componente:** `src/components/admin/ReconciliationDashboard.tsx`
  - Cards de KPIs (Volume Auditado, Taxa de Conciliação %, Divergências Abertas, Saldo sob Custódia).
  - Aba de Visão Executiva e Lotes.
  - Aba de Gestão e Resolução de Divergências com modal e parecer obrigatório.
  - Aba de Fechamento Diário Consolidado.
  - Aba de Normas e Idempotência.
- **Exportação Multi-Abas:** `/api/admin/conciliacao/export`
  - Planilha Excel (.xlsx) com proteção nativa contra *CSV/Excel Formula Injection* (`sanitizeCellForExport`).

---

## 7. Status e Próximos Passos (Sprint 17)

| Item | Status Atual | Observações |
| :--- | :---: | :--- |
| **Motor de Conciliação** | **Aprovado** | Testado com dados sintéticos e cenários de borda |
| **Fechamento Diário** | **Aprovado** | Segregação de custódia e receita homologada |
| **Interface de Auditoria** | **Aprovada** | Modal de resolução com justificativa obrigatória |
| **Exportação XLSX** | **Aprovada** | Multi-abas com sanitização anti-fórmula |
| **Credenciais Reais de Gateway** | **Pendente** | Ambiente permanece em Mock/Sandbox |
| **Aplicação Remota de Migrations** | **Pendente** | Migrations 79 e 80 aguardam autorização formal |

**Próxima Sprint recomendada:** **Sprint 17 — Auditoria Final de Segurança P0, Isolamento Multi-Tenant e Ledger**, para consolidar as barreiras de autorização antes de qualquer liberação para homologação remota.

