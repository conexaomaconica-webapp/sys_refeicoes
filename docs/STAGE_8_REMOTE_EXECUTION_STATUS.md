# Etapa 8 — Status da execução remota autorizada

**Data:** 27/10/2026  
**Resultado atualizado:** snapshot e migration executados manualmente pelo SQL
Editor; smoke de ACL aprovado

## Escopo autorizado

Foram autorizados o snapshot remoto read-only, a migration 75 e o início das
Etapas 8B/8C. A sequência de segurança da Etapa 8A.5 manteve o snapshot como
gate anterior a qualquer alteração.

## Execução realizada

Foi preparado o runner
`scripts/stage8a/run-migration75-snapshot.cjs`, que:

- aceita somente o projeto Supabase vinculado ao repositório;
- exige a identidade administrativa PostgreSQL esperada;
- exige autorização efêmera por variável de ambiente;
- usa `rejectUnauthorized: true`;
- inicia `BEGIN TRANSACTION READ ONLY`;
- aplica limites de tempo e sempre tenta `ROLLBACK`;
- recusa comandos de escrita no arquivo de snapshot;
- salva somente JSON sanitizado de metadados.

Foram realizadas duas tentativas:

1. CA padrão embutida do Node;
2. CA confiável do Windows via `node --use-system-ca`.

Ambas foram recusadas com `SELF_SIGNED_CERT_IN_CHAIN` antes da autenticação.
Em seguida, o fluxo foi transferido para o Supabase SQL Editor, sem desabilitar
a validação TLS. O snapshot read-only foi executado, a migration 75 foi aplicada
manualmente pelo usuário e o pós-check retornou `approved:true` para as 12
assinaturas.

## Gate de ambiente

O projeto vinculado está nomeado `Sys_refeicoes` e não possui identificação
local de staging. Como produção continua em NO-GO, esse projeto não pode ser
tratado como staging por inferência.

## Situação

| Operação | Resultado |
| --- | --- |
| snapshot remoto read-only | concluído via SQL Editor |
| migration 75 no Supabase | aplicada manualmente; ausente do histórico de migrations |
| pós-check de ACL | aprovado para 12/12 assinaturas |
| smoke anônimo | acesso negado conforme esperado |
| smoke autenticado na unidade permitida | F7 abriu e exibiu aprovados |
| Etapa 8B | compatibilidade e smoke de ACL aprovados; reconciliação do histórico pendente |
| Etapa 8C | preflight executado; bloqueada antes de conexão porque staging não foi identificado |
| produção | permanece NO-GO para novas migrations e integração real |

## Condições para continuidade

1. criar ou identificar um projeto de staging expressamente isolado da
   produção;
2. comprovar backup/PITR e um procedimento de restauração;
3. reconciliar a migration 75 aplicada por SQL Editor com o histórico, sem
   inserir versões manualmente por improviso;
4. executar em staging o teste autenticado negativo entre unidades;
5. manter novas migrations e a integração real bloqueadas no projeto de
   produção.

O preflight posterior à autorização da 8C está documentado em
`docs/STAGE_8C_EXECUTION_STATUS.md`.

## Validações locais após a interrupção

| Verificação | Resultado |
| --- | ---: |
| sintaxe do runner de snapshot | aprovada |
| controles de prontidão 8A.5 | 18/18 |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado; 24/24 páginas geradas |

O build manteve somente o aviso preexistente sobre o plugin Next.js na
configuração ESLint.
