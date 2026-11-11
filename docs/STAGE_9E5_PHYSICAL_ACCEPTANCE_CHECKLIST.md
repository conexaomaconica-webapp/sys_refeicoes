# 9E.5 — Checklist de aceite no equipamento físico

**Execução:** bloqueada até autorização e agendamento na unidade  
**Operação:** somente fixture autorizada; sem cobrança real

## Identificação do posto

- [ ] unidade, posto e terminal registrados por alias sanitizado;
- [ ] operador de teste e responsável presencial identificados;
- [ ] navegador/OS, scanner, teclado, monitor e impressora inventariados;
- [ ] rede principal e contingência 4G/5G identificadas;
- [ ] relógio/fuso horário sincronizados;
- [ ] câmera, USB e permissões do navegador restritos ao necessário.

## Casos de aceite

| ID | Cenário | Critério |
| --- | --- | --- |
| PHY-01 | login e troca de operador | sessão correta; sem senha persistida |
| PHY-02 | scanner USB | 50/50 leituras sem caractere perdido |
| PHY-03 | teclado/matrícula | 20/20 submissões corretas |
| PHY-04 | refeição aprovada | verde/som somente após commit |
| PHY-05 | bloqueio | vermelho, motivo claro e registro no F7 |
| PHY-06 | duplicidade | segunda tentativa bloqueada |
| PHY-07 | saldo insuficiente | nenhum débito parcial/liberação |
| PHY-08 | abertura/fechamento | caixa e diferença auditáveis |
| PHY-09 | visitante/troco | valor, meio e troco corretos |
| PHY-10 | troca automática de refeição | horário respeitado sem fechar caixa diário |
| PHY-11 | queda de internet | fail-closed; nenhuma fila ou cobrança offline |
| PHY-12 | reconexão | novas leituras retomadas sem duplicar a anterior |
| PHY-13 | F7/relatórios | aprovados e bloqueados consistentes |
| PHY-14 | impressão | legível, sem dado excessivo |
| PHY-15 | PWA consumidor | instalação, login e QR online |
| PHY-16 | ergonomia/acessibilidade | teclado, contraste e mensagens legíveis |

## Desempenho

Executar no mínimo 100 validações sintéticas representativas e registrar p50,
p95, p99 e erros. Meta operacional inicial: p95 ≤ 400 ms para a decisão online,
sem contar digitação humana. Qualquer verde antes do commit é falha crítica.

## Continuidade

Na perda de conexão o sistema deve bloquear automaticamente. A contingência
manual é procedimento externo e não equivale a consumo confirmado. Reconexão
não pode sincronizar refeições locais nem duplicar um commit cuja resposta se
perdeu.

## Aprovação

GO exige 16/16 casos, meta de latência cumprida, zero falha crítica/alta, zero
transação real e assinatura do responsável operacional. Usar
`9e5-physical-acceptance.template.json`.

