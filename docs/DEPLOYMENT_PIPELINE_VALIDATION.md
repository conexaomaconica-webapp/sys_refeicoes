# Validação do Pipeline de Implantação

**Data:** 19/10/2026  
**Escopo:** validação local do artefato de produção, sem publicação remota.  
**Decisão de produção:** **NO-GO**.

## Resultado

O pipeline local de produção foi comprovado de ponta a ponta após a correção
da resolução de dependências do pnpm no webpack.

| Gate | Resultado |
| --- | --- |
| Runtime Node.js 22 | aprovado |
| `pnpm install --offline --frozen-lockfile` | aprovado; 461 entradas verificadas |
| `pnpm run lint` | aprovado |
| `pnpm run typecheck` | aprovado |
| Sprint 4 | 52/52 validações |
| Estabilização Pós-Sprint 10 | 20/20 validações |
| `pnpm run build` (webpack) | aprovado |
| Geração estática | 10/10 páginas |
| Build tracing | concluído |
| Smoke test com `next start` | `/` e `/login` HTTP 200 |
| Headers básicos | `nosniff`, `DENY` e referrer policy presentes |

O build webpack concluiu em aproximadamente 9m53s neste host. A compilação
foi concluída em 3,7 minutos; o restante concentrou-se nas verificações,
geração estática, otimização e tracing.

O comando canônico completo `pnpm run pipeline:check` também foi executado
isoladamente e concluiu com exit code 0 em aproximadamente 14m20s. Na segunda
execução, a compilação webpack levou 5 minutos e todas as 10 páginas foram
geradas.

## Defeito encontrado e correção

O build inicialmente não resolvia `cookie` e `@supabase/functions-js`, apesar
de ambos estarem presentes no lockfile e no store do pnpm. Havia duas causas
locais:

1. a árvore de links de `node_modules` estava incompleta e foi reparada com
   instalação offline e lockfile congelado;
2. `next.config.mjs` definia `config.resolve.symlinks = false`, impedindo o
   webpack de seguir a estrutura de dependências do pnpm.

A opção incompatível foi removida. Nenhuma versão de dependência foi alterada.

## Comando canônico local

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run pipeline:check
```

`pipeline:check` executa, em ordem:

1. lint;
2. typecheck;
3. validação da Sprint 4;
4. validação da Estabilização Pós-Sprint 10;
5. build webpack de produção.

## Pipeline recomendado para CI/CD

```text
checkout
  -> Node 22 + pnpm 12.6.0
  -> pnpm install --frozen-lockfile
  -> pnpm run pipeline:check
  -> validar migrations por dry-run no ambiente de destino
  -> comprovar backup restaurável
  -> aprovação manual
  -> aplicar migrations aditivas autorizadas
  -> implantar o mesmo artefato validado
  -> smoke test e health check
  -> registrar evidências ou executar rollback da aplicação
```

O job deve usar cache do store do pnpm, mas nunca cachear `.env`, credenciais
ou respostas financeiras. Segredos devem ser injetados pelo provedor e nunca
usar prefixo `NEXT_PUBLIC_`, exceto URL e chave anônima do Supabase.

O Next.js emite um aviso de que não detecta seu plugin no ESLint. O lint
separado usa `next/core-web-vitals` e `next/typescript` via FlatCompat e passa
sem erros; o aviso é não bloqueante, mas deve ser reavaliado ao atualizar o
Next.js ou migrar a configuração flat do ESLint.

## Pendências para comprovar implantação real

Não existe no repositório workflow de CI/CD, configuração de Vercel ou outro
provedor de hospedagem. Portanto, o artefato local está validado, mas ainda não
há prova de implantação em infraestrutura externa.

Antes de produção ainda são obrigatórios:

- escolher e configurar o provedor de hospedagem;
- criar ambiente de preview/teste separado da produção;
- configurar segredos server-side no provedor;
- estabelecer backup externo restaurável, RPO e RTO;
- executar o pipeline no runner remoto;
- validar HTTPS, domínio, health check, logs e rollback da aplicação;
- manter migrations de produção sob aprovação manual específica.

O snapshot interno do banco de testes não substitui backup externo. Nenhuma
publicação ou alteração de produção foi realizada nesta validação.
