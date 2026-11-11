# Etapa 9E.2 — Homologação financeira em sandbox

**Data:** 28/10/2026  
**Situação:** preflight local concluído; execução externa bloqueada por ausência de credenciais de teste  
**Parecer:** **GO para preparação local; NO-GO para homologação financeira**

## Decisão sobre a Etapa 9E.1

O responsável pelo projeto decidiu não executar neste momento a cópia externa do
backup nem o ensaio de restauração 9E.1-C e declarou aceitar o risco residual.
O backup cifrado e sua chave existentes foram preservados sem alteração. Essa
decisão não equivale à homologação de recuperação de desastre.

## Preflight executado

O preflight da 9E.2 não encontrou credenciais Asaas ou Mercado Pago de sandbox
no `.env.local`. Por segurança, nenhuma chamada externa, pagamento, webhook
remoto ou mutação no Supabase foi executada.

Foram adicionados controles fail-closed para:

- eliminar fallbacks silenciosos de chaves fictícias nos provedores externos;
- exigir seleção explícita do endpoint sandbox do Asaas;
- interromper antes da rede quando a credencial do gateway estiver ausente;
- bloquear o provedor `mock` também na fábrica quando `NODE_ENV=production`;
- rejeitar códigos de provedor desconhecidos.
- usar o endpoint oficial `api-sandbox.asaas.com` e um `User-Agent`
  identificável;
- aceitar no preflight somente chave Asaas de homologação com prefixo
  `$aact_hmlg_` e segredo de Webhook com ao menos 32 caracteres.

## Resultado

| Verificação | Resultado |
| --- | --- |
| Controles locais do preflight | 14/14 aprovados |
| Credencial Asaas sandbox | não configurada |
| Credencial Mercado Pago sandbox | não configurada |
| Cenários transacionais PAY-01 a PAY-14 | 0/14 executados |
| Conexões a gateways | 0 |
| Transações financeiras reais | 0 |
| Mutações no Supabase | 0 |

Os vetores locais de assinatura e as regressões existentes não serão
contabilizados como homologação em sandbox. O gate continua exigindo 14/14 em
credenciais oficiais de teste.

## Requisitos para retomar

Configurar localmente, sem compartilhar valores em conversa ou versioná-los:

- Asaas: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET` e `ASAAS_SANDBOX=true`; ou
- Mercado Pago: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` e
  `MERCADOPAGO_SANDBOX=true` como confirmação operacional de que as credenciais
  selecionadas no painel são de teste.

Depois disso, repetir o preflight e executar somente o provedor explicitamente
autorizado. Produção e publicação permanecem em NO-GO.

Como a chave Asaas começa com `$`, em `.env.local` esse caractere deve ser
escapado (`ASAAS_API_KEY=\$aact_hmlg_...`) para o carregador de ambiente do
Next.js preservar o valor literal.
