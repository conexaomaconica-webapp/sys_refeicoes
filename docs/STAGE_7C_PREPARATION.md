# Etapa 7C — Preparação local da homologação transacional

**Data:** 26/10/2026

**Escopo:** preparação local, sem conexão remota e sem aplicação em banco
existente

**Situação:** kit executável preparado; execução PostgreSQL pendente por ausência
de engine local

## 1. Ambiente descartável selecionado

A opção recomendada é PostgreSQL 17 oficial em contêiner efêmero:

- porta publicada somente em `127.0.0.1:55437`;
- rede interna sem saída externa;
- dados em `tmpfs`, sem volume persistente;
- banco dedicado `stage7c_security`;
- credenciais exclusivas e não reutilizáveis;
- encerramento com remoção de volumes e órfãos.

O ambiente está descrito em `infra/stage7c/compose.yaml`. A imagem não foi
baixada e o contêiner não foi iniciado, pois Docker/Podman não estão disponíveis
nesta estação.

Alternativas avaliadas:

| Alternativa | Situação | Parecer |
| --- | --- | --- |
| Docker/Podman local | não instalado | recomendada quando disponível |
| PostgreSQL/`psql` nativo | não instalado | válida em VM/devbox isolada |
| WSL | comando existe, subsistema não instalado | não utilizar nesta etapa |
| engine Node/WASM | pacote não presente | não instalar automaticamente; compatibilidade RLS precisa ser comprovada |
| PostgreSQL remoto | proibido pelo escopo | descartado |

## 2. Runner transacional

`scripts/homologate-stage7c-local.cjs`:

1. exige `STAGE7C_DB_URL`;
2. recusa qualquer hostname diferente de loopback;
3. recusa banco cujo nome não comece com `stage7c_`;
4. exige PostgreSQL 17;
5. inicia transação;
6. cria baseline mínimo equivalente às dependências afetadas;
7. executa as migrations 72 e 73 reais do repositório;
8. cria fixtures sintéticas de dois tenants e múltiplas unidades/perfis;
9. executa 31 asserções RLS/catalog reais;
10. finaliza sempre com `ROLLBACK`.

O baseline contém deliberadamente as duas policies offline extras e policies
permissivas, reproduzindo as classes de falha observadas na Etapa 4B. Ele existe
somente para teste e não é migration de produção.

## 3. Matriz executável dos 31 cenários

| Faixa | Cobertura | Quantidade |
| --- | --- | ---: |
| 1–4 | drift offline, convergência de policies e grants de RPC | 4 |
| 5–14 | isolamento offline por tenant, unidade, perfil, status e anonimato | 10 |
| 15–24 | tenant financeiro e contenção fail-closed | 10 |
| 25–28 | estudante próprio, instituição e bloqueio por unidade sem vínculo canônico | 4 |
| 29–31 | caixa/movimentos por tenant, unidade e status | 3 |

Os testes incluem dois tenants, três unidades no Tenant A, uma unidade no Tenant
B, perfis globais e locais, usuário institucional, consumidor, inativo e
anônimo.

## 4. Execução futura

Em máquina com Docker e a imagem já disponível:

```powershell
pnpm.cmd run homologate:stage7c
```

O orquestrador sobe o contêiner, aguarda saúde, executa o runner e remove o
ambiente em bloco `finally`. Nenhuma URL remota é aceita pelo runner.

Se a imagem ainda não estiver presente, qualquer download deve ser autorizado
separadamente. A execução não deve ser adaptada para apontar a um Supabase ou
banco compartilhado.

## 5. Plano transacional e rollback

### Banco descartável

- migrations, fixtures e testes rodam na mesma transação;
- sucesso ou falha termina em `ROLLBACK`;
- o contêiner e o `tmpfs` são removidos ao final;
- uma falha antes do runner também aciona `docker compose down --volumes`.

### Staging futuro

Ainda bloqueado. Antes de qualquer aplicação será obrigatório:

1. inventariar schema, owners, grants, policies e status offline;
2. restaurar snapshot sanitizado em ambiente descartável;
3. validar que todos os status existentes cabem na constraint proposta;
4. aplicar 72/73 em transação com timeout e janela controlada;
5. executar os 31 cenários antes do commit;
6. abortar diante de qualquer falha crítica/alta;
7. preservar colunas aditivas no rollback e restaurar ACLs/policies pelo snapshot;
8. preferir correção forward-only depois de qualquer gravação real.

## 6. Validações efetivamente executadas nesta preparação

| Verificação | Resultado |
| --- | --- |
| sintaxe JavaScript do runner | aprovado |
| sintaxe PowerShell do orquestrador | aprovado |
| leitura do `package.json` | aprovado |
| bloqueio de URL remota pelo runner | aprovado; `example.com` recusado |
| `pnpm.cmd run validate:stage7c-prep` | 16/16 aprovado |
| preflight de `homologate:stage7c` sem Docker | bloqueio seguro aprovado; nenhum banco alterado |
| 31 controles estáticos da 7B | preservados |
| regressão arquitetural da Etapa 6 | 17/17 aprovado |
| lint | aprovado |
| TypeScript | aprovado |
| build Next.js | aprovado; 24/24 páginas geradas |
| execução dos 31 cenários em PostgreSQL | não executada; engine indisponível |
| migrations aplicadas em banco existente | nenhuma |

## 7. Pendências e riscos residuais

- o baseline mínimo valida 72/73, mas não substitui a instalação completa das 71
  migrations;
- a compatibilidade com o schema efetivo só poderá ser comprovada após inventário
  autorizado de staging;
- a imagem do PostgreSQL precisa existir localmente ou ter download autorizado;
- a modelagem financeira proposta depende das decisões registradas em
  `STAGE_7C_FINANCIAL_SCOPE_MODEL.md`;
- supervisor e gerente permanecem sem leitura financeira bruta;
- nenhum resultado desta preparação autoriza dados reais ou produção.

## 8. Parecer

**GO** para revisão do kit local e futura execução em PostgreSQL descartável.

**NO-GO** para declarar os 31 cenários homologados, aplicar migrations em
staging, remover a contenção fail-closed, integrar dados reais ou liberar
produção.
