# Sprint 19A — Preparação da Operação Piloto Assistida

**Data da Elaboração:** 10/11/2026  
**Escopo:** Planejamento operacional, matriz de aceite, critérios de segurança/continuidade, indicadores e gates GO/NO-GO para futura execução do piloto assistido (**Sprint 19B**) em unidade universitária autorizada.  
**Status Sprint 19A:** **GO — Planejamento Local Preparado**  
**Status Execução Piloto (19B):** **NO-GO — Aguardando Resolução dos Gates Bloqueantes**  
**Status Produção:** **NO-GO — Nenhuma alteração aplicada ao Supabase remoto**

---

## 1. Pré-Requisitos Pendentes Antes da Sprint 19B (Bloqueadores Atuais)

Com base na auditoria acumulada até a Sprint 18, a operação piloto assistida **não pode ser iniciada** enquanto os bloqueadores abaixo permanecerem abertos:

| Gate | Situação Atual Verificada | Documento de Referência |
| :--- | :--- | :--- |
| **G1 — Backup & Restauração (`9E.1-C`)** | Backup lógico cifrado existe (`STAGE_9E1B`), porém cópia externa e ensaio de restauração **não executados**. | [STAGE_9E1B_LOGICAL_BACKUP.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1B_LOGICAL_BACKUP.md), [STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md) |
| **G2 — Gateway de Pagamentos em Sandbox** | Preflight local 14/14 aprovado; execução transacional `PAY-01..PAY-14` em **0/14** por ausência de credenciais sandbox. | [STAGE_9E2_PAYMENT_SANDBOX_EXECUTION.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E2_PAYMENT_SANDBOX_EXECUTION.md) |
| **G3 — Aplicação Controlada das Migrations 79–82** | Validadas em PostgreSQL 17.11 descartável ([Sprint 17.1](file:///c:/Sys_MArefeicoes/docs/SPRINT_17_1_TRANSACTIONAL_HOMOLOGATION.md), [Sprint 18](file:///c:/Sys_MArefeicoes/docs/SPRINT_18_PERFORMANCE_STRESS_HOMOLOGATION.md)), mas **não aplicadas remotamente**. | [SPRINT_17_1_TRANSACTIONAL_HOMOLOGATION.md](file:///c:/Sys_MArefeicoes/docs/SPRINT_17_1_TRANSACTIONAL_HOMOLOGATION.md) |
| **G4 — Homologação Remota Realtime & Storage** | Subscrição em `operational_dashboard_signals` (sem PII) e bucket `contingency-evidence` (isolado por `tenant_id`) ainda sem teste no projeto hospedado. | [SPRINT_17_SECURITY_FINANCIAL_AUDIT.md](file:///c:/Sys_MArefeicoes/docs/SPRINT_17_SECURITY_FINANCIAL_AUDIT.md) |
| **G5 — Aceite no Equipamento Físico (`PHY-01..PHY-16`)** | Checklist definido, execução bloqueada até agendamento presencial no restaurante piloto com fixtures sintéticas. | [STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md) |

---

## 2. Planejamento Operacional do Piloto Assistido

### 2.1 Definição de Escopo e Unidade Piloto
- **Tenant / Instituição / Unidade Alvo:** **A DEFINIR** (selecionar 1 unidade universitária única, com volume controlado e equipe presencial designada).
- **Regime dos Comensais no Piloto:** Somente perfis autorizados da janela piloto (fase inicial com usuários/fixtures de teste antes de qualquer liberação real).
- **Janela de Turnos:**
  - **Turno Almoço:** abertura de terminal/caixa **30 min** antes do início da regra de horário (`unit_meal_types.start_time`); conferência e fechamento em até **30 min** após `end_time`.
  - **Turno Jantar:** mesma disciplina de pré-abertura, operação assistida e fechamento auditável.
  - **Modo de Caixa:** verificar configuração da unidade (`per_meal` vs `daily` conforme `units.cash_shift_mode`) antes do início do turno.

### 2.2 Papéis Envolvidos e Matriz de Responsáveis

Referência canônica de permissões: [PERMISSIONS_v1_2.md](file:///c:/Sys_MArefeicoes/docs/PERMISSIONS_v1_2.md).

| Papel Técnico (`user_role`) | Atribuição no Piloto | Escopo de Rotas | Responsável Designado |
| :--- | :--- | :--- | :--- |
| `admin_general` | Governança técnica, gestão de chaves/rollback, contingência master e aprovação final de gates | `/admin/*` | **A DEFINIR** |
| `operations_director` | Coordenação operacional dos turnos, aprovação de lotes de contingência (dupla custódia) | `/admin/dashboard`, `/admin/contingencia`, `/admin/unidades` | **A DEFINIR** |
| `finance` | Auditoria patrimonial (`audit_wallet_custody_integrity`), conciliação (`/admin/conciliacao`) e relatórios (`/admin/relatorios`) | `/admin/financeiro`, `/admin/conciliacao`, `/admin/relatorios` | **A DEFINIR** |
| `unit_manager` / `supervisor` | Gestão presencial do restaurante piloto, abertura/conferência de caixa, lançamento de contingência (Tipo A/B), suporte local | `/admin/dashboard`, `/admin/caixa`, `/admin/contingencia`, `/admin/comensais` | **A DEFINIR** |
| `operator` | Operação de catraca/PDV no turno (abertura/fechamento do próprio caixa, leitura de matrícula/USB/QR, recebimento de visitantes) | `/terminal` | **A DEFINIR** |
| `institution_user` | Acompanhamento consolidado de sua instituição (somente leitura) | `/admin/relatorios`, `/admin/dashboard` | **A DEFINIR** |
| `student` (Grupo Piloto) | Acesso PWA, visualização de saldo/extrato, geração de QR Code dinâmico online | `/consumer` | **A DEFINIR** |
| **Suporte Técnico Remoto / Plantão** | Monitoramento de logs, erros HTTP/RPC, healthchecks (`/api/health/live`, `/api/health/ready`) e rollback | Logs Vercel/Supabase | **A DEFINIR** |

### 2.3 Checklist de Infraestrutura e Equipamentos do Posto
- [ ] **Estação Operacional:** Navegador atualizado (Chrome/Edge), resolução mínima compatível com `/terminal`, sincronismo NTP de relógio e fuso configurado (`units.timezone`, padrão `America/Sao_Paulo`).
- [ ] **Leitor USB (Código de Barras / RFID HID):** Configurado em modo teclado HID com sufixo `Enter`, testado contra caracteres perdidos (`PHY-02`).
- [ ] **Feedback Visual e Sonoro:** Monitor voltado para o operador com confirmação visual verde/vermelha visível e áudio habilitado quando aplicável.
- [ ] **Conectividade Redundante:** Rede principal (cabeada/Wi-Fi institucional sem bloqueio ao domínio Vercel/Supabase/WebSocket) + link de backup 4G/5G testado previamente.
- [ ] **Contingência Física de Papel:** Planilhas físicas numeradas de registro de contingência (Tipo A — lista assinada com matrícula/nome) + termo de contagem física (Tipo B) disponíveis no balcão para eventual queda total de rede.

### 2.4 Roteiro de Treinamento e Roteiro dos Turnos
1. **Pré-Piloto (D-2 a D-1):**
   - Sessão prática de 45 min com operadores (`/terminal`): abertura de caixa, bipagem por USB, digitação de matrícula, tratamento de bloqueio (`INSUFFICIENT_FUNDS`, `ALREADY_CONSUMED_TODAY`, `OUT_OF_SCHEDULE`), venda a visitante com troco, fechamento cego de caixa com justificativa obrigatória de diferença.
   - Sessão prática de 45 min com gerência/financeiro: monitoramento em `/admin/dashboard`, registro e dupla aprovação de contingência em `/admin/contingencia` (sem nunca cadastrar aluno fictício), conciliação em `/admin/conciliacao` e exportação sanitizada em `/admin/relatorios`.
   - Material rápido impresso (1 página) fixado junto ao posto com códigos de bloqueio e fluxo de queda de internet.
2. **Dia do Piloto — Pré-Turno (`T-30 min`):**
   - Verificar `/api/health/ready`, confirmar operador autenticado em conta individual (`NUNCA` compartilhar login), abrir caixa na refeição correta, testar leitura com usuário sintético de controle e zerar/conferir relatório de turno.
3. **Turno Ativo (`T0` a `T+180 min`):**
   - Acompanhamento contínuo do painel `/admin/dashboard` verificando indicador **Ao Vivo vs Modo Resiliente (Polling 30s)** e ausência de fila física excessiva.
   - Qualquer falha de rede segue estritamente a regra **fail-closed** (Seção 4).
4. **Pós-Turno (`T+30 min`):**
   - Fechamento de caixa no terminal, conferência de relatório F7 (`get_terminal_shift_reports`), batimento de custódia/conciliação diária (`run_financial_reconciliation_audit`), registro de incidentes e assinatura de aceite do turno.

---

## 3. Matriz de Fluxos de Aceite do Piloto (`PIL-01` a `PIL-14`)

Complementa integralmente os 16 testes físicos `PHY-01..PHY-16` de [STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E5_PHYSICAL_ACCEPTANCE_CHECKLIST.md):

| ID | Fluxo Funcional | Pré-Condição | Critério de Aceite Objetivo | Evidência Requerida |
| :--- | :--- | :--- | :--- | :--- |
| **PIL-01** | Identificação por matrícula digitada | Caixa aberto; aluno ativo com saldo | Debita exatamente `student_price`, exibe **Verde** somente após commit RPC | Screenshot sanitizado + ID consumo |
| **PIL-02** | Leitor USB (crachá/cartão físico) | Leitor HID configurado; cartão ativo | **100% (50/50)** leituras exatas sem perda de caractere ou duplo submit | Log contagem `PHY-02` |
| **PIL-03** | QR Code dinâmico (`/consumer`) | PWA logado; relógio sincronizado | QR aceito dentro da janela TTL; segunda leitura do mesmo token rejeitada (`TOKEN_ALREADY_USED`) | Screenshot `/consumer` + `/terminal` |
| **PIL-04** | Beneficiário Integral (`0%`) vs Parcial | Regras ativas na unidade | Integral libera com `student_price = 0.00` e `subsidy_amount = full_price`; Parcial debita carteira 1:1 | Registro turno F7 / relatório |
| **PIL-05** | Visitante com pagamento na entrada e troco | Categoria visitante ativa; caixa aberto | Registra venda no caixa (`cash_movements`), calcula troco corretamente e contabiliza no esperado de fechamento | Comprovante caixa |
| **PIL-06** | Duplicidade e concorrência na catraca | Aluno já consumiu no turno ou bip duplo | Bloqueia com `ALREADY_CONSUMED_TODAY` / `CONCURRENT_CONSUMPTION_CONFLICT`; 0 débito duplo | Registro em `blocked_attempts` |
| **PIL-07** | Saldo insuficiente | Aluno com saldo `< student_price` | Bloqueia com `INSUFFICIENT_FUNDS`; saldo permanece intacto (`>= 0`); sem liberação parcial | Ledger antes/depois |
| **PIL-08** | Troca de turno (Almoço → Jantar) | Unidade configurada em `per_meal` ou `daily` | Respeita `unit_meal_types` e janelas; impede consumo com caixa vencido (`STALE_CASH_SHIFT`) | Log troca de refeição |
| **PIL-09** | Fechamento de caixa e diferença | Vendas de visitantes + suprimento/sangria | Conferência cega calcula `difference_amount`; diferença != 0 exige justificativa obrigatória | Extrato `/admin/caixa` |
| **PIL-10** | Dashboard tempo real e resiliência WS | Operação ativa + simulação de queda WebSocket | Recebe sinais sem PII (`operational_dashboard_signals`); se WS cair, ativa **Modo Resiliente (polling 30s)** sem travar `/terminal` | Captura `/admin/dashboard` |
| **PIL-11** | Queda total de internet (**Fail-Closed**) | Desconexão do link do terminal | Terminal bloqueia autorizações online automáticas; **não grava débito/crédito offline**; operador aciona ata física | Foto do estado bloqueado |
| **PIL-12** | Regularização de contingência (Tipo A/B) | Ocorrência simulada pós-queda | Gerente lança lote em `/admin/contingencia` com evidência anexada; **outro** usuário (`operations_director`/`finance`) aprova (`SELF_APPROVAL_PROHIBITED` impede autoaprovação) | ID do lote + log aprovação |
| **PIL-13** | Relatórios gerenciais e XLSX/CSV | Consumos + contingência aprovada | `/admin/relatorios` fecha equação `Bruto = Subsídio + Aluno`, exclui custódia de receita, exporta `.xlsx` sem *Formula Injection* | Arquivo `.xlsx` sanitizado |
| **PIL-14** | Conciliação e integridade patrimonial | Recargas sandbox + consumos do dia | `/admin/conciliacao` detecta divergências corretamente; `audit_wallet_custody_integrity` retorna `custody_drift = 0` | JSON auditoria patrimonial |

---

## 4. Segurança, Privacidade e Plano de Continuidade / Reversão

### 4.1 Guardrails de Segurança no Piloto
- **Sessão e Escopo:** Proibido uso de conta `admin_general` como operador de balcão; cada operador usa credencial individual vinculada apenas à `unit_id` piloto (`has_unit_access`).
- **Segredos:** `SUPABASE_SERVICE_ROLE_KEY` estritamente restrita ao runtime server-side; proibida exposição no navegador ou compartilhamento em logs.
- **Privacidade em Tempo Real:** O canal Realtime propaga apenas eventos estruturais de `operational_dashboard_signals` (`unit_id`, `signal_type`, `emitted_at`), sem nomes, matrículas ou valores financeiros.
- **Storage Segregado:** Anexos de ata/evidência em `contingency-evidence` armazenados sob prefixo `<tenant_id>/...` protegido por RLS no `storage.objects`.
- **Imutabilidade Contábil:** `wallet_transactions` protegida contra `UPDATE`, `DELETE` e `TRUNCATE` (incluindo `CASCADE`); qualquer estorno gera novo lançamento compensatório ou cancelamento auditável.

### 4.2 Continuidade Operacional em Falhas (Online-First / Fail-Closed)
Conforme [OFFLINE_STRATEGY.md](file:///c:/Sys_MArefeicoes/docs/OFFLINE_STRATEGY.md) e Migration 72 (`reconcile_offline_consumptions` revogada para clientes):
1. **Degradação parcial ou queda do WebSocket:** `/terminal` continua operando normalmente via RPC transacional síncrona; `/admin/dashboard` alterna automaticamente para polling a cada 30s.
2. **Timeout indeterminado em consumo:** Trava local (`TimeoutLock`) impede nova tentativa imediata duplicada na mesma matrícula/refeição até reconciliação da chave `idempotency_key`.
3. **Perda total de conectividade (> 2 minutos com fila física):**
   - Operador alterna para registro manual em **formulário de contingência físico (Tipo A ou Tipo B)** mediante autorização do supervisor/gerente do turno.
   - Ao restabelecer rede, a regularização entra exclusivamente por `/admin/contingencia` (`submit_contingency_batch` → `review_contingency_batch` em dupla custódia).
   - **É estritamente proibido cadastrar comensais fictícios** para compensar falta de rede.

### 4.3 Plano de Reversão Operacional e de Banco
1. **Reversão Operacional Imediata (Sem perda de dados):** Suspensão da fila digital via decisão do coordenador do piloto, mantendo registro auditável de atendimento em planilha física de contingência para posterior apuração contábil.
2. **Reversão de Aplicação (Vercel):** Promover imediatamente a release estável anterior conforme [STAGE_9E4_HOSTED_ROLLBACK_RUNBOOK.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E4_HOSTED_ROLLBACK_RUNBOOK.md).
3. **Reversão de Migrations (`82 -> 81 -> 80 -> 79`):** Executar apenas se não houver dados financeiros gravados após a aplicação, seguindo o script validado [sprint17_1_rollback_79_80_81.sql](file:///c:/Sys_MArefeicoes/scripts/sql/sprint17_1_rollback_79_80_81.sql) (precedido por `DROP INDEX IF EXISTS` dos 4 índices da Migration 82). Se já houver transações válidas gravadas no piloto, **não executar rollback destrutivo** — acionar plano de remediação *forward-only* sobre backup prévio (`9E.1-B`).

---

## 5. Indicadores do Piloto (KPIs e Instrumentação)

Na Sprint 19B, todos os indicadores abaixo deverão ser medidos separando **RPC PostgreSQL** de **latência ponta-a-ponta**:

| Categoria | Indicador | Meta Preliminar de Aceite (Sujeita a Calibração em Campo) | Fonte de Coleta |
| :--- | :--- | :--- | :--- |
| **Latência Ponta-a-Ponta** | Tempo total do bip/Enter na UI até resposta visual confirmada (`p50`, `p95`, `p99`) | `p95 <= 400 ms` online (sem digitação humana) — preliminar | Instrumentação cliente/observabilidade |
| **Latência Backend / RPC** | Duração da execução server-side `consume_operator_terminal_meal` (`p50`, `p95`, `p99`) | `p95 <= 250 ms` — preliminar | Logs PostgreSQL / APM |
| **Confiabilidade** | Taxa de erros HTTP `5xx` ou falhas inesperadas de RPC | `0` falhas críticas / `< 0,5%` transientes | Logs Next.js / Vercel / Supabase |
| **Integridade de Consumo** | Duplicidades financeiras ou liberações sem commit | `0` ocorrências | `meal_consumptions` + `blocked_attempts` |
| **Fluxo de Fila** | Tempo médio de atendimento por comensal na catraca e pico de fila | `< 8 s/comensal` no posto assistido — preliminar | Cronometragem presencial no turno |
| **Conciliação e Custódia** | Divergências não justificadas + `custody_drift` pós-turno | `custody_drift = 0`; `100%` fechamento auditado | `audit_wallet_custody_integrity` + `/admin/conciliacao` |
| **Disponibilidade** | Disponibilidade útil durante a janela Almoço + Jantar | `>= 99,5%` (ou contingência formal acionada em < 2 min) | Monitor `/api/health/ready` |

> **Calibração Pré-Piloto:** Os tetos de `400 ms` (ponta-a-ponta), `250 ms` (RPC) e `8 s/comensal` têm caráter **estritamente preliminar** e deverão ser confrontados e recalibrados contra as medições reais obtidas no equipamento físico e na rede da unidade universitária (`PHY-01..PHY-16`), antes de se tornarem critérios definitivos de operação.

---

## 6. Matriz de Riscos do Piloto

| Risco | Probabilidade | Impacto | Mitigação Prévia Obrigatória |
| :--- | :---: | :---: | :--- |
| Queda de internet no refeitório em horário de pico | Média | Alto | Redundância 4G/5G + protocolo fail-closed + formulários Tipo A/B prontos no balcão (`4.2`) |
| Leitor USB enviando caracteres incompletos ou sem `Enter` | Média | Médio | Homologação prévia `PHY-02` (`50/50` leituras perfeitas) com leitor exato da unidade |
| Erro de configuração de horário/categoria liberando/bloqueando errado | Baixa | Alto | Conferência de `unit_meal_types` e `meal_rules` em `T-30 min` com matrícula de teste controlada |
| Picos na cauda `p99` por contenção/WAL no plano Supabase | Média | Médio | Pooling ativo, índices da Migration 82 aplicados e janela de observação antes de escala completa |
| Autoaprovação ou fraude em contingência/caixa | Baixa | Crítico | Enforcement em banco (`trg_prevent_contingency_tampering`, dupla custódia, `cash_shifts`) |

---

## 7. Checklist Formal GO / NO-GO para Autorizar a Sprint 19B

**Regra de Decisão:** A Sprint **19B (Execução do Piloto)** permanece **NO-GO** caso **qualquer** item crítico abaixo esteja desmarcado:

### Bloco A — Pré-Condições Técnicas Obrigatórias (Hard Gates)
- [ ] **A1 (Backup & Restore):** Backup pré-piloto gerado, cópia externa confirmada e ensaio de restauração `9E.1-C` aprovado com evidência.
- [ ] **A2 (Pagamentos Sandbox):** `14/14` cenários `PAY-01..PAY-14` homologados em sandbox oficial (`STAGE_9E2`).
- [ ] **A3 (Banco Remoto):** Migrations `79`, `80`, `81` e `82` aplicadas em ambiente autorizado com verificação de triggers, RLS e índices ativos.
- [ ] **A4 (Realtime & Storage):** Canal `operational_dashboard_signals` e bucket `contingency-evidence` validados no projeto remoto com teste negativo cross-tenant.
- [ ] **A5 (Estabilidade do Build):** `tsc`, `lint`, `build` e regressões das Sprints 14–18 aprovados sobre a versão exata candidata ao piloto.

### Bloco B — Preparação Presencial e Operacional
- [ ] **B1 (Aceite Físico):** Checklist `PHY-01..PHY-16` executado com **16/16** aprovações no hardware e rede reais da unidade piloto (dados sintéticos apenas).
- [ ] **B2 (Responsáveis e Escala):** Todos os campos **A DEFINIR** da Seção `2.2` preenchidos com responsáveis nominais e escala de suporte confirmada.
- [ ] **B3 (Treinamento):** Operadores, gerência local e financeiro treinados nos fluxos de catraca, caixa, contingência e conciliação.
- [ ] **B4 (Regras da Unidade):** Preços (`meal_rules`), horários (`unit_meal_types`), modo de caixa (`cash_shift_mode`) e categorias conferidos e assinados.

### Bloco C — Integridade Financeira Inicial e Encerramento
- [ ] **C1 (Auditoria Zero):** `audit_wallet_custody_integrity` executada antes do primeiro turno retornando `is_patrimony_balanced = true` e `custody_drift = 0`.
- [ ] **C2 (Autorização Explícita):** Autorização formal do gestor do projeto registrando escopo sanitizado, data de início/fim do piloto e assinatura de **GO — Sprint 19B** (mantendo produção geral isolada).

---

### Parecer da Sprint 19A
- **Sprint 19A (Preparação do Piloto):** **GO — Procedimento, matriz de aceite, indicadores, contingência e gates documentados.**
- **Sprint 19B (Execução do Piloto):** **NO-GO até cumprimento integral dos Blocos A, B e C.**
- **Produção:** **NO-GO.**

