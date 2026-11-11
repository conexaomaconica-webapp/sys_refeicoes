# Etapa 8A.5 — Revisão de prontidão para execução remota

**Data:** 27/10/2026  
**Escopo:** revisão e preparação exclusivamente locais  
**Operações remotas:** nenhuma

## 1. Parecer executivo

**GO** para concluir a revisão local e preparar uma decisão futura.

**NO-GO para aplicar a migration 75 no Supabase neste momento.** Antes dessa
autorização, deve ser executado e aprovado o snapshot remoto estritamente
read-only preparado nesta etapa.

A homologação 24/24 da Etapa 8A.4 prova o comportamento em PostgreSQL 17.11
descartável. Ela não comprova que owners, definições, `search_path`, triggers e
ACLs do schema efetivo correspondem integralmente ao baseline.

## 2. Revisão da migration 75

A migration é aditiva em segurança e altera somente ACLs:

- não remove nem substitui funções;
- não remove nem recria triggers;
- não altera dados ou políticas RLS;
- remove `EXECUTE` de `PUBLIC` nas 12 assinaturas do preflight;
- mantém `authenticated` somente em
  `get_terminal_shift_reports(uuid,uuid,text)`;
- trata `rls_auto_enable()` condicionalmente;
- falha se qualquer função existente permanecer executável por `PUBLIC`.

As onze assinaturas versionadas são referenciadas diretamente por `REVOKE`; se
alguma estiver ausente ou tiver assinatura diferente, a transação falhará antes
do commit. A função remota não versionada `rls_auto_enable()` é opcional.

## 3. Matriz de impacto

| Assinatura/grupo | Situação | Impacto esperado |
| --- | --- | --- |
| `get_terminal_shift_reports(uuid,uuid,text)` | RPC ativa no frontend | preserva `authenticated`; smoke test obrigatório por unidade |
| `admin_list_cash_shifts(uuid,varchar,date,date)` | overload legado | fluxo atual usa cinco argumentos, incluindo `meal_type_id` |
| `get_active_cash_shift(uuid,varchar)` | RPC legada | sem chamada no frontend atual; permanece fechada |
| `record_cash_movement(uuid,varchar,numeric,varchar,text)` | RPC legada | sem chamada no frontend atual; wrappers posteriores substituem o fluxo |
| `register_visitor_entry(uuid,uuid,text,varchar)` | overload legado | fluxo atual usa `register_operator_visitor_entry` |
| seis funções de trigger | execução indireta | triggers permanecem associados; 8A.4 comprovou execução sem grant direto |
| `rls_auto_enable()` | event trigger remoto em drift | definição e vínculo precisam do snapshot remoto |

Scripts históricos `apply-migration-34/35/36.cjs` ainda chamam RPCs legadas,
mas são ferramentas antigas de aplicação/homologação e não podem ser executados
no ambiente remoto. Eles não representam consumidores do frontend atual.

## 4. Snapshot obrigatório antes da mudança

Arquivo preparado:
`scripts/stage8a/05-migration75-preapply-readonly.sql`.

O snapshot coleta apenas metadados:

- presença das 12 assinaturas;
- owner, linguagem, `SECURITY DEFINER`, volatilidade e `proconfig`;
- MD5 da definição sem imprimir o corpo da função;
- privilégios efetivos de `PUBLIC`, `anon` e `authenticated`;
- triggers e event triggers associados;
- presença da versão 75 no histórico de migrations.

Gate obrigatório: as 12 assinaturas devem existir no ambiente observado, a
migration 75 ainda não pode constar como aplicada e qualquer divergência de
owner, hash, configuração ou vínculo deve ser revisada antes da aplicação.

## 5. Plano de aplicação futura

Somente após autorização independente para mudança remota:

1. confirmar projeto, janela e responsável pela decisão de commit;
2. comprovar backup/PITR disponível e registrar identificador do ponto de
   recuperação segundo os recursos do plano Supabase;
3. executar o snapshot read-only e preservar seu JSON sanitizado;
4. comparar assinaturas, owners, hashes, configurações, ACLs e triggers;
5. confirmar que não existem sessões ou clientes usando as quatro RPCs legadas;
6. preparar identidades reais de teste para a RPC ativa, com unidades permitida
   e proibida;
7. aplicar a migration 75 em transação controlada, com `lock_timeout` e
   `statement_timeout` definidos;
8. antes do commit, conferir a pós-condição de ACL e abortar diante de qualquer
   assinatura ausente, lock, erro ou grant inesperado;
9. após o commit, executar
   `scripts/stage8a/06-migration75-postapply-readonly.sql`;
10. executar smoke tests da RPC ativa e dos fluxos que disparam os seis triggers;
11. somente depois avaliar, em autorização separada, a conta temporária de
    auditoria.

## 6. Critérios de interrupção

Executar `ROLLBACK` antes do commit se ocorrer qualquer condição abaixo:

- projeto, versão ou histórico de migrations divergente;
- assinatura alvo ausente ou overload inesperado;
- owner não identificado ou incompatível com a identidade aplicadora;
- mudança de hash/configuração sem revisão;
- trigger esperado ausente ou desabilitado;
- lock acima do limite definido;
- `PUBLIC` ainda executável após a migration;
- `anon` executável em qualquer alvo;
- `authenticated` divergente da matriz esperada;
- ausência de identidade adequada para o smoke test da RPC ativa.

## 7. Recuperação

O rollback seguro possui duas situações:

### Antes do commit

Usar `ROLLBACK`. ACLs e `NOTIFY` são transacionais no PostgreSQL, e a Etapa
8A.4 comprovou a restauração integral nesse cenário.

### Depois do commit

Executar correção forward-only. Nunca conceder novamente a `PUBLIC` como atalho.
Se for comprovado que um fluxo autorizado depende de uma assinatura, conceder
`EXECUTE` somente ao papel mínimo e à assinatura exata, após aprovação do
incidente. Falhas mais amplas devem usar o ponto de recuperação previamente
registrado, conforme o procedimento operacional do Supabase.

Não foi criada uma down migration que restaure os ACLs vulneráveis.

## 8. Autorizações independentes

As decisões abaixo não devem ser combinadas:

| Decisão | Escopo | Situação |
| --- | --- | --- |
| snapshot remoto read-only da 8A.5 | metadados das 12 funções | requer autorização |
| aplicação remota da migration 75 | alteração de ACL | bloqueada |
| Conta temporaria de auditoria | criação, uso e revogação do papel | bloqueada |
| inventário 8A com auditor dedicado | metadados autorizados | bloqueado |
| Etapas 8B/8C | reconciliação e staging | NO-GO |
| produção | dados reais e deploy | NO-GO |

Aplicar o hardening não autoriza criar a conta. Criar a conta não autoriza
aplicar migrations. Cada operação exige aprovação, evidência e rollback próprios.

## 9. Riscos residuais

1. `rls_auto_enable()` permanece drift remoto sem definição versionada local.
2. A RPC ativa possui `search_path` histórico e exige hardening de corpo em etapa
   separada, não misturada à migration 75.
3. O repositório não possui telemetria que prove ausência total de clientes
   externos ou versões antigas usando RPCs legadas.
4. Backup/PITR e restauração ainda não foram comprovados para o projeto remoto.
5. A conta auditora não deve ser criada enquanto o hardening remoto permanecer
   pendente ou sem autorização própria.

## 10. Validações locais

| Verificação | Resultado |
| --- | ---: |
| controles de prontidão 8A.5 | 18/18 |
| controles de hardening 8A.3 | 20/20 |
| controles estáticos do runner 8A.4 | 16/16 |
| regressões RLS | 31/31 |
| regressão arquitetural da Etapa 6 | 17/17 |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado; 24/24 páginas geradas |

Os dois novos scripts SQL foram revisados estaticamente como read-only, mas não
foram executados contra PostgreSQL ou Supabase nesta etapa. O build manteve o
aviso preexistente sobre o plugin Next.js na configuração ESLint.

## 11. Critério para futura autorização

A aplicação remota da migration 75 poderá ser considerada somente quando:

- o snapshot read-only estiver aprovado e preservado;
- todas as divergências estiverem explicadas;
- backup/PITR estiver confirmado;
- responsáveis, janela e critérios de aborto estiverem definidos;
- identidades para testes positivo e negativo estiverem disponíveis;
- houver autorização expressa e exclusiva para aplicar a migration 75.
