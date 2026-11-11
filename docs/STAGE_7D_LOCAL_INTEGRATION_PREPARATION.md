# Etapas 7D.1 e 7D.2 — Contratos e integração operacional local

**Data:** 27/10/2026

**Escopo:** preparação exclusivamente local dos contratos e da RPC de leitura
dos quatro indicadores operacionais priorizados na Etapa 6

**Situação:** implementação local concluída; migration preparada e não aplicada

## 1. Parecer

**GO** para revisão e homologação local das Etapas 7D.1 e 7D.2.

**NO-GO** para aplicar a migration 74, conectar Supabase, consultar dados reais,
executar em staging, iniciar 7D.3/7D.4, realizar deploy ou liberar produção.

## 2. Indicadores abrangidos

| Indicador | Fonte canônica proposta | Regra |
| --- | --- | --- |
| refeições servidas | `meal_consumptions` | conta `approved` e `financially_refunded` |
| volume por restaurante | `meal_consumptions` + `units` | agrupa dentro do escopo autorizado |
| utilização por categoria | `meal_consumptions` + `student_categories` | contagem e percentual do período atual |
| comparativo por período | `meal_consumptions` | períodos de mesma duração, fim exclusivo |

`cancelled_unserved` não representa refeição fisicamente servida e fica fora de
todos os agregados.

Nenhuma tabela ou coluna financeira é consultada. Valor facial, recargas, saldo
em custódia e divergência de caixa continuam bloqueados até a aprovação da
modelagem financeira canônica.

## 3. Contrato TypeScript

Foi criado um contrato operacional independente do snapshot visual sintético:

- consulta com período atual e anterior em datas ISO;
- filtros reais por UUID de instituição, unidade e categoria;
- listas omitidas representam todo o escopo autorizado;
- listas vazias são recusadas para impedir ampliação acidental de escopo;
- períodos devem ter de 1 a 366 dias e a mesma duração;
- resposta versionada como `stage7d-operational-v1`;
- estados explícitos `ready`, `empty` e `unavailable`;
- conferência entre o total, o agrupamento por unidade, o agrupamento por
  categoria e o comparativo do período;
- mensagens de erro internas da RPC não são repassadas ao cliente.

O adaptador `RpcOperationalIntelligenceProvider` depende somente de um executor
injetado. Ele não importa, configura ou instancia o Supabase. Assim, o contrato
pode ser testado localmente sem liberar integração real.

O protótipo em `/demonstracao/central-inteligencia` não foi conectado ao novo
adaptador e continua usando exclusivamente o fornecedor sintético homologado.

## 4. RPC preparada

A migration local
`20261027000074_prepare_operational_intelligence_reads.sql` define a RPC:

```text
get_operational_intelligence_v1(
  p_period_start date,
  p_period_end date,
  p_previous_start date,
  p_previous_end date,
  p_institution_ids uuid[] | null,
  p_unit_ids uuid[] | null,
  p_category_ids uuid[] | null
) -> jsonb
```

O tenant não é parâmetro. Ele é obtido exclusivamente do perfil associado a
`auth.uid()`.

### 4.1 Controles de acesso

| Perfil | Escopo operacional |
| --- | --- |
| `admin_general`, `operations_director`, `finance` | próprio tenant |
| `supervisor`, `unit_manager` | `user_unit_access` explícito |
| `institution_user` | `user_institution_access` explícito |
| `operator`, `student`, anônimo ou perfil inativo | recusado |

Todo UUID solicitado é validado antes da agregação. Unidades, instituições ou
categorias inexistentes, de outro tenant ou fora do escopo geram falha
`42501`; não são silenciosamente ignoradas.

### 4.2 Hardening

- `LANGUAGE plpgsql STABLE`;
- `SECURITY DEFINER` com `search_path = ''`;
- referências a tabelas totalmente qualificadas;
- execução revogada de `PUBLIC` e `anon`;
- execução concedida somente a `authenticated`;
- perfil ativo obrigatório;
- máximo de 100 UUIDs por dimensão;
- ausência de escrita, DDL destrutiva ou alteração de RLS;
- nenhuma dependência de `service_role`.

## 5. Semântica temporal

Os intervalos são `[início, fim)`: a data inicial é inclusiva e a final é
exclusiva. Isso elimina sobreposição entre meses consecutivos e torna explícita
a comparação com período anterior de igual duração.

A fonte é `consumption_date`, já calculada no fuso operacional da unidade pelo
motor de consumo. A RPC não reconverte `consumed_at`, evitando alterar o dia
contábil originalmente registrado.

Quando o período anterior possui zero refeições, `variation_percent` retorna
`null`, pois não há base matemática comparável.

## 6. Arquivos criados ou modificados

- `src/features/intelligence/operational-contracts.ts`;
- `src/features/intelligence/providers/rpc-operational-intelligence.provider.ts`;
- `src/features/intelligence/indicator-catalog.ts`;
- `supabase/migrations/20261027000074_prepare_operational_intelligence_reads.sql`;
- `scripts/validate-stage7d-local.cjs`;
- `package.json`;
- este relatório.

## 7. Validações locais

| Verificação | Resultado |
| --- | --- |
| contratos e controles 7D.1/7D.2 | 36/36 aprovados |
| regressão arquitetural da Etapa 6 | 17/17 aprovada |
| controles estáticos de segurança da Etapa 7 | 31/31 aprovados |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado, 24/24 páginas estáticas geradas |
| execução da migration 74 em PostgreSQL | não executada |
| consulta a Supabase ou dados reais | nenhuma |

A suíte específica valida compilação isolada dos contratos, datas, UUIDs,
deduplicação de filtros, estados do provider, versão do payload, consistência
dos totais, papéis, escopos, grants e ausência de fontes financeiras.

O build emitiu somente o aviso preexistente de que o plugin Next.js não foi
detectado na configuração do ESLint, sem interromper a validação.

## 8. Dependências para staging

Antes de aplicar ou executar a RPC fora do ambiente local será obrigatório:

1. reconciliar o schema e as policies existentes em staging;
2. revisar a migration 74 contra o inventário real;
3. executar a migration em transação e ambiente isolado;
4. repetir os 31 cenários RLS no schema reconciliado;
5. homologar os contratos com dados sintéticos representativos;
6. concluir 7D.3 para índices, `EXPLAIN`, concorrência e SLA;
7. obter autorização separada para 7D.4 e staging.

## 9. Riscos residuais

- a RPC ainda não foi compilada ou executada em PostgreSQL;
- o desempenho depende da distribuição real de consumos e dos índices do
  ambiente de destino;
- o baseline sintético da 7C não representa todo o schema de staging;
- permissões e owners efetivos precisam ser inventariados antes da aplicação;
- indicadores financeiros permanecem fora do contrato e fail-closed;
- não existe autorização para conectar o adaptador ao protótipo com dados reais.

## 10. Status consolidado

| Frente | Situação |
| --- | --- |
| 7D.1 — contratos reais de leitura operacional | concluída localmente |
| 7D.2 — consultas e RPC com isolamento | preparada localmente, não aplicada |
| 7D.3 — concorrência, índices e desempenho | aguardando autorização |
| 7D.4 — plano e homologação em staging | bloqueada |
| indicadores financeiros | bloqueados |
| produção | NO-GO |
