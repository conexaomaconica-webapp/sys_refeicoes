# Etapa 4B — Homologação executável dos indicadores

**Data:** 24/10/2026  
**Ambiente:** Supabase principal `Sys_refeicoes`, autorizado pelo usuário como ambiente de testes  
**PostgreSQL:** 17.6  
**Decisão:** **NO-GO para integração da dashboard com dados reais e NO-GO para produção**

## 1. Proteções adotadas

- Todas as fixtures foram executadas dentro de uma transação finalizada com `ROLLBACK`.
- O benchmark utilizou apenas tabelas temporárias, também finalizadas com `ROLLBACK`.
- Nenhuma migration, policy, tabela real ou dado existente foi alterado.
- A verificação posterior encontrou zero tenants, usuários, refeições, eventos offline e caixas da fixture.
- A verificação posterior encontrou zero sessões da Etapa 4B abertas.
- As três alterações preexistentes em `admin/unidades` foram preservadas.

## 2. Migrations e schema efetivo

O banco possui 71 migrations registradas e o repositório possui as mesmas 71 migrations. Não havia migration pendente e, portanto, nenhuma migration foi aplicada.

O schema efetivo de `offline_contingency_events` contém os campos usados pelas funções posteriores, incluindo `institution_id`, `consumption_date`, `conflict_reason`, `linked_consumption_id`, `financial_debit_applied`, `notes` e `updated_at`.

Entretanto, o estado efetivo não é reproduzível apenas pela cadeia local observada:

- a migration 31 cria a constraint com o estado `pending`;
- o banco efetivo utiliza `received` no lugar de `pending`;
- a migration 33 utiliza colunas que não são adicionadas por ela;
- o banco possui duas policies adicionais em `offline_contingency_events`, com nomes em português, que não foram localizadas nas migrations versionadas.

Isso caracteriza **drift de schema/policies** apesar da equivalência numérica do histórico de migrations.

## 3. Indicadores financeiros e operacionais

Fixture SQL executada no PostgreSQL real:

| Indicador | Esperado | Obtido | Resultado |
| --- | ---: | ---: | --- |
| Refeições servidas | 5 | 5 | aprovado |
| Valor facial | R$ 83 | R$ 83 | aprovado |
| Recargas confirmadas | R$ 130 | R$ 130 | aprovado |
| Saldo em custódia | R$ 85 | R$ 85 | aprovado |
| Falta de caixa | R$ 5 | R$ 5 | aprovado |
| Sobra de caixa | R$ 12 | R$ 12 | aprovado |
| Exposição absoluta | R$ 17 | R$ 17 | aprovado |
| Diferença líquida | R$ 7 | R$ 7 | aprovado |
| Chave offline duplicada | rejeitada | SQLSTATE `23505` | aprovado |

Os valores foram isolados por tenant. Pagamentos, recargas, carteiras e caixa não foram somados ao valor facial das refeições.

## 4. Matriz RLS

A suíte produziu 18 aprovações e 13 falhas.

### Comportamentos aprovados

- Admin e diretor acessaram o escopo esperado do próprio tenant nas tabelas operacionais testadas.
- Financeiro acessou o escopo financeiro global do tenant.
- Supervisor, gerente e operador ficaram restritos à unidade em `meal_consumptions`.
- Operador ficou restrito à unidade em `cash_shifts` dentro do próprio tenant testado.
- Consumidor acessou somente seus próprios registros de estudante, carteira, pagamentos, recargas e refeições.
- Usuário anônimo não obteve registros.
- Unidades, instituições, estudantes, refeições, carteiras, pagamentos e recargas bloquearam o tenant administrativo oposto no cenário testado.

### Falhas confirmadas

1. Supervisor com acesso somente à Unidade A1 leu as três carteiras do tenant.
2. Gerente da Unidade A1 leu as três carteiras do tenant.
3. Supervisor leu os quatro pagamentos e as quatro recargas do tenant.
4. Gerente leu os quatro pagamentos e as quatro recargas do tenant.
5. Supervisor e gerente enxergaram dois estudantes da mesma instituição, sem distinção entre as unidades A1 e A2.
6. Operador da Unidade A1 leu evento offline da Unidade B.
7. Usuário institucional leu todos os eventos offline do tenant.
8. Consumidor leu todos os eventos offline do tenant.
9. Usuário inativo leu todos os eventos offline do tenant.
10. Usuário institucional não conseguiu ler os estudantes da própria instituição.
11. Administrador do Tenant B leu os três caixas sintéticos do Tenant A.

As falhas offline decorrem da combinação da policy versionada, sem escopo de unidade, com duas policies adicionais não versionadas que verificam apenas o tenant. A falha de caixa decorre da ausência de `tenant_id = get_auth_tenant_id()` no ramo de perfis globais da policy de `cash_shifts`.

O isolamento financeiro de supervisor e gerente não pode ser corrigido apenas trocando uma condição: `wallets`, `payments` e parte de `recharges` não possuem uma origem canônica de unidade suficiente para todos os casos. Da mesma forma, `students` possui instituição, mas não uma unidade acadêmica canônica.

## 5. Desempenho

Foi criada uma tabela temporária com 1.100.000 refeições, índices equivalentes aos principais índices atuais e distribuição em 365 dias.

Resultados da rodada comparativa:

| Consulta | Índices equivalentes aos atuais | Índice temporário `(tenant_id, consumption_date)` |
| --- | ---: | ---: |
| Total e valor facial de 30 dias | 4.492 ms | 1.553 ms |
| Agregação por unidade em 30 dias | 2.996 ms | 395 ms |
| Histórico mensal de 12 meses | 1.002 ms | não medido após índice |
| Detalhamento paginado, 50 linhas | 3,3 ms | não necessário |

Os tempos variaram entre execuções por cache e leitura das tabelas temporárias. O índice candidato melhorou as agregações, mas o consolidado ainda ficou acima de um segundo. O teste não inclui concorrência, joins completos, custo real de RLS ou tráfego PostgREST; portanto, nenhum SLA está homologado.

## 6. Correções necessárias

1. Criar migration aditiva que remova as duas policies offline não versionadas e estabeleça uma única política com tenant, status ativo, papel permitido e `has_unit_access(unit_id)`.
2. Corrigir `cash_shifts` e `cash_movements` para sempre validar tenant, inclusive para admin, diretor e financeiro.
3. Definir o vínculo canônico entre estudante, carteira, pagamento, recarga e unidade antes de restringir a camada financeira.
4. Definir se `institution_user` deve listar estudantes da instituição e alinhar `can_manage_students_at_institution` à matriz de permissões.
5. Criar uma migration de reconciliação do schema offline para tornar uma instalação nova reproduzível sem ajustes manuais.
6. Homologar índice composto, consulta agregada ou tabela de resumo somente após fechar o contrato dos indicadores.
7. Reexecutar integralmente esta suíte após as migrations corretivas.

## 7. Critérios de aceite

| Critério | Situação |
| --- | --- |
| Histórico local e remoto de migrations comparado | cumprido |
| Migrations pendentes aplicadas | não aplicável; zero pendentes |
| Schema offline efetivo identificado | cumprido |
| Cadeia reproduzível sem drift | pendente |
| Cinco indicadores validados em SQL real | cumprido |
| Idempotência offline validada | cumprido |
| Isolamento entre tenants | reprovado em caixa |
| Isolamento entre unidades | reprovado em financeiro e offline |
| Usuário inativo sem acesso | reprovado em offline |
| Consumidor sem acesso administrativo | reprovado em offline |
| Performance anual medida | cumprido |
| SLA acordado e homologado | pendente |
| Limpeza integral das fixtures | cumprido |

## 8. Recomendação

- **NO-GO** para conectar a dashboard a dados reais.
- **GO restrito** somente para protótipo visual com dados fictícios e sem integração.
- **NO-GO** para produção até corrigir RLS, drift offline e contrato de escopo financeiro.

Scripts reproduzíveis:

- `scripts/homologate-stage4b-rollback.cjs`
- `scripts/benchmark-stage4b-rollback.cjs`
