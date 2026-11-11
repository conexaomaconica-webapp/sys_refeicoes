# Etapa 9E.1-A — Inventário remoto de recuperação

**Data:** 28/10/2026  
**Escopo:** metadados read-only de backup, PITR, banco e Storage  
**Resultado:** **CONCLUÍDO — nenhum backup recuperável foi exposto pela Management API**  
**Parecer:** **NO-GO para provisionamento, backup ou restauração**

## 1. Resumo da execução

O certificado `Supabase Root 2021 CA` foi localizado, validado e usado sem ser
copiado para o repositório. A conexão PostgreSQL foi autenticada com TLS
verificado e executou uma única consulta agregada dentro de transação `READ
ONLY`, finalizada com rollback.

Um token fine-grained temporário com `Backups: Read` foi usado em uma única
requisição `GET`. O token, project ref e IDs de backup não foram gravados na
evidência. A API confirmou a região, o estado de WAL-G/PITR e a lista disponível.

Não foram usados `service_role`, Data API ou conteúdo de dados operacionais.
Nenhum backup, restore, projeto, configuração ou migration foi criado ou alterado.

## 2. Fontes corretas por tipo de informação

| Informação | Fonte oficial | Pode ser comprovada por SQL? | Situação |
| --- | --- | --- | --- |
| plano contratado | Dashboard/Billing | não | não verificado |
| backups e retenção efetivos | `Database > Backups` ou Management API | não | verificado: lista vazia |
| PITR e janela recuperável | Dashboard ou Management API | não | verificado: desativado/sem janela |
| tamanho lógico do banco | Database Reports ou `pg_database_size` | sim | verificado |
| disco provisionado/WAL/sistema | Dashboard/Infrastructure | apenas parcialmente | não verificado |
| buckets, objetos e bytes do Storage | Dashboard/relatório ou metadados agregados | parcialmente | agregados verificados |
| custo do novo projeto | tela anterior ao clone | não | não calculado |

A presença de tabelas, migrations ou arquivos locais não comprova a existência
de um ponto de recuperação utilizável.

## 3. Constatações oficiais aplicáveis

- backups diários automáticos são oferecidos nos planos Pro, Team e Enterprise;
  as retenções documentadas são 7, 14 e até 30 dias, respectivamente;
- o plano Free não inclui backups automáticos nem PITR;
- PITR é adicional para projetos pagos, exige ao menos compute Small e substitui
  os backups diários enquanto estiver ativo;
- os valores publicados para PITR são aproximadamente US$ 100/mês por 7 dias,
  US$ 200/mês por 14 dias e US$ 400/mês por 28 dias de retenção;
- o endpoint `GET /v1/projects/{ref}/database/backups` exige permissão
  `backups_read` e informa backups, região e estado de PITR;
- restaurar para novo projeto exige plano pago e backups físicos habilitados;
- o novo projeto gera custo adicional conforme compute e disco espelhados, que
  deve ser exibido antes da confirmação;
- o clone é database-only: objetos/configurações do Storage, Edge Functions,
  Auth settings, API keys, Realtime e outras configurações exigem recomposição;
- `pg_cron`, `pg_net` e wrappers podem voltar a produzir efeitos imediatamente
  após um restore binário. Não existe pausa prévia no fluxo de clone.

Os preços são referências públicas observadas na data deste relatório, não uma
cotação. O custo real depende do plano, compute, disco e retenção do projeto.

## 3.1 Capacidade observada via SQL read-only

| Métrica | Resultado |
| --- | ---: |
| PostgreSQL | 17.6 (`serverVersionNum` 170006) |
| banco completo | 27.053.203 bytes (aprox. 25,80 MiB) |
| relações do schema `public` | 10.158.080 bytes (aprox. 9,69 MiB) |
| relações do schema `auth` | 1.613.824 bytes (aprox. 1,54 MiB) |
| metadados do schema `storage` | 409.600 bytes (aprox. 0,39 MiB) |
| buckets | 3 |
| objetos | 18 |
| conteúdo agregado informado pelo Storage | 4.420.908 bytes (aprox. 4,22 MiB) |
| `pg_cron`, `pg_net` ou `wrappers` instalados | nenhum identificado |

A transação confirmou `transaction_read_only=on`. Nenhum nome de bucket,
objeto, usuário ou registro operacional foi retornado. Esses números dimensionam
o volume atual, mas não comprovam backups recuperáveis nem o espaço físico total
de disco/WAL do projeto.

## 3.2 Backups observados via Management API

| Metadado | Resultado |
| --- | --- |
| região | `sa-east-1` |
| WAL-G indicado pela plataforma | ativo |
| PITR | desativado |
| backups listados | 0 |
| backups físicos listados | 0 |
| início/fim da janela física | indisponíveis |
| mutações executadas | 0 |

WAL-G ativo é um componente interno e não comprova, sozinho, a existência de um
ponto restaurável para o usuário. O resultado relevante do endpoint autorizado
é: nenhum backup e nenhuma janela de PITR foram disponibilizados.

## 4. Artefatos preparados

- runner local fail-closed: `scripts/stage9e/inventory-recovery-sql-readonly.cjs`;
- alternativa para SQL Editor:
  `scripts/stage9e/supabase-sql-editor/09e1a-capacity-readonly.sql`;
- ambos retornam somente agregados de capacidade e extensões externas, sem
  nomes de pessoas, registros financeiros ou conteúdo de arquivos.

## 5. Dados ainda necessários

### Pelo Dashboard ou Management API

1. nome do plano, sem identificador do projeto;
2. compute e disco provisionado;
3. custo estimado para habilitar proteção compatível, sem contratar;
4. causa de a API não disponibilizar backups (plano, idade ou configuração).

### Pelo SQL Editor ou conexão com CA

Concluído em 28/10/2026 por transação PostgreSQL read-only. A evidência está em
`docs/evidence/stage9e/stage9e1a-sql-capacity-inventory.json`.

Não registrar project ref, URL, token, nomes de objetos, e-mails ou payloads.

## 6. Formas seguras de desbloqueio

O token temporário cumpriu sua finalidade e deve ser removido do `.env.local` e
revogado no Dashboard. Qualquer investigação adicional de plano ou custo deve
usar o Dashboard ou uma autorização separada para outras permissões read-only.

Não é aceitável definir `rejectUnauthorized: false`, usar `sslmode=require` sem
verificação de identidade para contornar o erro, ou reutilizar `service_role`.

## 7. Riscos e decisão

| Risco | Estado |
| --- | --- |
| backups recuperáveis | nenhum disponibilizado pela API |
| RPO de 15 minutos depende de PITR | reprovado: PITR desativado |
| clone pode iniciar efeitos externos | crítico, exige contenção anterior por estratégia lógica ou aceite formal |
| Storage não acompanha o clone | confirmado pela documentação oficial |
| capacidade SQL e Storage | verificada por agregados read-only |
| custo do clone e PITR | indeterminado sem plano/recursos atuais |

O inventário 9E.1-A está encerrado, mas seu resultado é **NO-GO para a 9E.1**.
Sem backup recuperável não existe fonte para criar o ambiente de restauração e o
RPO proposto não pode ser atingido. Produção, criação do destino e restore
permanecem em **NO-GO**.

## 8. Fontes oficiais

- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/reference/api/v1-list-all-backups
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/platform/database-size
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/pricing

## 9. Validações locais

| Verificação | Resultado |
| --- | --- |
| controles fail-closed da 9E.1-A | 20/20 aprovados |
| ESLint | aprovado |
| TypeScript `--noEmit` | aprovado |
| build Next.js | código zero; 26/26 páginas; `BUILD_ID` gerado |
| duração do build | 486,1 segundos |

Essas validações aprovam os artefatos locais, não a disponibilidade de backup.
