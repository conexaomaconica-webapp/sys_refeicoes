# Etapa 8A.1 — Preparação local da credencial de auditoria

**Escopo:** preparação local  
**Resultado:** pronta para revisão  
**Execução manual pelo usuário:** preparada, ainda não confirmada  
**Staging modificável e produção:** NO-GO

## 1. Objetivo

Preparar, sem conexão remota, os scripts necessários para criar temporariamente a identidade PostgreSQL `ma_stage8a_auditor`, validar seus privilégios efetivos, executar futuramente o inventário 8A e revogar integralmente a identidade.

Nenhum usuário, grant, alteração de configuração ou conexão remota foi realizado nesta etapa.

## 2. Pacote preparado

| Ordem | Arquivo | Finalidade | Identidade futura |
| --- | --- | --- | --- |
| 1 | `01-preflight-admin-readonly.sql` | Inventariar pré-requisitos e privilégios herdados | Administrador autorizado, transação read-only |
| 2 | `02-create-auditor.sql` | Criar conta temporária e conceder o mínimo | Administrador autorizado |
| 3 | `03-verify-as-auditor.sql` | Comprovar os privilégios efetivos | `ma_stage8a_auditor` |
| 4 | `audit-stage8a-readonly.cjs` | Coletar somente metadados do destino | `ma_stage8a_auditor` |
| 5 | `04-revoke-auditor.sql` | Bloquear login, conferir dependências e excluir conta | Administrador autorizado |

Cada passo futuro exige autorização própria da 8A.2. Os scripts não aplicam migrations 72, 73 ou 74.

## 3. Privilégios mínimos

A conta preparada possui:

- `LOGIN` temporário, validade obrigatória e limite de uma conexão;
- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION` e `NOBYPASSRLS`;
- `CONNECT` somente ao banco corrente;
- `USAGE` somente em `supabase_migrations`;
- `SELECT` somente na coluna `version` de `supabase_migrations.schema_migrations`;
- default transacional read-only e timeouts defensivos.

Ela não recebe `USAGE`, `SELECT`, DML, ownership ou `EXECUTE` no domínio operacional. O inventário lê relações, colunas, constraints, policies, ACLs, funções e índices diretamente dos catálogos PostgreSQL.

## 4. Tratamento de PUBLIC e herança

PostgreSQL soma privilégios concedidos diretamente, por memberships e por `PUBLIC`; não existe um `DENY` individual que neutralize um grant herdado de `PUBLIC`.

Por isso, revogar permissões diretamente da conta não é suficiente. Antes da criação, o pacote bloqueia a operação quando detectar:

- `CREATE` para `PUBLIC` no schema `public`;
- leitura ou escrita para `PUBLIC` em qualquer tabela do schema `public`;
- `EXECUTE` para `PUBLIC` em funções `SECURITY DEFINER` ou voláteis do schema `public`.

Se qualquer gate falhar, a criação deve ser interrompida. Corrigir grants de `PUBLIC` seria uma mudança global e exige escopo, revisão e autorização separados; a 8A.1 não prepara nem autoriza essa alteração.

`NOINHERIT` também não substitui essa verificação: ele afeta memberships, mas não elimina privilégios de `PUBLIC`.

## 5. Histórico de migrations

O inventário necessita apenas das versões aplicadas. A concessão foi reduzida a:

```sql
GRANT USAGE ON SCHEMA supabase_migrations TO ma_stage8a_auditor;
GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations
TO ma_stage8a_auditor;
```

Não há acesso às colunas adicionais do histórico nem a outras tabelas do schema `supabase_migrations`.

## 6. Senha, validade e evidências

- A senha não aparece no repositório, em parâmetro de linha de comando ou no histórico do shell.
- O script utiliza o prompt seguro `\password` do `psql`.
- A validade é obrigatória e deve cobrir apenas a janela aprovada.
- `STAGE8A_DB_URL` deve existir somente no processo da auditoria, nunca em `.env.local` versionado ou evidência.
- Logs e inventário não podem registrar senha ou URL completa.

## 7. Sequência futura da 8A.2

1. Autorizar explicitamente a criação e revogação remotas.
2. Executar o preflight read-only e revisar todos os grants de `PUBLIC`.
3. Criar a identidade com validade curta e senha temporária aleatória.
4. Conectar como auditor e executar `03-verify-as-auditor.sql`.
5. Se qualquer verificação falhar, executar a revogação; não coletar o inventário.
6. Executar o runner 8A e validar o JSON pelo contrato 7D.4.
7. Encerrar a sessão de auditoria.
8. Executar `04-revoke-auditor.sql` e comprovar que o papel não existe mais.
9. Produzir o relatório de drift sem iniciar 8B ou aplicar migrations.

## 8. Revogação segura

O script de revogação:

- aplica `NOLOGIN` antes das demais verificações;
- falha se houver sessão ativa, sem encerrá-la automaticamente;
- falha se a conta possuir qualquer objeto;
- não utiliza `DROP OWNED`, `REASSIGN OWNED` ou limpeza abrangente;
- remove apenas os grants conhecidos e então executa `DROP ROLE`.

Se o processo for interrompido após a criação, a prioridade é executar esse script durante a mesma janela autorizada. Nenhuma credencial temporária deve permanecer ativa após a auditoria.

## 9. Critérios para autorizar 8A.2

- revisão humana dos quatro scripts SQL;
- executor administrativo identificado e janela definida;
- resultado limpo do preflight sobre `PUBLIC`;
- validade máxima e canal seguro para a senha acordados;
- plano de revogação com responsável presente;
- confirmação de que o destino é o project-ref vinculado;
- manutenção do NO-GO para 8B, 8C e migrations.

## 10. Parecer

**GO para revisão local da preparação 8A.1.**

O pacote está pronto para a execução manual indicada pelo usuário no Supabase SQL Editor. O agente não realizou conexão nem comando remoto. A 8A.2 somente poderá ser considerada concluída depois do preflight, inventário, validação e revogação comprovados. Etapas 8B, 8C, integração real e produção permanecem em **NO-GO**.

## 11. Execução pelo Supabase SQL Editor

Foi preparado um pacote adicional compatível com o SQL Editor:

1. `scripts/stage8a/supabase-sql-editor/01-preflight-readonly.sql`;
2. `scripts/stage8a/supabase-sql-editor/02-create-temporary-auditor.sql`;
3. `scripts/stage8a/supabase-sql-editor/03-revoke-temporary-auditor.sql`.

Esses arquivos **não são migrations**. Uma conta temporária, sua senha e sua remoção não representam estado permanente da aplicação e não devem ser registradas no histórico de schema. Colocá-las em `supabase/migrations` faria instalações futuras recriarem uma identidade de auditoria desnecessária e tornaria a revogação dependente de uma nova migration.

O script de criação gera 256 bits aleatórios no servidor, mantém o segredo em tabela temporária `ON COMMIT DROP`, configura expiração em duas horas e mostra a senha uma única vez no resultado. O resultado contendo a senha não deve ser salvo, compartilhado ou anexado como evidência.

Ordem operacional quando a 8A.2 for autorizada:

1. executar somente o preflight e revisar o JSON;
2. executar a criação apenas se as listas de privilégios de `PUBLIC` estiverem vazias e os demais gates forem compatíveis;
3. copiar a senha temporária por canal seguro e montar `STAGE8A_DB_URL` somente na sessão local;
4. executar a verificação e o inventário pelo runner local;
5. encerrar a conexão local;
6. executar imediatamente o script de revogação no SQL Editor.
