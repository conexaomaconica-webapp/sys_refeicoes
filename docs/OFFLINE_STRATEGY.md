# OFFLINE_STRATEGY.md
## Estratégia de Contingência e Operação sem Conectividade
**Projeto:** Sistema de Controle de Refeições  
**Versão:** 1.0  
**Status:** Estratégia inicial de contingência  
**Stack:** Next.js + Supabase + PWA  
**Documentos relacionados:**  
- `SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md`
- `PERMISSIONS_v1_2.md`
- `FLOWS_v1_1.md`
- `MVP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `SECURITY.md`
- `PAYMENTS.md`

---

# 1. Objetivo

Este documento define como o sistema deve se comportar diante de:

- perda de internet;
- indisponibilidade do backend;
- falha parcial de conexão;
- instabilidade de rede;
- indisponibilidade temporária do Supabase;
- indisponibilidade do gateway de pagamento.

O objetivo é manter a operação segura sem permitir inconsistências financeiras ou múltiplas liberações indevidas.

---

# 2. Princípio central

A prioridade do sistema é:

```text
1. integridade financeira
2. prevenção de consumo duplicado
3. consistência de dados
4. disponibilidade
```

Não implementar um modo offline que comprometa as três primeiras prioridades apenas para manter atendimento contínuo.

---

# 3. Premissa do MVP

O funcionamento principal do sistema é:

```text
ONLINE
```

O MVP não terá autorização financeira offline completa.

---

# 4. Motivo

O fluxo de acesso depende de dados que podem mudar a qualquer momento:

- saldo;
- refeição já utilizada;
- situação da matrícula;
- categoria;
- regra de preço;
- status da unidade.

Sem conexão, o terminal não consegue garantir que essas informações continuam atuais.

---

# 5. Risco principal

Cenário:

```text
Aluno possui R$ 2,00
```

Terminal A offline:

```text
libera almoço
```

Terminal B offline:

```text
também acredita que há R$ 2,00
libera almoço novamente
```

Resultado:

- saldo negativo;
- refeição duplicada;
- inconsistência.

---

# 6. Segundo risco

Aluno integral:

```text
tem direito a 1 almoço
```

Terminal A offline:

```text
libera
```

Terminal B offline:

```text
libera novamente
```

Mesmo sem saldo financeiro, a regra de consumo foi violada.

---

# 7. Conclusão

O sistema não deve adotar no MVP:

```text
offline irrestrito
```

---

# 8. Estratégia proposta

Dividir contingência em quatro níveis:

```text
NÍVEL 0 — ONLINE NORMAL
NÍVEL 1 — REDE INSTÁVEL
NÍVEL 2 — BACKEND INDISPONÍVEL
NÍVEL 3 — CONTINGÊNCIA OPERACIONAL
```

---

# 9. Nível 0 — Online normal

Fluxo padrão:

```text
scanner
↓
frontend
↓
backend
↓
consume_meal()
↓
resultado
```

Todas as regras são aplicadas em tempo real.

---

# 10. Nível 1 — Rede instável

Características:

- latência alta;
- timeout eventual;
- conexão retorna rapidamente.

Comportamento:

```text
não assumir falha definitiva
```

Aplicação pode:

- tentar novamente;
- mostrar estado "Reconectando";
- manter scanner pronto;
- evitar múltiplas submissões.

---

# 11. Retry

Retry deve ser controlado.

Não enviar várias solicitações simultâneas para o mesmo QR.

---

# 12. Idempotência no consumo

Se houver retry da mesma leitura:

```text
mesma tentativa
```

não pode gerar consumo duplicado.

Considerar:

```text
request_id
```

ou chave de idempotência.

---

# 13. Timeout

Definir timeout operacional curto.

Exemplo conceitual:

```text
3–5 segundos
```

Valor final deve ser validado no piloto.

---

# 14. Estado visual

Durante timeout:

```text
PROCESSANDO...
```

Depois:

```text
CONEXÃO INSTÁVEL
TENTAR NOVAMENTE
```

---

# 15. Não liberar por timeout

Timeout não significa:

```text
LIBERADO
```

---

# 16. Nível 2 — Backend indisponível

Se Supabase/backend estiver indisponível:

```text
não debitar
não registrar consumo
não confirmar liberação automática
```

---

# 17. Mensagem ao operador

Exemplo:

```text
SISTEMA TEMPORARIAMENTE INDISPONÍVEL

Não foi possível validar esta matrícula.
```

---

# 18. Indicador de status

Tela da recepção deve possuir indicador:

```text
ONLINE
INSTÁVEL
OFFLINE
```

---

# 19. Detecção de conectividade

Não confiar apenas em:

```text
navigator.onLine
```

Também realizar health check real.

---

# 20. Health check

Endpoint simples:

```text
/api/health
```

ou chamada equivalente segura.

---

# 21. Frequência

Quando a recepção detectar falha:

```text
tentar health check periodicamente
```

Sem sobrecarregar backend.

---

# 22. Reconexão

Quando conexão retornar:

```text
ONLINE
```

Interface deve liberar novas leituras imediatamente.

---

# 23. Nível 3 — Contingência operacional

Se a operação não puder parar, a empresa pode definir protocolo manual externo ao sistema.

Exemplo:

- fila de contingência;
- anotação manual;
- lista impressa;
- decisão de gestão.

---

# 24. Importante

A contingência manual:

```text
não equivale a consumo confirmado pelo sistema
```

---

# 25. Registro posterior

Se a empresa optar por liberar manualmente durante indisponibilidade:

pode existir futuramente módulo:

```text
contingency_entries
```

---

# 26. Fora do MVP

Esse módulo não é obrigatório no MVP.

Deve ser avaliado após piloto.

---

# 27. Possível estrutura futura

```text
contingency_entries
```

Campos:

```text
id
tenant_id
unit_id
registration_number
meal_type_id
occurred_at
operator_id
reason
status
synced_at
```

---

# 28. Risco do lançamento posterior

Ao sincronizar:

```text
pode existir conflito
```

Exemplo:

- refeição já registrada online;
- saldo insuficiente;
- aluno inativo.

---

# 29. Regra de reconciliação futura

Contingência offline nunca deve ser sincronizada automaticamente sem validação.

---

# 30. Possíveis estados

```text
pending_review
accepted
rejected
conflict
```

---

# 31. Estratégia recomendada para MVP

No MVP:

```text
sem consumo offline
```

A recepção depende de conectividade funcional.

---

# 32. Por que isso é aceitável

A empresa informou que:

- internet normalmente é estável;
- quedas não são frequentes.

Logo, é melhor preservar segurança e integridade.

---

# 33. PWA offline

O PWA pode funcionar parcialmente offline para:

- assets;
- branding;
- layout;
- splash.

---

# 34. Dados que não devem funcionar offline

Não permitir uso offline de:

- saldo;
- extrato financeiro atualizado;
- recarga;
- consumo;
- liberação;
- status acadêmico.

---

# 35. Carteirinha offline

A PWA pode exibir o QR Code previamente carregado.

Mas:

```text
exibir QR ≠ garantir liberação
```

A recepção ainda precisa validar online.

---

# 36. Cache do QR

Pode ser permitido para melhorar UX.

O QR apenas identifica.

Não representa autorização.

---

# 37. Service Worker

Pode cachear:

```text
CSS
JS
ícones
logo
fontes
shell da aplicação
```

---

# 38. Não cachear

Evitar cache persistente de:

```text
wallet balance
payment status
meal eligibility
consumption history sensível
admin data
```

---

# 39. Estratégia stale data

Se algum dado antigo aparecer:

identificar claramente:

```text
Última atualização: XX:XX
```

---

# 40. Recargas sem internet

Não permitir criar recarga digital se o backend estiver indisponível.

---

# 41. Gateway indisponível

Se backend está online mas gateway offline:

```text
carteirinha continua funcionando
consumo continua funcionando
recarga fica indisponível
```

---

# 42. Separação importante

```text
falha do gateway
≠
falha do sistema
```

---

# 43. Status dos serviços

Arquitetura pode futuramente possuir status interno:

```text
database
auth
payments
```

---

# 44. Terminal e gateway

A recepção não deve depender do gateway de pagamentos em tempo real.

Ela depende apenas do saldo já confirmado.

---

# 45. Falha de Auth

Se operador já possui sessão válida:

avaliar comportamento conforme token.

Se sessão expirar e Auth estiver indisponível:

não criar bypass inseguro.

---

# 46. Sessão da recepção

Configurar duração adequada para evitar logout durante pico.

---

# 47. Reautenticação

Não exigir login repetido a cada refeição.

---

# 48. Equipamento dedicado

Recomendado:

- sessão por operador;
- terminal dedicado;
- conexão estável;
- rede redundante quando possível.

---

# 49. Redundância de internet

Recomendação operacional futura:

```text
link principal
+
4G/5G backup
```

Pode reduzir necessidade de offline.

---

# 50. Roteador backup

Uma solução simples pode ser mais segura que um offline complexo.

---

# 51. Rede local

O sistema não dependerá apenas da LAN.

Precisa acessar backend em nuvem.

---

# 52. Latência

Medir durante piloto:

```text
p50
p95
p99
```

da operação `consume_meal()`.

---

# 53. Threshold

Se latência subir demais:

mostrar alerta operacional.

---

# 54. Circuit breaker

Não obrigatório no MVP.

Pode ser avaliado para integrações externas.

---

# 55. Queue

Não usar fila assíncrona para liberação da refeição.

A decisão deve ser síncrona.

---

# 56. Operações assíncronas permitidas

Após liberação:

- notificação;
- analytics;
- logs secundários.

---

# 57. Operações síncronas obrigatórias

Antes de LIBERAR:

- validação;
- duplicidade;
- saldo;
- consumo;
- débito.

---

# 58. Regra visual

Nunca mostrar verde/liberado antes do COMMIT.

---

# 59. Som de liberação

Só disparar após sucesso confirmado.

---

# 60. Falha após leitura

Se backend não responde:

não mostrar:

```text
LIBERADO
```

---

# 61. Retry do operador

Botão:

```text
TENTAR NOVAMENTE
```

Pode reutilizar leitura.

---

# 62. Nova leitura

Após erro:

operador pode escanear novamente.

Backend deve bloquear duplicidade se a primeira tentativa tiver sido concluída mas a resposta se perdeu.

---

# 63. Cenário crítico

```text
backend COMMIT ocorreu
↓
resposta perdeu conexão
↓
operador tenta de novo
```

Segundo request deve retornar:

```text
MEAL_ALREADY_USED
```

Idealmente informar:

```text
Refeição já registrada às HH:MM
```

---

# 64. Idempotency key no consume_meal

Pode melhorar esse cenário.

Exemplo:

```text
terminal_id + scan_id
```

---

# 65. terminal_id

Recomendado futuramente identificar dispositivo.

Campos:

```text
terminal_id
unit_id
name
status
```

---

# 66. terminals

Tabela pode ser adicionada em `DATABASE.md` futuramente.

Não obrigatória no primeiro ciclo.

---

# 67. Telemetria

Registrar:

- perda de conexão;
- quantidade de retries;
- tempo offline;
- falhas de health check;
- timeouts.

---

# 68. Dashboard operacional

Pode mostrar:

```text
Terminais online
Terminais com falha
```

Pós-MVP.

---

# 69. Disponibilidade do Supabase

Monitorar status externo se necessário.

Não confiar exclusivamente nisso para UX local.

---

# 70. Fallback administrativo

Admin pode continuar consultando dados previamente carregados?

Somente leitura e se estiver claro que são dados desatualizados.

---

# 71. Escrita offline no admin

Não recomendada no MVP.

---

# 72. Importação offline

Não suportada.

---

# 73. Relatórios offline

Não necessários.

---

# 74. Splash offline

Se PWA foi instalada e assets estão em cache:

pode abrir splash.

Depois informar:

```text
Sem conexão
```

---

# 75. Aluno offline

Pode acessar:

- QR previamente carregado;
- dados básicos armazenados localmente, se seguro.

---

# 76. Aluno parcial offline

Não mostrar saldo como atual sem aviso.

---

# 77. Recarga offline

Bloquear.

---

# 78. Histórico offline

Opcional cache apenas de leitura.

Não necessário no MVP.

---

# 79. Segurança do cache

Nunca armazenar dados sensíveis em localStorage sem necessidade.

---

# 80. IndexedDB

Se usada futuramente:

- minimizar dados;
- evitar dados financeiros desnecessários.

---

# 81. Contingência para integral

Embora não exista saldo:

continua havendo risco de refeição duplicada.

Portanto:

```text
integral também precisa de validação online
```

---

# 82. Contingência para parcial

Mais crítica ainda por saldo.

---

# 83. Possível evolução: offline controlado

Pós-MVP, pode-se estudar:

```text
offline allowance
```

com limites.

---

# 84. Exemplo de offline allowance

Servidor pré-autoriza:

```text
1 almoço
```

para determinado aluno/terminal.

Mas isso aumenta complexidade.

---

# 85. Tokens de consumo offline

Outra possibilidade futura:

```text
meal entitlement tokens
```

pré-assinados.

Não implementar agora.

---

# 86. Problemas do entitlement offline

- sincronização;
- revogação;
- múltiplos terminais;
- saldo;
- fraude;
- replay.

---

# 87. Decisão atual

```text
NÃO IMPLEMENTAR
```

---

# 88. Estratégia operacional recomendada

Antes do piloto:

- validar qualidade da internet;
- testar Wi-Fi;
- testar cabeamento;
- avaliar link backup;
- testar horário de pico.

---

# 89. Teste de falha

Durante homologação:

```text
desconectar internet
```

e observar comportamento.

---

# 90. Critérios de aceite

O sistema deve:

- detectar indisponibilidade;
- não liberar indevidamente;
- não debitar parcialmente;
- não duplicar consumo após retry;
- recuperar operação ao reconectar;
- informar status ao operador.

---

# 91. Testes obrigatórios

## Rede

- timeout;
- conexão lenta;
- queda durante request;
- reconexão.

## Consume

- commit + resposta perdida;
- retry;
- duas leituras simultâneas.

## PWA

- abertura offline;
- QR previamente carregado;
- recarga bloqueada.

---

# 92. Mensagens recomendadas

## Instável

```text
Conexão instável.
Tentando reconectar...
```

## Offline

```text
Sem conexão com o sistema.
A validação de acesso está temporariamente indisponível.
```

## Backend indisponível

```text
Sistema temporariamente indisponível.
Tente novamente em instantes.
```

---

# 93. Não usar

Evitar mensagens técnicas:

```text
Supabase error
fetch failed
ECONNRESET
```

---

# 94. Procedimento operacional

A empresa deverá definir:

```text
o que fazer quando o sistema ficar indisponível por X minutos
```

---

# 95. Documento interno

Pode existir posteriormente:

```text
RUNBOOK_CONTINGENCIA.md
```

para operadores e gestores.

---

# 96. Responsáveis

Definir futuramente:

- quem decide liberar manualmente;
- quem registra contingência;
- quem revisa conflitos.

---

# 97. Auditoria de contingência

Se houver operação manual futura:

toda entrada deve ser auditada.

---

# 98. Conciliação pós-contingência

Após retorno:

```text
registros pendentes
↓
revisão
↓
aceite/rejeição
↓
ajuste financeiro se necessário
```

---

# 99. Não sincronizar cegamente

Principal regra de eventual modo offline.

---

# 100. Métricas

Medir:

- uptime;
- tempo offline;
- quantidade de falhas;
- retries;
- impacto na fila.

---

# 101. SLA

Pode ser definido após piloto.

---

# 102. Meta inicial

Buscar alta disponibilidade por infraestrutura, não por offline financeiro.

---

# 103. Resumo da estratégia

```text
PWA pode abrir offline
QR pode ser exibido offline
Recepção precisa estar online
Consumo precisa estar online
Saldo precisa estar online
Recarga precisa estar online
```

---

# 104. Decisão arquitetural

Para o MVP:

```text
ONLINE-FIRST
+
FAIL-SAFE
```

Em caso de dúvida:

```text
não liberar automaticamente
```

---

# 105. Evoluções futuras

Avaliar:

- link redundante;
- terminals registrados;
- modo kiosk;
- entitlement offline;
- contingência auditável;
- sincronização supervisionada.

---

# 106. Fonte de verdade

Este documento define a estratégia de conectividade e contingência do MVP.

Nenhuma implementação deve permitir consumo offline irrestrito sem revisão formal desta estratégia.

---

**Fim do documento.**
