# Sprint 20 — Finalização Funcional, Revisão de Interface e Homologação Local (`20.1` a `20.12`)

**Data:** 11/11/2026  
**Escopo Consolidado:**
- **Rodada 1 (`20.1`–`20.5`):** Auditoria funcional integral, matriz `P0`–`P3` e correções `P0-01`–`P0-06` e `P1-01`–`P1-03`.
- **Rodada 2 (`20.6`–`20.10`):** Persistência idempotente de fechamentos diários (`Migration 83`), saneamento fail-closed de offline legado (`ONLINE_FIRST_POLICY_ACTIVE`), remoção de `100.00` hardcoded na abertura de caixa e smoke HTTP/SSR local.
- **Sprint 20.11:**
  - **Parte 1:** Homologação transacional real da **Migration 83** em PostgreSQL `17.11` descartável (`27/27 PASS`, concorrência simultânea e imutabilidade comprovadas).
  - **Parte 2 e 3:** Auditoria estrutural de responsividade (tabelas/modais) e correção de scroll horizontal/vertical em 6 componentes; entrega de roteiro detalhado para inspeção visual manual.
  - **Parte 4:** Revalidação completa após a última edição (`tsc`, `eslint`, `next build 33/33`, `smoke-sprint20-routes.cjs 15/15` e regressões Sprints `14`–`20`).
- **Sprint 20.12 (Pós-reinicialização do Antigravity):** Tentativa de execução da inspeção visual interativa contra [start-isolated-ui-server.cjs](file:///c:/Sys_MArefeicoes/scripts/sprint20/start-isolated-ui-server.cjs) (`127.0.0.1:3100`). Confirmado encerramento limpo da porta `3100`; bloqueio de ferramentas `chrome_devtools` persistiu conforme diagnóstico na Seção 2.

**Restrições Preservadas:** Zero acesso ao Supabase remoto, zero aplicação remota de migrations (`79`–`83`), zero backups, zero pagamentos ou dados reais e zero deploy/push/commit.  
**Status Técnico Local:** **GO — Homologação Transacional Local (Migration 83) + Build/Regressões Aprovados**  
**Status Visual Chrome:** **BLOQUEADO POR AMBIENTE MCP / PENDENTE — Inspeção visual interativa em Chrome não executada (ver Seção 2); coberto no nível HTTP/SSR (`15/15`) + auditoria estrutural e roteiro manual.**  
**Status Produção:** **NO-GO**

---

## 1. Homologação Transacional Real — Migration 83 (`PostgreSQL 17.11`)

Executada em instância efêmera `PostgreSQL 17.11` na porta `127.0.0.1:55443` (banco `sprint20_83_*`, papéis `authenticated` e `anon` sem `SUPERUSER` e sem `BYPASSRLS`), aplicando a cadeia `77 -> 78 -> 79 -> 80 -> 81 -> 83` sobre o baseline descartável via [run-migration83-portable.ps1](file:///c:/Sys_MArefeicoes/scripts/sprint20/run-migration83-portable.ps1) e [homologate-sprint20-migration83.cjs](file:///c:/Sys_MArefeicoes/scripts/homologate-sprint20-migration83.cjs).

- **Hardening adicionado na Migration 83 antes da homologação ([20261110000083_sprint20_daily_closing_persistence.sql](file:///c:/Sys_MArefeicoes/supabase/migrations/20261110000083_sprint20_daily_closing_persistence.sql)):**
  - `pg_catalog.pg_advisory_xact_lock(...)` para serializar chamadas simultâneas sobre o mesmo `(tenant_id, closing_date, unit_id/consolidated)` + captura `unique_violation` convertida deterministicamente em `DAILY_CLOSING_ALREADY_EXISTS`.
  - Trigger `trg_prevent_financial_daily_closing_mutation` (`IMMUTABLE_DAILY_CLOSING`) bloqueando `UPDATE` e `DELETE` em `public.financial_daily_closings`, além de `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ... FROM PUBLIC, anon, authenticated`.

### Evidência Transacional Observada (`27/27 PASS`, `0` falhas)
- **Ambiente descartável e roles (`01`–`05`):** PG `170011`, `data_directory` exclusivo em `%TEMP%`, loopback `127.0.0.1:55443`, `authenticated`/`anon` restritos e cadeia `77 -> 81 -> 83` aplicada.
- **Autorização e perfil (`06`–`09`):** `anon`, chamada sem JWT `sub` (`AUTH_REQUIRED`), perfil financeiro inativo (`ACTIVE_PROFILE_REQUIRED`) e `operator` (`PERMISSION_DENIED`) bloqueados.
- **Isolamento multi-tenant (`10`–`11`, `21`–`22`):** Financeiro do Tenant B bloqueado no Tenant A (`TENANT_MISMATCH`); unidade pertencente ao Tenant B recusada ao Tenant A (`UNIT_TENANT_MISMATCH`); RLS ocultou todos os fechamentos do Tenant A para Tenant B e para `operator`.
- **Regras de negócio (`12`–`13`):** Data futura rejeitada (`INVALID_CLOSING_DATE`) e justificativa `< 5` caracteres rejeitada (`JUSTIFICATION_REQUIRED`).
- **Persistência, segregação contábil e idempotência (`14`–`20`):** Fechamento por unidade (`unitA1`) e consolidado (`unit_id IS NULL`) gravados com segregação exata (`pix=50`, `card=25`, `total=75`, créditos `+50`, débitos `-20`, saldo custódia `30`, drift `0`, receita aluno `10` na unidade / `18` consolidado, subsídios contratuais `5`/`9`, contingência `12`); repetições bloqueadas com `DAILY_CLOSING_ALREADY_EXISTS` inclusive via índice único parcial `uq_daily_closing_tenant_date_consolidated`.
- **Concorrência simultânea (`23`):** Duas sessões paralelas (`Promise.allSettled`) para a mesma data consolidada produziram exatamente **1 gravação** e **1 rejeição determinística** `DAILY_CLOSING_ALREADY_EXISTS`.
- **Integridade do ledger e imutabilidade (`24`–`27`):** `wallets.balance` (`30.00`), soma de `wallet_transactions` (`30.00`) e contagem (`2`) permaneceram inalterados; `UPDATE` bloqueado para `authenticated`; `UPDATE` e `DELETE` bloqueados até para owner/`service_role` pelo trigger `IMMUTABLE_DAILY_CLOSING`.
- **Arquivos de evidência:** [sprint20-migration83-20261111-072548.json](file:///c:/Sys_MArefeicoes/docs/evidence/sprint20/sprint20-migration83-20261111-072548.json) e [sprint20-migration83-20261111-072548.log](file:///c:/Sys_MArefeicoes/docs/evidence/sprint20/sprint20-migration83-20261111-072548.log).

---

## 2. Revisão de Interface e Correções Aplicadas (Parte 2 e Parte 3)

### Limitação Objetiva de Browser Automatizado (Confirmada na Sprint 20.12 Pós-Reinicialização)
Mesmo após a instalação de `chrome-devtools-plugin` (`v1.10.1`) e reinicialização do servidor do Antigravity, o subagente `browser` continuou recebendo apenas `read_file`, `send_message` e `manage_task` (sem ferramentas `chrome_devtools` / `list_pages` / `navigate_page` declaradas). A inspeção da pasta do plugin instalado em `chrome-devtools-plugin` mostrou apenas `plugin.json` e `skills/`, sem arquivo `.mcp.json` / servidor MCP `chrome-devtools-mcp` configurado no cliente. **Portanto, a inspeção visual interativa em Chrome (`1280×800`, `768×1024`, `390×844`) não pôde ser automatizada nesta estação e permanece pendente via navegador humano ou configuração explícita de `chrome-devtools-mcp` / Playwright em staging.**

O servidor isolado `127.0.0.1:3100` iniciado para a tentativa foi encerrado e validado como livre (`Get-NetTCPConnection -LocalPort 3100` sem listener residual).

### Correções Responsivas Identificadas e Aplicadas em Código (`Parte 3`)
Durante a auditoria estrutural de tabelas e overlays modais em todas as interfaces (`src/`), foram corrigidos defeitos concretos de overflow/recorte em viewports menores:
1. [ReconciliationDashboard.tsx](file:///c:/Sys_MArefeicoes/src/components/admin/ReconciliationDashboard.tsx#L550): container da tabela **Divergências** corrigido de `overflow-hidden` para `overflow-x-auto`; modais de **Resolução de Divergência** e **Fechamento Diário** receberam `overflow-y-auto` + `my-auto`.
2. [FinanceManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/financeiro/FinanceManager.tsx#L169-L170): modais de **Ajuste de carteira** e **Estornar lançamento** receberam `overflow-y-auto` + `my-auto`.
3. [CommensalManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/comensais/CommensalManager.tsx#L432), [UserManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/usuarios/UserManager.tsx#L739) e [ContingencyManager.tsx](file:///c:/Sys_MArefeicoes/src/app/admin/contingencia/ContingencyManager.tsx#L783): overlays modais receberam `overflow-y-auto`.
4. [ReceptionTerminal.tsx](file:///c:/Sys_MArefeicoes/src/components/terminal/ReceptionTerminal.tsx#L1767-L1977): overlays da **Calculadora**, **Diagnóstico F8**, **Recebimento/Troco do Aluno** e **Pagamento de Visitante** receberam `overflow-y-auto` para evitar recorte quando o teclado virtual abrir em tablets/celulares.

---

## 3. Roteiro Obrigatório para Inspeção Visual Manual (Staging / Local Autenticado)

Executar em navegador real (Desktop `1280x800`, Tablet `768x1024` e Mobile `390x844`) verificando `scrollWidth <= innerWidth`, contraste, abertura/fechamento de modais, estados de loading/erro e ausência de erros no Console DevTools:

| # | Módulo / Rota | Verificações Visuais e Interativas Obrigatórias |
| :-: | :--- | :--- |
| 1 | **Login Staff & Home** (`/`, `/login`) | Card limpo sem botões de debug; toggle de exibição de senha; erro visível com credencial inválida; redirecionamento pós-login por perfil. |
| 2 | **Portal Administrativo** (`/admin`) | Drawer mobile no `AdminShell` abrindo/fechando em `390px` e `768px`; barra lateral retrátil em `1280px`; presença dos cards de **Contingência** e **Integrações**; modal **Alterar senha** legível. |
| 3 | **Dashboard Operacional** (`/admin/dashboard`) | Seletor de unidade respeitando escopo; badges **Ao Vivo** / **Modo Resiliente (30s)**; gráfico de blocos de 15 min sem sobreposição de rótulos em `390px`. |
| 4 | **Unidades & Comensais** (`/admin/unidades`, `/admin/comensais`, `/admin/usuarios`) | Tabelas com rolagem horizontal sem estourar o viewport; abertura e scroll dos modais de criação/edição e exibição de credencial temporária; feedback ao alterar modo de caixa (`per_meal` / `daily`). |
| 5 | **Importação & Categorias** (`/admin/importacoes`, `/admin/categorias`) | Upload de planilha modelo CSV/XLSX, visualização de rejeições por linha (`/admin/importacoes/[id]/rejeicoes`) e tabela de regras de preço por categoria/refeição. |
| 6 | **Terminal / PDV** (`/terminal`) | Seleção multi-unidade; digitação/busca sem roubo de foco com **F7**, **Diagnóstico F8** ou **Calculadora** abertos; tela cheia sincronizando ícone com `Esc`; desbloqueio após `timeout` conferindo F7; atalhos de pagamento de visitante no modal e contraste no tema claro/escuro. |
| 7 | **Caixa e Relatórios de Turno** (`/admin/caixa`, `CashShiftModal`, `ShiftReportsModal`) | Campo **Fundo de Troco Inicial** iniciando vazio (aceitando `0,00` digitado); histórico em `/admin/caixa` exibindo movimentações específicas do `shift.id` clicado em **Ver Detalhes**; baixa parcial em modo `daily`; download CSV F7 abrindo acentuado no Excel. |
| 8 | **Contingência** (`/admin/contingencia`) | Criação de lote Tipo A/B/C com anexo PDF/imagem; aprovação/rejeição em modal com scroll vertical em mobile; erro claro para papéis sem alçada. |
| 9 | **Relatórios Financeiros** (`/admin/relatorios`) | Filtro de datas e unidade; separação clara de Receita Realizada vs Custódia vs Subsídios; downloads XLSX e PDF sem falha HTTP. |
| 10 | **Conciliação e Fechamento Diário** (`/admin/conciliacao`) | Aba **Divergências** rolando horizontalmente em mobile; modal **Auditoria de Divergência** e botão **Persistir Lote** sem `alert()`; aba **Fechamento Diário Consolidado** diferenciando `Prévia Dinâmica` vs `Fechamento Persistido`, abrindo o modal **Fechar Dia** e rejeitando duplicidade na mesma data/escopo. |
| 11 | **Portal/PWA Comensal & Contas** (`/consumer`, `/conta/login`, `/conta/primeiro-acesso`, `/conta/esqueci-senha`, `/conta/redefinir-senha`, `/conta/ativar`) | Bottom navigation mobile PWA em `390px`; feedback visual `"Código Pix copiado!"`; cartão bloqueado com aviso explícito até integração sandbox; loading de instituições no primeiro acesso; contraste e toggle de senha. |
| 12 | **Configurações Master & Integrações** (`/admin/identidade`, `/admin/integracoes`) | Prévia ao vivo de cores/logo e cartão digital sem mojibake; configuração de provedores Asaas/Mercado Pago sem exposição de segredo em client-side. |

---

## 4. Evidências Executadas Após a Última Edição de Código (`Parte 4`)

| Verificação / Suíte | Comando | Resultado Observado |
| :--- | :--- | :--- |
| **Migration 83 (PG 17.11 real)** | `powershell ... scripts/sprint20/run-migration83-portable.ps1` | **27/27 PASS (0 falhas)** |
| **TypeScript Check** | `pnpm exec tsc --noEmit` | **0 erros** (código `0`) |
| **ESLint** | `pnpm run lint` (`eslint src`) | **0 erros** (código `0`) |
| **Build de Produção Next.js** | `pnpm run build` | **33/33 páginas** (código `0`) |
| **Smoke HTTP & Guards Local** | `node scripts/smoke-sprint20-routes.cjs` | **15/15 PASS** (`8` rotas `200`, `7` guards `307`) |
| **Validação Sprint 20** | `node scripts/validate-sprint20.cjs` | **12/12 PASS** |
| **Regressão Sprint 18** | `node scripts/validate-sprint18.cjs` | **8/8 PASS** |
| **Segurança & Prep Sprint 17 / 17.1** | `homologate-sprint17-security.cjs` + `validate-sprint17-1-prep.cjs` | **20/20 PASS** + **5/5 PASS** |
| **Conciliação Sprint 16** | `homologate-sprint16-reconciliation.cjs` + `validate-sprint16.cjs` | **10/10 PASS** + **7/7 PASS** |
| **Relatórios Sprint 15** | `homologate-sprint15-financial.cjs` + `hardening.cjs` + `validate-sprint15-reporting.cjs` | **10/10** + **7/7** + **7/7 PASS** |
| **Dashboard Sprint 14** | `homologate-sprint14-dashboard.cjs` + `validate-sprint14-dashboard.cjs` | **23/23 PASS** + **6/6 PASS** |
| **Estabilização Pós-Sprint 10** | `node scripts/validate-post-sprint10-stabilization.cjs` | **63/63 PASS** |

---

## 5. Classificação Final da Entrega

1. **Concluído e testado:** Correções funcionais `P0-01`–`P0-06`, `P1-01`–`P1-03`, `P2-03`, `P3-01`; Migration 83 (`close_financial_daily_period` + `trg_prevent_financial_daily_closing_mutation`) homologada transacionalmente em PostgreSQL `17.11` (`27/27 PASS`); correções responsivas de tabela/modais; `tsc`, `eslint`, `build 33/33`, `smoke-sprint20-routes.cjs 15/15` e todas as regressões `14–20` (`0` falhas).
2. **Concluído no código, pendente inspeção visual em navegador real e staging:** Todas as 12 interfaces administrativas, PDV e portal/conta do comensal (roteiro manual na Seção 3, pois o MCP `chrome_devtools` não estava conectado).
3. **Bloqueado por integração / ambiente externo:** Aplicação remota controlada das migrations `79`–`83`, homologação sandbox de pagamentos (`PAY-01..PAY-14`) + tokenização de cartão, TEF presencial `sitef`, restauração de backup (`Gate G1`) e testes físicos presenciais (`PHY-01..PHY-16` / Piloto `19B`).

**Parecer Final:** **Sprint 20.11/20.12 concluída no escopo executável local (GO para homologação técnica e transacional local; Revisão visual interativa em Chrome permanece pendente via roteiro manual da Seção 3 ou Playwright/MCP dedicado em staging; Produção permanece em NO-GO).**
