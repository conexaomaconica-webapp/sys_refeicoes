# Sprint 11 — Implementação e homologação

**Data:** 19/10/2026  
**Estado:** implementação concluída; homologações transacional e E2E aprovadas no banco remoto de testes.

## Arquitetura

A rota server-rendered `/admin/importacoes` concentra upload, preview, filtros,
confirmação parcial, histórico de lotes e download de rejeições. O arquivo
original é gravado no bucket privado `import-files` somente no servidor, após
validação da sessão, papel e tenant. O navegador nunca recebe a service role.

O fluxo persiste primeiro um manifesto em `imports`/`import_rows` e somente a
confirmação executa as linhas válidas. Cada linha possui subtransação própria;
uma rejeição não reverte as demais. XLSX e CSV são gerados no servidor e
neutralizam formula injection.

## Banco de dados

- Migration 48: completa o fluxo de importação parcial, vigência e histórico.
- Migration 49: restringe a execução das RPCs ao papel autenticado.
- Migration 50: corrige concorrência temporal e o contexto da atualização interna.
- Migration 51: reconcilia de forma idempotente o bucket privado `import-files`.

As migrations 48 a 51 estão sincronizadas no banco remoto de testes. O bucket
possui limite de 10 MB, MIME types restritos e `public = false`. O RLS de
`storage.objects` está ativo.

A confirmação não escreve em `wallets` nem em `wallet_transactions`. Mudanças
de categoria registram valor anterior, novo, vigência, lote, linha e autor.

## Segurança e permissões

Somente `admin_general` e `operations_director` ativos podem criar, confirmar,
cancelar e consultar lotes. Escritas usam RPCs `SECURITY DEFINER` com
`search_path` vazio e isolamento por tenant. A service role é restrita ao
módulo server-only que grava o arquivo privado, depois da autorização do usuário.

## Evidências

- homologação transacional remota com rollback: 26/26;
- homologação E2E remota: 5/5;
- cenário E2E: 8 processados, 2 rejeitados e 0 falhas;
- limpeza pós-E2E: zero resíduos no banco e no bucket;
- lint e typecheck finais: aprovados;
- validação da Sprint 4: 52/52;
- validação estrutural da Sprint 11: 28/28;
- estabilização pós-Sprint 10: 20/20;
- build Next.js final: compilação e geração de 11/11 páginas aprovadas; o comando
  excedeu 10 minutos durante `Collecting build traces`, mantendo registrada a
  lentidão de tracing já conhecida;
- build Next.js completo anterior: aprovado, 11/11 rotas.

## Pendências

1. Validar o pipeline real do provedor escolhido.
2. Registrar decisão formal antes de qualquer implantação em produção.

Produção permanece NO-GO. Nenhuma operação produtiva foi executada ou
autorizada.
