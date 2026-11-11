# Gate G1.1 — Plano de Recuperação Externa e Custódia Segura

**Data da Elaboração:** 10/11/2026  
**Escopo:** Preparação documental, inventário criptográfico, dimensionamento de armazenamento externo, custódia separada de chave, matriz de compatibilidade Supabase e critérios de medição para execução futura dos sub-gates **G1-A** e **G1-B**.  
**Status Gate G1.1:** **GO — Plano de Recuperação Externa Preparado**  
**Status G1-A / G1-B / Sprint 19B / Produção:** **NO-GO — Nenhuma cópia, criação de projeto, restauração ou alteração remota executada**

---

## 1. Inventário Consolidado dos 21 Artefatos Cifrados (`runId = 20261028152457`)

Conjunto preservado em `C:\MARefeicoes-Backups\stage9e1b-20261028152457` (`AES-256-GCM`, gerado em `28/10/2026` às `15:27:19Z`), somado a `manifest.json` e marcador `.stage9e1b-backup`. Todos os hashes abaixo referem-se exclusivamente aos arquivos cifrados (zero exposição de segredos ou nomes internos de objetos):

| # | Artefato | Bytes Cifrados | SHA-256 (Arquivo Cifrado) | Observação Técnica |
| :---: | :--- | :---: | :--- | :--- |
| 01 | `database.dump.enc` | `1.624.788` | `b8b40ff06150f895ee8f60b42f66deff7b302999a80d36bdbc8c68f4919382d3` | `1.624.752` B decifrado (`pg_dump --format=custom --compress=zstd:9`, 1.494 itens TOC) |
| 02 | `roles.sql.enc` | `6.420` | `724aca43d99a2b8733cd113f43b9a5464c54077b51fa6806afa4163aa1b172c1` | `6.384` B decifrado (`--roles-only --no-role-passwords`) |
| 03 | `storage-index.json.enc` | `10.798` | `a93b3f98158b1d40255e7fe7e9c4fece53344309090dfd2aad8d0a8095011de3` | `10.762` B decifrado (índice privado de 3 buckets e 18 objetos) |
| 04 | `storage/object-000001.enc` | `610.042` | `f6a026d057c7fd4ecae1c7c511fd7063553bcbe3765b0a452e3b97f14ea03448` | Objeto Storage cifrado |
| 05 | `storage/object-000002.enc` | `204.266` | `1bb09e923617a60fc3e40118a7818b2fcceb6c31588499c04efe59c5c0b823a3` | Objeto Storage cifrado |
| 06 | `storage/object-000003.enc` | `218.846` | `9b2fb1341961f8579622a836c5a4d359ddd0903fef04c6042710b5941c1f6ae9` | Objeto Storage cifrado |
| 07 | `storage/object-000004.enc` | `165.135` | `16d768b9283f67c0eeadbb90457495e10d79a988dc166b2d7159222202356063` | Objeto Storage cifrado |
| 08 | `storage/object-000005.enc` | `137.438` | `8d3b706f510c31566a35e046fbd06ac69ebb3be2fd0f76925dd9fa45c6886121` | Objeto Storage cifrado |
| 09 | `storage/object-000006.enc` | `172.745` | `b00b2d9334f0f3aaa3274cb4f990567bdf0b9314313ee82cb25e51c91e47ac8a` | Objeto Storage cifrado |
| 10 | `storage/object-000007.enc` | `204.615` | `003a8a333a80b24b2c21d60723854e9b96f9e5b048f7dd63d5b5cbcce369906d` | Objeto Storage cifrado |
| 11 | `storage/object-000008.enc` | `154.533` | `f0aedb71517cd32e5a7e44d8eb8ec2446b00bb9e10257a03fa172f834150d755` | Objeto Storage cifrado |
| 12 | `storage/object-000009.enc` | `136.016` | `d67b9f3818a05e4026def3d1ac663d06e3eee65b1e90bb507195655c7af4c593` | Objeto Storage cifrado |
| 13 | `storage/object-000010.enc` | `59.923` | `9d5870c67e311fc086ccb55baf97a477e1a3b646aa580cc0b83485f74eb404c3` | Objeto Storage cifrado |
| 14 | `storage/object-000011.enc` | `59.923` | `de15e9d177f47b4a2c75c56454db69a6e21348b0441fc6af3bb86ceb9efff4d7` | Objeto Storage cifrado |
| 15 | `storage/object-000012.enc` | `59.923` | `f2071d044788dcf9bd2a7e17863a6dedd7393b3a4c5aa2a536decdf45e82b162` | Objeto Storage cifrado |
| 16 | `storage/object-000013.enc` | `59.923` | `ff0641fcbdbaebc2eaa9c8878cde77382d8679360deba3b6bc8a53a9253946e8` | Objeto Storage cifrado |
| 17 | `storage/object-000014.enc` | `59.923` | `7f890792cf3e2558ae008242846797b74e435c939007962f7ca7da63da7eb499` | Objeto Storage cifrado |
| 18 | `storage/object-000015.enc` | `59.923` | `6f0ac0bf6afe0b88b3af4b8adead244461bde70c1d3d3050dd6ceab31fcf84a4` | Objeto Storage cifrado |
| 19 | `storage/object-000016.enc` | `192.238` | `b272b07f4cd997904ca35f4ceebdc206ceecf52c1922d3fdde02d21c7b7a1423` | Objeto Storage cifrado |
| 20 | `storage/object-000017.enc` | `192.238` | `497de9abe90d699e191f35cfceff46da25018a849a948aa51190fab4f70ee26b` | Objeto Storage cifrado |
| 21 | `storage/object-000018.enc` | `1.673.906` | `6ef24769e47bccf47abba2e66a4fdaf43300bbcea9e499e277b189c9c1227731` | Objeto Storage cifrado |

- **Totais verificados do pacote `9E.1-B`:** `21` artefatos cifrados (`6.063.460` bytes; Storage decifrado acumulado = `4.420.908` bytes), `manifest.json` + marcador `.stage9e1b-backup` (`6.064.833` bytes totais na pasta), com integridade decifrada e TOC (`1.494` itens) comprovados em RAM em [stage9e1c-preflight-20261110210204.json](file:///c:/Sys_MArefeicoes/docs/evidence/stage9e/stage9e1c-preflight-20261110210204.json).

---

## 2. Dimensionamento de Capacidade para Restauração Integral

Estimativa conservadora dimensionada para evitar repetição da restrição atual da estação de desenvolvimento (`C:\` com `1,75 GB` livres):

| Componente no Ensaio de Recuperação | Tamanho Estimado | Observação |
| :--- | :---: | :--- |
| Pacote de backup cifrado (`stage9e1b-20261028152457`) | `~6 MB` | Copiado integralmente para mídia externa |
| Expansão do banco lógico (`192` tabelas, índices, catálogo) | `~120–250 MB` | `pg_dump` atual tem `1,55 MB` compactado em `zstd:9` + crescimento inicial de tabelas/índices |
| Segmentos WAL e áreas temporárias durante `pg_restore` | `~200–400 MB` | Picos de ordenação, `CREATE INDEX` e `pg_wal` ativo |
| Storage reconstruído em staging/mídia (`18` objetos + folga) | `~50 MB` | Crescimento esperado com atas futuras (`contingency-evidence`) |
| Ferramentas portáteis PostgreSQL 17 (se estação Windows) | `~650–800 MB` | ZIP (`364 MB`) + binários/libs/share (`~280 MB`) + `initdb` (`~80 MB`) |
| Margem operacional anti-degradação (SO + snapshots múltiplos) | **`>= 8,0 GB`** | Evita pressão de paginação e suporta múltiplas rodadas de validação |

- **Capacidade recomendada de infraestrutura externa:**
  - **Estação / SSD externo de apoio:** mínimo prático de **>= 10 GB livres** (SSD confiável; `4 GB` é apenas piso absoluto para tentativa mínima).
  - **Projeto Supabase isolado de recuperação:** cota de banco compatível com tamanho restaurado + Storage dedicado (suficiente para o volume atual `< 10 MB`, mas exigindo atenção à retenção de planos pagos se **PITR** for contratado).

---

## 3. Procedimento Seguro de Cópia Externa do Backup (Somente com Autorização)

**Regra:** Nunca mover ou excluir `C:\MARefeicoes-Backups\stage9e1b-20261028152457`. Executar apenas cópia verificada após autorização específica e montagem de destino externo confiável.

1. **Preparação:** Montar mídia externa dedicada (SSD USB cifrado / BitLocker ou armazenamento isolado equivalente), confirmar `>= 10 GB` livres e registrar seu rótulo lógico sem dados pessoais.
2. **Cópia controlada:** Copiar integralmente o diretório `stage9e1b-20261028152457` (sem copiar a pasta `.key` junto!) preservando somente os 23 arquivos originais.
3. **Conferência obrigatória de integridade:**
   - Calcular `SHA-256` dos **21 arquivos cifrados** no destino externo e confrontar 1:1 com a tabela da **Seção 1**.
   - Conferir existência e leitura íntegra de `manifest.json` e `.stage9e1b-backup`.
4. **Critério de aprovação da cópia:** `21/21` checksums cifrados idênticos e leitura comprovada após desconectar/reconectar a mídia externa. Qualquer divergência invalida a cópia (`NO-GO`).

---

## 4. Custódia e Armazenamento Separado da Chave AES-256-GCM

Conforme [STAGE_9E1B_LOGICAL_BACKUP.md](file:///c:/Sys_MArefeicoes/docs/STAGE_9E1B_LOGICAL_BACKUP.md#L63-L77):
- **Proibição absoluta:** Backup cifrado e arquivo `.key` (`stage9e1b-20261028152457.key`) **jamais** podem coexistir no mesmo disco removível, repositório Git, conversa de chat ou e-mail sem proteção.
- **Armazenamento separado recomendado:**
  - **Cópia 1 (Estação atual):** mantida sob `Documents` com ACL restrita ao usuário/SYSTEM (sem alterações até substituição planejada).
  - **Cópia 2 (Custódia segregada):** gravar a chave em cofre de segredos institucional / gerenciador corporativo com MFA ou dispositivo criptografado distinto da mídia que recebeu o backup `stage9e1b-*`.
- **Teste de leitura:** Validar que a chave possui exatamente `64` caracteres hexadecimais (256 bits) via script booleano (`verifyEncrypted`) sem jamais imprimir seu valor em stdout ou logs.

---

## 5. Matriz de Compatibilidade com Destino Supabase Isolado vs PostgreSQL Genérico

| Componente / Aspecto | PostgreSQL 17 Portátil (Genérico) | Novo Projeto Supabase Isolado (Destino Alvo G1) | Ação Requerida na Restauração |
| :--- | :---: | :---: | :--- |
| Schema `public` (tabelas, FKs, RLS, funções) | Compatível | **100% Compatível** | Restaurar e aplicar validação RLS `31/31` + migrations locais pendentes conforme cenário |
| `supabase_vault` (extensão) | **Incompatível** (ausente no Windows) | **Nativo** (habilitar previamente) | Verificar extensão ativa antes de restaurar schema/policies dependentes |
| `btree_gist`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements` | Parcial | **Nativo** (`extensions`) | Confirmar versão e schema `extensions` compatíveis no destino |
| Schemas `auth`, `storage`, `realtime`, `vault`, `pgbouncer`, `graphql_public` | **Não gerenciados** | **Gerenciados pela plataforma Supabase** | Não sobrescrever tabelas internas gerenciadas cegamente via dump completo; usar fluxo próprio para usuários Auth, metadados e API Storage |
| Schema legado `backup_pre_homologacao_20261019` | Compatível | Compatível | Inventariar no destino isolado e decidir retenção ou exclusão após conferência |
| Objetos do Storage (`18` arquivos em `3` buckets) | Apenas extração em arquivo local | **Restauração real via Storage API + buckets privados** | Recriar os 3 buckets (`public`, `file_size_limit`, `allowed_mime_types`) a partir de `storage-index.json.enc` e enviar os 18 objetos validando `plainSha256` |

---

## 6. Extensões, Schemas e Serviços Gerenciados com Tratamento Específico

1. **Bloqueio Prévio de Efeitos Externos (Obrigatório Antes do Restore):**
   - No novo projeto Supabase isolado, desativar previamente webhooks HTTP, Database Webhooks, envios SMTP/Auth de e-mail, `pg_cron`, `pg_net` e não apontar variáveis de gateways (`Asaas`/`Mercado Pago`) reais.
2. **Restauração Seletiva/Ordenada no Destino Supabase:**
   - **Passo A (Banco):** `pg_dump` de projeto Supabase inclui schemas internos gerenciados pela plataforma (`auth`, `storage`, `realtime`, `pgbouncer`, `vault`, `graphql_public`). Em um novo projeto Supabase, esses schemas **já existem e são controlados pelo próprio runtime da plataforma**; portanto, o procedimento deve restaurar separadamente schema `public` (e `supabase_migrations`), além de mapear usuários/identidades necessárias no `auth.users` em ambiente controlado sem disparar convites/e-mails reais, filtrando erros esperados de objetos proprietários da plataforma.
   - **Passo B (Roles):** `roles.sql.enc` contém roles gerenciadas do Supabase sem senhas (`passwordsIncluded: false`). Aplicar somente roles customizadas/não-reservadas que já não existam nativamente no destino.
   - **Passo C (Extensões):** Garantir `btree_gist`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements` e `supabase_vault` habilitadas no novo projeto antes da carga de funções e triggers.
   - **Passo D (Storage):** Recriar os `3` buckets com as políticas originais e subir `18/18` objetos decifrados em streaming (preferencialmente via buffer em RAM, zero arquivo plano persistido), verificando cada `SHA-256`.

---

## 7. Medição Real de RPO/RTO e Estratégia Complementar de PITR

> **Ajuste Técnico Obrigatório:** Os valores **`RPO <= 15 minutos`** e **`RTO <= 4 horas`** constantes nos runbooks anteriores são **metas-alvo propostas**, e **não métricas comprovadas**.

1. **Limite Estrito do Backup Lógico (`9E.1-B`):**
   - O backup lógico cifrado em disco comprova recuperação apenas até o ponto exato em que foi capturado (`2026-10-28T15:27:19Z`). Em operação real, depender apenas de dump manual diário gera **RPO de horas/dias**, incompatível com a meta proposta de `15 min`.
2. **Estratégia Complementar Necessária (PITR):**
   - Para alcançar `RPO <= 15 min` em piloto/produção, será necessário validar plano Supabase com **Point-in-Time Recovery (PITR)** ativo, documentando:
     - janela de retenção contratada (ex.: 7 dias);
     - granularidade real de ponto de recuperação verificada no painel;
     - procedimento combinado (**PITR para banco gerenciado + backup lógico criptografado `9E.1-B` como salvaguarda portátil + replicação/backup independente de objetos do Storage**, já que backups físicos/PITR não garantem cópia sincronizada fora do projeto).
3. **Protocolo de Cronometragem no Ensaio Futuro:**
   - Registrar em arquivo JSON sanitizado (`9e1-backup-restore.template.json`):
     - `backupCapturedAt`: timestamp do snapshot/ponto selecionado;
     - `restoreStartedAt`: início efetivo do provisionamento/restauração;
     - `restoreCompletedAt`: conclusão com banco + Storage + RLS `31/31` aprovados;
     - **`RTO_medido`** = `restoreCompletedAt - restoreStartedAt` (comparar com teto `<= 4 h`);
     - **`RPO_disponivel`** = intervalo comprovado pelo mecanismo testado (snapshot lógico pontual vs ponto PITR efetivamente restaurável).

---

## 8. Checklist de Limpeza e Descarte Seguro do Ambiente Temporário

Ao finalizar o futuro ensaio **G1-A / G1-B**, cumprir integralmente antes de registrar evidência final:
- [ ] Zero arquivos decifrados temporários (`*.dump`, `*.sql`, `storage-index.json`, objetos de Storage em texto plano) remanescentes na estação ou mídia auxiliar.
- [ ] Zero variáveis de conexão (`SUPABASE_DB_URL`, `PGPASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`) ou chave AES persistidas em logs, terminal ou repositório.
- [ ] Zero processos `postgres`, `pg_ctl` ou listeners residuais na estação local (se usados).
- [ ] Projeto Supabase isolado de recuperação **pausado ou excluído** formalmente após coleta da evidência sanitizada e autorização de encerramento.
- [ ] Backup original `C:\MARefeicoes-Backups\stage9e1b-20261028152457`, cópia externa e chaves preservados intactos.

---

## 9. Critérios Objetivos de Aprovação (G1-A e G1-B)

| Sub-Gate | Critério Mínimo Obrigatório para Mudar de NO-GO → GO | Status Atual |
| :--- | :--- | :---: |
| **G1-A — Recuperabilidade** | (1) Cópia externa aprovada com `21/21` SHA-256 conferidos + chave guardada separadamente; (2) Restauração real em destino isolado com schema `public`, dados, `18/18` objetos Storage por checksum, `31/31` cenários RLS e `audit_wallet_custody_integrity` (`drift = 0`). | **NO-GO** |
| **G1-B — Continuidade** | (1) Reproduzibilidade comprovada em **novo projeto Supabase isolado** (`auth`, `storage`, `realtime`, `supabase_vault`); (2) `RTO` medido `<= 4 h`; (3) Estratégia de retenção e **PITR** definida/validada se a meta `RPO <= 15 min` for exigida; (4) Zero alterações na origem e descarte limpo do destino. | **NO-GO** |

---

### Resumo de Posição Atual
- **Etapa G1.1 (Plano de Recuperação Externa):** **GO — Documentado com inventário verificado (`21/21` hashes), dimensionamento e matriz de compatibilidade.**
- **G1-A, G1-B, Sprint 19B e Produção:** **NO-GO** (aguardando armazenamento externo, cópia autorizada da chave/backup e projeto Supabase isolado para execução futura).

