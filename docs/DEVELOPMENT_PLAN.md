# DEVELOPMENT_PLAN.md
## Plano de Desenvolvimento por Fases e Sprints
**Projeto:** Sistema de Controle de Refeições — MA Refeições  
**Versão:** 2.0 (Revisão Pós-Sprint 7 e Alinhamento Operacional)  
**Stack:** Antigravity + Next.js 15 + TypeScript + Supabase (PostgreSQL / RLS) + PWA  

---

# 1. Objetivo e Princípios Operacionais

Este documento define a ordem prática, técnica e incremental de desenvolvimento do **Sistema MA Refeições**.

### Princípios Inegociáveis:
1. **Foco na Redução de Filas:** Toda a arquitetura de recepção prioriza atendimento ágil (latência alvo < 400ms por validação). A **matrícula** é o identificador primário, rápido e universal. QR Code, biometria e carteirinha PWA atuam como complementos.
2. **Implementação Incremental e Estável:** Não iniciar módulos futuros sem estabilizar as fases anteriores.
3. **Isolamento de Sprints:** Cada sprint possui objetivo claro, migrations próprias sequenciais, suíte de testes automatizados e critérios de aceite bem definidos.
4. **Desacoplamento de Gateways:** A operação central do restaurante (consumo, filas, controle de bolsistas e contingência) não pode ficar paralisada por trâmites contratuais ou técnicos de gateways bancários (Asaas, Mercado Pago ou SiTef/Fiserv).
5. **Integridade Contábil e Auditoria:** Proibição de saldo negativo, histórico imutável em livro-razão (ledger), barreira de idempotência em webhooks e proibição absoluta de criar comensais fictícios para regularizações.

---

# 2. Documentos de Referência Obrigatórios

Todas as sprints devem respeitar rigorosamente a documentação arquitetural e de segurança em `/docs`:

```text
SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md  -> Visão funcional e fluxos gerais
PERMISSIONS_v1_2.md                   -> Matriz de papéis (RBAC) e escopos de acesso
ARCHITECTURE.md                       -> Arquitetura Next.js, serviços e componentes
DATABASE.md                           -> Modelagem de tabelas, enums, triggers e constraints
SECURITY.md                           -> Hardening, RLS, gestão de chaves e RPCs definer
PAYMENTS.md                           -> Regras financeiras e integração de gateways
OFFLINE_STRATEGY.md                   -> Estratégia de contingência e operação desconectada
```

---

# 3. Estado Atual do Projeto (Auditoria Pós-Sprint 7)

```text
================================================================================
FASE 0 a SPRINT 7: CONCLUÍDAS TECNICAMENTE NO REPOSITÓRIO LOCAL
================================================================================
• Migrations: 25 arquivos SQL sequenciais (000001 a 000025)
• Testes Automatizados: 132/132 aprovados (100% de sucesso)
  - Sprint 5: 16/16 aprovados (validate-sprint5.cjs)
  - Sprint 6: 39/39 aprovados (validate-sprint6.cjs)
  - Sprint 7: 55/55 aprovados (validate-sprint7.cjs)
  - Homologação Financeira Controlada: 22/22 aprovados (homologate-sprint7-financial.cjs)
• Compilação TypeScript: 0 erros (tsc --noEmit)
• Qualidade de Código: 0 erros (eslint src)
• Build de Produção: Next.js 15 aprovado (next build)
• Repositório Git: Histórico limpo e commits isolados por sprint

IMPORTANTE — PENDÊNCIAS DE HOMOLOGAÇÃO OPERACIONAL REMOTA:
1. Aplicação física das DDLs em instância PostgreSQL remota de staging/homologação.
2. Disparo e recepção de webhooks reais com credenciais de Sandbox (Asaas e Mercado Pago).
3. Homologação presencial de TEF (SiTef/Fiserv) reservada para etapa própria com equipamento físico.
================================================================================
```

---

# 4. Sequência Estratégica das Sprints (Versão 2.0)

```text
FASE 0  ──▶ Preparação e Infraestrutura Técnica               [CONCLUÍDO]
SPRINT 1 ──▶ Fundação SaaS, Multi-tenant e Branding            [CONCLUÍDO]
SPRINT 2 ──▶ Auth, Perfis, Permissões e RLS                    [CONCLUÍDO]
SPRINT 3 ──▶ Cadastro de Alunos, Categorias e Fotos            [CONCLUÍDO]
SPRINT 4 ──▶ Importação por Planilha (Base de Lote)            [CONCLUÍDO]
SPRINT 5 ──▶ Tipos de Refeição, Unidades e Preços              [CONCLUÍDO]
SPRINT 6 ──▶ Carteira Financeira e Livro-Razão Imutável        [CONCLUÍDO]
SPRINT 7 ──▶ Recargas Automáticas e Multi-Gateway (Mock)       [CONCLUÍDO]
──────────────────────────────────────────────────────────────────────────
SPRINT 8  ──▶ Carteirinha Digital e Identificação Rápida
SPRINT 9  ──▶ Motor de Consumo Atômico (consume_meal)          [CRÍTICA - P0]
SPRINT 10 ──▶ Terminal de Recepção e Contingência Offline      [CRÍTICA - P0]
SPRINT 11 ──▶ Importação Parcial Tolerante e Relatório de Erros [ALTA]
SPRINT 12 ──▶ PWA do Consumidor (Aluno Parcial e Integral)     [IMPLEMENTADA LOCALMENTE]
SPRINT 13 ──▶ Regularização Retroativa Auditável               [ALTA]
SPRINT 14 ──▶ Dashboards Operacionais e Monitoramento de Picos
SPRINT 15 ──▶ Relatórios Fiscais, Subsídios e Faturamento      [ALTA]
SPRINT 16 ──▶ Integração de Gateway Real e Conciliação         [DESACOPLÁVEL]
SPRINT 17 ──▶ Auditoria Contábil, Segurança e Hardening        [CRÍTICA - P0]
SPRINT 18 ──▶ Performance, Carga e Estresse (3.000+ ref/dia)   [CRÍTICA - P0]
SPRINT 19 ──▶ Operação Piloto em Unidade Real                  [CRÍTICA - P0]
SPRINT 20 ──▶ Ajustes, Correções e Refinamentos Pós-Piloto
```

---

# 5. Detalhamento das Sprints Concluídas (1 a 7)

### SPRINT 1 — Fundação SaaS, Branding e Unidades
- **Objetivo:** Multi-tenant e identidade visual personalizável.
- **Banco:** `tenants`, `tenant_branding`, `institutions`, `units` (Migrations `000001` a `000004`).
- **Entregas:** Layout base, carregamento de marca/logo, splash dinâmico.

### SPRINT 2 — Auth, Perfis e Permissões
- **Objetivo:** Autenticação e matriz RBAC com RLS restritivo.
- **Banco:** `profiles`, `user_unit_access`, `user_institution_access` (Migrations `000005` a `000009`).
- **Perfis:** `admin_general`, `operations_director`, `finance`, `supervisor`, `unit_manager`, `operator`, `institution_user`, `student`.

### SPRINT 3 — Cadastro de Alunos e Fotos
- **Objetivo:** Registro acadêmico, categorias de bolsa e biometria fotográfica opcional.
- **Banco:** `student_categories`, `students`, bucket `student-photos` (Migrations `000010` a `000015`).
- **Regras:** Unicidade de `(institution_id, registration_number)` e chaves compostas com `tenant_id`.

### SPRINT 4 — Importação de Alunos por Planilha (Base de Lote)
- **Objetivo:** Carga em massa de alunos via Excel (.xlsx) e CSV.
- **Banco:** `imports`, `import_rows`, bucket `import_files` (Migrations `000016` a `000018`).
- **Entregas:** Parser, validador de cabeçalhos, staging auditável e snapshot de bolsistas integrais.

### SPRINT 5 — Tipos de Refeição e Preços
- **Objetivo:** Preços diferenciados por unidade, refeição e categoria, com vigência temporal.
- **Banco:** `meal_types`, `unit_meal_types`, `meal_rules` (Migrations `000019` a `000021`).
- **Regras:** Constraint de exclusão GiST contra sobreposição de datas e bloqueio de preços futuros. Bolsista Integral = R$ 0,00.

### SPRINT 6 — Carteira Financeira e Livro-Razão Imutável
- **Objetivo:** Controle de saldo para alunos parciais com contabilidade estrita.
- **Banco:** `wallets`, `wallet_transactions` (Migrations `000022` a `000023`).
- **Regras:** Saldo nunca negativo (`balance >= 0`), integral sem carteira, RPCs atômicas com lock pessimista (`FOR UPDATE`) para ajuste e estorno compensatório imutável.

### SPRINT 7 — Recargas Automáticas e Multi-Gateway (Mock)
- **Objetivo:** Infraestrutura de pagamentos online (Pix e Cartão) desacoplada via Adapter Pattern.
- **Banco:** `payment_providers`, `payments`, `recharges`, `payment_webhook_events` (Migrations `000024` a `000025`).
- **Entregas:** Provedores Asaas, Mercado Pago e Mock Sandbox; barreira de idempotência `UNIQUE (provider_code, event_id)`; validação HMAC-SHA256; bloqueio defensivo para o código `'sitef'`.

---

# 6. Detalhamento das Sprints Futuras (8 a 20)

---

## SPRINT 8 — Carteirinha Digital e Identificação Rápida

### Objetivo
Construir os mecanismos de identificação dos alunos para entrada no restaurante, com foco prioritário em leitura rápida de **matrícula**, e carteirinha digital PWA como complemento.

### Diretriz Operacional MA Refeições
> A matrícula digitada no teclado numérico ou lida por scanner USB de código de barras é o meio principal e mais ágil para escoamento de fila. O QR Code é dinâmico e alternativo, nunca impeditivo.

### Banco de Dados
Criar:
```text
cards (id, tenant_id, student_id, card_number, status, issued_at)
qr_tokens (id, tenant_id, student_id, token_hash, expires_at, revoked_at)
```

### Funcionalidades
- **Mecanismos de Identificação Aceitos:**
  1. Digitação rápida de matrícula (com buffer de teclado / leitor USB).
  2. Bipagem de código de barras 1D de carteirinha física.
  3. Leitura de QR Code dinâmico gerado no PWA do aluno.
- **Geração de QR Code:**
  - Token assinado de curta duração com rotação automática, evitando capturas de tela e clonagens.
- **Visualização de Carteirinha:**
  - Componente com foto (se houver), nome social/completo, matrícula, curso e categoria (destaque visual claro para Bolsista Integral vs Parcial).

### Critérios de Aceite
- [ ] Leitor USB de código de barras preenche a matrícula e dispara consulta imediatamente.
- [ ] QR Code expira automaticamente e não aceita replay.
- [ ] Aluno sem foto identificável consome normalmente pela conferência da matrícula.
- [ ] Testes unitários e typecheck 100% aprovados.

---

## SPRINT 9 — Motor de Consumo Atômico (`consume_meal()`) [CRÍTICA — P0]

### Objetivo
Desenvolver a função central de negócio que valida a elegibilidade, debita o saldo (quando aplicável) e autoriza a refeição de forma atômica e com alta concorrência.

### Banco de Dados
Criar:
```text
meal_consumptions (
    id, tenant_id, unit_id, meal_type_id, student_id, category_id,
    consumption_date, consumed_at, full_price, student_price, subsidy_amount,
    wallet_transaction_id, operator_id, terminal_id, verification_method
)
blocked_attempts (
    id, tenant_id, unit_id, meal_type_id, student_id, registration_attempted,
    attempted_at, reason, terminal_id
)
```

### RPC `consume_meal()` — Validações Obrigatórias
1. **Tenant e Unidade:** Validação do escopo do terminal.
2. **Aluno Ativo:** Matrícula cadastrada e com status acadêmico ativo.
3. **Janela de Horário:** Refeição ativa na unidade no horário corrente (com tolerância de abertura parametrizável).
4. **Categoria e Preço:** Obtenção da regra de preço vigente na data/hora (`meal_rules`).
5. **Trava de Duplicidade (Garantia de 1 Refeição):**
   - **Bolsista Integral:** Rigorosamente **1 refeição por tipo por dia** (Ex: 1 almoço e 1 jantar). Segunda passagem no mesmo tipo rejeitada com código `ALREADY_CONSUMED_TODAY`.
   - **Aluno Parcial:** Se a regra da unidade permitir repetição de prato mediante pagamento, autorizar débito; caso contrário, aplicar a mesma trava de unicidade diária.
6. **Contabilidade e Saldo:**
   - **Bolsista Integral:** Preço do aluno R$ 0,00. Registra consumo com subsídio total sem debitar carteira.
   - **Aluno Parcial:** Exige saldo $\ge$ `student_price`. Aplica lock pessimista `FOR UPDATE` na carteira, deduz o saldo e gera lançamento `meal_debit` no livro-razão imutável.
7. **Atomicidade e Concorrência:**
   - Teste de colisão com 2 terminais tentando liberar a mesma matrícula no mesmo segundo: exatamente 1 é liberado e o outro recebe bloqueio imediato.

### Critérios de Aceite
- [ ] Nenhum consumo liberado sem registro correspondente em `meal_consumptions`.
- [ ] Nenhum saldo negativo gerado para alunos parciais.
- [ ] Bolsista integral bloqueado na 2ª tentativa de refeição no mesmo turno.
- [ ] Latência da execução da RPC no banco < 100ms.
- [ ] Testes de concorrência com simulação de 50 requisições simultâneas aprovados.

---

## SPRINT 10 — Terminal de Recepção e Contingência Offline [CRÍTICA — P0]

### Objetivo
Construir a interface do operador nos pontos de atendimento e desenhar a arquitetura de contingência para operação sob perda de internet.

### Interface do Operador (Tela de Atendimento Contínuo)
- **Foco:** Operação sem mouse, uso exclusivo de scanner ou teclado numérico.
- **Sinalização Visual Instantânea:**
  - 🟢 **LIBERADO (Verde):** Nome do aluno, categoria, foto (se houver), saldo remanescente (parcial). Sinal sonoro suave de confirmação.
  - 🔴 **NÃO LIBERADO (Vermelho):** Motivo explícito em destaque (ex: "JÁ ALMOÇOU HOJE", "SALDO INSUFICIENTE: R$ 2,50", "MATRÍCULA INATIVA"). Sinal sonoro de bloqueio.
  - 🟡 **CONTINGÊNCIA ATIVA (Amarelo):** Aviso de desconexão.
- **Auto-Reset:** Tela reseta automaticamente em 1,5 segundos para receber a próxima matrícula.

### Arquitetura de Contingência e Desconexão de Rede
> [!WARNING]
> **Realidade Técnica de Múltiplos Dispositivos Desconectados:**
> Em um ambiente sem internet com 2 ou mais catracas/terminais isolados, **não existe unicidade global instantânea** sem um canal local de sincronismo. Presumir que o offline impede duplicidade entre dois computadores desconectados seria uma falácia arquitetural.

#### Mecanismos de Mitigação Implementados:
1. **Cache Local Criptografado (IndexedDB / SQLite local):**
   - Carga prévia das matrículas ativas da unidade e saldo no início do turno, assinado com chave de sessão do operador.
2. **Buffer de Contingência Assinado:**
   - Cada consumo registrado offline gera um pacote assinado com chave do terminal: `{ terminal_id, sequence_num, student_id, meal_type_id, timestamp, offline_hash }`.
3. **Particionamento Operacional por Posto:**
   - Em caso de queda prolongada, cada terminal opera em sua faixa de atendimento recomendada.
4. **Limite Parametrizável de Contingência:**
   - Cada terminal possui um teto de tolerância diária em modo offline (ex: no máximo 100 refeições offline por operador sem validação central), evitando fraudes em massa.
5. **Reconciliação e Trilha de Divergências:**
   - Ao retomar a conexão, os eventos offline são transmitidos em lote ordenado.
   - Casos em que o aluno passou em 2 terminais desconectados são registrados com flag `offline_contingency_conflict`, gerando lançamento de auditoria para regularização sem quebrar o banco.

### Critérios de Aceite
- [ ] Atendimento de ponta a ponta com scanner USB operando em menos de 400ms em modo online.
- [ ] Operação contínua quando a rede é desconectada, gravando eventos no buffer local.
- [ ] Sincronização automática idempotente ao reconectar a rede.
- [ ] Relatório de divergências offline emitido na conciliação pós-turno.

---

## SPRINT 11 — Importação Parcial Tolerante e Relatório de Erros [ALTA]

### Objetivo
Aprimorar o módulo da Sprint 4 para permitir a importação tolerante a falhas parciais em planilhas acadêmicas com inconsistências.

### Funcionalidades
> **Escopo operacional:** apesar do nome legado da tabela `students`, a importação atende comensais identificados — alunos, servidores, funcionários e outros públicos definidos por categoria. Cada lote deve informar instituição e unidade de origem. O cadastro permanece institucional e `imports.unit_id` preserva a rastreabilidade operacional da listagem.

1. **Pré-visualização Inteligente de Lote:**
   - Painel mostrando: Total de Linhas, Válidas para Inclusão, Válidas para Atualização, e Linhas Inválidas/Com Erro.
2. **Importação Parcial Segura:**
   - Opção para o administrador: **"Importar 950 alunos válidos e isolar 50 inconsistentes"**.
   - As linhas válidas são efetivadas imediatamente para não prejudicar os alunos regulares.
3. **Exportação de Manifesto de Inconsistências:**
   - Geração de arquivo Excel (.xlsx) contendo apenas as linhas rejeitadas, com as colunas originais acrescidas de:
     - `motivo_rejeicao` (ex: "Matrícula duplicada", "CPF com dígito inválido", "Categoria inexistente").
     - `linha_original` (número da linha no arquivo de origem).
4. **Reconciliação de Atualizações de Bolsa Integral:**
   - Se um aluno era Parcial e a nova lista oficial da universidade o classifica como Integral, o sistema preserva o saldo residual de sua carteira e aplica a isenção a partir da vigência da lista.

### Critérios de Aceite
- [ ] Planilha com 1.000 linhas e 20 erros importa 980 alunos com sucesso.
- [ ] Download do arquivo de rejeições com mensagens claras de diagnóstico.
- [ ] Nenhuma duplicação de aluno ou perda de histórico acadêmico.

---

## SPRINT 12 — PWA do Consumidor (Aluno Parcial e Integral)

### Objetivo
Interface web responsiva e instalável (PWA) para autoatendimento do comensal.

### Visão Adaptativa por Categoria
- **Menu do Bolsista Integral:**
  - `Início` | `Minha Carteirinha (QR)` | `Histórico de Refeições` | `Meus Dados`
  - *(Menus de Saldo, Recarga e Extrato Financeiro são totalmente ocultos e inacessíveis no frontend e nas APIs).*
- **Menu do Aluno Parcial:**
  - `Início` | `Saldo Disponível` | `Recarga Rápida (Pix/Cartão)` | `Extrato do Livro-Razão` | `Minha Carteirinha` | `Histórico de Refeições`

### Notificações Operacionais
- Notificação push / PWA de confirmação imediata de recarga.
- Notificação de aviso de saldo baixo (configurável pelo aluno).
- Registro do consumo realizado no terminal em tempo real.

### Critérios de Aceite
- [x] PWA instalável no Android e iOS.
- [x] Bolsista integral não visualiza nenhuma interface financeira.
- [x] Extrato financeiro do aluno parcial reflete exatamente as transações do livro-razão (`wallet_transactions`).

> Implementação local concluída em 22/10/2026. A publicação depende da aplicação
> das migrations `20261022000062` e `20261022000063` no ambiente de destino e da
> homologação com contas reais de consumidores integrais e parciais.

---

## SPRINT 13 — Regularização Retroativa Auditável [ALTA]

### Objetivo
Permitir o registro e a apuração contábil de refeições servidas em situações excepcionais (pane geral, falta de energia ou problemas operacionais), com auditoria rígida e sem criar registros fictícios.

### Tipologias Distintas de Regularização
O módulo separa obrigatoriamente três cenários:
1. **Tipo A — Consumo Individual Identificado:**
   - Alunos conhecidos que consumiram durante a contingência e anotaram matrícula em lista física de papel.
   - Lançamento retroativo com indicação da matrícula real e verificação de que o aluno ainda não possui registro no turno.
2. **Tipo B — Lote de Contingência sem Matrícula (Contagem Física):**
   - Refeições comprovadamente servidas sem identificação individualizada do aluno (ex: catraca travada durante apagão, contagem de pratos servidos pela cozinha).
   - **Regra de Ouro:** Jamais atribuir a matrículas aleatórias.
   - Criar tabela `contingency_meal_batches`:
     ```text
     contingency_meal_batches (
         id, tenant_id, unit_id, meal_type_id, service_date,
         total_meals_served, category_estimated, justification,
         evidence_document_url, operator_id, status, approved_by, approved_at
     )
     ```
   - O lote compõe a fatura institucional como "Refeições Fornecidas em Regime de Contingência", mediante aprovação gerencial.
3. **Tipo C — Ajuste Administrativo e Correção de Erro:**
   - Estorno de cobrança duplicada ou correção contábil justificada, gerando lançamento compensatório assinado no ledger.

### Trilha de Aprovação e Evidências
- Upload obrigatório de documento comprobatório (foto da ata de ocorrência, foto da lista assinada ou laudo técnico da unidade).
- Fluxo de dupla aprovação: Gerente da Unidade lança $\rightarrow$ Diretor de Operações / Financeiro aprova.

### Critérios de Aceite
- [ ] Proibição no código de qualquer sorteio ou vínculo fictício de consumo a alunos reais.
- [ ] Duplo nível de permissão obrigatório para aprovação de lotes retroativos.
- [ ] Lotes aprovados entram no demonstrativo de faturamento com discriminação clara de contingência.

---

## SPRINT 14 — Dashboards Operacionais e Monitoramento de Picos

### Objetivo
Fornecer visibilidade em tempo real para gerentes de unidade e diretoria de operações.

### Indicadores em Tempo Real
- **Velocidade de Linha:** Refeições validadas por minuto por terminal.
- **Painel de Picos:** Gráfico de distribuição horária (ex: 11h30 às 13h30 em blocos de 15 minutos) para dimensionamento de equipe e buffet.
- **Taxa de Bloqueios:** Percentual de tentativas rejeitadas e motivos (saldo insuficiente, dupla passagem).
- **Consumo por Categoria:** Proporção em tempo real entre Integrais e Parciais.

### Critérios de Aceite
- [ ] Atualização em tempo real via canais seguros Supabase Realtime.
- [ ] Filtro por tenant, instituição, unidade e tipo de refeição.
- [ ] Alertas visuais quando um terminal ultrapassar 2 minutos sem registros em horário de pico.

---

## SPRINT 15 — Relatórios Fiscais, Subsídios e Faturamento Consolidado [ALTA]

### Objetivo
Gerar os relatórios analíticos e sintéticos para prestação de contas, faturamento contra as instituições contratantes e conformidade fiscal.

### Segregação Contábil Mandatória
Os relatórios e demonstrativos devem distinguir com precisão:
1. **Faturamento Bruto de Refeições:** Soma do valor facial de todas as refeições servidas (`full_price`).
2. **Subsídios Devidos pela Instituição:** Valor faturado contra a universidade/empresa (`subsidy_amount` de parciais + valor integral de bolsistas + lotes de contingência aprovados).
3. **Recargas Recebidas:** Montante total depositado pelos alunos parciais (contabilizado como **Passivo de Custódia**, e não receita tributável imediata).
4. **Receita Líquida Operacional:** Refeições efetivamente consumidas e quitadas pelo saldo do aluno.
5. **Taxas Operacionais:** Tarifas retidas por gateways de pagamento (Pix/Cartão/TEF).
6. **Quebras e Perdas Definitivas:** Refeições servidas sem recebimento comprovado ou inconsistências não regularizadas.
7. **Saldo em Custódia (Passivo Circulante):** Saldo total atualmente retido nas carteiras dos alunos que ainda não foi consumido.

### Formatos de Exportação
- Exportação em PDF corporativo (com marca, unidade, período, paginação e termo de encerramento).
- Exportação em Excel (.xlsx) e CSV com memória de cálculo aberta para auditoria fiscal da instituição contratante.

### Critérios de Aceite
- [ ] Fechamento contábil bate exatamente com a soma dos lançamentos do livro-razão (`wallet_transactions`) e consumos (`meal_consumptions`).
- [ ] Relatórios em PDF e Excel gerados com velocidade e paginação correta.

---

## SPRINT 16 — Integração de Gateway Real e Conciliação [DESACOPLÁVEL]

### Objetivo
Conectar as credenciais oficiais de produção dos provedores de pagamento homologados (Asaas, Mercado Pago e SiTef/Fiserv).

### Regra de Ativação
> Esta sprint pode ser executada assim que os contratos e credenciais comerciais forem disponibilizados pelo cliente, sem impactar a ordem das sprints de operação física (8 a 15).

### Escopo
- Ativação das chaves reais de API e segredos de webhook.
- Homologação do fluxo de Pix com conciliação automática via webhook.
- Homologação de Cartão de Crédito 1x com tokenização segura.
- Rotina noturna de reconciliação para checagem de pagamentos pendentes que perderam evento de webhook.
- Integração e homologação do protocolo SiTef/Fiserv para maquininhas presenciais no caixa de recarga.

### Critérios de Aceite
- [ ] Transação Pix real de R$ 1,00 efetuada, confirmada via webhook e creditada no ledger em menos de 5 segundos.
- [ ] Tentativa de webhook com assinatura inválida rejeitada com status 401/403.

---

## SPRINT 17 — Auditoria Contábil, Segurança e Hardening [CRÍTICA — P0]

### Objetivo
Revisão completa e exaustiva de segurança e integridade financeira antes da entrada de usuários reais.

### Testes de Penetração e Auditoria:
1. **RLS e Tenant Isolation:** Provar que nenhuma query ou mutação consegue vazar dados entre `Tenant A` e `Tenant B`.
2. **Proteção de Carteiras:** Testar tentativas de injeção de parâmetros nas RPCs; garantir que apenas a `service_role` consegue acionar RPCs financeiras críticas.
3. **Imutabilidade do Ledger:** Tentar atualizar (`UPDATE`) ou remover (`DELETE`) registros em `wallet_transactions` e comprovar o bloqueio irrestrito.
4. **IDOR e Chaves:** Varredura em busca de vazamentos de IDs sequenciais ou tokens em endpoints públicos.

### Critérios de Aceite
- [ ] Relatório de conformidade com [SECURITY.md](file:///c:/Sys_MArefeicoes/docs/SECURITY.md) 100% preenchido e aprovado.
- [ ] Zero vulnerabilidades críticas identificadas.

---

## SPRINT 18 — Performance, Carga e Estresse (3.000+ Refeições/Dia) [CRÍTICA — P0]

### Objetivo
Garantir que a infraestrutura suporte os horários de pico mais agressivos dos restaurantes universitários.

### Cenário de Estresse Simulado:
- Volume de **3.000 refeições em 2 horas** de almoço (média de 25 atendimentos por minuto por ponto).
- Picos de **40 requisições simultâneas por segundo** com múltiplos terminais operando concorrentemente.

### Métricas Obrigatórias:
- **Latência de ponta a ponta:** $p50 < 250ms$, $p95 < 400ms$, $p99 < 800ms$.
- **Uso de Conexões:** Pool de conexões do Supabase/PostgreSQL dimensionado com folga de segurança.
- **Taxa de Erro:** 0,00% de erros 500 ou falhas de concorrência contábil.

### Critérios de Aceite
- [ ] Script de carga (K6 ou Artillery) executado em ambiente de homologação.
- [ ] Nenhuma ocorrência de dead lock ou inconsistência de saldo sob carga máxima.

---

## SPRINT 19 — Operação Piloto em Unidade Real [CRÍTICA — P0]

### Objetivo
Implantar o sistema em uma unidade piloto real da MA Refeições com acompanhamento presencial.

### Roteiro de Implantação
1. Carga oficial dos alunos e regras de preço da unidade piloto.
2. Treinamento prático dos operadores de caixa e recepção.
3. Operação assistida no primeiro turno oficial de almoço e jantar.
4. Coleta de telemetria: tempo de fila, quantidade de alunos atendidos por minuto, eventuais rejeições indevidas.

### Critérios de Aceite
- [ ] Turno completo operado exclusivamente pelo sistema sem interrupção de atendimento.
- [ ] Aprovação formal do gerente da unidade piloto.

---

## SPRINT 20 — Ajustes, Correções e Refinamentos Pós-Piloto

### Objetivo
Refinar o sistema com base no feedback real dos operadores, nutricionistas e estudantes colhido no piloto.

### Classificação de Demandas
- **Bugs Críticos:** Correção emergencial imediata.
- **Ajustes de UX:** Melhorias na visibilidade da tela do operador, tamanho de botões e contraste.
- **Otimizações:** Ajustes de atalhos de teclado e filtros de relatórios.
- **Preparação para Expansão:** Liberação do rollout para as demais unidades da rede.

---

# 7. Definition of Done (Critérios Globais de Conclusão)

Nenhuma sprint é considerada concluída sem atender integralmente aos seguintes requisitos:
1. **Migrations Registradas:** Salvas em `supabase/migrations/` com sequência e timestamp, estritamente não-destrutivas.
2. **Políticas RLS:** Políticas de segurança ativas para cada nova tabela criada.
3. **Validação de Código:** `tsc --noEmit` com 0 erros, `eslint` sem erros e `npm run build` passando limpo.
4. **Testes Automatizados:** Script dedicado de validação (`validate-sprintX.cjs`) atestando todas as regras de negócio.
5. **Auditoria Documentada:** Atualização do relatório de entrega e preservação de comentários técnicos relevantes.

---
**Fim do documento revisado.**

---

# Estabilização Pós-Sprint 10 — 19/10/2026

Sprint 11 e `/admin/configuracoes` permanecem bloqueadas até o aceite de `POST_SPRINT_10_STABILIZATION_REPORT.md`.

Escopo autorizado: infraestrutura/build, integridade financeira e operacional, caixa/auditoria, homologação e documentação.

- Node.js 22 e dependências fixadas por versão, com pnpm 12.6.0 documentado;
- pagamento avulso separado de recarga/débito da carteira pela migration `20261019000044`;
- dinheiro, Pix e cartão conciliados separadamente; somente numerário integra o saldo físico esperado;
- estorno avulso compensatório, sem crédito indevido em carteira;
- terminal alinhado a online-first/fail-safe, sem nova liberação ou cobrança offline;
- abertura de caixa obrigatória preservada, sem configuração de desativação.

Gate de saída: lint, typecheck, validação estática, build finalizado, smoke test, migration homologada em staging e roteiro funcional registrado.

## Extensão autorizada de branding e acesso — 22/10/2026

- usuário `admin_general` apresentado como Master, sem criação de papel paralelo;
- fundos configuráveis e separados para login interno e do consumidor;
- variantes desktop e mobile com fallback responsivo;
- `/conta/login` dedicado e validação de papel nos dois portais;
- migration aditiva `20261022000064`, sem desabilitar RLS.
- carteirinha virtual com dados dinâmicos e fundo configurável por cor ou imagem;
- fundo da página completa do terminal separado do fundo da área operacional e exclusivo do Master;
- migrations aditivas `20261022000064` e `20261022000065` aplicadas no ambiente
  remoto de testes/homologação em 22/10/2026; produção permanece NO-GO.

## Correção autorizada — gestão de acesso dos comensais (22/10/2026)

- fechar a lacuna entre o cadastro do comensal e sua conta no Portal do
  Consumidor;
- reutilizar a capacidade `manage_students` para Master, Diretor Operacional,
  Supervisor e Gerente de Unidade;
- limitar Supervisor e Gerente às instituições vinculadas;
- manter identidades administrativas e de consumidor separadas;
- migration aditiva `20261022000066`, sem desabilitar RLS.

## Entrega complementar autorizada — primeiro acesso do consumidor

- [x] Importação aceita CPF e e-mail, sem criar senha padrão.
- [x] CPF do manifesto é substituído por HMAC-SHA256 e `last4`.
- [x] Autoatendimento valida instituição, matrícula, CPF e nome.
- [x] E-mail importado recebe convite para escolha da senha.
- [x] Ausência de e-mail ou falha de entrega gera revisão administrativa.
- [x] Telefone e foto opcional são coletados após confirmar o convite.
- [x] Recuperação de senha é conduzida pelo consumidor.

A liberação operacional depende da migration `000067`, do segredo
`CONSUMER_IDENTITY_HMAC_KEY` e da allowlist/template de e-mail do Supabase Auth.
