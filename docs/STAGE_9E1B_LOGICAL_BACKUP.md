# Etapa 9E.1-B — Backup lógico cifrado

**Data:** 28/10/2026  
**Origem:** projeto oficial Supabase no plano Free  
**Destino:** `C:\MARefeicoes-Backups\stage9e1b-20261028152457`  
**Parecer:** **GO para geração e verificação do backup; NO-GO para restauração e publicação**

## 1. Escopo executado

- download da distribuição portátil PostgreSQL 17.11-5 para Windows x64;
- verificação do SHA-256 publicado pela EDB;
- exportação lógica do banco em formato custom do `pg_dump`;
- exportação separada dos papéis, sem senhas;
- cópia dos objetos e configurações básicas dos buckets do Storage;
- cifragem AES-256-GCM durante o fluxo, sem dump persistente em texto puro;
- verificação de integridade por SHA-256, autenticação GCM e `pg_restore --list`;
- chave criada fora da pasta de backup e ACL restrita ao usuário atual e SYSTEM.

Nenhuma migration, escrita, restauração ou alteração de configuração foi
executada no Supabase.

## 2. Ferramentas e integridade

| Item | Resultado |
| --- | --- |
| pacote | `postgresql-17.11-5-windows-x64-binaries.zip` |
| origem | distribuição EDB vinculada pela página oficial do PostgreSQL |
| tamanho | 381.531.864 bytes |
| SHA-256 esperado/observado | `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f` |
| `pg_dump` / `pg_restore` | PostgreSQL 17.11 |
| certificado | Supabase Root 2021 CA, TLS verificado |

## 3. Resultado do backup

| Domínio | Resultado |
| --- | ---: |
| dump lógico antes da cifra | 1.624.752 bytes |
| dump lógico cifrado | 1.624.788 bytes |
| roles antes da cifra | 6.384 bytes |
| roles cifradas | 6.420 bytes |
| buckets | 3 |
| objetos do Storage | 18/18 |
| conteúdo do Storage | 4.420.908 bytes |
| arquivos no conjunto | 23 |
| tamanho total do conjunto | 6.064.833 bytes |
| arquivos de dados em texto puro | 0 |
| mutações na origem | 0 |

O índice privado do Storage, incluindo nomes e metadados necessários à futura
restauração, também está cifrado. O manifesto público contém somente métricas,
hashes e informações técnicas sanitizadas.

## 4. Verificações

- autenticação AES-GCM e SHA-256 aprovados para banco, roles, índice e 18 objetos;
- `pg_restore --list` encerrou com código zero e produziu catálogo válido;
- roles foram exportadas com `--no-role-passwords`;
- a chave não está sob `C:\MARefeicoes-Backups`;
- nenhum token, senha, connection string ou service role foi persistido;
- o primeiro verificador encontrou `write EOF` ao aguardar o pipe; o tratamento
  foi corrigido e o conjunto existente foi finalizado sem reexportar dados.

## 5. Gestão da chave

A chave está em diretório separado sob Documentos e possui nome correspondente
ao `runId`. O valor não foi exibido nem versionado.

Antes de considerar este backup resiliente, o responsável deve:

1. copiar a chave para mídia externa/offline protegida;
2. copiar o diretório do backup para outro dispositivo ou armazenamento seguro;
3. manter chave e backup em destinos distintos;
4. confirmar a leitura das duas cópias e registrar custódia;
5. nunca enviar a chave por chat, e-mail aberto ou commit.

Enquanto backup e chave permanecerem apenas no mesmo disco físico, existe risco
residual crítico de perda conjunta da estação.

## 6. Limitações

- o plano Free continua sem backup automático e sem PITR;
- esta cópia representa um ponto manual, não RPO de 15 minutos;
- configurações do painel, Edge Functions, SMTP, callbacks e segredos externos
  exigem inventário/recomposição separados;
- a cópia foi validada estrutural e criptograficamente, mas não restaurada;
- o espaço livre no `C:` ficou próximo de 1,83 GiB;
- o ZIP de ferramentas foi removido após validação e extração, recuperando
  381.531.864 bytes; os binários 17.11 necessários à restauração foram mantidos.
- após a limpeza controlada, o `C:` ficou com aproximadamente 2,18 GiB livres.

## 7. Próximo gate

A Etapa 9E.1-C deverá restaurar banco, roles e Storage em PostgreSQL/ambiente
isolado, sem tocar no Supabase oficial. Ela exige autorização separada e espaço
de trabalho adicional. Até lá, a comprovação de recuperação permanece pendente.

## 7.1 Qualidade local

| Verificação | Resultado |
| --- | --- |
| controles da 9E.1-B | 20/20 aprovados |
| ESLint | aprovado |
| TypeScript `--noEmit` | aprovado |
| build Next.js | código zero; 26/26 páginas; `BUILD_ID` gerado |
| duração do build | 587 segundos |

## 8. Fontes

- https://www.postgresql.org/download/windows/
- https://www.enterprisedb.com/download-postgresql-binaries
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/storage/management/download-objects
