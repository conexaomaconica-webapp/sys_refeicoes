# Etapa 9C — Preparação de CI/CD, health checks e rollback

**Data:** 27/10/2026  
**Escopo:** desenvolvimento local; sem GitHub/Vercel remoto e sem deploy  
**Parecer:** **GO para preparação local; NO-GO para publicação**

## Arquitetura preparada

### Quality gate

`.github/workflows/quality-gate.yml` executará, quando futuramente enviado ao
GitHub, checkout sem credencial persistida, Node 22, pnpm 12.6.0, instalação com
lockfile congelado e `pnpm run ci:check`.

O workflow possui somente `contents: read`, usa placeholders sintéticos, não
declara ambiente de produção e não contém token Vercel, comando de deploy,
migration, acesso ao banco ou segredo remoto. Push e pull request validam; nunca
publicam.

### Health checks

| Rota | Objetivo | Resposta pública |
| --- | --- | --- |
| `/api/health/live` | comprovar que o processo HTTP responde | `{"status":"ok"}` |
| `/api/health/ready` | validar presença e formato da configuração essencial | `{"status":"ready"}` ou `{"status":"not_ready"}` |

As rotas não consultam dados operacionais, não exibem variáveis ausentes,
versões, uptime, hostname, stack trace ou credenciais. Ambas desabilitam cache.
A prontidão de configuração não substitui o smoke autenticado do Supabase.

### Verificadores

- `scripts/release/check-environment.cjs`: valida nomes, URLs, HMAC e separação
  público/privado sem imprimir valores;
- `scripts/release/verify-deployment.cjs`: exige HTTPS fora de localhost e
  verifica páginas, health checks e headers;
- `scripts/validate-stage9c.cjs`: comprova estaticamente os controles da etapa.

## Headers

Foram preservados `nosniff`, `DENY` e `Referrer-Policy`. Foram adicionados:

- `Permissions-Policy` restritiva;
- HSTS por um ano, incluindo subdomínios.

CSP permanece gate da 9D: a política definitiva precisa ser testada com imagens
do Supabase Storage, Realtime e provedores de pagamento para não bloquear fluxos
legítimos.

## Rollback da aplicação

Procedimento futuro, após a Vercel ser configurada:

1. confirmar falha por health check, logs sanitizados e reprodução;
2. congelar novas promoções e identificar o último deployment aprovado;
3. verificar a migration head exigida pela versão anterior;
4. recusar rollback se a versão antiga for incompatível com o schema atual;
5. executar Instant Rollback no painel ou `vercel rollback` por operador
   autorizado com MFA;
6. validar `/api/health/live`, `/api/health/ready`, `/login`, `/terminal` e
   `/consumer`;
7. executar smoke de autenticação e um fluxo transacional controlado;
8. registrar incidente, deployment anterior/atual, horários e decisão;
9. corrigir a causa e promover uma nova versão revisada.

Rollback Vercel não reverte PostgreSQL, migrations, Storage, Auth, webhooks ou
movimentações financeiras. Recuperação do banco segue exclusivamente o plano 9B.
Migrations destrutivas continuam proibidas; correções de schema exigem migration
compensatória revisada ou procedimento de recuperação autorizado.

## Checklist para futura implantação

- [ ] Vercel Pro e orçamento aprovados;
- [ ] contas Git/Vercel/Supabase protegidas por MFA;
- [ ] branch protection exige Quality Gate aprovado;
- [ ] preview usa somente dados sintéticos e credenciais próprias;
- [ ] variáveis conferidas sem imprimir valores;
- [ ] Node fixado em 22.x e região próxima ao Supabase;
- [ ] backup/PITR e restore da 9B comprovados;
- [ ] CSP homologada;
- [ ] domínio, HTTPS, callbacks Auth e webhooks validados;
- [ ] smoke 9D aprovado, inclusive terminal e pagamentos;
- [ ] teste negativo entre duas unidades reais aprovado;
- [ ] aprovação manual de produção registrada;
- [ ] rollback cronometrado e responsável de plantão definido.

Qualquer item pendente mantém **NO-GO** para publicação.

## Arquivos da etapa

- `.github/workflows/quality-gate.yml`;
- `src/app/api/health/live/route.ts`;
- `src/app/api/health/ready/route.ts`;
- `src/lib/health.ts`;
- `scripts/release/check-environment.cjs`;
- `scripts/release/verify-deployment.cjs`;
- `scripts/validate-stage9c.cjs`;
- `docs/ENVIRONMENT_VARIABLES.md`;
- `docs/STAGE_9C_CICD_ROLLBACK.md`.

Nenhum commit, push, contratação, projeto Vercel, deploy ou alteração Supabase
faz parte desta entrega.

## Resultado da validação local

| Gate | Resultado |
| --- | --- |
| controles específicos 9C | 28/28 aprovados |
| inventário `.env.example` | 15/15 aprovados |
| `pnpm run ci:check` | aprovado integralmente |
| lint e TypeScript | aprovados |
| build Next.js | aprovado; 28 rotas listadas e 26 páginas geradas |
| `/api/health/live` | HTTP 200, `ok`, `no-store` |
| `/api/health/ready` | HTTP 200, `ready`, `no-store` |
| processos temporários | encerrados |

O smoke de health utilizou configuração sintética e não consultou páginas,
Supabase ou dados operacionais.
