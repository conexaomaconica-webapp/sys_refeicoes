# Estudo Técnico — Módulo de Ajustes e Regularizações de Refeições (Retroativo por Data e Ajuste Inteligente Mensal)

**Status:** Estudo Técnico e Arquitetural (somente documentação — sem alteração de código, sem criação/execução de migrations e sem acesso remoto)  
**Data:** 11/11/2026  
**Base Arquitetural Analisada:** Sprint 13 ([20261029000077_create_contingency_regularization.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261029000077_create_contingency_regularization.sql)), Sprint 15 ([20261109000079_create_financial_reporting_rpcs.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261109000079_create_financial_reporting_rpcs.sql)), Sprint 17 ([20261110000081_sprint17_p0_security_and_accounting_hardening.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000081_sprint17_p0_security_and_accounting_hardening.sql)), Sprint 20 ([20261110000083_sprint20_daily_closing_persistence.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000083_sprint20_daily_closing_persistence.sql)), [contingency.service.ts](file:///c:/Sys_MArefeicoes/src/server/contingency/contingency.service.ts), [ContingencyManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/contingencia/ContingencyManager.tsx) e [MealScheduleTab.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/categorias/MealScheduleTab.tsx).

---

## 1. Resumo Executivo e Princípios Inegociáveis

O Sistema MA Refeições já possui uma fundação auditável para regularizações retroativas (`public.contingency_meal_batches`, `public.contingency_batch_items`, bucket privado `contingency-evidence`, dupla aprovação com bloqueio de autoaprovação e integração contábil no relatório consolidado). Entretanto, o fluxo atual em `/admin/contingencia` exige que o gestor lance manualmente **uma data por vez**, sem apoio analítico de competência mensal.

Este estudo especifica a evolução dessa estrutura para um **Módulo Unificado de Ajustes e Regularizações de Refeições** (`/admin/ajustes-refeicoes`), reunindo duas modalidades complementares sob o mesmo motor de auditoria, segurança e aprovação:

1. **Modalidade 1 — Retroativo por Data Específica:** evolução direta do lançamento unitário existente, com prévia obrigatória de elegibilidade, duplicidade e impacto financeiro antes da submissão.
2. **Modalidade 2 — Ajuste Inteligente Mensal:** motor analítico que analisa toda a competência (`YYYY-MM`), identifica dias operacionais e lacunas estatísticas de comensais habituais, cruza contagens físicas quando disponíveis e auxilia a conferência e a regularização em duas submodalidades distintas (*Distribuição Inteligente de Quantidades* ou *Reconciliação Individual Assistida*), mantendo saldo não distribuível em **Diferença Mensal Pendente de Apuração**.

### Regras de Ouro Contábeis e de Integridade
- **Lacuna não é prova de atendimento:** a ausência de registro em um dia de um estudante frequente funciona exclusivamente como **indício estatístico de conferência**, jamais como evidência de consumo.
- **Zero matrículas aleatórias ou fictícias:** nenhuma rotina pode sortear estudantes nem criar comensais artificiais para "fechar" um quantitativo.
- **Individualização exige comprovação documental:** registros atribuídos a matrículas (`type_a_identified` / `contingency_batch_items`) exigem lista assinada, folha de portaria ou evidência anexada por item/lote.
- **Não forçar distribuição sem base por data:** se a divergência de `N` refeições estiver comprovada apenas no fechado mensal, sem evidência diária suficiente, a parcela sem base permanece explicitamente como **Pendente de Apuração por Data**, fora do faturamento diário até conciliação documental.
- **Ledger e carteiras intocados:** regularizações aprovadas ajustam quantitativos e subsídios institucionais faturáveis nos relatórios, **sem debitar nem creditar automaticamente `wallets` ou `wallet_transactions`**.

---

## 2. Comparativo das Duas Modalidades

| Critério | Modalidade 1: Retroativo por Data Específica | Modalidade 2: Ajuste Inteligente Mensal |
| :--- | :--- | :--- |
| **Escopo de entrada** | Instituição, unidade, data exata, turno (`almoço`/`jantar`), quantidade, categoria/tipo e evidência. | Instituição, unidade, competência (`YYYY-MM`), turno (`almoço`/`jantar`), quantidade comprovadamente fornecida e opcionalmente contagens diárias de produção/catraca. |
| **Seleção de datas** | Manual (1 data por submissão). | Análise automática do mês inteiro; o sistema propõe datas priorizadas com base em dias operacionais, lacunas habituais e divergências diárias apuradas. |
| **Pesquisa de lacunas** | Validação pontual de duplicidade/elegibilidade na data escolhida. | Varredura mensal de assiduidade histórica, exclusão de consumos/lotes já registrados e detecção de anomalias diárias. |
| **Comportamento quando sem identificação de alunos** | Grava 1 lote agregado (`type_b_unidentified_count` ou `type_c_administrative_adjustment`). | **Submodo A — Distribuição Inteligente:** gera campanha vinculada a `N` lotes agregados por data sugerida/confirmada pelo gestor, sem vincular matrículas; ou retém parcela sem base diária como **Pendente Mensal**. |
| **Comportamento quando há lista nominal / comprovantes** | Grava lote `type_a_identified` + `contingency_batch_items` validando unicidade em `meal_consumptions`. | **Submodo B — Reconciliação Individual Assistida:** lista estudantes habituais com lacuna em dias críticos apenas como candidatos à conferência; somente linhas marcadas com referência documental/comprovante seguem para `contingency_batch_items`. |
| **Prévia antes de gravar** | Sim (contagem, valores por `meal_rules`, conflitos). | Sim (distribuição sugerida dia a dia, saldo distribuível vs pendente mensal, desvios e impacto financeiro). |
| **Auditoria e aprovação** | Mesma trilha (`contingency_meal_batches` + `review_contingency_batch` com segregação de funções). | Mesma trilha + registro mestre da campanha mensal (`meal_adjustment_campaigns`) preservando o histórico único de aprovações. |

---

## 3. Reaproveitamento da Arquitetura Atual e Lacunas Identificadas no Código

A análise direta das migrations e serviços atuais mostra o que já existe pronto e quais ajustes pontuais são necessários para evitar retrabalho ou duplicação:

| Ativo Existente | O que já entrega | Lacuna / Adaptação Necessária |
| :--- | :--- | :--- |
| `public.contingency_meal_batches` (Migration 77) | Tabela principal de lotes (`type_a_identified`, `type_b_unidentified_count`, `type_c_administrative_adjustment`), status, justificativa, `evidence_document_url`, aprovação e valores unitário/subsídio. | Adicionar suporte opcional de rastreio de origem (`campaign_id`, `adjustment_modality`) sem quebrar lotes legados; criar suporte para estado mensal não alocado em data (`meal_adjustment_campaigns`) fora da tabela diária até rateio. |
| `public.contingency_batch_items` (Migration 77) | Vincula alunos reais em lotes `type_a_identified` com `UNIQUE (batch_id, student_id)`. | `submit_contingency_batch` (Migration 81) checa duplicidade apenas em `meal_consumptions`, **não** checa se o mesmo aluno já consta em outro lote `contingency_batch_items` (`pending_approval`/`approved`) na mesma data/turno; precisa fechar essa brecha cross-batch. |
| `storage.objects` (`contingency-evidence`, Migration 81) | Bucket privado 15 MB com RLS isolada por `${tenant_id}/...`. | Reutilizar integralmente para atas mensais, mapas de produção e listas assinadas. |
| `review_contingency_batch` & `trg_prevent_contingency_tampering` (Migrations 77/81) | `FOR UPDATE`, perfil ativo obrigatório, bloqueio de autoaprovação (`operator_id = v_reviewer_id`, exceto `admin_general`), imutabilidade após `approved`/`rejected`. | Reutilizar diretamente em todos os lotes individuais ou agregados gerados por qualquer modalidade; avaliar remoção gradual da exceção de autoaprovação ou exigência de dupla assinatura acima de limiar configurável. |
| `public.unit_meal_types` ([actions.ts](file:///c:/Sys_MArefeicoes/src/app/admin/categorias/actions.ts)) | Controla habilitação e janela horária (`start_time`, `end_time`) de almoço/jantar por unidade. | **Não existe calendário de dias úteis/feriados/recessos.** Para o Ajuste Inteligente saber em quais dias o RU funcionou, o sistema precisa combinar atividade registrada (`meal_consumptions` ou `cash_shifts` no dia) com uma tabela opcional `unit_operating_calendar` (ou marcação explícita de exceções). |
| `public.get_consolidated_financial_report` (Migration 79) e `close_financial_daily_period` (Migration 83) | Agregam automaticamente `contingency_meal_batches WHERE status = 'approved'`, preservando separação entre `regular_meals_served`, `contingency_meals_served`, `student_paid_amount` e `contingency_subsidy_amount`. | Lotes diários aprovados entram automaticamente sem duplicar código. Diferenças mensais **não distribuídas por data** devem ficar em entidade separada (`pending_allocation`) até que tenham base verificável por dia, evitando distorção em `financial_daily_closings`. |

---

## 4. Arquitetura Proposta e Organização de Rotas

### 4.1 Estratégia de Rota (`/admin/ajustes-refeicoes` + compatibilidade `/admin/contingencia`)
Para cumprir o princípio de **único módulo administrativo com histórico unificado**, recomenda-se:
- Criar a rota principal **`/admin/ajustes-refeicoes`**, incorporando o menu lateral de [AdminShell.tsx](file:///c:/Sys_MArefeicoes/src/components/admin/AdminShell.tsx) com o rótulo **"Ajustes e regularizações"**.
- Manter `/admin/contingencia` redirecionando (`redirect('/admin/ajustes-refeicoes')`) — ou compartilhando exatamente o mesmo container — para preservar bookmarks e permissões já auditadas nas Sprints 13 e 17.
- Estruturar a página em **três seções integradas**:
  1. **Seletor de Modalidade (2 Abas):**
     - **Aba 1: Retroativo por Data Específica** (evolução do formulário atual de lote único com prévia de elegibilidade/conflito antes do envio).
     - **Aba 2: Ajuste Inteligente Mensal** (assistente em 3 passos: *Parâmetros e Análise da Competência -> Conferência e Modalidade de Regularização -> Prévia Contábil e Submissão*).
  2. **Painel de Pendências Mensais Não Conciliadas** (exibe competências que possuem saldo comprovado no mês ainda sem atribuição diária confiável).
  3. **Histórico Único de Ajustes e Aprovações** (unifica todos os lotes individuais, lotes oriundos de campanhas inteligentes e campanhas mensais com filtros por unidade, competência, modalidade, origem e status).

### 4.2 Separação de Camadas (`Next.js` + `Supabase`)
- **`src/lib/adjustments/smart-gap-analyzer.ts` (Motor Puro / Determinístico):** funções puras testáveis em Node.js sem banco para cálculo de frequência habitual, escore de lacunas, priorização por divergência de produção e rateio proporcional limitado a teto verificável.
- **`src/server/adjustments/smart-adjustment.service.ts` (`server-only`):** autenticação, validação estrita de `tenant_id`, `role` e `has_unit_access(unit_id)`, coleta agregada da competência, persistência de campanha e orquestração de submissão em lote.
- **`src/server/contingency/contingency.service.ts`:** reutilizada como núcleo único de consulta do histórico, itens identificados e invocação das RPCs de submissão/aprovação.

---

## 5. Algoritmo de Análise de Lacunas e Distribuição Inteligente

O algoritmo opera estritamente de forma **determinística, explicável e auditável** (sem heurísticas opacas de IA generativa nem sorteio aleatório).

### 5.1 Entradas da Análise (`analyzeMonthlyMealGaps`)
- **Obrigatórias:** `tenantId`, `institutionId`, `unitId`, `competence` (`YYYY-MM`), `mealTypeId` (almoço ou jantar).
- **Opcionais de comprovação:**
  - `provenUnrecordedTotal` (`INT >= 0`): quantidade total de refeições comprovadamente fornecidas e não registradas no mês (ou na soma das evidências).
  - `dailyServedEvidence?: Array<{ date: string; physicalTotalServed: number; sourceRef: string }>`: contagens diárias confiáveis (ex.: mapa de cubas/produção da cozinha ou contador mecânico da catraca).
  - `lookbackDays` (padrão `60` dias anteriores à competência para baseline de assiduidade).

### 5.2 Etapas do Algoritmo (Passo a Passo)

1. **Determinação dos Dias Operacionais da Unidade (`D_op`):**
   - Para cada dia $d$ dentro da competência (`[inicio_mes, min(fim_mes, CURRENT_DATE)]`):
     - Verificar que `unit_meal_types.enabled = true` para `(unit_id, meal_type_id)`.
     - Se existir registro em `unit_operating_calendar` para `(unit_id, d)` com `is_operating = false` (feriado, greve, manutenção), excluir $d$.
     - Caso não exista calendário explícito cadastrado, considerar $d$ como operacional se houver qualquer evidência real de operação na unidade/turno (`EXISTS meal_consumptions` na data, `EXISTS cash_shifts` aberto na data ou presença em `dailyServedEvidence`), permitindo ao gestor marcar/desmarcar dias excepcionais na UI de conferência.
     - Dias sem atividade operacional não entram como lacuna.

2. **Apuração dos Registros Já Existentes por Dia (`R_d` e `C_d`):**
   - $R_d$: contagem de `meal_consumptions` com `status IN ('approved', 'financially_refunded')` em `(unit_id, meal_type_id, consumption_date = d)`.
   - $C_d$: soma de `total_meals_served` em `contingency_meal_batches` com `status IN ('pending_approval', 'approved')` em `(unit_id, meal_type_id, service_date = d)`.
   - $TotalRegistrado_d = R_d + C_d$.

3. **Identificação da Base de Estudantes Habituais (`H`) e Elegibilidade Histórica na Data (`d`):**
   - Selecionar estudantes ativos vinculados à `institution_id` (respeitando `student_categories` ativas) cuja data de criação/vínculo seja compatível com $d$.
   - Calcular assiduidade na janela histórica $[inicio\_mes - lookbackDays,\ inicio\_mes - 1]$ + dias da competência com operação regular:
     $$f_s = \frac{\text{dias com consumo aprovado do estudante } s \text{ no turno}}{\text{total de dias operacionais da janela em que } s \text{ esteve ativo}}$$
   - Classificar como **comensal habitual** apenas quando $f_s \ge f_{min}$ (ex.: $f_{min} = 0{,}40$ e mínimo de $5$ consumos prévios no turno).

4. **Detecção de Lacunas Individuais Candidatas (`G_d`) e Exclusão de Duplicidades:**
   - Para cada dia operacional $d \in D_{op}$ e cada estudante habitual $s \in H$:
     - Excluir se $s$ estiver inativo/bloqueado em $d$ ou sem `meal_rule` habilitada vigente (`effective_from`/`effective_to`) naquela categoria/unidade/data.
     - Excluir se já existir consumo em `meal_consumptions` (`status = 'approved'`) para `(student_id = s, meal_type_id, consumption_date = d)` — **inclusive em outra unidade no mesmo turno** (regra de unicidade diária do turno).
     - Excluir se já existir item em `contingency_batch_items` cujo lote em `contingency_meal_batches` esteja em `pending_approval` ou `approved` para `(student_id = s, meal_type_id, service_date = d)`.
   - As ocorrências restantes formam o conjunto $G_d$ (**lacunas potenciais para conferência no dia $d$**), com escore individual baseado em assiduidade histórica $f_s$ e presença em outros turnos do mesmo dia (ex.: jantou no dia sem registro de almoço).

5. **Apuração de Divergência Comprovada e Ranqueamento Diário (`S_d`):**
   - **Caso 1 — Há contagem física por dia (`dailyServedEvidence`):**
     - Divergência diária verificável:
       $$\Delta_d = \max(0,\ \text{physicalTotalServed}_d - TotalRegistrado_d)$$
     - Esses dias têm prioridade máxima (**Evidência Direta de Divergência**).
   - **Caso 2 — Não há contagem física por dia, apenas eventos operacionais + lacunas estatísticas:**
     - Calcular desvio relativo em relação à média móvel do mesmo dia da semana ($M_{dow}$), quedas anômalas em `operational_dashboard_signals` / `blocked_attempts`, e volume de lacunas habituais $|G_d|$.
     - Gerar um **Indicador de Conferência por Dia ($w_d$)** transparente e auditável (exibido na interface com o porquê de cada dia sugerido: *"12 habituais ausentes; queda de 34% vs terças anteriores; 2 lotes já registrados"*).

6. **Regra Decisória Entre Distribuição por Data vs. Retenção em Saldo Mensal Pendente:**
   - A partir da `provenUnrecordedTotal` ($Q$):
     1. **Alocação por Divergência Direta ($\Delta_d$):** aloca-se primeiro nos dias com $\Delta_d > 0$ comprovado, limitado a $\min(\Delta_d,\ Q_{restante})$.
     2. **Sugestão Assistida por Base Verificável (quando autorizada pela política do tenant):** se restar $Q_{restante} > 0$ e houver **base documental/operacional por data** (ex.: dias em que o gestor anexa evidência de atendimento ou confirma as datas sugeridas a partir das lacunas), distribui-se por Método dos Maiores Restos (Hamilton) preservando inteiros exatos ($\sum q_d = Q_{alocado}$) e respeitando o teto razoável do dia (nunca concentrar volume incompatível com a capacidade da unidade).
     3. **Bloqueio de Chute Mensal (Regra Obrigatória):** se a quantidade $Q$ estiver comprovada **apenas para o mês inteiro**, sem contagem diária nem identificação/comprovação por data após a conferência, **o sistema NÃO força distribuição automática por dias**. O saldo remanescente fica explicitamente registrado como **`unallocated_monthly_pending`** (*Diferença Mensal Pendente de Apuração*), aguardando folha complementar ou confirmação documental futura.

7. **Fluxo das Duas Submodalidades na Conferência:**
   - **Submodalidade A — Distribuição Inteligente de Quantidades (Agregada):** gera lotes `type_b_unidentified_count` por data confirmada (sem associar matrículas), usando categoria/regra selecionada ou rateio proporcional transparente definido pelo gestor, vinculados a uma campanha mestra e submetidos para aprovação segregada.
   - **Submodalidade B — Reconciliação Individual Assistida:** apresenta por data a lista filtrável de estudantes em $G_d$ com motivo da sugestão (*ex.: assiduidade 85%*). O botão de confirmação exige marcar cada estudante e informar **referência de comprovação** (nº da folha física assinada, anexo PDF/foto no `contingency-evidence` ou registro de catraca manual), gerando lote(s) `type_a_identified` apenas para os comensais efetivamente comprovados.

---

## 6. Modelo de Dados Proposto (Aditivo e Não-Destrutivo)

Mantém integralmente as tabelas da Migration 77 e acrescenta apenas o mínimo necessário para campanhas mensais, calendário operacional opcional e saldo pendente sem data:

### 6.1 Tabela `public.unit_operating_calendar` (Opcional / Calendário Operacional)
- `id UUID PK`
- `tenant_id UUID NOT NULL REFERENCES public.tenants(id)`
- `unit_id UUID NOT NULL REFERENCES public.units(id)`
- `calendar_date DATE NOT NULL`
- `meal_type_id UUID NULL REFERENCES public.meal_types(id)` (`NULL` aplica à unidade inteira no dia)
- `is_operating BOOLEAN NOT NULL` (`false` = feriado/recesso/paralisação; `true` = funcionamento excepcional em fim de semana)
- `reason TEXT`
- `created_by UUID REFERENCES public.profiles(id)`, `created_at TIMESTAMPTZ`
- **Unique:** `(tenant_id, unit_id, calendar_date, COALESCE(meal_type_id, '00000000-0000-0000-0000-000000000000'))`

### 6.2 Tabela `public.meal_adjustment_campaigns` (Campanha / Registro Mestre Mensal)
Centraliza uma solicitação de **Ajuste Inteligente Mensal**, guarda os parâmetros da análise, o snapshot de cálculo explicável e eventual saldo mensal pendente de apuração sem data:
- `id UUID PK`
- `tenant_id UUID NOT NULL REFERENCES public.tenants(id)`
- `institution_id UUID NOT NULL REFERENCES public.institutions(id)`
- `unit_id UUID NOT NULL REFERENCES public.units(id)`
- `meal_type_id UUID NOT NULL REFERENCES public.meal_types(id)`
- `competence_month DATE NOT NULL` *(sempre 1º dia do mês, ex.: `2026-11-01`)*
- `modality TEXT NOT NULL CHECK (modality IN ('smart_quantity_distribution', 'smart_individual_reconciliation'))`
- `proven_total_meals INT NOT NULL CHECK (proven_total_meals > 0)`
- `allocated_meals_count INT NOT NULL DEFAULT 0 CHECK (allocated_meals_count >= 0)`
- `unallocated_pending_meals INT NOT NULL DEFAULT 0 CHECK (unallocated_pending_meals >= 0)` *(diferença mensal sem base por data)*
- `allocation_status TEXT NOT NULL CHECK (allocation_status IN ('draft', 'partially_allocated_pending', 'submitted_for_approval', 'approved', 'rejected', 'cancelled'))`
- `analysis_snapshot JSONB NOT NULL` *(dias operacionais analisados, lacunas encontradas, pesos/divergências diárias, parâmetros de lookback)*
- `justification TEXT NOT NULL`
- `evidence_document_url TEXT`
- `created_by UUID NOT NULL REFERENCES public.profiles(id)`
- `approved_by UUID REFERENCES public.profiles(id)`
- `approved_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`
- **Constraint matemática:** `CHECK (allocated_meals_count + unallocated_pending_meals = proven_total_meals)`

### 6.3 Extensão Aditiva em `public.contingency_meal_batches`
Sem alterar contratos existentes (novas colunas anuláveis ou com default retrocompatível):
- `adjustment_modality TEXT NOT NULL DEFAULT 'single_date_manual'` CHECK IN (`'single_date_manual'`, `'smart_quantity_distribution'`, `'smart_individual_reconciliation'`)
- `campaign_id UUID NULL REFERENCES public.meal_adjustment_campaigns(id) ON DELETE RESTRICT`
- Índice `idx_contingency_batches_campaign ON public.contingency_meal_batches(tenant_id, campaign_id) WHERE campaign_id IS NOT NULL`

### 6.4 Trava Cross-Batch em `public.contingency_batch_items`
- Adicionar `service_date DATE` e `meal_type_id UUID` denormalizados (populados pelo servidor/RPC a partir do batch) OU trigger `BEFORE INSERT` garantindo que nenhum `student_id` apareça em **mais de um** lote `pending_approval`/`approved` no mesmo `(tenant_id, service_date, meal_type_id)`, bloqueando duplicidade mesmo entre lotes distintos ou entre Modalidade 1 e Modalidade 2.

---

## 7. Fluxo de Interface Administrativa (`/admin/ajustes-refeicoes`)

```
+----------------------------------------------------------------------------------+
| Ajustes e Regularizações de Refeições                                            |
| [ Aba 1: Retroativo por Data ]   [ Aba 2: Ajuste Inteligente Mensal ]            |
+----------------------------------------------------------------------------------+
```

### Aba 1 — Retroativo por Data Específica
- Seleção de **Instituição**, **Unidade**, **Data** ($\le$ hoje e dentro da competência permitida), **Almoço/Jantar**, **Tipo** (`Individual com Lista Assinada`, `Agregado sem Matrícula`, `Ajuste Administrativo`), **Quantidade** e **Categoria de preço**.
- **Prévia Automática Antes de Confirmar:** exibe quantas refeições regulares (`R_d`) e contingências (`C_d`) já existem na data, os valores unitário e de subsídio vigentes em `meal_rules` para aquela data e validação prévia de conflitos caso haja lista nominal.

### Aba 2 — Ajuste Inteligente Mensal
1. **Filtro de Competência:** Instituição + Unidade + Mês/Ano (`competence`) + Refeição + Quantidade Comprovada (`proven_total_meals`) + Upload opcional de evidência mensal/contagem diária (`.csv` ou anexo PDF/imagem no `contingency-evidence`).
2. **Painel Analítico de Oportunidades (somente indícios):**
   - KPIs: *Dias operacionais no mês*, *Lacunas estatísticas de habituais encontradas*, *Refeições já registradas/regularizadas*, *Quantidade a conferir*.
   - Alerta visual permanente: *"Lacunas são indícios estatísticos para conferência, nunca prova automática de consumo."*
3. **Escolha da Submodalidade na Conferência:**
   - **Distribuição Inteligente (Agregada):** tabela dia a dia com coluna *"Motivo da Sugestão"* (ex.: *Divergência física +8 / 14 habituais sem registro*), edição manual controlada da distribuição pelo gestor e marcador explícito caso reste saldo em **Diferença Mensal Pendente de Apuração** (por falta de base por data).
   - **Reconciliação Individual Assistida:** tabela por data listando candidatos habituais com lacuna, checkbox de confirmação individual habilitado somente após preencher *"Comprovante / Referência da Lista"* + anexo do lote.
4. **Prévia Final Contábil & Submissão:** exibe o resumo exato dos lotes diários a criar (`pending_approval`), eventual saldo pendente mensal sem data e impacto estimado em subsídio/bruto, sem tocar no saldo das carteiras.

### Histórico Único de Ajustes e Aprovações (Rodapé/Seção Comum)
- Tabela unificada listando lotes da Modalidade 1, lotes gerados pela Modalidade 2 (com chip vinculando à `Campanha #id`) e campanhas com parcela **Pendente de Apuração por Data**.
- Ações de revisão (**Aprovar / Rejeitar** em lote único ou por campanha inteira) executadas com `review_contingency_batch` e dupla aprovação segregada.

---

## 8. Impactos nos Relatórios Financeiros e Fechamento Diário

| Origem do Registro | Onde Entra | Entra no Faturamento / Subsídio? | Altera Carteira / Ledger? |
| :--- | :--- | :--- | :--- |
| Consumo normal no terminal (`meal_consumptions`) | Relatório consolidado (`regular_meals_served`) e fechamento diário (`realized_student_revenue`, `contractual_subsidies`) | Sim | Sim (já debitado no momento do consumo online) |
| Lote individual comprovado (`type_a_identified` aprovado) | Relatório consolidado (`contingency_meals_served`, `contingency_subsidy_amount`) e fechamento diário (`contingency_subsidies`) | Sim, como **Regularização Individual Auditada** (separado de consumo regular online) | **Não** (salvo ação administrativa separada e justificada em `/admin/financeiro`) |
| Lote agregado por data (`type_b_unidentified_count` / `type_c` aprovado) | Relatório consolidado (`contingency_breakdown`) e fechamento diário (`contingency_subsidies`) na `service_date` | Sim, como **Regularização Agregada Institucional** | **Não** |
| Diferença mensal sem base por data (`unallocated_pending_meals` em `meal_adjustment_campaigns`) | Exibida em quadro informativo separado: **"Pendências Mensais em Apuração (Não Faturadas)"** | **Não** (não entra em `total_gross_invoicing` nem em `financial_daily_closings` até atribuição verificada a datas) | **Não** |

---

## 9. Requisitos de Segurança, Permissões e Imutabilidade

1. **Matriz de Acesso (alinhada a [PERMISSIONS_v1_2.md](file:///c:/Sys_MArefeicoes/docs/PERMISSIONS_v1_2.md)):**
   - **Análise, Prévia e Submissão:** `admin_general`, `operations_director`, `supervisor`, `unit_manager` (os dois últimos restritos estritamente via `has_unit_access(unit_id)` e `user_unit_access`). `operator` e `student` bloqueados em `RLS` e `RPC`.
   - **Aprovação / Rejeição:** apenas `admin_general`, `operations_director` e `finance`, sempre por RPC `SECURITY DEFINER` com `SET search_path = ''`, `REVOKE ALL FROM PUBLIC, anon` e `FOR UPDATE`.
   - **Segregação de Funções:** `created_by` / `operator_id` não pode aprovar a própria campanha/lote (reforçando bloqueio mesmo para perfis financeiros; avaliando remoção de autoaprovação ou registro de auditoria reforçado).
2. **RLS e Storage:** `ENABLE` + `FORCE ROW LEVEL SECURITY` em `meal_adjustment_campaigns` e `unit_operating_calendar`; anexos obrigatórios sob prefixo `${tenant_id}/batches/...` no bucket `contingency-evidence`.
3. **Imutabilidade e Anti-Adulteração:** trigger `BEFORE UPDATE OR DELETE` impedindo alteração de quantidades, datas, alunos, snapshot analítico ou valores financeiros após `approved` ou `rejected`.
4. **Competência Permitida:** bloqueio de data futura e bloqueio/alerta configurável para competências já fechadas em `financial_daily_closings` (ou exigência de registro como ajuste administrativo com aprovação diretoria/financeira quando período já estiver fechado).

---

## 10. Critérios de Aceite, Testes Obrigatórios e Plano de Implementação

### Plano de Implementação Sugerido (Somente após autorização)
- **Fase A — Banco e Segurança (Nova Migration Local, ex.: `84`):** criar `unit_operating_calendar`, `meal_adjustment_campaigns`, campos opcionais em `contingency_meal_batches`, trava cross-batch em `contingency_batch_items` e RPCs `analyze_monthly_meal_gaps` / `submit_smart_adjustment_campaign` / `review_smart_adjustment_campaign`.
- **Fase B — Motor Puro e Serviços Server-Side:** implementar `smart-gap-analyzer.ts` (100% puro), `smart-adjustment.service.ts` e unificar o preview da Modalidade 1 em `contingency.service.ts`.
- **Fase C — Interface `/admin/ajustes-refeicoes`:** construir o painel com Abas 1 e 2, modal de prévia, lista de reconciliação assistida com exigência de comprovante, painel de diferença mensal pendente e histórico único.
- **Fase D — Relatórios & Regressão:** atualizar UI/XLSX de `/admin/relatorios` para destacar `Regularizações Individuais` vs `Regularizações Agregadas` vs `Pendências Mensais sem Alocação` e executar homologação em PostgreSQL 17 descartável.

### Matriz Mínima de Testes Obrigatórios Antes do GO Local
1. **Testes Unitários do Motor Puro:** garante que estudantes habituais sem consumo **nunca** sejam convertidos em itens individuais automaticamente; garante soma exata dos lotes sem arredondamento quebrado e retenção em `unallocated_pending_meals` quando não houver base diária.
2. **Testes Transacionais PostgreSQL 17 Descartável:**
   - Isolamento multi-tenant (`TENANT_MISMATCH`), bloqueio de `unit_manager` fora da unidade (`has_unit_access`), bloqueio de `operator`/`anon`/perfil inativo.
   - Duplicidade cross-batch: impede incluir o mesmo `student_id` na mesma `(service_date, meal_type_id)` em dois lotes ou contra `meal_consumptions` aprovado.
   - Autoaprovação bloqueada, imutabilidade pós-aprovação e **zero mutações** em `wallets` e `wallet_transactions`.
   - Integridade matemática: `allocated_meals_count + unallocated_pending_meals = proven_total_meals`, e confirmação de que `unallocated_pending_meals` **não** infla `get_consolidated_financial_report` nem `close_financial_daily_period`.
3. **Validações Contínuas (`AGENTS.md`):** `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build` e regressões Sprints `13`–`20`.

