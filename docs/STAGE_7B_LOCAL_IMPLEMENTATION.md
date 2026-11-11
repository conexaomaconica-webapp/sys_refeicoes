# Etapa 7B — Implementação corretiva exclusivamente local

**Data:** 26/10/2026

**Situação:** correções e testes estáticos locais concluídos

**Migrations aplicadas:** nenhuma

**Produção, staging, deploy e dados reais:** **NO-GO**

## 1. Arquivos criados ou modificados

| Arquivo | Finalidade |
| --- | --- |
| `supabase/migrations/20261026000072_reconcile_offline_contingency_security.sql` | reconcilia schema, status, índice, policies e grants offline |
| `supabase/migrations/20261026000073_harden_scoped_read_policies.sql` | endurece estudantes, financeiro, caixa e movimentos |
| `scripts/validate-stage7-security.cjs` | valida 31 controles estáticos da Etapa 7 |
| `package.json` | adiciona `validate:stage7` |
| `docs/STAGE_7A_SECURITY_AUDIT.md` | registra diagnóstico e matriz das 13 falhas |
| `docs/STAGE_7B_LOCAL_IMPLEMENTATION.md` | registra implementação, testes, rollback e pendências |

## 2. Arquitetura das correções

### Contingência offline

A migration 72 torna a cadeia local reproduzível sem apagar registros. Ela
adiciona campos ausentes, aceita `received` como novo default e mantém `pending`
somente para compatibilidade legada. Todas as policies anteriores da tabela são
removidas no momento da futura aplicação e substituídas por uma policy de leitura
que combina tenant, perfil ativo, papel permitido e unidade.

A RPC experimental continua preservada para rastreabilidade, porém sem
`EXECUTE` para papéis cliente, em conformidade com a estratégia
`ONLINE-FIRST + FAIL-SAFE`.

### Estudantes e instituições

O usuário institucional passa a ler estudantes apenas quando existe vínculo
explícito em `user_institution_access`. Supervisor e gerente não herdam mais
acesso a todos os estudantes de uma instituição apenas porque possuem uma de
suas unidades.

### Financeiro

Enquanto não existir relação canônica entre estudante e unidade, supervisor,
gerente e operador não recebem leitura financeira por tenant. Admin, diretor e
financeiro conservam o acesso do próprio tenant, condicionado a perfil ativo.
Essa é uma contenção fail-closed: resolve a exposição, mas não homologa a
capacidade funcional limitada prevista na matriz de permissões.

### Caixa

As policies de turno e movimento agora verificam tenant e status ativo em todos
os ramos. Perfis locais também precisam de `has_unit_access`. As policies de
escrita foram endurecidas como defesa em profundidade, embora os grants de DML
direto já tenham sido revogados na estabilização anterior.

## 3. Checklist dos 31 cenários

`Aprovado estático` significa que a migration contém o controle e passou pelo
validador local. Não equivale à execução real do PostgreSQL/RLS.

| # | Cenário | Validação local | PostgreSQL/RLS |
| ---: | --- | --- | --- |
| 1 | RLS habilitada em eventos offline | aprovado estático | não testado |
| 2 | policies offline convergem para uma única definição | aprovado estático | não testado |
| 3 | offline isolado por tenant | aprovado estático | não testado |
| 4 | offline exige usuário ativo | aprovado estático | não testado |
| 5 | offline limita papéis operacionais | aprovado estático | não testado |
| 6 | offline exige escopo de unidade | aprovado estático | não testado |
| 7 | instituição sem leitura offline | aprovado estático | não testado |
| 8 | consumidor sem leitura offline | aprovado estático | não testado |
| 9 | inativo sem leitura offline | aprovado estático | não testado |
| 10 | RPC offline revogada de `PUBLIC` | aprovado estático | não testado |
| 11 | RPC offline revogada de `anon` | aprovado estático | não testado |
| 12 | RPC offline revogada de `authenticated` | aprovado estático | não testado |
| 13 | status `received` reproduzível | aprovado estático | não testado |
| 14 | sete colunas offline reconciliadas | aprovado estático | não testado |
| 15 | supervisor sem carteira global | aprovado estático | não testado |
| 16 | gerente sem carteira global | aprovado estático | não testado |
| 17 | supervisor sem pagamentos globais | aprovado estático | não testado |
| 18 | supervisor sem recargas globais | aprovado estático | não testado |
| 19 | gerente sem pagamentos globais | aprovado estático | não testado |
| 20 | gerente sem recargas globais | aprovado estático | não testado |
| 21 | supervisor não infere estudante pela unidade | aprovado estático | não testado |
| 22 | gerente não infere estudante pela unidade | aprovado estático | não testado |
| 23 | instituição lê estudantes explicitamente vinculados | aprovado estático | não testado |
| 24 | consumidor lê somente o próprio estudante | aprovado estático | não testado |
| 25 | turno de caixa isolado por tenant | aprovado estático | não testado |
| 26 | turno de caixa exige usuário ativo | aprovado estático | não testado |
| 27 | turno local exige unidade | aprovado estático | não testado |
| 28 | movimento herda tenant do turno | aprovado estático | não testado |
| 29 | movimento herda unidade do turno | aprovado estático | não testado |
| 30 | leitura financeira exige usuário ativo | aprovado estático | não testado |
| 31 | migrations não desabilitam RLS nem expõem service role | aprovado estático | não testado |

Resultado do validador: **31/31 controles estáticos aprovados**. O resultado de
segurança transacional permanece **0/31 executados**, pois a Etapa 7C não foi
autorizada e não existe PostgreSQL descartável disponível nesta estação.

## 4. Estratégia de aplicação e rollback futuro

Antes de aplicar em staging:

1. exportar schema, owners, ACLs e todas as policies efetivas, especialmente as
   policies offline não versionadas;
2. restaurar uma cópia sanitizada em banco descartável;
3. executar as migrations 72 e 73 em transação e rodar os 31 cenários com
   `anon`, usuários ativos/inativos e todos os perfis;
4. confirmar que não há registros offline com status fora da nova constraint;
5. comparar plano e contagens antes/depois e somente então revisar aplicação.

Rollback seguro:

- preferir uma migration corretiva forward-only;
- não remover as novas colunas, pois isso poderia apagar dados produzidos após a
  aplicação;
- restaurar policies e ACLs a partir do inventário capturado imediatamente antes
  da aplicação, dentro de transação;
- manter as RPCs offline revogadas durante qualquer rollback;
- abortar a transação se qualquer cenário crítico de tenant, unidade ou status
  falhar.

A convergência dinâmica das policies offline exige esse inventário: sem ele não
é seguro aplicar a migration em ambiente persistente.

## 5. Validações executadas

| Validação | Resultado |
| --- | --- |
| `pnpm.cmd run validate:stage7` | 31/31 aprovado |
| `node scripts/validate-stage6.cjs` | 17/17 aprovado |
| `node scripts/homologate-stage5c.cjs` | 21/21 aprovado com servidor e Chrome headless locais |
| `pnpm.cmd run lint` | aprovado |
| `pnpm.cmd run typecheck` | aprovado |
| `pnpm.cmd run build` | aprovado; 24/24 páginas geradas |
| `git diff --check` nos arquivos da etapa | aprovado |
| PostgreSQL descartável | não testado; Docker e `psql` indisponíveis |
| acesso remoto | não executado por restrição de escopo |
| migrations | não aplicadas |

O primeiro acionamento da regressão 5C não iniciou o Chrome DevTools dentro do
sandbox. A repetição autorizada, com servidor e Chrome headless estritamente
locais e encerrados ao final, aprovou as 21 verificações. O primeiro build
atingiu 24/24 páginas, mas excedeu o limite durante a coleta de traces; uma única
repetição com limite ampliado concluiu com código zero.

## 6. Pendências e critérios para dados reais

1. Definir e versionar o vínculo canônico estudante/unidade que sustenta
   carteira, pagamento e recarga.
2. Homologar o contrato financeiro por unidade sem misturar valor facial,
   recarga e saldo em custódia.
3. Inventariar o schema/policies efetivos em staging com autorização específica.
4. Aplicar as migrations primeiro em banco descartável e depois em staging.
5. Executar de fato os 31 cenários e zerar falhas críticas/altas.
6. Auditar as definições efetivas restantes de `SECURITY DEFINER`, owners,
   `search_path` e grants.
7. Homologar concorrência, índices e SLA na futura Etapa 7D.

## 7. Parecer local

**GO** para revisão das correções locais da Etapa 7B.

**NO-GO** para afirmar homologação RLS, aplicar migrations, iniciar 7C/7D,
conectar dados reais, realizar deploy ou liberar produção.
