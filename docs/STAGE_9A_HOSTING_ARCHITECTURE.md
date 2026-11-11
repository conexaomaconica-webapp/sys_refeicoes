# Etapa 9A — Hospedagem e arquitetura de implantação

**Data da análise:** 27/10/2026  
**Escopo:** planejamento local, sem contratação, criação de conta ou deploy  
**Parecer:** **GO para Vercel Pro como arquitetura preferencial; NO-GO para contratação/publicação**

## 1. Requisitos do Sistema MA Refeições

A hospedagem precisa suportar:

- Next.js 15 com App Router, SSR, Route Handlers e Middleware;
- Node.js 22 e pnpm fixado pelo repositório;
- PWA com manifest e service worker servido somente por HTTPS;
- conexão de baixa latência com Supabase Auth, PostgreSQL, Realtime e Storage;
- variáveis públicas e segredos server-side separados;
- preview, promoção controlada, health check e rollback rápido;
- terminal online-first e fail-closed: indisponibilidade nunca pode liberar refeição,
  cobrança ou débito localmente;
- operação inicial de uma unidade e evolução posterior para múltiplas unidades.

O artefato atual já foi validado com 26 páginas, SSR e build de produção.

## 2. Opções avaliadas

| Opção | Compatibilidade | Operação | Custo inicial indicativo | Avaliação |
| --- | --- | --- | --- | --- |
| Vercel Pro | integração nativa com Next.js 15, Node 22, Git, previews e rollback | baixa complexidade | US$ 20/mês, com um assento de deploy e US$ 20 de crédito de uso; excedentes e impostos à parte | **recomendada** |
| AWS Amplify Hosting | suporta Next.js 15 e Node 22 sem adaptador | complexidade e cobrança AWS maiores; exige maior disciplina de IAM e observabilidade | consumo por build, SSR e transferência; estimativa depende de tráfego | alternativa caso a organização já opere AWS |
| infraestrutura própria/VPS | possível com Node, proxy, TLS e process manager | maior responsabilidade por patches, escala, alta disponibilidade, logs e rollback | variável; custo operacional não está incluído no preço do servidor | não recomendada para o primeiro piloto |

O plano Hobby da Vercel não é adotado como base operacional. O plano Pro oferece
controles de equipe, cobrança profissional e rollback para deployments elegíveis.

## 3. Arquitetura recomendada

```text
Usuários / terminais / PWA
          |
       HTTPS + domínio
          |
    Vercel Pro — Next.js
      |             |
 Supabase SDK   webhooks de pagamento
      |
 Supabase oficial
 Auth + PostgreSQL + RLS + Realtime + Storage
```

Decisões:

1. Aplicação Next.js na Vercel Pro.
2. Supabase permanece como backend dedicado; não mover banco ou autenticação.
3. Fixar Node em `22.x` no provedor, sem usar a versão padrão futura 24.x.
4. Escolher a região de Functions mais próxima da região efetiva do Supabase.
5. Conectar o repositório somente na Etapa 9C, com preview e produção separados.
6. Promoção para produção deve ser manual após todos os gates da 9D.
7. Rollback da aplicação não executa rollback automático do banco.

## 4. Compatibilidade

| Recurso atual | Vercel | Condição de aceite futura |
| --- | --- | --- |
| Next.js 15 / App Router | nativo | build remoto deve reproduzir 26/26 páginas |
| Node.js 22 | suportado | selecionar explicitamente `22.x` |
| pnpm | detectado por `pnpm-lock.yaml` | usar lockfile congelado |
| Middleware e cookies Supabase | suportado | validar login interno e consumidor |
| Route Handlers/webhooks | Functions Node.js | validar assinatura, timeout e idempotência |
| PWA/service worker | compatível sob HTTPS | validar instalação, atualização e fallback offline |
| uploads e relatórios | filesystem da Function não é persistente | manter arquivos no Supabase Storage; `/tmp` apenas transitório |
| Realtime | conexão externa ao Supabase | medir reconexão e região durante piloto |

## 5. Variáveis e segredos

Variáveis públicas permitidas:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `NEXT_PUBLIC_APP_URL`;
- `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`;
- `NEXT_PUBLIC_SITE_NAME`.

Segredos exclusivamente server-side:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `CONSUMER_IDENTITY_HMAC_KEY`;
- chaves e segredos de webhooks dos provedores de pagamento;
- credenciais administrativas de backup, quando existirem.

`SUPABASE_DB_URL`, senhas de teste e credenciais temporárias não devem ser
disponibilizadas ao runtime web sem necessidade. Preview e produção precisam de
segredos distintos. Nenhum valor secreto pode aparecer em Git, log, artefato,
variável `NEXT_PUBLIC_*` ou relatório de erro.

## 6. Rede, domínio e segurança

- HTTPS obrigatório e redirecionamento HTTP → HTTPS;
- domínio principal separado dos endpoints do Supabase;
- URLs de callback do Supabase Auth em allowlist explícita;
- origem de webhook fixa e validação criptográfica no servidor;
- CSP e `Permissions-Policy` devem ser adicionadas antes do GO operacional;
- manter `nosniff`, proteção contra framing e política de referrer já validadas;
- configurar alertas de custo com teto inferior ao padrão de US$ 200 da Vercel;
- habilitar MFA nas contas administrativas de Vercel, Git e Supabase;
- conceder acesso de deploy pelo menor privilégio possível.

## 7. Estimativa inicial

Valores em USD, sem impostos, câmbio ou consumo excedente:

| Componente | Estimativa mínima |
| --- | ---: |
| Vercel Pro | US$ 20/mês |
| Supabase Pro | a partir de US$ 25/mês |
| PITR Supabase por 7 dias | aproximadamente US$ 100/mês |
| compute mínimo exigido pelo PITR | adicional; confirmar no painel antes da contratação |
| armazenamento externo de backups | variável por volume, retenção e tráfego |

Portanto, a base com PITR começa em aproximadamente **US$ 145/mês mais compute,
armazenamento, excedentes, impostos e câmbio**. Esse valor não é cotação e deve
ser confirmado nos painéis antes de qualquer aprovação financeira.

## 8. Gates antes da contratação

- confirmar plano atual, região e volume do Supabase;
- estimar usuários, requisições, egress, Storage e picos por terminal;
- aprovar orçamento e responsável financeiro;
- definir domínio e responsáveis por DNS;
- definir contas com MFA e matriz de acesso;
- aprovar a estratégia 9B e financiar ao menos um teste de restauração;
- decidir se previews usarão um projeto Supabase separado com dados sintéticos;
- manter publicação operacional bloqueada até a Etapa 9D.

## 9. Fontes oficiais consultadas

- Vercel Pro: https://vercel.com/docs/plans/pro-plan
- Limites Vercel: https://vercel.com/docs/limits
- Node.js suportado: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Rollback Vercel: https://vercel.com/docs/instant-rollback
- Next.js no AWS Amplify: https://docs.aws.amazon.com/amplify/latest/userguide/server-side-rendering-amplify.html
- Preços AWS Amplify: https://aws.amazon.com/amplify/pricing/
- Preços Supabase: https://supabase.com/pricing

