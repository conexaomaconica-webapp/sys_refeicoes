# Etapa 9E.1-C — Preflight e Homologação da Restauração Isolada (Gate G1)

**Data da Execução do Preflight:** 10/11/2026 (`2026-11-10T21:02:04Z`)  
**Script Executado:** [preflight-stage9e1c-restore.cjs](file:///c:/Sys_MArefeicoes/scripts/stage9e/preflight-stage9e1c-restore.cjs) (somente leitura em memória; `0` arquivos em texto puro em disco; `0` acessos remotos)  
**Evidência Sanitizada:** [stage9e1c-preflight-20261110210204.json](file:///c:/Sys_MArefeicoes/docs/evidence/stage9e/stage9e1c-preflight-20261110210204.json)  
**Parecer Gate G1-A (Recuperabilidade):** **NO-GO — Bloqueado na estação local por espaço insuficiente (`1,74 GB` em `C:\`), ausência de volume secundário e dependências gerenciadas Supabase (`supabase_vault`)**  
**Parecer Gate G1-B (Continuidade / RPO-RTO):** **NO-GO — Não testado em destino isolado com plataforma compatível**  
**Status Produção / Sprint 19B:** **NO-GO**

---

## 1. Origem e Identificação do Backup Verificado

| Atributo | Resultado Observado |
| :--- | :--- |
| Identificador (`runId`) | `20261028152457` (Etapa `9E.1-B`, gerado em `28/10/2026`) |
| Origem declarada (`9E.1-B`) | Projeto oficial Supabase (plano Free; captura manual) |
| Raiz preservada na estação | `C:\MARefeicoes-Backups\stage9e1b-20261028152457` |
| Criptografia | `AES-256-GCM` autenticada (`MAGIC = MAREFB01`, IV 12 bytes, AuthTag 16 bytes) |
| Custódia da chave | Arquivo de chave presente fora da raiz do backup (sob `Documents`), formato 256-bit (`64` hex) validado sem exibição |
| Conteúdo total do conjunto | `21` artefatos cifrados verificados em RAM (`database.dump.enc`, `roles.sql.enc`, `storage-index.json.enc`, `18` objetos de Storage) + `manifest.json` + marcador `.stage9e1b-backup` |

---

## 2. Capacidade de Disco e Ambiente Verificado

| Recurso | Valor Medido no Preflight | Requisito / Diagnóstico |
| :--- | :--- | :--- |
| Volumes disponíveis | Somente `C:\` (`Fixed`, `118,15 GB` totais, **`1,74 GB` livres**) | **Sem volume secundário** (`D:\`/`E:\`/`F:\` ausentes) para isolar dados restaurados |
| Mínimo seguro para ensaio local | `2,50 GB` livres recomendados | Déficit de `~0,76 GB` considerando pico transitório (`~830 MB`) + margem de estabilidade do Windows |
| Ferramentas locais retidas (`.tools`) | `pg_restore.exe`, `postgres.exe`, `initdb.exe` (`17.11-5`) presentes; **`share/postgres.bki` ausente** | Subir cluster descartável local exigiria novo download/extração (`~644 MB` pico) antes de restaurar |
| Projeto Supabase de recuperação | **Não provisionado / não autorizado** | Destino remoto isolado permanece pendente conforme [STAGE_9E1_PREFLIGHT_READINESS.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1_PREFLIGHT_READINESS.md) |

---

## 3. Evidências de Integridade Obtidas em Memória (Fase 1)

Sem gravar nenhum dado decifrado em disco e sem alterar o backup ou a chave originais, o preflight validou integralmente em streaming RAM:

1. **Verificação Criptográfica AES-256-GCM + SHA-256:**
   - `database.dump.enc`: **`1.624.752` bytes** decifrados em RAM, tag GCM e SHA-256 idênticos ao `manifest.json`.
   - `roles.sql.enc`: **`6.384` bytes** (`passwordsIncluded = false`), tag GCM e SHA-256 idênticos ao `manifest.json`.
   - `storage-index.json.enc`: **`10.762` bytes** íntegros, indexando **`3` buckets** e **`18` objetos**.
   - Objetos do Storage: **`18/18` objetos** (`4.420.908` bytes totais) decifrados em memória com `plainBytes` e `plainSha256` validados sem divergência.
2. **Inspeção do Catálogo do Dump (`pg_restore --list` via pipe em RAM):**
   - Código de saída `0`; **`1.494` entradas no TOC**, incluindo:
     - `192` `TABLE`, `137` `FUNCTION`, `160` `INDEX`, `127` `FK`, `116` `CONSTRAINT`, `50` `POLICY`, `32` `TRIGGER`, `24` `TYPE`, `4` `PUBLICATION`, `5` `EXTENSION`.
   - **Schemas presentes:** `public`, `auth`, `storage`, `realtime`, `extensions`, `graphql_public`, `pgbouncer`, `supabase_migrations`, `vault`, `pg_catalog`, `backup_pre_homologacao_20261019`.
   - **Extensões exigidas pelo dump:** `btree_gist`, `pg_stat_statements`, `pgcrypto`, **`supabase_vault`**, `uuid-ossp`.

---

## 4. Motivo Técnico da Interrupção Antes da Restauração (Decisão Baseada no Preflight)

Em estrita observância à regra de interrupção *"Se não houver espaço ou ambiente adequado, encerrar em NO-GO com diagnóstico e requisitos objetivos para execução futura"*, a **Fase 3 (Restauração)** **não foi executada**, pelos três bloqueios objetivos abaixo comprovados:

1. **Risco de esgotamento do volume único `C:\` (`1,74 GB` livres):** Não existe volume secundário isolado na máquina e `.tools` não possui `share/postgres.bki`; baixar/extrair os binários completos (`~644 MB` de pico) somado ao cluster `initdb`, restauração do dump (`1.494` objetos) e objetos Storage comprometeria a margem mínima segura (`2,50 GB`) e a memória RAM livre da estação (`~0,42–0,62 GB`).
2. **Incompatibilidade de extensões gerenciadas Supabase em PostgreSQL 17 Windows genérico:** O TOC revelou dependência explícita da extensão **`supabase_vault`** e dos schemas gerenciados `auth`, `storage`, `realtime`, `vault`, `pgbouncer` e `graphql_public`. Um PostgreSQL 17 portátil no Windows não possui `supabase_vault` nem os serviços gerenciados Auth/Storage/Realtime, permitindo no máximo restauração parcial de `public` (insuficiente para aprovar **G1-A** completo e **G1-B**).
3. **Ausência de cópia externa de custódia comprovada:** Conforme [STAGE_9E1B_LOGICAL_BACKUP.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1B_LOGICAL_BACKUP.md#L68-L77), backup e chave ainda residem no mesmo disco físico (`C:\`), exigindo duplicação prévia para mídia externa/armazenamento seguro separado antes do exercício.

---

## 5. Procedimento Preparado de Restauração (Para Execução Futura Autorizada)

Quando o destino adequado estiver disponível, a execução deverá seguir estritamente:
1. **Para G1-A (Recuperabilidade Lógica / Estrutural em PostgreSQL Isolado — volume dedicado >= 5 GB livres):**
   - Criar cluster descartável exclusivo no volume dedicado (nunca em `C:\` abaixo de `2,50 GB` livres).
   - Decifrar em stream (`decryptReadable`) e restaurar `roles.sql.enc` (filtrando roles reservadas Supabase se alvo não for projeto Supabase) e `database.dump.enc` por schemas críticos (`public`), registrando eventuais erros esperados de extensões gerenciadas caso não seja ambiente Supabase completo.
   - Decifrar objetos de `storage/` em pasta isolada no volume secundário, validando `18/18` hashes SHA-256 contra `storage-index.json.enc`.
   - Executar conferência de contagens, `audit_wallet_custody_integrity`, políticas RLS (`31/31`) e validação read-only.
2. **Para G1-B (Continuidade Completa RPO/RTO — Novo Projeto Supabase Isolado):**
   - Provisionar **novo projeto Supabase de recuperação** (região compatível, zero tráfego, integrações/cron/webhooks desativados), conforme [STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1_BACKUP_RESTORE_RUNBOOK.md).
   - Restaurar banco gerenciado + roles + Auth + buckets/objetos do Storage via API sobre o novo projeto, medir `RPO` e `RTO` reais (limites `<= 15 min` em plano pago/PITR e `<= 4 h` RTO), validar `31/31` RLS e confirmar zero alterações no projeto oficial `Sys_refeições`.

---

## 6. Limitações, Riscos Residuais e Requisitos Objetivos para Desbloquear G1

| Sub-Gate | Estado Atual | Requisitos Objetivos para Alcançar GO |
| :--- | :---: | :--- |
| **G1-A — Recuperabilidade** | **NO-GO** | (1) Cópia externa da pasta de backup e da chave validada em outra mídia; (2) Ambiente isolado com **>= 4,0 GB livres** em volume dedicado (ou projeto Supabase isolado); (3) Execução efetiva do `pg_restore` + Storage `18/18` com contagem de tabelas/linhas e `custody_drift = 0`. |
| **G1-B — Continuidade** | **NO-GO** | (1) Destino Supabase isolado com suporte nativo a `auth`, `storage`, `realtime` e `supabase_vault` (ou plano com backup físico/PITR ativo, pois o plano Free não atende `RPO <= 15 min`); (2) Medição comprovada de `RTO <= 4 h` e procedimento reproduzível documentado. |

### Encerramento e Preservação
- `remoteAccessAttempted = false`, `restoresPerformed = 0`, `plaintextWrittenToDisk = 0`.
- `C:\MARefeicoes-Backups\stage9e1b-20261028152457` e a chave em `Documents` foram **integralmente preservados sem modificação**.
- Zero processos PostgreSQL em execução, porta `55442` livre e zero clusters ou arquivos temporários criados por esta etapa.
- **Parecer Final do Gate G1:** **NO-GO** (Sprint **19B** e **Produção** permanecem em **NO-GO**).

