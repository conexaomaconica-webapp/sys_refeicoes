# 9E.2 — Plano de homologação financeira em sandbox

**Execução:** bloqueada até autorização específica  
**Ambiente:** somente credenciais de teste e valores sem liquidação real

## Preflight

- [ ] separar URLs, aplicações e segredos de teste dos produtivos;
- [ ] confirmar `DEFAULT_PAYMENT_PROVIDER` sem fallback produtivo;
- [ ] manter Access Token exclusivamente server-side;
- [ ] configurar webhook de teste HTTPS e segredo exclusivo;
- [ ] confirmar observabilidade sanitizada e limpeza das fixtures;
- [ ] registrar provedores autorizados: Asaas, Mercado Pago ou ambos.

## Matriz obrigatória

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| PAY-01 | Pix criado com credencial de teste | pedido pendente, sem crédito antecipado |
| PAY-02 | cartão aprovado de teste | exatamente um crédito correspondente |
| PAY-03 | cartão rejeitado | nenhum crédito |
| PAY-04 | assinatura válida | evento aceito |
| PAY-05 | assinatura inválida | HTTP 401 e nenhum crédito |
| PAY-06 | segredo ausente | falha fechada e nenhum crédito |
| PAY-07 | mesmo `event_id` repetido | saldo e ledger alterados uma única vez |
| PAY-08 | eventos fora de ordem | estado final canônico, sem regressão indevida |
| PAY-09 | status pendente/expirado | nenhum crédito |
| PAY-10 | indisponibilidade do gateway | recarga indisponível; terminal continua independente |
| PAY-11 | replay após resposta perdida | resposta idempotente |
| PAY-12 | provedor `mock` em produção | recusado |
| PAY-13 | valor/ID externo incompatível | recusado e auditável |
| PAY-14 | conciliação repetida | nenhum crédito adicional |

## Invariantes financeiros

- soma dos créditos confirmados = soma das recargas confirmadas da fixture;
- uma confirmação gera no máximo um lançamento no ledger;
- saldo nunca fica negativo;
- evento rejeitado não altera `payments`, `recharges`, `wallets` ou ledger;
- payload bruto não aparece em logs/evidências;
- o endpoint consulta o estado canônico Mercado Pago antes do crédito.

## Aprovação

GO exige 14/14 cenários, zero diferença de saldo, zero segredo exposto e zero
transação real. Qualquer crédito duplicado, assinatura aceita indevidamente ou
divergência financeira é falha crítica e encerra a execução.

Usar `9e2-payment-sandbox.template.json`.

