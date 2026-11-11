# Etapa 9B — Plano de backup, restauração e recuperação

**Data da análise:** 27/10/2026  
**Escopo:** planejamento local; nenhum backup ou restore remoto executado  
**Parecer:** **GO para o plano; NO-GO operacional até comprovar restauração**

## 1. Objetivos de recuperação propostos

| Domínio | RPO proposto | RTO proposto | Mecanismo principal |
| --- | ---: | ---: | --- |
| banco transacional e Auth | até 15 minutos | até 4 horas | PITR Supabase + restore validado |
| aplicação Next.js | zero transações de banco | até 30 minutos | Git, artefato imutável e rollback de deployment |
| Supabase Storage | até 24 horas | até 8 horas | cópia independente diária e versionada |
| configurações externas | após cada mudança, máximo 24 horas | até 4 horas | inventário cifrado e checklist de reconfiguração |

Sem PITR, o backup diário do Supabase implica RPO potencial próximo de 24 horas.
Isso é incompatível com o objetivo proposto para refeições e movimentos
financeiros. Os números acima são metas e só se tornam compromisso depois de um
teste cronometrado com volume representativo.

## 2. Escopo que precisa ser protegido

1. PostgreSQL: schema, migrations, dados, RLS, funções, grants e histórico.
2. Supabase Auth: usuários e registros de autenticação.
3. Storage: `student-photos`, `import-files` e `tenant-branding`.
4. Configuração Supabase: Auth, URLs de callback, templates de e-mail, Realtime,
   extensões, restrições de rede e chaves que precisem ser recriadas.
5. Aplicação: Git, lockfile, configuração de build e inventário de variáveis.
6. Integrações: provedores de pagamento, webhooks, DNS e domínio.

Backups físicos do banco Supabase não incluem os objetos do Storage. Eles
preservam apenas metadados das tabelas `storage.*`; portanto, os arquivos exigem
uma cópia separada.

## 3. Estratégia em camadas

### Camada A — proteção nativa do banco

- plano Supabase pago com backups físicos;
- PITR de 7 dias antes do início da operação oficial;
- alerta se o ponto de recuperação mais recente estiver atrasado;
- restore preferencial para novo projeto, evitando sobrescrever o único projeto
  durante o primeiro diagnóstico;
- registrar duração, indisponibilidade e todos os passos de reconfiguração.

### Camada B — exportação lógica independente

- exportação noturna cifrada do schema e dados de negócio;
- exportação separada de roles quando aplicável;
- armazenamento fora da organização/projeto Supabase de origem;
- checksum, tamanho, data, versão PostgreSQL e migration head no manifesto;
- teste automatizado de legibilidade e restauração futura em PostgreSQL isolado.

O `supabase db dump` padrão exclui schemas gerenciados como `auth` e `storage` e
não inclui dados ou roles sem flags específicas. Por isso, a exportação lógica
é uma camada complementar, não substituta do backup físico/PITR.

### Camada C — Supabase Storage

- habilitar acesso S3 compatível somente para a rotina de backup autorizada;
- sincronização diária dos três buckets para armazenamento independente;
- versionamento e criptografia no destino;
- manifesto por objeto com bucket, chave, tamanho, ETag/checksum e data;
- nunca tornar `student-photos` ou `import-files` públicos;
- testar restauração de amostra e restauração integral em ambiente isolado.

### Camada D — aplicação e configuração

- Git como fonte do código e migrations;
- deployments imutáveis para rollback da aplicação;
- inventário de nomes de variáveis, sem seus valores;
- valores secretos em cofre do provedor, com rotação após desastre;
- checklist versionado de Auth, Storage, Realtime, DNS e webhooks.

## 4. Retenção proposta

Política inicial, sujeita à aprovação jurídica, contábil e LGPD:

| Cópia | Retenção |
| --- | --- |
| PITR | 7 dias |
| exportações lógicas diárias | 14 dias |
| cópias semanais | 8 semanas |
| cópias mensais | 12 meses |
| Storage versionado | 30 dias online; arquivo posterior conforme política aprovada |
| evidências de restore | 12 meses |

Registros financeiros e de auditoria não devem ser apagados apenas porque a
cópia operacional expirou. A retenção legal definitiva precisa ser aprovada por
responsável jurídico/contábil antes do GO.

## 5. Procedimento futuro de restauração

1. Declarar incidente, horário provável e responsável.
2. Bloquear novas escritas ou colocar a aplicação em manutenção.
3. Preservar logs e identificar o último ponto confiável.
4. Criar projeto isolado de recuperação na mesma região.
5. Restaurar backup físico/PITR no novo projeto.
6. Impedir que cron jobs, webhooks ou extensões externas executem efeitos antes
   da revisão; restores binários podem reativá-los automaticamente.
7. Restaurar arquivos do Storage e suas configurações.
8. Reconfigurar Auth, chaves, Realtime, extensões, rede e callbacks.
9. Validar migrations 1–75, RLS, grants, contagens e checksums.
10. Executar os 31 cenários RLS e os smokes críticos da Etapa 9D.
11. Rotacionar segredos potencialmente expostos.
12. Alterar as variáveis da aplicação, promover deployment e executar health
    checks antes de reabrir o tráfego.
13. Registrar RPO/RTO reais, divergências e decisão de encerramento.

Rollback da aplicação e recuperação do banco são procedimentos independentes.
Uma versão antiga da aplicação não deve ser promovida se for incompatível com o
schema atual.

## 6. Plano de testes futuros

| Teste | Periodicidade proposta | Critério |
| --- | --- | --- |
| restore completo antes do piloto | obrigatório uma vez | RPO/RTO medidos e todos os gates aprovados |
| restore do banco para novo projeto | trimestral | aplicação conecta e 31 cenários RLS passam |
| restore de amostra do Storage | mensal | checksum e autorização preservados |
| restore integral do Storage | semestral | todos os objetos e manifests reconciliados |
| rollback da aplicação | a cada mudança do pipeline | versão anterior volta em até 30 minutos |
| simulação de indisponibilidade de internet | antes do piloto e semestral | terminal permanece fail-closed e recupera após reconexão |

Cada teste que criar projeto, compute, bucket ou tráfego pago exige autorização
financeira e técnica separada. Dados reais não devem ser copiados para ambiente
de teste sem proteção, minimização e base legal.

## 7. Contingência operacional

- link principal e link 4G/5G de backup na unidade piloto;
- terminal exibe indisponibilidade e nunca confirma operação offline;
- caixa e atendimento seguem o procedimento manual aprovado pela operação,
  sem posterior inserção automática não auditada;
- contatos de incidente, escalonamento e comunicação devem existir fora do
  sistema hospedado;
- credenciais de emergência devem usar MFA, cofre e auditoria.

## 8. Gates para encerrar a recuperação

- backup físico/PITR disponível e dentro do RPO;
- cópia independente do Storage confirmada;
- restore cronometrado em ambiente isolado;
- Auth, RLS, funções, grants e migrations reconciliados;
- 31 cenários de segurança aprovados;
- fluxos de login, terminal, pagamentos e relatórios aprovados;
- segredos rotacionados e logs preservados;
- aprovação formal do responsável técnico e operacional.

## 9. Fontes oficiais consultadas

- Backups Supabase: https://supabase.com/docs/guides/platform/backups
- Restore para novo projeto: https://supabase.com/docs/guides/platform/clone-project
- CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-inspect-db-role-configs
- Download de objetos Storage: https://supabase.com/docs/guides/storage/management/download-objects
- Rollback Vercel: https://vercel.com/docs/instant-rollback

