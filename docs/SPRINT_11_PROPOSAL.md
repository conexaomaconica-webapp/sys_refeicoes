# Proposta da Sprint 11 — Importação Parcial Tolerante

**Status:** implementação local concluída; migration 48 e homologação remota pendentes.  
**Dependência:** Estabilização Pós-Sprint 10 homologada em banco remoto de
testes (39/39 validações).

## Objetivo

Completar a experiência administrativa da importação acadêmica para permitir
que linhas válidas sejam processadas mesmo quando o arquivo contém erros,
preservando rastreabilidade, histórico e saldos existentes.

## Base já disponível da Sprint 4

- parser server-only para XLSX e CSV;
- limites de 10 MB, 10.000 linhas, 5 abas e 100.000 células;
- preservação de zeros à esquerda na matrícula;
- validação e classificação em `insert`, `update`, `ignore`, `error` e
  `reclassify_partial`;
- tabelas `imports` e `import_rows` com manifesto linha a linha;
- RLS forçada e escrita somente por RPCs `SECURITY DEFINER`;
- idempotência por hash do arquivo;
- processamento parcial com subtransação por linha;
- snapshots anterior/posterior e detecção de concorrência;
- bucket privado `import-files`;
- relatório CSV de erros protegido contra formula injection;
- suíte existente aprovada em 52/52 validações.

## Lacunas que a Sprint 11 deve fechar

1. Criar a rota administrativa `/admin/importacoes` com upload, modo de
   importação, instituição e confirmação explícita.
2. Exibir preview com total, inclusões, atualizações, ignoradas,
   reclassificações e inválidas.
3. Permitir filtrar e inspecionar erros e avisos por linha antes da confirmação.
4. Exibir a ação explícita: “Importar N linhas válidas e isolar M
   inconsistentes”.
5. Gerar manifesto de rejeições em XLSX, preservando as colunas originais e
   acrescentando `motivo_rejeicao` e `linha_original`.
6. Manter CSV como formato alternativo seguro.
7. Corrigir o status final para `completed_with_errors` quando existirem erros
   de validação no preview, mesmo que nenhuma linha válida falhe na execução.
8. Registrar no lote as contagens finais de processadas, falhas e ignoradas.
9. Preservar a carteira e o saldo residual quando o aluno mudar de parcial para
   integral; a importação não pode criar, zerar ou excluir carteira.
10. Registrar a vigência e a trilha da mudança de categoria, evitando que uma
    nova lista altere retroativamente consumos antigos.
11. Implementar estados de loading, erro, confirmação e resultado acessíveis.
12. Adicionar testes de autorização, concorrência e isolamento por tenant e
    instituição.

## Escopo de banco proposto

Criar somente migrations aditivas, após revisão do esquema remoto:

- histórico de categoria/vigência do aluno, caso ainda não exista estrutura
  equivalente;
- campos de totais finais no lote apenas se os campos atuais forem
  insuficientes;
- ajuste da RPC `confirm_and_process_import` para refletir erros prévios no
  status final e retornar resumo determinístico;
- auditoria da confirmação e da reclassificação.

Não alterar nem apagar transações de carteira. Não desabilitar RLS. Funções
`SECURITY DEFINER` devem validar `auth.uid()`, tenant, perfil ativo e
instituição.

## Perfis e autorização

Manter nesta sprint os perfis já implementados:

- `admin_general`;
- `operations_director`.

Não liberar importação para `institution_user`, gerente, supervisor ou operador
sem decisão formal na matriz de permissões.

## Fases propostas

### 11.1 — Contrato e validação

- consolidar cabeçalhos aceitos e template de exemplo;
- definir códigos de erro estáveis, em vez de depender apenas de mensagens;
- cobrir duplicidade no arquivo, categoria inexistente, matrícula vazia,
  status inválido e conflito concorrente.

### 11.2 — Preview administrativo

- upload seguro;
- cards de totais;
- tabela virtualizada/paginada;
- filtros por ação, erro e aviso;
- confirmação com resumo inequívoco.

### 11.3 — Processamento parcial e histórico

- processar somente linhas válidas;
- isolar falhas por linha;
- preservar saldo e histórico;
- garantir idempotência e transição única de `preview` para `processing`.

### 11.4 — Manifesto e homologação

- exportar XLSX e CSV de rejeições;
- proteger células contra formula injection;
- testar arquivo de 1.000 linhas com 20 erros;
- comprovar 980 processadas, 20 isoladas e nenhuma duplicação/perda histórica.

## Critérios de aceite

- arquivo com 1.000 linhas e 20 erros processa exatamente 980 válidas;
- preview e resultado exibem contagens coerentes com `import_rows`;
- rejeições são exportadas em XLSX com dados originais, linha e motivo;
- reenvio do mesmo arquivo é bloqueado, salvo ação explícita autorizada;
- falha de uma linha não reverte linhas válidas nem fica silenciosa;
- mudança parcial -> integral preserva integralmente wallet e ledger;
- consumos históricos mantêm categoria e valores registrados à época;
- nenhum acesso cru de escrita pelo navegador às tabelas de importação;
- testes de RLS, tenant, instituição e perfis passam;
- lint, typecheck, suíte dedicada e build de produção passam.

## Fora do escopo

- importação por `institution_user`;
- integração automática com sistemas acadêmicos externos;
- importação offline;
- configurações gerais em `/admin/configuracoes`;
- alterações em pagamentos, caixa ou terminal.

## Implementação local — 2026-10-19

- rota `/admin/importacoes` com upload, vigência, modos geral e lista oficial;
- preview filtrável com inclusões, atualizações, reclassificações, ignoradas e inválidas;
- confirmação explícita do processamento parcial;
- manifesto XLSX/CSV com colunas originais, `motivo_rejeicao` e `linha_original`;
- histórico recente dos lotes;
- migration aditiva `20261019000048_complete_partial_import_workflow.sql`;
- histórico de categoria com data de vigência e RLS forçado;
- totais finais e correção de `completed_with_errors`;
- carteira e ledger permanecem fora das operações SQL da importação;
- validação autônoma da Sprint 11 aprovada em 18/18 verificações.
- lint e typecheck aprovados;
- build de produção aprovado com 11/11 rotas em 19/10/2026.

A migration 48 foi somente criada no repositório. Sua aplicação no banco remoto
e a homologação transacional exigem autorização específica e continuam
pendentes. Isso não autoriza implantação em produção.
