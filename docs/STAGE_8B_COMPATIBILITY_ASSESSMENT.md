# Etapa 8B — Avaliação de compatibilidade da migration 75

**Data:** 27/10/2026  
**Fonte:** snapshot read-only executado manualmente no Supabase SQL Editor  
**Alterações remotas:** migration 75 aplicada manualmente pelo usuário no SQL Editor

## Parecer

**GO técnico** para o hardening de ACL da migration 75: a verificação posterior
retornou `approved:true` para as 12 assinaturas.

**NO-GO** para novas migrations, Etapa 8C e integração real. O projeto
`Sys_refeicoes` foi confirmado como produção e não existe staging isolado.

## Resultado do snapshot

| Controle | Resultado |
| --- | --- |
| PostgreSQL | 17.6 (`170006`) |
| assinaturas esperadas | 12/12 presentes |
| assinaturas ausentes | 0 |
| owner | `postgres` nas 12 funções |
| migration 75 no histórico | ausente |
| `PUBLIC` com `EXECUTE` | 12/12 |
| `anon` com `EXECUTE` efetivo | 12/12 |
| `authenticated` com `EXECUTE` efetivo | 12/12 |
| triggers comuns habilitados | 23 |
| event trigger habilitado | `ensure_rls` |

O SQL 06 retornou `approved:false` porque foi executado antes da migration 75.
Esse resultado confirma o estado vulnerável inicial e não representa falha do
script de pós-verificação.

Após a aplicação manual da migration 75, uma nova execução do SQL 06 retornou:

- `approved:true`;
- `publicExecute:false` nas 12 assinaturas;
- `anonExecute:false` nas 12 assinaturas;
- `authenticatedExecute:true` somente em
  `get_terminal_shift_reports(uuid,uuid,text)`;
- `migration75Recorded:false`.

O resultado `Success. 0 rows` da migration é esperado para DDL de ACL. Como a
execução ocorreu no SQL Editor, a alteração não foi registrada automaticamente
em `supabase_migrations.schema_migrations`.

## Compatibilidade com a migration 75

1. Todas as assinaturas referenciadas diretamente pelos `REVOKE` existem.
2. O tratamento condicional de `rls_auto_enable()` encontrará a função remota.
3. O owner `postgres` é compatível com execução administrativa pelo SQL Editor.
4. A RPC ativa `get_terminal_shift_reports(uuid,uuid,text)` está presente e a
   migration preserva `authenticated` explicitamente.
5. As quatro RPCs/overloads legados estão presentes e serão fechados para os
   papéis de aplicação.
6. Os triggers estão habilitados; a migration altera ACL das funções, sem
   remover os vínculos.

## Divergências e riscos confirmados

- `rls_auto_enable()` e o event trigger `ensure_rls` continuam sendo drift não
  versionado no repositório.
- `get_terminal_shift_reports` e o overload legado de visitante usam
  `search_path=public, extensions, pg_temp`.
- três funções de caixa usam `search_path=public, pg_temp`.
- `handle_updated_at()` não é `SECURITY DEFINER`, não possui `proconfig` e está
  ligada a 18 tabelas; o hardening de ACL é compatível, mas uma reescrita de
  corpo não deve ser misturada à migration 75.
- o snapshot não prova ausência de clientes externos antigos chamando RPCs
  legadas.

## Gates operacionais ainda reprovados

1. `Sys_refeicoes` foi confirmado como produção, não staging.
2. Não existe projeto de staging isolado.
3. Há apenas indicação de que muitos dados podem ser sintéticos; o conjunto não
   foi classificado nem comprovado como integralmente sintético/anonimizado.
4. Backup/PITR e restauração não foram comprovados.
5. O smoke remoto confirmou que chamadas anônimas são recusadas (`401`/
   `42501`) e que uma identidade autenticada autorizada consegue abrir o F7 e
   visualizar as refeições aprovadas da unidade.
6. O teste remoto de uma identidade autenticada contra unidade não autorizada
   continua pendente e não deve ser improvisado com credenciais reais.

## Smoke funcional posterior à aplicação

| Verificação | Resultado |
| --- | --- |
| chamada anônima da RPC | negada, conforme esperado |
| chamada autenticada na unidade permitida | aprovada |
| abertura e renderização do F7 | aprovada |
| exibição de refeições aprovadas | aprovada |
| aba de bloqueios sem registros persistidos | vazia, comportamento esperado |
| isolamento remoto entre duas unidades autenticadas | pendente |

O uso de um identificador inexistente não constitui um bloqueio operacional
persistido. O terminal classifica esse caso como erro de entrada/não encontrado
e a pré-validação não grava em `blocked_attempts`. Portanto, a aba vazia não
representa regressão da RPC nem da migration 75.

## Próxima decisão

Não executar novas migrations no projeto atual. A migration 75 e seu smoke de
ACL estão tecnicamente aprovados. Antes da Etapa 8C, criar ou identificar
staging isolado, comprovar restauração e reconciliar o fato de a versão 75 estar
aplicada nos ACLs, mas ausente do histórico. Não inserir a versão manualmente no
histórico sem plano específico e autorização.

Evidência sanitizada:
`docs/evidence/stage8a/stage8a-migration75-snapshot-sql-editor-20261027.json`.

Evidência posterior:
`docs/evidence/stage8a/stage8a-migration75-postapply-sql-editor-20261027.json`.

Evidência do smoke:
`docs/evidence/stage8a/stage8b-migration75-smoke-partial-20261027.json`.
