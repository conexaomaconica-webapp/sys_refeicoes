# SPRINT 15 — Relatórios Fiscais, Subsídios e Faturamento Consolidado

**Data:** 09/11/2026  
**Status:** Implementação Local Concluída (GO — Validação Local | NO-GO — Produção/Externa)  
**Documentos de Referência:** [DEVELOPMENT_PLAN.md](file:///c:/Sys_MArefeicoes/docs/DEVELOPMENT_PLAN.md), [DATABASE.md](file:///c:/Sys_MArefeicoes/docs/DATABASE.md), [SECURITY.md](file:///c:/Sys_MArefeicoes/docs/SECURITY.md)

---

## 1. Objetivo e Princípios Contábeis

Fornecer à administração da **MA Refeições** e aos gestores institucionais relatórios gerenciais, financeiros e fiscais para acompanhamento diário e prestação de contas mensal às instituições contratantes (universidades/empresas).

### Princípios Contábeis e Fiscais Inegociáveis:
1. **Não-Confusão Contábil (Custódia vs Receita Realizada):**
   - Recargas antecipadas realizadas por estudantes (via Pix, Cartão ou Dinheiro) constituem **Passivo Circulante sob Custódia** da operadora, e **NÃO** receita tributável imediata.
   - O reconhecimento de receita operacional ocorre exclusivamente no momento do consumo da refeição (débito atômico na carteira).
2. **Segregação do Subsídio Institucional:**
   - O valor faturável contra a instituição contratante é formado pela parcela subsidiada das refeições consumidas por alunos parciais (`subsidy_amount`) + valor integral das refeições de bolsistas 100% isentos (`full_price`) + contingências aprovadas.
3. **Proibição de Comensais Fictícios em Contingência:**
   - As refeições fornecidas em regime de contingência (catraca travada, apagão ou pane de rede) registradas na Sprint 13 permanecem segregadas como "Lotes de Contingência / Contagem Física" e jamais atribuídas artificialmente a alunos.
4. **Proteção contra Injeção de Fórmulas:**
   - Todas as células de planilhas exportadas (.xlsx / CSV) são sanitizadas por `sanitizeCellForExport`, neutralizando prefixos como `=`, `+`, `-`, `@`, `\t` e `\r`.

---

## 2. Fontes Canônicas de Dados e Modelagem

| Grandeza Contábil | Tabela Canônica | Regra de Extração / Agregação |
| :--- | :--- | :--- |
| **Faturamento Bruto Regular** | `meal_consumptions` | $\sum \text{full\_price}$ onde `status IN ('approved', 'financially_refunded')` |
| **Subsídio Institucional Regular** | `meal_consumptions` | $\sum \text{subsidy\_amount}$ onde `status IN ('approved', 'financially_refunded')` |
| **Arrecadação Direta de Comensais** | `meal_consumptions` | $\sum \text{student\_price}$ debitado das carteiras dos comensais |
| **Contingência Aprovada** | `contingency_meal_batches` | $\sum \text{total\_amount}$ e $\sum \text{total\_subsidy\_amount}$ onde `status = 'approved'` |
| **Recargas no Período (Passivo)** | `recharges` | $\sum \text{amount}$ onde `status = 'completed'` |
| **Saldo sob Custódia (Passivo)** | `wallets` | $\sum \text{balance}$ das carteiras ativas |
| **Taxas Operacionais de Gateway** | `payments` | $\sum \text{provider\_fee}$ de pagamentos concluídos |

---

## 3. Arquitetura Técnica e Arquivos Criados

1. **Migration SQL:**
   - `supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql`:
     - RPC `get_consolidated_financial_report` com `SECURITY DEFINER`, restrição de papéis gerenciais (`admin_general`, `operations_director`, `finance`, `supervisor`, `unit_manager`) e validação de escopo via `has_unit_access`.
     - *Nota:* Armazenada localmente e mantida em NO-GO para execução remota conforme diretriz.

2. **Contratos TypeScript:**
   - `src/types/financial-reporting.ts`: Contratos para resumos fiscais, detalhamento por categoria, consolidado por unidade e lotes de contingência.

3. **Backend Service (Server-Only):**
   - `src/server/reports/financial-reporting.server.ts`:
     - `getFinancialReportingInitialData`: Carrega filtros iniciais autorizados.
     - `getConsolidatedFinancialReport`: Executa a RPC ou fallback estruturado com RLS.
     - `generateFinancialReportExcelWorkbook`: Gera arquivo Excel (.xlsx) com 5 abas sanitizadas.

4. **API Route de Exportação Segura:**
   - `src/app/api/admin/relatorios/export/route.ts`:
     - Endpoint autenticado para download do arquivo `.xlsx` com header `Content-Disposition`.

5. **Interface de Usuário e Visualização:**
   - `src/components/admin/FinancialReportingDashboard.tsx`:
     - Painel com filtros de data (atalhos: mês atual, mês anterior, últimos 30 dias), instituição, unidade e categoria.
     - 4 Cards de Segregação Contábil Mandatória.
     - Abas analíticas por Categoria, Unidade, Contingência e Memória Contábil.
     - Botões de Exportação Excel (.xlsx) e Impressão / Salvar PDF com termo de encerramento fiscal.

6. **Página e Navegação:**
   - `src/app/admin/relatorios/page.tsx`: Rota de relatórios fiscais.
   - `src/components/admin/AdminShell.tsx` e `src/app/admin/page.tsx`: Menu integrado com ícone `Receipt`.

---

## 4. Indicadores que Dependem de Definição Contratual / Contábil Específica

Os seguintes pontos possuem impacto em prestação de contas e devem ser formalizados no fechamento de cada contrato institucional:

1. **Tratamento de Sobras de Saldo (Alunos Desligados / Formados):**
   - Definição do prazo de expiração ou processo de ressarcimento do saldo em custódia de carteiras inativas.
2. **Taxa de Administração de Contingência:**
   - Regra contratual estipulando se refeições de contingência Tipo B (contagem física sem matrícula) recebem o preço integral do contrato ou tarifa de subsídio operacional pré-acordada.
3. **Absorção de Taxas de Gateway:**
   - Confirmação se a taxa do Pix/Cartão é deduzida da receita da concessionária ou repassada contratualmente.

