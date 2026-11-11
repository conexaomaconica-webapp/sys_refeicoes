# Etapa 8A.2 — Execução do preflight remoto

**Data:** 27/10/2026  
**Resultado:** bloqueada antes da autenticação PostgreSQL  
**Conta de auditoria:** não criada  
**Alterações remotas:** zero

## Execução realizada

Foi iniciada somente a conexão destinada ao preflight administrativo read-only. O cliente exigiu TLS com validação da cadeia e recusou o certificado apresentado pelo pooler com `SELF_SIGNED_CERT_IN_CHAIN`.

Nenhuma sessão PostgreSQL foi autenticada, nenhuma consulta foi executada e nenhum dado operacional foi acessado. Os scripts de criação e revogação não foram iniciados.

## Decisão de segurança

A URL existente usa `sslmode=require`, que cifra a conexão, mas não comprova a autoridade certificadora nem o hostname. Como o preflight utiliza a credencial administrativa, o runner não reduzirá a proteção para `rejectUnauthorized: false`.

O runner agora aceita `STAGE8A_CA_CERT_PATH`, apontando para o certificado oficial baixado em **Database Settings → SSL Configuration → Download Certificate**. A validação do certificado e do hostname permanece obrigatória.

Alternativamente, o usuário pode executar diretamente no Supabase SQL Editor:

`scripts/stage8a/supabase-sql-editor/01-preflight-readonly.sql`

Somente o JSON sanitizado do preflight, sem senha ou URL, deve retornar para análise.

## Gates preservados

- criação da conta continua bloqueada até análise do preflight;
- nenhuma flexibilização de TLS foi aplicada;
- nenhuma migration foi criada ou executada;
- etapas 8B, 8C, integração real e produção permanecem em NO-GO.
