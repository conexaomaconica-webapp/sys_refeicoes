# Etapa 9D — Matriz de homologação pré-publicação

**Data:** 28/10/2026  
**Escopo:** aplicação local e dados sintéticos; sem acesso remoto  
**Classificação:** aprovado, reprovado ou pendente

Esta matriz separa evidência automatizada local de comprovações que exigem
infraestrutura, navegador operado, equipamento físico ou sandbox financeiro.
Uma validação estática não é tratada como substituta de um teste transacional.

| ID | Módulo | Cenário | Evidência local | Resultado |
| --- | --- | --- | --- | --- |
| AUTH-01 | Autenticação | login e sessão do operador | regressões de autenticação e verificação server-side | Aprovado |
| AUTH-02 | Autenticação | primeiro acesso, recuperação e alteração de senha | validadores de acesso e contratos Supabase | Aprovado |
| AUTH-03 | Autenticação | entrega real de e-mail e expiração do link | requer provedor de e-mail configurado | Pendente |
| TERM-01 | Terminal | abertura e fechamento de caixa | regressão de caixa e RPCs versionadas | Aprovado |
| TERM-02 | Terminal | consumo, visitante, pagamentos de balcão e troco | regressão sintética pós-Sprint 10 | Aprovado |
| TERM-03 | Terminal | bloqueios persistidos e relatório F7 | contrato da RPC e interface aprovados | Aprovado |
| TERM-04 | Terminal | scanner, teclado e latência no equipamento final | requer terminal físico e rede operacional | Pendente |
| OFF-01 | Continuidade | perda de conexão não libera nem cobra refeição | contrato `ONLINE-FIRST + FAIL-SAFE` | Aprovado |
| OFF-02 | Continuidade | reconexão restaura novas leituras | validação manual controlada em navegador | Pendente |
| OFF-03 | Continuidade | fila automática de refeições offline | proibida pela fonte de verdade do MVP | Não aplicável |
| FIN-01 | Carteira | saldo, ledger imutável e ausência de saldo negativo | regressões SQL locais anteriores e contratos | Aprovado |
| FIN-02 | Recarga | consumidor só recarrega a própria carteira | contrato server-side e regressões | Aprovado |
| FIN-03 | Webhook | segredo ausente ou assinatura inválida falha fechado | vetores sintéticos Asaas/Mercado Pago | Aprovado |
| FIN-04 | Webhook | repetição do mesmo evento não duplica crédito | constraint e RPC idempotente versionadas | Aprovado |
| FIN-05 | Webhook | status Mercado Pago é consultado antes do crédito | contrato server-side | Aprovado |
| FIN-06 | Gateway | Pix/cartão em sandbox oficial, repetição e indisponibilidade | exige credenciais e sandbox externo | Pendente |
| IMP-01 | Importação | arquivo válido e preview | validações sintéticas Sprint 4/11 | Aprovado |
| IMP-02 | Importação | rejeição parcial e manifesto rastreável | validações sintéticas Sprint 11 | Aprovado |
| IMP-03 | Importação | neutralização de fórmula em CSV/XLSX | sanitizador e regressão local | Aprovado |
| REP-01 | Relatórios | aprovados e bloqueados por turno | serviço/RPC e regressão de terminal | Aprovado |
| REP-02 | Relatórios | faturamento fiscal consolidado | módulo fiscal completo não está homologado | Pendente |
| SEC-01 | Segurança | 31 cenários RLS em PostgreSQL descartável | evidência transacional da Etapa 7C | Aprovado |
| SEC-02 | Segurança | hardening das 12 funções | migration 75 homologada e aplicada anteriormente | Aprovado |
| SEC-03 | Segurança | isolamento sintético por tenant/unidade | Etapas 7C e 7D | Aprovado |
| SEC-04 | Segurança | isolamento negativo entre duas unidades reais | banco oficial possui uma única unidade ativa adequada | Pendente |
| OPS-01 | Health | liveness e readiness sanitizados | 9C e build local | Aprovado |
| OPS-02 | Backup | política, retenção, RPO e RTO | plano 9B | Aprovado |
| OPS-03 | Restauração | restauração completa e cronometrada | exige infraestrutura isolada e backup utilizável | Pendente |
| OPS-04 | Rollback | procedimento separa aplicação e banco | plano 9C | Aprovado |
| OPS-05 | Rollback | reversão real da aplicação hospedada | não existe deployment autorizado | Pendente |
| OPS-06 | Segurança web | CSP compatível com Storage, Realtime e gateways | exige aplicação hospedada e integrações ativas | Pendente |
| OPS-07 | Build | compilação e encerramento formal do `next build` | estabilizado na 9D.1; código zero, 26/26 páginas e `BUILD_ID` válido | Aprovado |

## Gates obrigatórios ainda abertos

1. sandbox real de Asaas/Mercado Pago, incluindo assinatura, repetição e falha;
2. restauração cronometrada em infraestrutura isolada;
3. rollback de uma versão efetivamente hospedada;
4. teste negativo entre duas unidades reais antes de operação multiunidade;
5. aceite manual no navegador e no equipamento de terminal;
6. homologação do relatório fiscal consolidado e da CSP definitiva.
