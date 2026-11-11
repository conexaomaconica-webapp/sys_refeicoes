# Etapa 7C.1 — Runner PostgreSQL nativo e descartável

**Data:** 26/10/2026

**Escopo:** preparação exclusivamente local, sem instalação, servidor ou banco
acessado

**Cenários PostgreSQL executados:** 0/31

## 1. Resultado

O runner da Etapa 7C foi adaptado para futura execução com PostgreSQL 17
portátil no Windows, sem Docker, Podman ou WSL2. A cobertura permanece em 31
cenários e nenhuma migration foi executada durante esta subetapa.

## 2. Correção de concorrência

Os dois blocos que usavam `Promise.all` sobre o mesmo `pg.Client` foram
substituídos por `visibleCountsSequential`. Cada cenário agora conclui este
ciclo antes de iniciar o próximo:

```text
RESET ROLE
-> configura auth.uid/JWT
-> SET LOCAL ROLE
-> executa consulta
-> restaura owner
```

Isso impede que identidades diferentes se intercalem no mesmo estado de sessão.
O runner contém exatamente 31 chamadas de aprovação/reprovação e zero ocorrências
de `Promise.all`.

Também foram adicionadas precondições fatais, fora da contagem dos 31 cenários:

- `anon` e `authenticated` devem existir;
- ambos devem possuir `rolsuper = false`;
- ambos devem possuir `rolbypassrls = false`;
- o PostgreSQL deve ser major 17;
- banco, porta e `data_directory` devem coincidir com o ambiente descartável
  informado pelo orquestrador.

## 3. Orquestrador nativo

O arquivo `scripts/stage7c/run-native-disposable.ps1` implementa o ciclo futuro:

1. exige `PostgresBin` explícito;
2. valida `postgres`, `initdb`, `pg_ctl`, `pg_isready`, `createdb` e `psql`;
3. recusa qualquer versão diferente de PostgreSQL 17;
4. recusa porta já ocupada;
5. cria cluster sob `%TEMP%/ma-stage7c-<uuid>`;
6. grava marcador `.stage7c-disposable` com o UUID da execução;
7. gera senha aleatória temporária;
8. configura somente `127.0.0.1`, SSL desligado e autenticação SCRAM;
9. cria banco `stage7c_<uuid>`;
10. executa exclusivamente `homologate-stage7c-local.cjs`;
11. salva evidência com a senha substituída por `[REDACTED]`;
12. encerra PostgreSQL e confirma a liberação da porta;
13. remove o diretório somente se caminho, prefixo e marcador coincidirem.

Se o PostgreSQL não encerrar ou a porta continuar ocupada, a limpeza é recusada
e o diretório é preservado para evitar remoção insegura ou corrupção.

## 4. Isolamento e rollback

O runner mantém baseline, migrations, fixtures e asserções dentro de
`BEGIN/ROLLBACK`. O orquestrador adiciona uma segunda camada de descarte:

- banco com nome aleatório;
- cluster exclusivo;
- nenhum serviço do Windows;
- nenhum volume compartilhado;
- encerramento explícito do processo;
- eliminação integral do cluster temporário validado.

Essa segunda camada cobre objetos de cluster e operações externas à transação,
incluindo criação do banco e dos papéis temporários.

## 5. Scripts remotos excluídos

O repositório possui scripts legados que leem configuração remota. Eles não são
importados, chamados nem referenciados pelo orquestrador nativo. O único processo
Node autorizado pelo script é `scripts/homologate-stage7c-local.cjs`, que recusa
hosts fora de `127.0.0.1`, `localhost` e `::1`.

## 6. Testes executados sem PostgreSQL

| Verificação | Resultado |
| --- | --- |
| cenários preservados | 31 chamadas confirmadas |
| `Promise.all` no runner | zero ocorrências |
| isolamento sequencial | aprovado |
| validação de `data_directory` e porta | aprovada estaticamente |
| papéis sem superuser/BYPASSRLS | validação preparada |
| binários e major 17 | validação preparada |
| loopback e SCRAM | aprovados estaticamente |
| prefixos UUID e marcador | aprovados estaticamente |
| remoção restrita a `-LiteralPath` validado | aprovada |
| scripts remotos legados | ausentes do fluxo |
| sanitização da evidência | aprovada |
| ausência de binários | falha segura, nenhum cluster criado |
| URL remota | recusada antes da conexão |
| suíte `validate:stage7c-native` | 20/20 aprovada |
| preparação anterior da 7C | 16/16 aprovada |
| controles estáticos de segurança | 31/31 aprovados |
| regressão arquitetural da Etapa 6 | 17/17 aprovada |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado, 24/24 páginas estáticas geradas |

O build emitiu apenas o aviso já conhecido de que o plugin Next.js não foi
detectado na configuração do ESLint. O aviso não interrompeu lint, typecheck ou
build e não foi introduzido por esta subetapa.

## 7. Execução futura

Depois de disponibilizar os binários e mediante nova autorização:

```powershell
pnpm.cmd run homologate:stage7c:native -- -PostgresBin "C:\caminho\postgresql-17\bin"
```

Pré-requisitos:

- binários PostgreSQL 17 provenientes de fonte aprovada e integridade verificada;
- espaço livre suficiente para download, extração, cluster e logs;
- porta local livre, por padrão `55437`;
- permissão de escrita no `%TEMP%` e em `docs/evidence/stage7c`;
- antivírus/firewall permitindo exclusivamente o processo e loopback locais.

O diagnóstico encontrou somente 3,33 GiB livres no volume C:. A meta de 6–8
GiB continua recomendada como margem operacional, não como requisito rígido do
PostgreSQL.

## 8. Arquivos modificados ou criados

- `scripts/homologate-stage7c-local.cjs`;
- `scripts/stage7c/run-native-disposable.ps1`;
- `scripts/stage7c/run-disposable.ps1`;
- `scripts/stage7c/bootstrap.sql`;
- `scripts/validate-stage7c-native.cjs`;
- `package.json`;
- este relatório.

## 9. Parecer

**GO** para revisão da preparação nativa da Etapa 7C.1.

**NO-GO** para baixar ou instalar PostgreSQL, iniciar servidor, executar
migrations, afirmar homologação dos 31 cenários, acessar staging/dados reais ou
liberar produção.
