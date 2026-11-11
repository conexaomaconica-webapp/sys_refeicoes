# Inventário de variáveis de ambiente

Este documento registra somente nomes e finalidades. Valores reais devem ficar
no cofre do provedor e nunca em Git, logs, relatórios ou artefatos.

## Runtime da aplicação

| Variável | Classe | Obrigatória | Ambientes | Finalidade |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | pública | sim | preview/produção | endpoint HTTPS do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | pública | sim | preview/produção | chave pública sujeita a RLS |
| `NEXT_PUBLIC_APP_URL` | pública | sim | preview/produção | URL canônica e callbacks |
| `NEXT_PUBLIC_SITE_NAME` | pública | sim | todos | nome exibido |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | pública | sim | todos | branding público inicial |
| `SUPABASE_SERVICE_ROLE_KEY` | privada | sim | runtime server-side | operações administrativas autorizadas |
| `CONSUMER_IDENTITY_HMAC_KEY` | privada | sim | runtime server-side | HMAC de CPF e rate limit |
| `DEFAULT_PAYMENT_PROVIDER` | privada/configuração | não | runtime server-side | `mock`, `asaas` ou `mercadopago` |
| `ASAAS_API_KEY` | privada | se Asaas ativo | runtime server-side | autenticação no provedor |
| `ASAAS_WEBHOOK_SECRET` | privada | se Asaas ativo | runtime server-side | validação do webhook |
| `ASAAS_SANDBOX` | privada/configuração | não | preview | impede uso acidental de produção |
| `MERCADOPAGO_ACCESS_TOKEN` | privada | se Mercado Pago ativo | runtime server-side | autenticação no provedor |
| `MERCADOPAGO_WEBHOOK_SECRET` | privada | se Mercado Pago ativo | runtime server-side | validação do webhook |

`VERCEL_ENV` é fornecida automaticamente pela plataforma e diferencia
`development`, `preview` e `production`; não deve ser cadastrada manualmente.

## Desenvolvimento e homologação

Senhas `CAIXA_TEST_PASSWORD`, `OPERATOR_TEST_PASSWORD` e
`OPERATOR_PREVIOUS_PASSWORD`, URLs PostgreSQL e guardas `STAGE*` são exclusivas
de execução local autorizada. Elas não devem existir no runtime Vercel.

`SUPABASE_DB_URL` também não integra o runtime web. Quando necessário para uma
tarefa administrativa, deve ser injetada temporariamente em job manual separado,
sem acesso por pull requests e sem publicação em log.

## Regras

- preview e produção usam projetos/segredos distintos;
- nenhum segredo recebe prefixo `NEXT_PUBLIC_`;
- produção exige URLs HTTPS;
- a chave HMAC deve ser estável, aleatória, exclusiva por ambiente e ter ao
  menos 32 caracteres;
- rotação de HMAC precisa de plano de migração, pois altera identificadores;
- chaves de pagamento e `service_role` devem ser rotacionadas após suspeita de
  exposição;
- o workflow de qualidade usa somente placeholders sintéticos e não recebe
  secrets do GitHub.

Validação futura antes do deploy:

```text
node scripts/release/check-environment.cjs
```

O comando informa apenas aprovação por nome de variável e nunca imprime valores.
