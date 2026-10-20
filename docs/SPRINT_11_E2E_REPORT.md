# Homologação E2E da Sprint 11

**Data:** 19/10/2026  
**Ambiente:** aplicação Next.js local conectada ao Supabase remoto de testes  
**Resultado:** APROVADA

## Correção estrutural autorizada

A migration aditiva e idempotente
`20261019000051_reconcile_import_files_bucket.sql` foi criada e aplicada
exclusivamente no banco remoto de testes. Ela reconciliou o bucket
`import-files` com as seguintes propriedades:

- acesso privado (`public = false`);
- limite de 10 MB;
- formatos XLSX, CSV e texto permitidos;
- nenhuma policy de acesso direto criada para o cliente.

A primeira tentativa de aplicação foi rejeitada porque o papel de migrations
não é proprietário da tabela interna `storage.objects`. A tentativa sofreu
rollback integral e não foi registrada. A instrução redundante de `ALTER TABLE`
foi removida da mesma migration 51 ainda pendente; a reaplicação foi concluída.
A auditoria confirmou que o RLS de `storage.objects` já permanece ativo.

## Escopo executado

- criação de administrador temporário no Supabase Auth;
- login real pelo Microsoft Edge headless;
- autorização e abertura de `/admin/importacoes`;
- upload de CSV 100% sintético pelo Server Action real;
- preview com 8 linhas válidas e 2 inválidas;
- download autenticado dos relatórios de rejeições em XLSX e CSV;
- confirmação das linhas válidas pela interface;
- verificação independente dos dados persistidos;
- limpeza controlada no bloco `finally`.

## Resultados

- navegador: 5/5 verificações aprovadas;
- alunos sintéticos processados: 8;
- linhas processadas: 8;
- linhas rejeitadas e identificáveis: 2;
- lotes criados: 1;
- falhas de processamento: 0;
- objetos remanescentes em `import-files`: 0;
- resíduos de alunos, lote, perfil e usuário da fixture: 0.

## Conclusão

O fluxo E2E da Importação Parcial foi aprovado no ambiente remoto de testes. A
homologação comprovou autenticação, autorização, Storage privado, preview,
relatórios, confirmação parcial, persistência e limpeza.

Esta aprovação não autoriza publicação nem alteração em produção. Produção
permanece NO-GO até a validação do pipeline real e uma decisão formal de
implantação.
