# Relatório de Estabilização Pós-Sprint 10

**Data:** 19/10/2026  
**Escopo:** estabilização; Sprint 11 e `/admin/configuracoes` não iniciadas.  
**Recomendação atual:** **não liberar para produção** até concluir os itens pendentes abaixo.

## Resultado executivo

Foram corrigidas duas divergências críticas: pagamento avulso de aluno sem saldo era lançado como recarga técnica seguida de débito da carteira; e o terminal autorizava/sincronizava consumos offline apesar da estratégia oficial online-first. A migration `20261019000044` separa o caixa do ledger, preserva registros legados, concilia formas de pagamento e corrige estornos.

## Infraestrutura

- Node.js validado: 22.23.3.
- pnpm fixado: 12.6.0; lockfile aprovado na verificação de supply-chain (461 entradas).
- Next.js fixado: 15.5.28; React/React DOM: 19.3.1; TypeScript: 5.9.3.
- ESLint e typecheck: aprovados após a consolidação final.
- Validação específica da estabilização: 20/20 verificações aprovadas.
- Build isolado: compilação, checagem de tipos e geração estática 10/10 aprovadas.
- Build webpack padrão: compilou, validou tipos e gerou 10/10 páginas, mas excedeu 15 minutos durante tracing.
- Build final Turbopack: aprovado com exit code 0 (compilação, typecheck, 10/10 páginas, otimização e traces).
- Smoke test de produção: aprovado; `/` e `/login` responderam HTTP 200 via `next start`.
- `npm run ...`: indisponível neste host porque `npm` não está no PATH; equivalentes executados por `pnpm.cmd`.

## Integridade financeira e operacional

| Cenário | Resultado local | Evidência |
| --- | --- | --- |
| Integral sem cobrança | preservado | motor canônico sem wallet para preço zero |
| Parcial com saldo | preservado | `meal_debit` no ledger e saldo não negativo |
| Parcial sem saldo + balcão | corrigido | `meal_sale`, sem recarga/débito na carteira |
| Visitante | corrigido | forma explícita e `consumer_type=visitor` |
| Caixa obrigatório | aprovado por código | turno do mesmo operador/terminal |
| Dinheiro/Pix/cartão | corrigido | totais separados; só dinheiro no saldo físico |
| Estorno de balcão | corrigido | `refund`, original preservado, sem crédito em carteira |
| Idempotência | reforçada | índice por turno/chave e replay persistido |

## Homologação funcional

| Teste | Estado | Observação |
| --- | --- | --- |
| Abertura de caixa | pendente em staging | migration 44 em ambiente descartável |
| Consumo integral | pendente em staging | dados sintéticos e sessão autenticada |
| Parcial com saldo | pendente em staging | conferir ledger e saldo |
| Parcial sem saldo + avulso | pendente em staging | confirmar ausência de wallet transaction |
| Visitante | pendente em staging | dinheiro, Pix e cartão |
| Nova categoria | pendente em staging | teste integrado |
| Logomarca e cores | pendente em staging | storage/RLS remoto |
| Fechamento/conciliação | pendente em staging | numerário separado de Pix/cartão |
| Recebimento sem caixa | aprovado estaticamente | `CASH_SHIFT_REQUIRED` |
| Troca de operador/unidades | aprovado estaticamente | vínculo e `has_unit_access`; concorrência remota pendente |

## Migrations e segurança

- Repositório: 44 migrations sequenciais; nova migration aditiva `20261019000044_stabilize_counter_payments_and_cash_reconciliation.sql`.
- Nenhuma migration instalada foi reaplicada e nenhum dado foi removido.
- Auditoria remota read-only: 43 migrations remotas, 44 locais, somente a migration 44 pendente e nenhuma migration exclusiva do remoto. RLS de `cash_shifts`/`cash_movements` ativa.
- Rotação da credencial PostgreSQL anteriormente exposta continua obrigatória antes da produção.

## Riscos residuais

1. Validar migration 44 em banco descartável/staging, nunca primeiro em produção.
2. Resolver lentidão do filesystem/antivírus; o Next mediu 144–209 ms no benchmark. O build completo levou 12m26s.
3. Existem `package-lock.json` legado e `pnpm-lock.yaml` atual. pnpm foi declarado canônico; remover o legado exige decisão explícita.
4. Eventos offline legados foram preservados e não devem ser conciliados automaticamente.

## Próxima decisão

Após build, staging e homologação integral, a recomendação permanece: **Sprint 11 — Importação Parcial** antes de Configurações Operacionais, salvo dependência comprovada. Caixa obrigatório não pode se tornar configurável.

## Atualização da homologação remota — 19/10/2026

Esta seção substitui os estados pendentes de migration e homologação descritos
acima. O ambiente utilizado é o banco remoto de testes vinculado ao projeto;
não houve liberação para produção.

- Credencial PostgreSQL rotacionada antes da execução.
- Snapshot interno `backup_pre_homologacao_20261019` verificado: 25 tabelas,
  5.352 linhas e manifesto, sem acesso para `anon` ou `authenticated`.
- Migrations locais e remotas sincronizadas: 47/47, sem pendências.
- Migration 45 removeu a recarga técnica do wrapper de pagamento avulso.
- Migration 46 restaurou o valor negativo do `meal_debit` no ledger.
- Migration 47 restaurou o contrato do visitante sobre o motor canônico
  `consume_meal` e eliminou a referência a `validation_method`.
- Homologação transacional remota: 39/39 validações aprovadas.
- Todos os dados sintéticos foram executados em uma única transação e
  revertidos; a verificação final encontrou zero alunos e zero turnos `HOMO-*`.

Foram aprovados: caixa obrigatório, abertura, integral, parcial com carteira,
saldo insuficiente, pagamento avulso sem movimentar carteira, dinheiro e Pix
separados, troco, idempotência, estorno compensatório, visitante, suprimento,
sangria, saldo esperado e fechamento balanceado.

O snapshot interno reduz o risco operacional no ambiente de testes, mas não
substitui backup externo restaurável. A decisão continua **NO-GO para
produção** enquanto o pipeline real de implantação e a estratégia de backup de
produção não forem comprovados. Sprint 11 e `/admin/configuracoes` não foram
iniciados por esta homologação.
