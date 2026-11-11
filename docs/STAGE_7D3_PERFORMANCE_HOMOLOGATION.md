# Etapa 7D.3 — Homologação local de desempenho e concorrência

**Data:** 27/10/2026

**Ambiente:** PostgreSQL 17.11 nativo, local, temporário e descartável

**Resultado final:** 24/24 controles transacionais e de desempenho aprovados

## 1. Parecer

**GO** para encerramento local da Etapa 7D.3 e revisão da RPC operacional
otimizada.

**NO-GO** para aplicar as migrations 72, 73 ou 74 em banco existente, criar o
índice candidato em migration, acessar staging/dados reais, conectar o
protótipo, iniciar a Etapa 8, realizar deploy ou liberar produção.

## 2. Escopo executado

A migration 74 foi compilada e aplicada somente no cluster descartável, depois
das migrations 72 e 73. O ciclo validou a compatibilidade sequencial das três
migrations contra o baseline sintético ampliado.

A carga determinística continha:

| Dimensão | Volume |
| --- | ---: |
| consumos | 240.000 |
| tenants | 2 |
| instituições | 3 |
| unidades | 4 |
| linhas no período atual | 135.000 |
| linhas no período anterior | 105.000 |

Foram incluídos registros `approved`, `financially_refunded` e
`cancelled_unserved`, múltiplas categorias e perfis globais, locais,
institucionais, proibidos e inativos.

## 3. Segurança e isolamento

Foram aprovados:

- tenant derivado exclusivamente de `auth.uid()`;
- administrador, diretor e financeiro limitados ao próprio tenant;
- supervisor e gerente limitados a `user_unit_access`;
- usuário institucional limitado a `user_institution_access`;
- recusa de unidade e categoria de outro escopo/tenant;
- recusa de operador, estudante, perfil inativo e anônimo;
- exclusão de `cancelled_unserved` dos agregados;
- filtros combinados de instituição, unidade e categoria;
- concorrência com conexões independentes por identidade, sem troca ou
  vazamento de resultados.

Os papéis `anon` e `authenticated` permaneceram com `rolsuper = false` e
`rolbypassrls = false`.

## 4. Problema identificado e correção

### 4.1 Primeira execução

A implementação inicial passou em segurança, mas foi reprovada em desempenho:

| Métrica | Resultado inicial |
| --- | ---: |
| p95 sequencial com índice candidato | 3.667,11 ms |
| p95 concorrente com índice candidato | 4.262,27 ms |
| blocos temporários lidos/escritos por `EXPLAIN` | 4.916 / 1.229 |

A causa foi a materialização da CTE de consumos brutos, reutilizada para totais,
unidades e categorias. Com quase 200 mil refeições servidas nos dois períodos,
o conjunto intermediário excedia memória e era gravado em temporário.

### 4.2 Otimização aplicada

A migration 74 passou a agregar uma única vez por `unit_id` e `category_id`,
calculando contagens atual/anterior no mesmo scan. Totais, unidades e categorias
reutilizam apenas esse conjunto reduzido.

Também foram executados `VACUUM (ANALYZE)` no ambiente descartável para que o
teste de índice pudesse usar estatísticas e visibility map coerentes.

Resultado estrutural:

- blocos temporários lidos: `0`;
- blocos temporários escritos: `0`;
- `EXPLAIN` sem índice candidato: 530,20 ms;
- `EXPLAIN` com índice candidato: 300,19 ms.

## 5. Resultado final de desempenho

O SLA local provisório foi definido em 1.500 ms para p95 sequencial global e
2.000 ms para p95 concorrente. Ele se aplica somente a esta estação e a esta
carga sintética; não substitui o SLA que deverá ser aprovado em staging.

| Cenário | p50 | p95 | máximo | média |
| --- | ---: | ---: | ---: | ---: |
| índices existentes, sequencial global (30 chamadas) | 683,34 ms | 986,85 ms | 1.082,67 ms | 702,51 ms |
| índices existentes, concorrente (35 chamadas) | 761,56 ms | 1.266,03 ms | 1.677,18 ms | 740,44 ms |
| índice candidato, sequencial global (30 chamadas) | 634,92 ms | 1.181,51 ms | 2.266,04 ms | 698,73 ms |
| índice candidato, concorrente (35 chamadas) | 249,64 ms | 541,07 ms | 557,44 ms | 284,12 ms |

A execução final aprovou **24/24** controles.

## 6. Parecer sobre índices

O índice experimental foi:

```sql
(tenant_id, consumption_date, unit_id, category_id)
WHERE status IN ('approved', 'financially_refunded')
```

Ele foi efetivamente utilizado (`214` scans na execução final), reduziu blocos
compartilhados do `EXPLAIN` de 5.778 para 1.370 e melhorou substancialmente a
carga concorrente. Entretanto, não melhorou de forma consistente o p95
sequencial global.

Decisão: **não criar migration 75 nesta etapa**. O índice permanece candidato e
deverá ser comparado em staging com cardinalidade, distribuição temporal,
cache, autovacuum e concorrência representativos antes de aprovação.

Os índices existentes atenderam ao SLA local provisório depois da otimização da
consulta, reforçando que a correção do plano lógico foi mais importante que a
criação imediata de um novo índice.

## 7. Evidências

| Arquivo | Conteúdo |
| --- | --- |
| `stage7d-performance-20261027-074858.*` | primeira execução e diagnóstico do spill |
| `stage7d-performance-20261027-075503.*` | execução otimizada e calibração do SLA local |
| `stage7d-performance-20261027-075840.*` | execução final 24/24 |

Os arquivos estão em `docs/evidence/stage7d/`. O SHA-256 da evidência JSON final
é `1B5EBAE214A25B23BE06EA84F70872B451477D12B69C6F5F8B6CA6C4FAD4440E`.

## 8. Descarte do ambiente

- processos PostgreSQL residuais: `0`;
- listeners na porta `55438`: `0`;
- clusters `ma-stage7d-<uuid>` residuais: `0`;
- ZIP PostgreSQL temporário: removido;
- distribuição portátil extraída: removida;
- espaço livre final no volume C: `2,78 GiB`;
- dados reais ou remotos acessados: nenhum.

## 9. Arquivos criados ou modificados

- `supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql`;
- `scripts/homologate-stage7d-performance.cjs`;
- `scripts/stage7d/extend-operational-baseline.sql`;
- `scripts/stage7d/seed-performance.sql`;
- `scripts/stage7d/run-native-performance.ps1`;
- `scripts/validate-stage7d-performance.cjs`;
- `package.json`;
- evidências e este relatório.

## 10. Validações adicionais pendentes

Validações finais executadas no repositório:

| Verificação | Resultado |
| --- | --- |
| PostgreSQL real, segurança e desempenho | 24/24 aprovados |
| controles estáticos do kit 7D.3 | 29/29 aprovados |
| contratos 7D.1/7D.2 | 36/36 aprovados |
| controles estáticos RLS da Etapa 7 | 31/31 aprovados |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado, 24/24 páginas estáticas geradas |

O build emitiu somente o aviso preexistente de que o plugin Next.js não foi
detectado na configuração do ESLint, sem interromper a validação.

### Dependências ainda pendentes

Antes de qualquer uso real:

1. reconciliar o schema e as policies efetivas de staging;
2. repetir 31 cenários RLS e a 7D.3 sobre snapshot sanitizado representativo;
3. definir SLA de dashboard por volume e perfil;
4. analisar o índice candidato com `pg_stat_statements`, cache frio/quente e
   autovacuum realistas;
5. validar locks, timeouts, pool de conexões e limites do PostgREST;
6. revisar owner e grants efetivos da RPC;
7. obter autorização separada para a Etapa 7D.4 e staging.

## 11. Status consolidado

| Frente | Situação |
| --- | --- |
| 7D.1 — contratos operacionais | concluída localmente |
| 7D.2 — RPC e isolamento | concluída localmente |
| 7D.3 — desempenho e concorrência | concluída localmente — 24/24 |
| migration 74 em banco existente | não aplicada |
| índice candidato/migration 75 | não criado |
| 7D.4 — plano de staging | aguardando autorização |
| indicadores financeiros | bloqueados |
| produção | NO-GO |
