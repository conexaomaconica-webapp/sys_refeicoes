# Etapa 8C — Status da homologação em staging

**Data:** 27/10/2026  
**Resultado atualizado:** pacote atômico 72–74 aplicado; pós-check remoto aprovado

## Escopo autorizado

Foi autorizada a execução da Etapa 8C. A autorização cobre a homologação das
migrations preparadas em um ambiente Supabase de staging isolado. Ela não
transforma o projeto de produção em staging e não autoriza a criação automática
de um projeto externo com possível impacto financeiro.

## Preflight executado

| Verificação | Resultado |
| --- | --- |
| projeto Supabase vinculado ao repositório | presente; confirmado anteriormente como produção |
| referência distinta para staging | ausente |
| variáveis de ambiente específicas de staging | ausentes |
| `supabase/config.toml` | ausente |
| Supabase CLI | indisponível na estação |
| plano 7D.4 | exige staging isolado e dados sintéticos |
| conexão remota durante este preflight | nenhuma |
| migrations executadas durante este preflight | nenhuma |

Foram inspecionados apenas nomes de variáveis de ambiente; valores, senhas,
tokens e chaves não foram exibidos nem registrados.

## Mudança de ambiente autorizada

O usuário decidiu não criar staging e autorizou expressamente a aplicação das
migrations 72, 73 e 74 no projeto oficial `Sys_refeicoes`. A migration 75 já
está aplicada e não será reaplicada.

O inventário remoto read-only confirmou:

- PostgreSQL 17.6;
- 15/15 relações obrigatórias presentes;
- todas as colunas e funções exigidas presentes;
- RLS habilitada nas relações exigidas;
- migrations 72–74 ausentes do histórico;
- RPC `get_operational_intelligence_v1` ausente, como esperado antes da 74;
- 1.250 eventos offline preservados;
- drift parcial: estruturas e policies de 72–73 já existem sem registro no
  histórico.

A sessão do SQL Editor possui `BYPASSRLS`; ela é aceita exclusivamente para o
DDL administrativo autorizado e não serve como identidade dos testes RLS.

## Pacote de aplicação

Foi gerado
`scripts/stage8c/supabase-sql-editor/02-apply-production-migrations-72-74.sql`,
contendo uma única transação com preflight, migrations 72 → 73 → 74,
pós-condições e `COMMIT`. Qualquer exceção anterior ao commit desfaz todo o
pacote.

Hashes das fontes incluídas:

- 72: `59f807659086352bb79211ec1efdb21c7f7695e8502dfd7e2f2c32632359700c`;
- 73: `2366745fb1dc760da810c1dac6a54885c31ef3fce4f1102bb273a14ca8db9f25`;
- 74: `10062d9faf19bd4234d14d589e1a552d0e8eb28cd67fb79e732e7f2fadf1e8aa`.

## Próxima ação

O pacote foi executado integralmente no SQL Editor e retornou:

- `approved: true`;
- PostgreSQL `170006`;
- policy offline única `sel_offline_events_scoped_staff`;
- RPC operacional v1 presente;
- histórico automático das migrations ausente.

Não houve reaplicação da migration 75. A próxima ação é executar o smoke
funcional das policies e da RPC no schema oficial com identidades sem
`BYPASSRLS`. A reconciliação do histórico será tratada separadamente e não deve
ser improvisada por inserção manual.

## Estado preservado

- nenhuma alteração fora do pacote autorizado foi feita em produção;
- migrations 72, 73 e 74 foram aplicadas atomicamente após autorização expressa;
- nenhum conteúdo identificável de dado operacional foi consultado; somente
  metadados e agregados de compatibilidade;
- nenhum deploy ou commit foi criado;
- a migration 75 já aplicada anteriormente em produção permanece inalterada.

Evidência: `docs/evidence/stage8c/stage8c-production-apply-20261027.json`.
