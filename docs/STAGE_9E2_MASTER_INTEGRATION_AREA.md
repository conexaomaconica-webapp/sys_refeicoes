# Etapa 9E.2 — Área Master de integração Asaas

**Data:** 28/10/2026  
**Escopo:** implementação local e aplicação controlada da migration 76  
**Publicação e ativação produtiva:** NO-GO

## Entrega

Foi criada a rota `/admin/integracoes`, acessível exclusivamente ao perfil
`admin_general`. A área permite manter configurações independentes de Sandbox e
Produção, testar autenticação da API e validar localmente o token do Webhook.

As chaves são gravadas no Supabase Vault pela migration 76. A interface recebe
somente indicadores de presença e resultados dos testes; o valor dos segredos
nunca é devolvido ao navegador. A tabela de metadados utiliza RLS forçado e não
possui acesso direto para `anon` ou `authenticated`.

## Controles operacionais

- Sandbox aceita apenas chave com prefixo `$aact_hmlg_`;
- Produção aceita apenas chave com prefixo `$aact_prod_`;
- o teste de API usa somente `GET /myAccount/status/`;
- o teste não cria cliente, cobrança, Pix, cartão ou crédito;
- a ativação produtiva depende de `PAYMENT_PRODUCTION_ENABLE_ALLOWED=true` e
  permanece bloqueada no estado atual;
- somente um ambiente Asaas pode ficar ativo por tenant;
- a URL de Webhook contém `tenant_id` e `environment`, além da validação do
  token secreto;
- erros e evidências não registram chaves nem payloads sensíveis.

## Migration

`20261028000076_add_secure_asaas_integrations.sql` foi aplicada ao Supabase em
transação única após autorização expressa. Antes do commit, a mesma migration
foi executada duas vezes dentro de uma transação descartável e revertida, o que
comprovou aplicação e idempotência no Vault real.

Pós-condições remotas:

- migration `20261028000076` registrada no histórico com SHA-256;
- tabelas de integração e auditoria existentes;
- RLS habilitado e forçado;
- `authenticated` sem `SELECT` direto e sem execução da RPC que retorna segredo;
- zero integrações, zero eventos de auditoria e zero segredos Asaas criados pela
  aplicação no momento da instalação;
- nenhuma ativação de Sandbox ou Produção realizada.

## Homologação financeira

Esta entrega cria a superfície segura de configuração e testes, mas não aprova
os 14 cenários PAY-01 a PAY-14. A Etapa 9E.2 continua em NO-GO transacional até
que as credenciais Sandbox sejam cadastradas e a jornada completa seja
executada sem dinheiro real.

## Validação final

- controles específicos: **20/20**;
- vetores de assinatura: **10/10**;
- ensaio transacional da migration: aprovado e revertido;
- pós-check remoto: aprovado;
- lint e TypeScript: aprovados;
- build Next.js: código zero, **27/27 páginas** e `BUILD_ID` válido;
- tempo do build final: **555,8 s**.
