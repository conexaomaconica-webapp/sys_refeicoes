# 9E.1 — Roteiro de backup e restauração

**Execução:** bloqueada até autorização específica e aprovação de custos  
**Alvo obrigatório:** projeto novo, isolado e sem tráfego operacional

## Preflight

- [ ] registrar autorização, responsáveis técnico/operacional e janela;
- [ ] confirmar plano, backup físico disponível e PITR, quando contratado;
- [ ] identificar backup/ponto de recuperação sem expor identificadores;
- [ ] confirmar RPO alvo de 15 minutos e RTO alvo de 4 horas;
- [ ] confirmar que o destino não recebe tráfego, callbacks ou webhooks reais;
- [ ] inventariar `pg_cron`, `pg_net`, wrappers e integrações que possam reativar;
- [ ] preparar cópia separada dos objetos do Storage;
- [ ] definir orçamento, retenção e autorização de encerramento do destino.

O restore físico para novo projeto replica banco, Auth, roles e permissões, mas
não copia objetos do Storage nem todas as configurações. Extensões com efeitos
externos podem voltar ativas; esse risco é critério de interrupção.

## Sequência futura

1. registrar `startedAt`, migration head e instante desejado de recuperação;
2. impedir integrações externas no destino antes de qualquer teste funcional;
3. restaurar para projeto novo, nunca sobre o único projeto operacional;
4. registrar `backupCapturedAt`, `restoreCompletedAt`, RPO e RTO observados;
5. reconciliar schemas, migrations, funções, owners, grants, policies e RLS;
6. verificar Auth sem enviar e-mails e sem reutilizar callbacks operacionais;
7. restaurar Storage por mecanismo independente e comparar manifests/checksums;
8. executar 31 cenários RLS, smoke de login, terminal e relatórios;
9. comprovar que nenhuma escrita alcançou o projeto de origem;
10. documentar divergências, decisão e limpeza futura do ambiente isolado.

## Critérios de interrupção

- destino igual ao projeto de origem;
- ausência de autorização financeira ou de backup utilizável;
- extensão capaz de chamar sistemas externos sem contenção confirmada;
- Storage sem cópia independente;
- pedido para registrar segredo ou dado pessoal em evidência;
- risco de ultrapassar a janela sem plano de retorno.

## Critérios de aprovação

| Critério | Limite |
| --- | --- |
| RPO medido | ≤ 15 minutos |
| RTO medido | ≤ 4 horas |
| migrations esperadas | 100% reconciliadas |
| RLS transacional | 31/31 |
| objetos Storage | 100% por manifesto/checksum |
| efeitos externos | zero |
| alterações na origem | zero |
| falhas críticas/altas | zero |

## Evidência

Usar `9e1-backup-restore.template.json`. Não registrar project ref, connection
string, tokens, e-mails, nomes de comensais ou conteúdo de arquivos.

