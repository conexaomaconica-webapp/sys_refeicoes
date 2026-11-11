# Etapa 8C — Homologação integrada e candidato de implantação

**Data:** 27/10/2026  
**Ambiente de banco:** projeto oficial Supabase, por decisão expressa do usuário  
**Resultado local/remoto controlado:** **GO**  
**Publicação externa da aplicação:** **NO-GO técnico**

## Escopo executado

### 8C.1 — Smoke funcional integrado

Foi criada uma identidade sintética temporária, sem `SUPERUSER` ou
`BYPASSRLS`, vinculada como supervisor a uma única unidade. O teste confirmou:

- acesso anônimo recusado nas duas RPCs;
- relatório do terminal autorizado no escopo atribuído;
- Central de Inteligência autorizada no escopo atribuído;
- alvo sem atribuição recusado nas duas RPCs;
- remoção da identidade e ausência de perfil residual.

Nenhuma credencial, UUID ou linha operacional foi gravada nas evidências. O
banco possui somente uma unidade ativa, por isso o controle negativo usou uma
unidade inexistente. O fail-closed está comprovado, mas o teste entre duas
unidades reais permanece pendente até existir uma segunda unidade adequada.

### 8C.2 — Reconciliação do histórico

O histórico remoto foi reconciliado pelo mecanismo oficial
`supabase migration repair --status applied`, sem reexecutar os corpos SQL. A
verificação posterior confirmou alinhamento local/remoto das versões:

- `20261026000072`;
- `20261026000073`;
- `20261027000074`;
- `20261027000075`.

### 8C.3 — Candidato de implantação

O candidato local de produção foi aprovado:

- lint e TypeScript aprovados;
- regressões funcionais, arquiteturais e de segurança aprovadas;
- build Next.js otimizado aprovado;
- 26/26 páginas geradas;
- smoke com `next start` aprovado em `/`, `/login` e
  `/demonstracao/central-inteligencia`;
- headers `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`
  confirmados.

Três validadores estáticos estavam acoplados a implementações anteriores. Eles
foram atualizados para reconhecer o helper central de destino pós-login, a
bifurcação segura de ativação de conta e o script dedicado `dev:turbo`. Nenhum
fluxo de produção foi flexibilizado por essas correções.

## Parecer

| Gate | Parecer |
| --- | --- |
| 8C.1 — smoke funcional | GO, com ressalva de uma única unidade real |
| 8C.2 — histórico 72–75 | GO |
| 8C.3 — candidato local | GO |
| deploy externo | NO-GO técnico: destino não configurado |
| produção operacional | NO-GO até decisão explícita de hospedagem, backup e rollback |

Não foi criado commit, não houve push e nenhuma aplicação web foi publicada.
O projeto ainda não possui configuração de Vercel, workflow de CI/CD ou outro
provedor de hospedagem. Escolher esse destino e comprovar backup/restauração são
pré-requisitos para uma implantação real.

## Evidências

- `docs/evidence/stage8c/stage8c-functional-smoke-20261027.json`;
- `docs/evidence/stage8c/stage8c-history-reconciliation-20261027.json`;
- `docs/evidence/stage8c/stage8c-release-candidate-20261027.json`.
