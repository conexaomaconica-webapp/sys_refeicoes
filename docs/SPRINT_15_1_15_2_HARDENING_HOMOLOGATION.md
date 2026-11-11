# SPRINT 15.1 & 15.2 — Hardening Financeiro e Homologação Contábil

**Data de Elaboração:** 09/11/2026  
**Status do Módulo:** Concluído Localmente (Ambiente Mock / Sandbox)  
**Status de Produção:** **NO-GO** (Aguardando homologação remota transacional e conciliação da Sprint 16)  
**Ambiente de Execução:** Local / Testes de Regressão Automatizados  

---

## 1. Resumo Executivo e Justificativa

A Sprint 15 estruturou a inteligência financeira e fiscal do sistema MA Refeições, agregando faturamento bruto contratual, subsídios institucionais, arrecadação dos comensais, passivo circulante sob custódia e lotes auditáveis de contingência.

Para assegurar rigor absoluto na apuração e na governança dos dados, foram executadas as etapas:
- **Sprint 15.1 (Hardening Financeiro):** Fechamento de brechas de acesso, eliminação de rotas de leitura analítica que contornavam a RPC, garantia de comportamento *fail-closed* e imposição de escopo de unidade obrigatório (`UNIT_SCOPE_REQUIRED`) para supervisores e gestores locais.
- **Sprint 15.2 (Homologação Contábil):** Verificação de 10 casos de teste contábeis exaustivos, validação de regras de arredondamento monetário (`NUMERIC(14,2)`), segregação inviolável entre receita realizada e custódia de recargas, e blindagem de exportações multi-abas (XLSX/PDF) contra *CSV/Excel Formula Injection*.

---

## 2. Sprint 15.1 — Hardening de Segurança e Governança

### 2.1 Eliminação do Fallback Analítico e Fonte Canônica Única
No protótipo inicial da Sprint 15, `src/server/reports/financial-reporting.server.ts` possuía uma função `buildAnalyticalReportFallback` para o caso da RPC não estar disponível. Essa abordagem gerava risco de divergência contábil e de contorno das regras de escopo.

**Alteração Implementada:**
- A função `buildAnalyticalReportFallback` foi **completamente eliminada**.
- A RPC `public.get_consolidated_financial_report` passa a ser a **única fonte canônica oficial**.
- Caso a chamada RPC falhe, o servidor adota a política **fail-closed** imediata, rejeitando a consulta com erro explícito (`FALHA_CONTABIL_FAIL_CLOSED`), impedindo relatórios inconsistentes ou com regras divergentes.

### 2.2 Escopo Obrigatório de Unidade (`UNIT_SCOPE_REQUIRED`)
Gestores de unidade (`unit_manager`) e supervisores (`supervisor`) não possuem permissão para emitir relatórios consolidados do tenant inteiro:
- No TypeScript (`financial-reporting.server.ts`): Verificação prévia da presença do `filters.unitId`.
- Na RPC SQL (`20261109000079_create_financial_reporting_rpcs.sql`):
  ```sql
  IF v_profile.role IN ('unit_manager', 'supervisor') THEN
      IF p_unit_id IS NULL THEN
          RAISE EXCEPTION 'UNIT_SCOPE_REQUIRED: Gestores locais devem obrigatoriamente especificar uma unidade autorizada.' USING ERRCODE = '42501';
      END IF;
      IF NOT public.has_unit_access(p_unit_id) THEN
          RAISE EXCEPTION 'ACCESS_DENIED_UNIT: Usuário sem permissão para acessar esta unidade.' USING ERRCODE = '42501';
      END IF;
  END IF;
  ```

### 2.3 Privilégios e Search Path da RPC
- `SECURITY DEFINER` com `SET search_path = public, pg_temp` impede ataques de sequestro de caminho de busca.
- `REVOKE ALL ON FUNCTION ... FROM PUBLIC` garante que apenas `authenticated` e `service_role` possam invocar a função após verificação de autenticação de sessão.
- Bloqueio estrito de cross-tenant (`TENANT_MISMATCH`).

### 2.4 Blindagem de Dados de Custódia por Papel
- O saldo total em custódia (`wallets.balance`) e as recargas (`recharges.amount`) são visíveis **exclusivamente** para `admin_general`, `operations_director` e `finance`.
- Para `unit_manager` e `supervisor`, esses valores são retornados como `0.00`, evitando vazamento de posição financeira global para operadores locais de restaurantes.

---

## 3. Sprint 15.2 — Homologação Contábil e Regras Fiscais

### 3.1 Princípios Contábeis Homologados

| Conceito | Definição do Sistema MA Refeições | Tratamento Contábil |
| :--- | :--- | :--- |
| **Passivo de Custódia** | Créditos inseridos pelos comensais nas carteiras (`wallets.balance`, `recharges`). | **Passivo Circulante.** Não é receita. Pertence ao aluno até a efetivação do consumo da refeição. |
| **Receita Realizada** | Débito do valor de coparticipação (`student_price`) efetuado na catraca/terminal no momento do consumo. | **Receita Operacional Bruta.** Reconhecida no fato gerador da refeição consumida. |
| **Subsídio Institucional** | Parcela coberta pela contratante: parcial (`subsidy_amount`) ou integral (100% de bolsa). | **Faturamento a Receber da Instituição Contratante.** Comprovado por refeição identificada ou lote de contingência aprovado. |
| **Faturamento Bruto Consolidado** | Soma do valor facial de todas as refeições regulares mais lotes de contingência aprovados. | Base de cálculo contratual (`gross_meal_amount + contingency_gross_amount`). |
| **Contingência Auditada** | Refeições servidas sob queda de rede ou indisponibilidade de terminal (Sprint 13). | Segregadas em lote por data/turno/unidade. **Proibição absoluta de atribuição a comensais fictícios.** |

### 3.2 Cenários Contábeis Sintéticos Homologados (10/10)

1. **Refeição Padrão Subsidiada Parcialmente:** Aluno paga R$ 4,00, Instituição subsidia R$ 9,50, Valor Facial Contratual R$ 13,50.
2. **Refeição Bolsa Integral (100% Subsidiada):** Aluno paga R$ 0,00, Instituição subsidia R$ 13,50, Valor Facial Contratual R$ 13,50.
3. **Comensal Visitante / Sem Subsídio:** Aluno/Visitante paga R$ 13,50, Instituição subsidia R$ 0,00, Valor Facial Contratual R$ 13,50.
4. **Isolamento de Recarga:** Recarga de R$ 100,00 incrementa o Passivo de Custódia em R$ 100,00 sem gerar receita ou subsídio.
5. **Consumo a partir de Saldo:** Consumo de R$ 4,00 debita R$ 4,00 da custódia e converte em R$ 4,00 de receita realizada.
6. **Lote de Contingência Tipo A (Identificado em Lista Física):** 50 refeições apuradas, somadas ao subsídio sem duplicidade com consumos online.
7. **Lote de Contingência Tipo B (Contagem Numérica sem Vínculo de Aluno):** 120 refeições faturadas contratualmente com subsídio institucional, sem comensais fictícios.
8. **Lote de Contingência Tipo C (Ajuste Administrativo Auditado):** Correção justificada e autorizada por diretor operacional.
9. **Estorno Financeiro (`financially_refunded`):** Trilha de auditoria mantida sem afetar indevidamente o subsídio institucional.
10. **Taxas de Gateway:** Registradas em campo dedicado (`gateway_processing_fees`), mantendo a integridade da apuração bruta.

---

## 4. Matriz de Rastreabilidade e Auditoria

| Perfil de Usuário | Visibilidade de Faturamento | Visibilidade de Subsídios | Visibilidade de Custódia/Recargas | Escopo de Unidade |
| :--- | :---: | :---: | :---: | :---: |
| `admin_general` | Global (Todo o Tenant) | Global | Sim (Total) | Global ou Filtro Livre |
| `operations_director` | Global (Todo o Tenant) | Global | Sim (Total) | Global ou Filtro Livre |
| `finance` | Global (Todo o Tenant) | Global | Sim (Total) | Global ou Filtro Livre |
| `supervisor` | Apenas Unidades Alocadas | Apenas Unidades Alocadas | Não (Zerado) | **Obrigatório informar unidade autorizada** |
| `unit_manager` | Apenas Unidades Alocadas | Apenas Unidades Alocadas | Não (Zerado) | **Obrigatório informar unidade autorizada** |
| `operator_terminal` | **Acesso Negado (403)** | **Acesso Negado (403)** | **Acesso Negado (403)** | Bloqueado |
| `student` | **Acesso Negado (403)** | **Acesso Negado (403)** | **Acesso Negado (403)** | Bloqueado |

---

## 5. Próximos Passos (Transição para a Sprint 16)

Com a aprovação técnica e contábil local das Sprints 15, 15.1 e 15.2:
1. **Sprint 16 — Conciliação Financeira Automática e Fechamento:**
   - Conciliação entre webhooks do gateway de pagamento e a tabela `recharges`.
   - Detecção de inconsistências entre ordens pendentes, autorizadas e liquidadas.
   - Rotina de conferência diária de batimento financeiro.
2. **Sprint 17 — Auditoria Final de Segurança P0 e RLS:**
   - Penetration testing automatizado de isolamento entre restaurantes e instituições.
   - Homologação final do banco de dados antes da liberação para produção (GO).

