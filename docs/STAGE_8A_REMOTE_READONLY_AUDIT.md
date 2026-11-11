# Etapa 8A — Inventário remoto somente leitura

**Data:** 27/10/2026  
**Destino identificado:** projeto Supabase vinculado ao repositório  
**Resultado:** **BLOQUEADA COM SEGURANÇA antes da conexão remota**  
**Staging, migrations e produção:** **NO-GO**

## 1. Objetivo

Comparar o schema, policies, funções, permissões, índices e histórico de migrations do banco de destino com o contrato preparado na Etapa 7D.4, sem acessar linhas operacionais e sem modificar o ambiente.

## 2. Diagnóstico de acesso

O repositório possui uma URL PostgreSQL configurada, mas seu usuário é administrativo (`postgres.<project-ref>`). Também existe uma chave `SUPABASE_SERVICE_ROLE_KEY`. Nenhuma dessas credenciais atende ao requisito de privilégio mínimo da Etapa 8A.

Não foi encontrada uma credencial dedicada de auditoria (`STAGE8A_DB_URL`). O runner recusou deliberadamente reutilizar `SUPABASE_DB_URL`, credenciais `postgres` ou service role.

Consequentemente:

- conexões remotas abertas: **0**;
- consultas remotas executadas: **0**;
- linhas operacionais consultadas: **0**;
- migrations aplicadas: **0**;
- configurações ou policies alteradas: **0**.

## 3. Controles implementados

Foi criado `scripts/audit-stage8a-readonly.cjs`, que somente prossegue quando todos os controles abaixo forem satisfeitos:

1. autorização explícita de janela por `STAGE8A_ALLOW_REMOTE_READONLY=YES`;
2. credencial separada em `STAGE8A_DB_URL`;
3. destino limitado ao project-ref Supabase vinculado;
4. TLS com validação de certificado;
5. `BEGIN TRANSACTION READ ONLY`, timeouts e `ROLLBACK` obrigatório;
6. recusa de `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, `CREATEDB` e replicação;
7. recusa de `CREATE` no schema público;
8. recusa de qualquer privilégio efetivo de escrita nas tabelas públicas;
9. recusa de `SELECT` nas tabelas operacionais sensíveis;
10. evidência JSON confinada a `docs/evidence/stage8a`, sem sobrescrita.

O inventário foi alterado para obter colunas diretamente dos catálogos PostgreSQL. Assim, a conta de auditoria não precisa receber `SELECT` sobre estudantes, consumos, carteiras, pagamentos, recargas, caixas ou contingência.

## 4. Validações locais executadas

| Validação | Resultado |
| --- | --- |
| Controles do runner 8A | 18/18 aprovados |
| Contrato de prontidão 7D.4 | 24/24 aprovados |
| Falha segura sem credencial dedicada | Aprovada |
| Recusa da credencial administrativa existente | Aprovada antes da rede |
| Inventário remoto efetivo | Não executado |
| Comparação de drift atual | Não executada |

## 5. Credencial mínima necessária

A execução futura depende de uma conta PostgreSQL temporária e dedicada, provisionada fora da Etapa 8A por responsável autorizado, com estas propriedades:

- login sem superusuário, bypass de RLS, criação de roles/bancos ou replicação;
- sem associação a `anon`, `authenticated`, `service_role` ou papéis de leitura global;
- sem `CREATE` no schema `public`;
- sem `SELECT`, DML ou ownership sobre tabelas operacionais;
- acesso aos catálogos PostgreSQL;
- somente `USAGE` no schema `supabase_migrations` e `SELECT` em `supabase_migrations.schema_migrations`;
- validade limitada à janela de auditoria e revogação posterior sob autorização própria.

A criação e a revogação dessa conta são operações remotas de escrita e não foram executadas porque estão fora do escopo autorizado da 8A.

## 6. Divergências e riscos

O drift observado na Etapa 4B não foi tratado como evidência atual. Ele permanece apenas como hipótese a reconfirmar, pois o estado remoto pode ter mudado desde aquela captura.

Sem um novo inventário não é possível concluir:

- se as 72, 73 e 74 continuam pendentes no destino;
- se tabelas, tipos, constraints e status são compatíveis;
- quais policies e grants seriam substituídos;
- se existe alguma assinatura ou overload da RPC operacional;
- se owners, `search_path`, RLS e índices apresentam drift atual.

Utilizar a conta administrativa existente produziria a informação desejada, mas violaria o controle de privilégio mínimo e ampliaria desnecessariamente o impacto de um erro de execução.

## 7. Parecer

**GO para os mecanismos locais da Etapa 8A.** O runner e o inventário estão preparados e falharam de forma segura.

**BLOQUEADO para concluir o inventário remoto.** É necessária uma credencial PostgreSQL dedicada com o perfil mínimo descrito acima.

**NO-GO para 8B, 8C, migrations, staging modificável, integração real e produção.** Nenhuma divergência deve ser reconciliada até que o inventário atual seja coletado, validado e revisado.
