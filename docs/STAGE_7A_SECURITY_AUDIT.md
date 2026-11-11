# Etapa 7A — Auditoria local de segurança e integridade

**Data:** 26/10/2026

**Escopo:** repositório local, migrations versionadas e evidências da Etapa 4B

**Acesso remoto:** não realizado

**Decisão:** diagnóstico concluído; produção, dados reais e aplicação de migrations permanecem **NO-GO**

## 1. Método e limites

A auditoria confrontou `SECURITY.md`, `PERMISSIONS_v1_2.md`, `DATABASE.md`, a
cadeia de 71 migrations preexistentes, o relatório da Etapa 4B e o script
`homologate-stage4b-rollback.cjs`. Nenhuma conexão foi aberta, nenhuma
configuração remota foi consultada e nenhuma migration foi aplicada.

O número 13 corresponde às asserções reprovadas na execução da Etapa 4B. Uma
delas é a verificação agregada de que o usuário inativo não acessa tabela alguma;
ela falha pela mesma causa da asserção específica de eventos offline. Por isso o
relatório anterior descrevia 11 grupos funcionais, embora a suíte registrasse 13
falhas.

## 2. Matriz das 13 falhas

| ID | Asserção reprovada na Etapa 4B | Causa local confirmada | Tratamento preparado na 7B | Risco residual |
| --- | --- | --- | --- | --- |
| F01 | usuário inativo sem qualquer acesso | policies offline adicionais ignoravam status | policy offline única exige `active` | execução SQL pendente |
| F02 | supervisor vê somente uma carteira | policy staff concedia o tenant inteiro | supervisor removido da leitura financeira global | função limitada fica bloqueada |
| F03 | gerente vê somente uma carteira | mesma concessão global | gerente removido da leitura financeira global | função limitada fica bloqueada |
| F04 | supervisor vê somente estudante da unidade | estudante não possui vínculo canônico com unidade; helper inferia instituição inteira | inferência por `user_unit_access` removida | modelagem estudante/unidade pendente |
| F05 | gerente vê somente estudante da unidade | mesma ausência de vínculo canônico | escopo exige vínculo institucional explícito | modelagem estudante/unidade pendente |
| F06 | supervisor vê somente pagamentos da unidade | pagamento não possui origem canônica de unidade | leitura global removida em modo fail-closed | contrato financeiro pendente |
| F07 | gerente vê somente recargas da unidade | recarga/carteira não possui origem canônica de unidade em todos os fluxos | leitura global removida em modo fail-closed | contrato financeiro pendente |
| F08 | operador lê somente eventos offline da unidade | policy versionada validava apenas tenant e papel | adicionada exigência `has_unit_access(unit_id)` | execução SQL pendente |
| F09 | usuário institucional lê estudantes próprios | helper não incluía `institution_user` | vínculo explícito em `user_institution_access` aceito | execução SQL pendente |
| F10 | usuário institucional não lê eventos offline | duas policies não versionadas liberavam o tenant | convergência remove policies anteriores e cria uma única policy | inventário remoto pré-aplicação obrigatório |
| F11 | consumidor não lê eventos offline | mesma policy não versionada e permissiva | papel `student` excluído da policy canônica | execução SQL pendente |
| F12 | usuário inativo não lê eventos offline | policy não versionada ignorava status | status ativo obrigatório | mesma causa raiz de F01 |
| F13 | admin do Tenant B não lê caixas do Tenant A | ramo global de `cash_shifts` não comparava tenant | tenant obrigatório antes de qualquer ramo de papel | movimentos também foram endurecidos |

O script antigo também observou recargas globais para supervisor e pagamentos
globais para gerente, embora suas duas asserções individuais verificassem apenas
o par inverso. A correção cobre as quatro combinações.

## 3. Drift do schema offline

| Item | Cadeia local anterior | Evidência do schema efetivo registrada na 4B | Reconciliação proposta |
| --- | --- | --- | --- |
| status inicial | `pending` | `received` | default `received`; `pending` preservado para legado |
| colunas usadas pela RPC | sete colunas ausentes na criação | colunas presentes | `ADD COLUMN IF NOT EXISTS` |
| policies | uma policy versionada sem unidade | duas policies extras não versionadas | convergência controlada para policy única |
| superfície RPC | concedida originalmente | revogada na migration 44 | revogação reafirmada para `PUBLIC`, `anon` e `authenticated` |

As colunas reconciliadas são `institution_id`, `consumption_date`,
`conflict_reason`, `linked_consumption_id`, `financial_debit_applied`, `notes` e
`updated_at`. Nenhum dado existente é apagado ou reescrito.

## 4. SECURITY DEFINER, search_path e grants

A cadeia histórica contém definições `SECURITY DEFINER` antigas com
`search_path = public, ...`. Muitas foram substituídas por versões posteriores
com `search_path = ''`; portanto, contar ocorrências nos arquivos não equivale a
atestar o estado efetivo do banco. Sem acesso remoto autorizado, esse estado não
foi presumido.

No escopo das falhas:

- `reconcile_offline_consumptions(jsonb)` usa uma definição histórica com
  `public` no `search_path`, mas teve `EXECUTE` revogado de `authenticated` na
  migration 44; a migration 72 reafirma a revogação para todos os papéis cliente;
- `get_terminal_shift_snapshot(uuid)` recebe a mesma revogação defensiva;
- `can_manage_students_at_institution(uuid)` permanece `SECURITY DEFINER`, usa
  `search_path = ''`, referências qualificadas e grants mínimos;
- helpers de tenant, status e unidade já usam `search_path = ''` e filtram perfil
  ativo;
- a confirmação dos owners, ACLs e definições efetivas continua dependente de
  inventário em staging antes de qualquer aplicação.

## 5. Classificação

- **Crítico:** isolamento cruzado de tenant em caixa.
- **Alto:** eventos offline fora da unidade e acessíveis a perfis não autorizados;
  leituras financeiras globais por perfis de unidade.
- **Médio:** incapacidade de representar corretamente o escopo acadêmico por
  unidade e negação indevida ao usuário institucional.
- **Integridade:** schema offline local não reproduzível sem reconciliação.

## 6. Parecer da 7A

**GO** para a preparação local das correções da Etapa 7B.

**NO-GO** para aplicar migrations, homologar RLS como efetiva, integrar dados
reais ou liberar produção.
