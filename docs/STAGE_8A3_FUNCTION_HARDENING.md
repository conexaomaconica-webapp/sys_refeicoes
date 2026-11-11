# Etapa 8A.3 — Hardening das funções PostgreSQL

**Data:** 27/10/2026  
**Escopo:** preparação exclusivamente local  
**Resultado:** migration 75 preparada, não aplicada  
**Conta temporária, 8B, 8C e produção:** NO-GO

## 1. Origem do bloqueio

O preflight remoto da 8A.2 encontrou PostgreSQL 17.6, histórico de migrations acessível, ausência da conta temporária e nenhum privilégio de tabela ou `CREATE` herdado de `PUBLIC`.

O único gate reprovado foi a existência de 12 funções sensíveis com `EXECUTE` efetivo para `PUBLIC`. A criação de `ma_stage8a_auditor` permaneceu bloqueada.

## 2. Inventário e decisão por assinatura

| Função observada | Categoria | Uso/dependência local | ACL desejado pela migration 75 |
| --- | --- | --- | --- |
| `admin_list_cash_shifts(uuid, varchar, date, date)` | Overload legado, `SECURITY DEFINER` | Frontend usa a assinatura atual com cinco parâmetros, incluindo `meal_type_id` | sem `PUBLIC`, `anon` ou `authenticated` |
| `get_active_cash_shift(uuid, varchar)` | RPC legada, `SECURITY DEFINER` | Substituída por fluxo de operador; migration 44 já retirou `authenticated` | sem `PUBLIC`, `anon` ou `authenticated` |
| `get_terminal_shift_reports(uuid, uuid, text)` | RPC ativa, `SECURITY DEFINER` | Usada por `shift-reports.service.ts`; valida autenticação e unidade | somente `authenticated` |
| `record_cash_movement(uuid, varchar, numeric, varchar, text)` | RPC legada, `SECURITY DEFINER` | Substituída por wrapper de operador; migration 44 já retirou `authenticated` | sem `PUBLIC`, `anon` ou `authenticated` |
| `register_visitor_entry(uuid, uuid, text, varchar)` | Overload legado, `SECURITY DEFINER` | Fluxo atual usa wrappers de operador; assinatura restaurada posterior usa `varchar/varchar` e já é interna | sem `PUBLIC`, `anon` ou `authenticated` |
| `enrich_cash_movement()` | Trigger `SECURITY DEFINER` | Associada a trigger de caixa | sem execução direta para papéis de aplicação |
| `handle_updated_at()` | Trigger | Associada a triggers de atualização | sem execução direta para papéis de aplicação |
| `refresh_cash_shift_payment_totals()` | Trigger `SECURITY DEFINER` | Associada a trigger de caixa | sem execução direta para papéis de aplicação |
| `rls_auto_enable()` | Event trigger remoto não versionado | Drift do schema efetivo; ausente na cadeia local | revogação condicional, sem quebrar instalação nova |
| `sync_imported_consumer_identity()` | Trigger `SECURITY DEFINER` | Sincronização da identidade após importação | sem execução direta para papéis de aplicação |
| `trg_prevent_profile_escalation()` | Trigger `SECURITY DEFINER` | Proteção de campos sensíveis do perfil | sem execução direta para papéis de aplicação |
| `trg_prevent_student_tampering()` | Trigger `SECURITY DEFINER` | Proteção de campos acadêmicos | sem execução direta para papéis de aplicação |

## 3. Migration preparada

Arquivo: `supabase/migrations/20261027000075_harden_public_function_execution.sql`.

A migration:

- altera somente ACLs;
- não remove funções, triggers ou dados;
- não substitui corpos de funções;
- não altera as migrations 72, 73 ou 74;
- preserva `authenticated` exclusivamente em `get_terminal_shift_reports`;
- mantém RPCs e overloads legados fechados;
- trata `rls_auto_enable()` condicionalmente porque o objeto não existe na cadeia local;
- termina com uma pós-condição que falha se qualquer assinatura existente continuar executável por `PUBLIC`.

## 4. Dependências e impacto operacional

O frontend atual envia cinco argumentos para `admin_list_cash_shifts`, portanto não depende do overload legado de quatro argumentos. A consulta de relatórios do terminal depende de `get_terminal_shift_reports`, que recebe grant explícito para `authenticated`.

Não foi encontrado uso direto no código atual de `get_active_cash_shift`, `record_cash_movement` ou do overload legado de `register_visitor_entry`. Os fluxos correntes utilizam wrappers de operador mais recentes.

Revogar `EXECUTE` das funções de trigger não desassocia nem desativa triggers existentes. A migration não executa `DROP TRIGGER` ou `DROP FUNCTION`. A execução transacional em PostgreSQL real ainda deve confirmar essa propriedade antes de qualquer aplicação remota.

## 5. SECURITY DEFINER e search_path

As cinco RPCs identificadas são `SECURITY DEFINER`. A migration 75 reduz a superfície de chamada, mas não reescreve seus corpos.

Risco residual:

- `get_terminal_shift_reports` ainda usa o `search_path` histórico `public, extensions, pg_temp`;
- alguns objetos legados também usam `public, pg_temp`;
- `rls_auto_enable()` não possui definição reproduzível no repositório.

O preflight confirmou que `PUBLIC` não possui `CREATE` no schema `public`, reduzindo o risco de shadowing. Ainda assim, reescrever funções ativas com nomes totalmente qualificados e `search_path = ''` exige uma etapa própria, testes funcionais e análise do schema efetivo. Isso não foi misturado à correção de ACL.

## 6. Testes executados

| Validação | Resultado |
| --- | --- |
| Cobertura das 12 assinaturas | Aprovada |
| Matriz de grants desejados | Aprovada |
| Consumidores atuais do frontend | Aprovada |
| Preservação dos triggers versionados | Aprovada |
| Tratamento do drift `rls_auto_enable()` | Aprovada |
| Pós-condição contra `PUBLIC` | Aprovada |
| Ausência de DDL destrutivo | Aprovada |
| Controles estáticos 8A.3 | 20/20 aprovados |
| Aplicação em PostgreSQL descartável | Não executada; runtime local indisponível nesta estação |
| Aplicação no Supabase | Não autorizada e não executada |

## 7. Plano de homologação transacional

Antes de aplicar remotamente:

1. carregar um baseline que contenha as 11 funções versionadas e uma representação de `rls_auto_enable()`;
2. registrar ACLs e vínculos de triggers antes da migration;
3. aplicar a migration 75 dentro de transação;
4. confirmar que as 12 assinaturas não são executáveis por `PUBLIC`;
5. confirmar que somente `authenticated` executa `get_terminal_shift_reports`;
6. executar um `UPDATE` controlado para cada família de trigger e confirmar seus efeitos;
7. confirmar que os overloads atuais de caixa continuam com ACLs inalterados;
8. executar `ROLLBACK` e comparar os ACLs/vínculos com o snapshot inicial;
9. repetir com `COMMIT` somente em ambiente descartável e autorizado.

## 8. Rollback e recuperação

Não existe down migration automática. Restaurar `EXECUTE` para `PUBLIC` recriaria o bloqueio de segurança.

Se houver regressão operacional, a recuperação deve ser forward-only:

- conceder `EXECUTE` exclusivamente ao papel necessário e somente na assinatura comprovadamente usada;
- nunca restaurar `PUBLIC` como atalho;
- não remover nem recriar triggers para corrigir ACL;
- comparar o ACL efetivo com o snapshot anterior antes de qualquer grant emergencial.

## 9. Parecer

**GO para revisão local da migration 75.**

**NO-GO para aplicação remota e para criação da conta temporária.** A migration ainda precisa de homologação transacional em PostgreSQL real e autorização específica. As etapas 8B, 8C, integração real e produção permanecem bloqueadas.
