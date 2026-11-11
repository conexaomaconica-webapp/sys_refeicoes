# 9E.3 — Matriz de isolamento entre duas unidades

**Execução:** bloqueada até autorização específica  
**Pré-condição:** duas unidades ativas e identidades de teste controladas

## Fixture mínima

- um tenant e duas unidades distintas, A e B;
- um supervisor, gerente e operador vinculados somente à unidade A;
- equivalentes vinculados somente à unidade B;
- um perfil institucional com escopo documentado;
- consumidores sintéticos vinculados a cada unidade;
- refeições, caixas, bloqueios e eventos sintéticos identificáveis;
- nenhum `service_role`, `SUPERUSER` ou `BYPASSRLS` nos testes de usuário.

## Matriz de expectativas

Legenda: `P` permitido, `N` negado/fail-closed, `E` conforme escopo explícito.

| Perfil da unidade A | Recurso A | Recurso B | Mutação B |
| --- | ---: | ---: | ---: |
| operador | P | N | N |
| gerente de unidade | P | N | N |
| supervisor | P | N | N |
| usuário institucional | E | N | N |
| consumidor | próprio | N | N |
| financeiro global do tenant | P | P conforme matriz | somente ação autorizada |
| diretor operacional | P | P conforme matriz | somente ação autorizada |
| admin geral | P | P no próprio tenant | P conforme RBAC |

## Recursos obrigatórios

1. `meal_consumptions` e `blocked_attempts`;
2. `cash_shifts`, movimentos e relatórios de turno;
3. eventos offline legados, somente leitura autorizada;
4. carteiras, recargas, pagamentos e ledger;
5. Central de Inteligência/RPC operacional;
6. comensais, importações e arquivos privados;
7. unidades, horários, preços e categorias;
8. funções/RPCs com `SECURITY DEFINER`.

Para cada recurso devem existir testes `SELECT`, chamada de RPC e tentativa de
mutação quando aplicável. Resultado vazio ou erro autorizado conta como negação;
retorno de linha da unidade B para perfil A é falha crítica.

## Casos transversais

- perfil inativo não acessa A nem B;
- troca fraudulenta de `unit_id`/JWT não amplia escopo;
- tenant diferente nunca é visível, inclusive para perfis globais do tenant;
- relatórios e RPCs aplicam a mesma contenção das tabelas;
- função definer possui `search_path` seguro e valida escopo internamente;
- logs e evidências usam apenas aliases `UNIT_A` e `UNIT_B`.

## Critérios de aprovação

- 100% das negações esperadas efetivamente negadas;
- 100% dos acessos legítimos preservados;
- zero linha cruzada entre tenants ou unidades;
- zero privilégio incompatível herdado de `PUBLIC`;
- limpeza das identidades/fixtures comprovada quando autorizada.

Usar `9e3-multiunit-isolation.template.json`.

