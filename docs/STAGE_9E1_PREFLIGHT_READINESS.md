# Etapa 9E.1 — Preflight de backup e restauração

**Data:** 28/10/2026  
**Escopo executado:** verificação local de pré-requisitos e desenho do ambiente isolado  
**Execução remota:** não realizada  
**Parecer:** **GO para o preflight local; NO-GO para backup, provisionamento e restauração**

## 1. Limite da autorização

Esta atividade não acessou o Supabase, não consultou dados operacionais, não
gerou backup, não criou projeto, não restaurou dados e não alterou o ambiente
oficial. A autorização atual permite preparar a decisão; a execução efetiva
continua sujeita a autorização própria.

O projeto `Sys_refeições` é o ambiente oficial e será tratado exclusivamente
como **origem protegida**. Ele nunca poderá ser escolhido como destino de um
restore ou receber comandos de teste da 9E.1.

## 2. Destino isolado proposto

O destino admissível para a prova integral é um **novo projeto Supabase de
recuperação**, criado especificamente para a execução autorizada, preferencialmente
na mesma região da origem e com as seguintes contenções antes do restore:

- sem domínio, tráfego, aplicação ou terminal operacional;
- sem callbacks, SMTP, webhooks ou credenciais de gateways reais;
- acesso limitado aos responsáveis nominados, com MFA e prazo de expiração;
- segredos próprios, nunca reutilizados pela aplicação oficial;
- integrações externas bloqueadas até o inventário de `pg_cron`, `pg_net`,
  wrappers, Database Webhooks e funções com efeitos externos;
- classificação de segurança equivalente à produção, pois um restore integral
  pode conter dados pessoais e financeiros reais;
- encerramento somente após aceite das evidências e autorização específica.

O identificador, URL e credenciais do projeto não devem ser versionados. O
destino ainda **não existe nem foi contratado**; portanto, esta preparação não
equivale à disponibilização física do ambiente.

Um PostgreSQL local com dados sintéticos pode validar scripts, mas não substitui
esta prova: ele não comprova restauração gerenciada de Auth, roles, permissões,
configurações e dependências da plataforma.

## 3. Fontes propostas e seus limites

| Fonte | Uso permitido em execução futura | Estado atual |
| --- | --- | --- |
| backup físico/PITR gerenciado do projeto oficial | restaurar banco, Auth, roles e permissões em projeto novo | disponibilidade e janela não verificadas |
| histórico de migrations do repositório | reconciliar a migration head sem reexecutar migrations | disponível localmente |
| cópia independente do Storage | restaurar objetos e conferir manifesto/checksum | mecanismo e cópia ainda não comprovados |
| inventário sanitizado de configurações | reconstituir Auth, rede, extensões e callbacks sem registrar segredos | pendente |
| suíte local de RLS e smokes | validar o destino após contenção | preparada; execução remota não autorizada |

Não estão autorizadas consultas ad hoc a comensais, carteiras, pagamentos ou
consumos. A eventual restauração integral deverá ser tratada como processamento
de dados reais, mesmo que muitos registros atuais sejam sintéticos.

## 4. Preflight apurado localmente

| Requisito | Resultado | Consequência |
| --- | --- | --- |
| origem protegida identificada | aprovado | `Sys_refeições` não pode ser destino |
| destino novo e isolado | pendente | projeto não provisionado nem autorizado |
| plano Supabase, backup e PITR | não verificado | acesso remoto continua bloqueado |
| ponto de recuperação e RPO alcançável | não verificado | não há `backupCapturedAt` autorizado |
| cópia independente do Storage | pendente | restore integral não pode começar |
| contenção de efeitos externos | preparada documentalmente | inventário remoto ainda necessário |
| responsáveis e janela | pendente | execução não pode começar |
| orçamento e retenção | pendente | criação de infraestrutura não autorizada |
| ferramentas PostgreSQL globais | indisponíveis no PATH | não bloqueia restore gerenciado; bloqueia alternativa CLI local |
| espaço livre observado no `C:` | aproximadamente 3,44 GiB | inadequado para manter dump integral local sem dimensionamento |

Nenhum arquivo foi excluído e nenhuma dependência foi instalada para contornar
os dois últimos itens.

## 5. Procedimento proposto para autorização futura

1. autorizar uma consulta remota limitada a metadados de backup, plano, região,
   tamanho e recursos externos, sem leitura de tabelas operacionais;
2. nomear responsáveis, janela e orçamento máximo;
3. aprovar e criar o projeto novo de recuperação, ainda sem restore;
4. comprovar o bloqueio de e-mail, callbacks, webhooks, cron e chamadas externas;
5. selecionar o ponto de recuperação e registrar apenas timestamps sanitizados;
6. restaurar o backup gerenciado no destino, nunca na origem;
7. restaurar Storage separadamente e conferir 100% do manifesto/checksum;
8. reconciliar schemas, migrations, owners, grants, policies, RLS e Auth;
9. executar 31/31 cenários RLS e os smokes críticos autorizados;
10. medir RPO/RTO e confirmar zero escrita na origem e zero efeito externo;
11. emitir decisão e solicitar autorização de encerramento do ambiente.

As autorizações dos passos 1, 3 e 6 devem ser independentes. Autorizar metadados
não autoriza criação do projeto; autorizar o projeto não autoriza o restore.

## 6. Critérios de interrupção

- destino igual ou conectado operacionalmente à origem;
- ausência de backup utilizável ou de cópia independente do Storage;
- callback, e-mail, webhook, cron ou função externa sem contenção comprovada;
- necessidade de expor segredo, URL privada ou dado pessoal na evidência;
- tentativa de executar migrations durante a restauração;
- ausência de responsável, janela, orçamento ou plano de encerramento;
- projeção de RPO superior a 15 minutos ou RTO superior a 4 horas sem aceite.

## 7. Critérios objetivos de aprovação

- destino novo, isolado e classificado como sensível;
- RPO medido menor ou igual a 15 minutos;
- RTO medido menor ou igual a 4 horas;
- migrations, schemas, funções, grants, policies e RLS 100% reconciliados;
- 31/31 cenários RLS aprovados;
- Storage 100% reconciliado por manifesto/checksum;
- zero efeito externo e zero alteração no projeto de origem;
- nenhuma falha crítica ou alta pendente;
- evidência sanitizada validada com código zero.

## 8. Próximo gate

O próximo pedido deve se limitar à **9E.1-A — inventário remoto read-only dos
metadados de recuperação**. Ele deverá informar quem executará, a janela e se o
acesso será pelo Dashboard ou por uma identidade temporária de privilégio mínimo.

Backup, criação do destino e restauração permanecem em **NO-GO**.

## 9. Resultado da preparação local

| Verificação | Resultado |
| --- | --- |
| controles do preflight 9E.1 | 20/20 aprovados |
| ESLint | aprovado |
| TypeScript `--noEmit` | aprovado |
| build Next.js | código zero; 26/26 páginas; `BUILD_ID` gerado |
| duração do build | 484 segundos |
| conexões remotas | zero |
| backups/restores executados | zero/zero |

**GO para encerramento do preflight local. NO-GO para execução remota.**
