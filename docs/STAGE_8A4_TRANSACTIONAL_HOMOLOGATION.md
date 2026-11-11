# Etapa 8A.4 — Homologação transacional da migration 75

**Data:** 27/10/2026  
**Ambiente:** PostgreSQL 17.11 nativo, local, temporário e descartável  
**Resultado transacional final:** 24/24 controles aprovados

## 1. Parecer

**GO** para encerramento da homologação transacional local da migration 75.

**NO-GO** para aplicação no Supabase, criação da credencial temporária de
auditoria, Etapas 8B/8C, staging, integração real, deploy e produção.

As migrations 72, 73, 74 e 75 foram aplicadas, em sequência, somente em banco
PostgreSQL descartável. Nenhuma migration foi aplicada a banco existente ou
remoto.

## 2. Ambiente e isolamento

- PostgreSQL 17.11 portátil para Windows x86-64;
- artefato EDB com `340719294` bytes;
- SHA-256:
  `6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3`;
- cluster exclusivo `ma-stage8a-<uuid>` em `%TEMP%`;
- banco exclusivo `stage8a_<uuid>`;
- listener restrito a `127.0.0.1:55439`;
- SSL desligado apenas na instância loopback descartável;
- autenticação SCRAM;
- papéis `anon` e `authenticated` sem `SUPERUSER` e sem `BYPASSRLS`;
- dados exclusivamente sintéticos.

## 3. Baseline representativo

O baseline reproduziu as 12 assinaturas observadas no preflight remoto e o
estado vulnerável de `EXECUTE` herdado de `PUBLIC`. As funções de trigger foram
associadas a tabelas sintéticas para provar execução indireta após o hardening.

O baseline não reproduz todo o schema do Supabase nem substitui a reconciliação
do ambiente de destino. Os corpos das RPCs legadas são stubs porque elas devem
ficar inacessíveis. A RPC ativa `get_terminal_shift_reports(uuid,uuid,text)`
reproduz autorização por tenant/unidade para os testes positivo e negativo.

## 4. Resultados

| Domínio | Resultado |
| --- | ---: |
| isolamento do PostgreSQL descartável | 4/4 |
| papéis e fidelidade das assinaturas | 3/3 |
| compilação e rollback das migrations 72–75 | 2/2 |
| ACLs após migration 75 | 4/4 |
| RPC ativa e isolamento por unidade | 2/2 |
| funcionamento de triggers | 7/7 |
| idempotência e pós-condição final | 2/2 |
| **Total** | **24/24** |

Foram comprovados:

1. remoção de `EXECUTE` de `PUBLIC` nas 12 funções;
2. bloqueio de `authenticated` nas quatro RPCs legadas;
3. preservação exclusiva de `authenticated` na RPC ativa de relatórios;
4. bloqueio de acesso cruzado a unidade não autorizada;
5. funcionamento dos triggers mesmo sem chamada direta pelos papéis da aplicação;
6. restauração integral dos ACLs após `ROLLBACK` da primeira aplicação;
7. segunda aplicação da migration 75 sem alteração adicional dos ACLs;
8. manutenção da pós-condição depois da reaplicação.

## 5. Ocorrências durante a homologação

Três problemas de infraestrutura/runner foram encontrados e corrigidos antes do
resultado conclusivo:

1. `Expand-Archive` excedeu o tempo e deixou uma extração incompleta; `initdb`
   recusou iniciar pela ausência de `postgres.bki`.
2. A carga sintética usava múltiplos comandos em uma consulta preparada; as
   inserções parametrizadas foram separadas.
3. `inet_server_addr()::text` retornou `127.0.0.1/32`; a validação passou a usar
   `host(inet_server_addr())` e também `listen_addresses`, preservando o gate de
   loopback.

Nenhuma dessas ocorrências alterou a migration 75. As tentativas foram encerradas
sem processo ou listener residual.

## 6. Evidências e descarte

- evidência conclusiva:
  `docs/evidence/stage8a/stage8a-hardening-20261027-112728.json`;
- log conclusivo:
  `docs/evidence/stage8a/stage8a-hardening-20261027-112728.log`;
- SHA-256 da evidência JSON:
  `821FCC27DB24E46CA92A8527814AA2979A61BC8104B7E88F6FA64BC6366CF077`;
- processos PostgreSQL residuais: `0`;
- listeners na porta 55439: `0`;
- clusters `ma-stage8a-*` residuais: `0`;
- ZIP e distribuição portátil: removidos;
- espaço livre final observado no volume C: `2,78 GiB`.

O primeiro JSON preservado registra a tentativa 23/24 anterior à normalização do
endereço CIDR. O arquivo com timestamp `112728` é a evidência conclusiva.

## 7. Arquivos criados ou modificados

- `scripts/stage8a/function-hardening-baseline.sql`;
- `scripts/homologate-stage8a-function-hardening.cjs`;
- `scripts/stage8a/run-native-hardening.ps1`;
- `scripts/validate-stage8a-transactional.cjs`;
- `package.json`;
- este relatório e as evidências em `docs/evidence/stage8a/`.

A migration `supabase/migrations/20261027000075_harden_public_function_execution.sql`
foi executada sem modificação de seu conteúdo.

## 8. Riscos e próximos gates

1. O baseline sintético não prova compatibilidade com o schema completo do
   Supabase nem com o drift remoto.
2. A RPC `get_terminal_shift_reports` ainda exige revisão no schema efetivo,
   inclusive `SECURITY DEFINER`, `search_path` e dependências reais.
3. As RPCs legadas devem ser confrontadas com telemetria e fluxos operacionais
   antes de aplicação remota.
4. A conta temporária de auditoria permanece bloqueada até autorização e plano
   remoto específicos.
5. A aplicação da migration 75 no Supabase requer autorização independente,
   snapshot prévio de ACLs, plano de rollback e janela controlada.

## 9. Validação final do repositório

| Verificação | Resultado |
| --- | ---: |
| homologação transacional PostgreSQL 17.11 | 24/24 |
| controles estáticos do runner 8A.4 | 16/16 |
| hardening 8A.3 | 20/20 |
| preparação da credencial 8A.1 | 33/33 |
| runner de auditoria read-only 8A | 18/18 |
| regressão estática RLS | 31/31 |
| regressão arquitetural da Etapa 6 | 17/17 |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado; 24/24 páginas geradas |

O build manteve apenas o aviso preexistente de que o plugin Next.js não foi
detectado na configuração ESLint.

## 10. Status consolidado

| Frente | Situação |
| --- | --- |
| Etapa 8A.3 — preparação local | concluída |
| Etapa 8A.4 — homologação PostgreSQL local | concluída — 24/24 |
| Migration 75 no Supabase | não aplicada |
| Credencial temporária de auditoria | bloqueada |
| Etapas 8B e 8C | NO-GO |
| Integração real e produção | NO-GO |
