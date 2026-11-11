# 9E.4 — Roteiro de deploy e rollback hospedado

**Execução:** bloqueada até autorização específica e ambiente isolado  
**Banco:** sintético/isolado; nenhuma migration durante o exercício

## Pré-condições

- projeto hospedado identificado como homologação, nunca domínio operacional;
- duas versões imutáveis A (conhecida) e B (candidata), ambas com build aprovado;
- Node 22, lockfile congelado e variáveis sintéticas verificadas;
- promoção automática desabilitada e aprovador humano definido;
- health checks, logs sanitizados e orçamento aprovados;
- schema compatível com A e B, sem exigir rollback de banco.

## Ensaio futuro

1. publicar A no ambiente isolado e registrar deployment ID sanitizado;
2. executar health, login público e rotas críticas;
3. publicar B sem promover automaticamente;
4. executar smoke completo e promover B mediante gate humano;
5. simular falha somente na aplicação, reversível e sem dados;
6. iniciar cronômetro e executar Instant Rollback para A;
7. confirmar domínio/alias, health, headers, login e terminal;
8. confirmar que banco, Storage e migrations não foram revertidos;
9. registrar RTO, logs, responsável e decisão;
10. desfazer o rollback promovendo uma versão corrigida apenas com autorização.

## Critérios de interrupção

- destino ou domínio identificado como produção operacional;
- variáveis produtivas ou dados reais no preview;
- incompatibilidade de schema entre A e B;
- rollback exige migration reversa/destrutiva;
- promoção automática ou ausência de MFA/aprovador;
- custo não autorizado.

## Critérios de aprovação

| Critério | Limite |
| --- | --- |
| rollback da aplicação | ≤ 30 minutos |
| health após rollback | 100% |
| rotas críticas | 100% HTTP esperado |
| alteração de banco/Storage | zero |
| segredo em log | zero |
| diferença entre artefato local/remoto | zero relevante |

O rollback da Vercel restaura uma versão anterior da aplicação, mas não reverte
banco ou APIs externas; variáveis podem divergir do artefato restaurado e devem
ser verificadas antes da decisão.

Usar `9e4-hosted-rollback.template.json`.

