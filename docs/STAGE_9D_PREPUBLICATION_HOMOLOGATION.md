# Etapa 9D — Homologação pré-publicação

**Data:** 28/10/2026  
**Ambiente:** exclusivamente local, com dados e configuração sintéticos  
**Parecer:** **GO local com ressalvas; NO-GO para publicação**

## Resultado

A homologação local reuniu as regressões existentes de autenticação, terminal,
caixa, importação, consumidor, RLS e health checks em um runner reproduzível.
Nenhuma conexão remota, alteração no Supabase, migration, deploy, push ou commit
foi executado. Nenhuma transação financeira real foi realizada.

O comportamento offline foi avaliado conforme `OFFLINE_STRATEGY.md`: o MVP é
`ONLINE-FIRST + FAIL-SAFE`. Perda de conexão deve bloquear liberação e cobrança;
fila e sincronização automática de refeições offline não são critérios de aceite.

## Correção de segurança realizada

A auditoria 9D encontrou um risco alto no recebimento de pagamentos: Asaas e
Mercado Pago aceitavam notificações quando o segredo não estava configurado.
Também era possível alcançar o webhook do provedor `mock` no runtime de
produção, e uma notificação Mercado Pago era tratada como confirmação sem
consultar o status canônico do pagamento.

As correções locais:

- tornaram Asaas e Mercado Pago `fail-closed` na ausência de segredo/header;
- adotaram comparação em tempo constante;
- implementaram o manifesto HMAC Mercado Pago com `data.id`, `x-request-id` e
  timestamp;
- bloquearam o webhook `mock` em produção;
- exigiram consulta do status canônico Mercado Pago antes de creditar a recarga;
- adicionaram vetores sintéticos positivos e negativos de assinatura.

O sandbox real dos gateways continua pendente e impede publicação financeira.

## Cobertura executável

O comando `pnpm run validate:stage9d` executa, sem rede:

1. vetores de assinatura de webhook;
2. controles específicos da 9D;
3. autenticação, acesso do consumidor e primeiro acesso;
4. regressão do terminal e do caixa;
5. importação base e tolerante;
6. carteira/PWA do consumidor;
7. regressão estática RLS;
8. health checks e controles de release.

A evidência sanitizada é gravada em
`docs/evidence/stage9d/stage9d-local-20261028.json`. Ela registra apenas nomes de
suítes, contagens, códigos de saída e gates; não contém URLs, credenciais ou
dados operacionais.

### Resultado automatizado

- runner 9D: **11/11 suítes aprovadas**;
- verificações agregadas: **315/315 aprovadas**;
- lint: aprovado;
- `tsc --noEmit`: aprovado;
- compilação Next.js: concluída com sucesso;
- encerramento formal do `next build`: **reprovado**. O worker interno de
  validação de tipos não terminou em 15 minutos e o processo foi encerrado por
  timeout antes de gerar `BUILD_ID`. O typecheck independente havia encerrado
  normalmente.

Esse comportamento não foi mascarado como sucesso e passa a ser gate técnico
de publicação. O build deve ser repetido após diagnóstico de recursos/processos
do Windows e precisa terminar com código zero.

> Atualização 9D.1: o gate foi resolvido com isolamento do build worker e
> otimização de memória do Webpack. O build limpo encerrou com código zero,
> gerou 26/26 páginas e `BUILD_ID` válido. Consulte
> `docs/STAGE_9D1_BUILD_STABILIZATION.md`.

## Falhas e riscos residuais

| Severidade | Item | Situação / correção necessária |
| --- | --- | --- |
| bloqueante | restauração não comprovada | executar restore completo e cronometrado em ambiente isolado |
| bloqueante | duas unidades reais não testadas | criar/selecionar segunda unidade adequada e executar teste negativo de acesso |
| alta | gateways externos não homologados | usar sandbox oficial para assinatura, idempotência, retry e falhas |
| alta | relatório fiscal consolidado | concluir e homologar o módulo antes do uso contábil |
| média | rollback hospedado não exercitado | publicar somente após infraestrutura aprovada e ensaio controlado |
| média | CSP definitiva pendente | homologar com Storage, Realtime e gateways no destino |
| média | aceite físico do terminal | testar scanner, teclado, impressora, rede e latência no equipamento final |
| resolvido | build sem encerramento formal | corrigido e homologado na Etapa 9D.1 |

## Plano de correção

1. configurar ambiente isolado de recuperação e executar o drill de restauração;
2. homologar Asaas/Mercado Pago exclusivamente em sandbox, sem valores reais;
3. executar aceite manual completo em navegador e terminal físico;
4. comprovar isolamento entre duas unidades reais antes de habilitar
   multiunidade;
5. concluir relatório fiscal e validar as fórmulas financeiras;
6. homologar CSP, monitoramento e rollback após existir destino hospedado;
7. repetir lint, TypeScript, build e a suíte 9D no candidato final.
8. investigar a retenção do type worker do Next.js no Windows, incluindo
   memória disponível, antivírus/indexação e processos concorrentes, sem
   desabilitar permanentemente a checagem TypeScript.

## Critérios GO/NO-GO

O código pode continuar em desenvolvimento e homologação local. Publicação
operacional permanece **NO-GO para publicação** enquanto qualquer gate
bloqueante estiver aberto. Um futuro GO exige zero falha crítica/alta, restore
comprovado, fluxo essencial aceito no equipamento final e isolamento entre duas
unidades reais quando houver operação multiunidade.

## Arquivos da etapa

- `src/server/payments/webhook-signature.ts`;
- `src/server/payments/asaas.provider.ts`;
- `src/server/payments/mercadopago.provider.ts`;
- `src/services/recharge.service.ts`;
- `src/app/api/webhooks/payments/[provider]/route.ts`;
- `scripts/test-stage9d-webhook-signatures.cjs`;
- `scripts/validate-stage9d.cjs`;
- `scripts/stage9d/run-local-homologation.cjs`;
- `docs/STAGE_9D_TEST_MATRIX.md`;
- `docs/STAGE_9D_PREPUBLICATION_HOMOLOGATION.md`.
