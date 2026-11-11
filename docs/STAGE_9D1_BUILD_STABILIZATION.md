# Etapa 9D.1 — Estabilização do build de produção

**Data:** 28/10/2026  
**Escopo:** diagnóstico e correção exclusivamente locais  
**Publicação:** **NO-GO para publicação**

## Diagnóstico

O código da Etapa 9D compilava, e `tsc --noEmit` encerrava normalmente, mas o
`next build` permanecia no worker interno de validação de tipos até o timeout,
sem gerar `BUILD_ID`.

Medições do preflight:

- Node.js `v22.23.3` e pnpm `12.6.0`, compatíveis com o projeto;
- zero processos Node.js anteriores ao build;
- volume C: em NTFS, não FAT32;
- 4.005.040.128 bytes de RAM física total;
- aproximadamente 492 MB livres no diagnóstico;
- aproximadamente 3,44 GiB livres no volume C:;
- compilação Webpack concluída antes da retenção do type worker;
- `tsc --noEmit` aprovado fora do build.

A configuração possuía um hook `webpack` customizado para desabilitar cache.
No Next.js, a presença desse hook desativa o build worker automático. Em uma
máquina de 4 GB, a compilação permanecia no processo principal enquanto o
worker de TypeScript era iniciado, provocando paginação severa.

## Correção controlada

Foram habilitados explicitamente os recursos nativos do Next.js 15:

- `experimental.webpackBuildWorker: true`;
- `experimental.webpackMemoryOptimizations: true`.

O hook de compatibilidade foi preservado. Nenhuma checagem de TypeScript ou
ESLint foi desabilitada, nenhuma dependência foi atualizada e nenhuma regra
operacional foi modificada.

## Resultado das verificações

| Gate | Resultado |
| --- | --- |
| controles específicos 9D.1 | 12/12 aprovados |
| regressão completa 9D | 11/11 suítes; 315/315 verificações |
| lint | aprovado |
| `tsc --noEmit` | aprovado |
| build limpo | aprovado; código de saída zero em 378,7 s |
| páginas estáticas | 26/26 geradas |
| artefatos obrigatórios | 6/6 verificações aprovadas |
| `BUILD_ID` | presente e válido |
| smoke HTTP | 10/10 aprovado |
| processos Node residuais | zero |

O build foi executado após a remoção controlada apenas do diretório `.next`
incompleto. A compilação concluiu em 2,7 minutos e o pipeline completo em 6,3
minutos, incluindo lint interno, TypeScript, coleta de dados, geração das 26
páginas, otimização e traces.

O smoke iniciou `next start` em loopback com variáveis exclusivamente
sintéticas. Foram aprovadas as rotas `/`, `/login`, `/terminal`, recuperação de
senha, Central de Inteligência e os dois health checks. O processo foi encerrado
e não deixou servidor residual.

## Evidências exigidas

- `docs/evidence/stage9d/stage9d1-build-20261028.json`;
- `docs/evidence/stage9d/stage9d1-build-smoke-20261028.json`;
- `.next/BUILD_ID` e manifests locais do candidato.

## Arquivos modificados

- `next.config.mjs`;
- `package.json`;
- `scripts/validate-stage9d1.cjs`;
- `scripts/stage9d1/verify-build-artifact.cjs`;
- `scripts/stage9d1/smoke-local-build.cjs`;
- este relatório e as evidências correspondentes.

## Riscos residuais

Mesmo com esta estabilização aprovada, permanecem os gates externos da Etapa
9D: restauração real, sandbox financeiro, isolamento entre duas unidades reais,
rollback hospedado e aceite no equipamento físico.

O alerta do Next sobre detecção do plugin ESLint permanece apenas informativo:
o lint completo encerrou com código zero antes do build e o lint interno também
foi executado. A configuração Flat Config deverá ser revisada futuramente sem
misturar essa manutenção com a estabilização de memória.

## Parecer

**GO local para a Etapa 9D.1.** A capacidade de gerar um candidato reproduzível
foi recuperada sem reduzir controles de qualidade. **NO-GO para publicação** é
mantido pelos gates externos listados acima.
