# Etapa 7D.4 — Plano de prontidão para homologação em staging

## 1. Parecer executivo

**GO para revisão do pacote local de prontidão.**

**NO-GO para execução em staging.** O inventário do schema efetivo ainda não foi coletado, a restauração ainda não foi ensaiada e não existe autorização para modificar o ambiente.

**NO-GO para produção, integração com dados reais e indicadores financeiros.** A contenção financeira permanece fail-closed até a homologação da modelagem canônica.

Este documento prepara uma futura homologação reproduzível. Ele não autoriza acesso remoto, aplicação das migrations 72, 73 ou 74, deploy ou alteração de políticas.

## 2. Escopo e evidências já disponíveis

- Etapa 7C.2: 31/31 cenários RLS aprovados em PostgreSQL 17 descartável.
- Etapa 7D.1/7D.2: contratos e RPC operacional preparados localmente.
- Etapa 7D.3: 24/24 testes locais de segurança, concorrência e desempenho com 240 mil consumos sintéticos.
- Migrações em análise:
  - `20261026000072_reconcile_offline_contingency_security.sql`;
  - `20261026000073_harden_scoped_read_policies.sql`;
  - `20261027000074_prepare_operational_intelligence_reads.sql`.

Essas evidências comprovam o baseline sintético, não a compatibilidade com o schema efetivo de staging.

## 3. Inventário e compatibilidade (7D.4.1)

### 3.1 Dependências e superfície de mudança

| Migration | Mudança | Dependências principais | Risco de drift |
| --- | --- | --- | --- |
| 72 | Adiciona colunas e índice à contingência; substitui todas as policies da tabela; revoga duas RPCs legadas | `offline_contingency_events`, `institutions`, `meal_consumptions`, `profiles`, helpers de autenticação e unidade | Alto: remove policies não versionadas; constraint de status pode falhar com valores desconhecidos |
| 73 | Substitui helper de gestão de estudantes e policies de estudantes, financeiro e caixa | perfis, instituições, acessos institucionais/unidade, estudantes, carteiras, pagamentos, recargas, caixas | Alto: policies existentes podem divergir; tabelas financeiras ficam deliberadamente fail-closed para perfis locais |
| 74 | Cria/substitui RPC operacional v1 e concede execução somente a `authenticated` | perfis, unidades, instituições, acessos, consumos e categorias | Médio/alto: assinatura preexistente sem versão registrada é drift; tipos/colunas e status precisam ser idênticos |

Não há índice candidato de desempenho em migration. A decisão da 7D.3 foi preservada porque ele melhorou o p95 concorrente, mas piorou o p95 sequencial.

### 3.2 Mecanismo read-only

O arquivo `scripts/stage7d/staging-inventory-readonly.sql`:

- abre `BEGIN TRANSACTION READ ONLY` e termina com `ROLLBACK`;
- impõe `statement_timeout`, `lock_timeout` e tempo ocioso;
- lê somente catálogos e metadados, sem consultar linhas operacionais;
- registra versão, migrations, relações, colunas, constraints, RLS, policies, funções, ACLs e índices;
- não inclui credenciais nem conteúdo de usuários, refeições ou transações.

Após autorização específica, a captura deverá usar uma identidade dedicada, sem `SUPERUSER` e sem `BYPASSRLS`. O JSON deve ser armazenado como evidência restrita e validado assim:

```powershell
node scripts/validate-stage7d-staging-readiness.cjs --inventory <caminho-do-inventario.json>
```

O validador interrompe diante de migration já registrada, RPC 74 presente sem registro, relação/coluna/função ausente, PostgreSQL incompatível, RLS desabilitada ou sessão privilegiada. A revisão humana ainda é obrigatória para tipos, bodies de funções, policies, proprietários, ACLs, status e índices divergentes.

### 3.3 Gates de compatibilidade

- PostgreSQL major 17 e migrations 72/73/74 ainda não registradas.
- Nenhuma assinatura concorrente ou overload inesperado das funções alteradas.
- Tipos, nulabilidade, defaults, FKs e constraints compatíveis com o contrato local.
- Todos os valores existentes de status aceitos pela constraint da migration 72.
- RLS habilitada nas nove relações sensíveis listadas no contrato.
- Snapshot completo das policies que a 72 e a 73 removerão ou substituirão.
- Proprietário das funções controlado e `search_path` seguro.
- Ausência de grants a `PUBLIC` e `anon` nas RPCs protegidas.
- Reconciliação explícita de cada drift; não corrigir silenciosamente durante a janela.

## 4. Plano de execução controlada (7D.4.2)

### Fase A — autorização e pré-requisitos

1. Obter autorização separada para leitura remota e outra para mudanças em staging.
2. Fixar responsável, janela, canal de incidente e aprovador de continuidade.
3. Congelar alterações concorrentes de schema e registrar o SHA-256 das migrations e runners.
4. Coletar e revisar o inventário read-only.
5. Confirmar que staging não contém dados reais; caso contenha, interromper e tratar privacidade antes de continuar.

### Fase B — backup e ensaio de restauração

1. Confirmar snapshot/PITR suportado pelo ambiente e sua retenção.
2. Gerar backup lógico de schema, policies, funções, grants e histórico de migrations por mecanismo aprovado, sem expor segredos.
3. Restaurar o backup em uma instância isolada e descartável.
4. Validar objetos, checksums lógicos, RLS, owners e grants após a restauração.
5. Registrar duração e responsável. Backup sem restauração comprovada não satisfaz o gate.

### Fase C — ensaio em clone restaurado

1. Aplicar 72, 73 e 74, nessa ordem, com parada no primeiro erro.
2. Definir `lock_timeout` e `statement_timeout` compatíveis com a janela aprovada.
3. Repetir inventário pós-migration e comparar o diff esperado.
4. Executar os 31 cenários RLS e os 24 controles aplicáveis da 7D.3.
5. Validar indicadores contra agregações independentes usando apenas massa sintética.
6. Ensaiar a estratégia de reversão e restauração.

### Fase D — aplicação futura em staging

1. Repetir o preflight imediatamente antes da mudança.
2. Aplicar cada arquivo com `ON_ERROR_STOP`, na ordem 72 → 73 → 74, por executor autorizado.
3. Manter cada migration em transação quando tecnicamente suportado; não ocultar erros com continuação parcial.
4. Após cada migration, validar registro, objetos, grants e RLS antes de avançar.
5. Rodar os testes com tenants e unidades sintéticos exclusivos da homologação.
6. Remover a massa sintética de maneira rastreável e verificar ausência de resíduos.

### Pré-commit

Qualquer erro de SQL, timeout, lock não previsto ou diferença de objeto exige `ROLLBACK` imediato da transação corrente. Nenhuma migration posterior deve ser tentada.

### Pós-commit

Não existe down migration genérica segura:

- a 72 adiciona dados/colunas e converge todas as policies; remover colunas pode destruir informação;
- a 73 substitui regras de autorização, que devem ser restauradas a partir do inventário revisado;
- a 74 pode ser removida somente se não houver consumidor e se uma assinatura anterior tiver sido preservada.

Após commit, priorizar correção forward. Se o impacto impedir operação segura, isolar o ambiente e executar a restauração previamente ensaiada. Toda restauração exige autorização do responsável pelo ambiente e nova homologação integral.

## 5. Critérios de interrupção

Interromper sem exceção se ocorrer qualquer item abaixo:

- backup ou restauração não comprovados;
- drift sem decisão registrada;
- objeto, coluna, constraint, status ou função incompatível;
- RLS desabilitada, grant inesperado ou owner inseguro;
- falha ou vazamento em qualquer teste negativo de tenant, instituição ou unidade;
- resultado diferente de 31/31 nos cenários RLS;
- divergência entre RPC e agregação independente;
- lock/statement timeout, aplicação parcial ou erro no histórico de migrations;
- uso de dado real ou presença de segredo em logs/evidências;
- regressão crítica/alta, p95 acima do SLA aprovado ou uso anormal de temporários;
- indisponibilidade do responsável por rollback/restauração.

## 6. Critérios de homologação (7D.4.3)

### Segurança e isolamento

- 31/31 cenários RLS aprovados no schema efetivo.
- Testes negativos entre tenants, instituições e unidades sem qualquer linha ou agregado vazado.
- Papéis de teste com `rolsuper = false` e `rolbypassrls = false`.
- Supervisor e gerente continuam sem acesso financeiro indireto.
- RPC acessível a `authenticated`, negada a `PUBLIC`/`anon`, com `SECURITY DEFINER` e `search_path` fixo.

### Consistência operacional

Para o período atual e o comparativo, validar por tenant, instituição, unidade e categoria:

- refeições servidas;
- volume por restaurante;
- utilização por categoria;
- comparativos por período.

Os totais da RPC devem ser idênticos aos de consultas independentes sobre a massa sintética, inclusive filtros vazios/inválidos, limites de período, estados cancelados e períodos sem dados.

### Concorrência e desempenho

- Executar carga sequencial e concorrente com clientes independentes por identidade.
- Coletar p50, p95, máximo e `EXPLAIN (ANALYZE, BUFFERS)` sem registrar parâmetros sensíveis.
- Aprovar SLA antes da janela. Como referência local, não como SLA de staging: p95 sequencial ≤ 1.500 ms e concorrente ≤ 2.000 ms.
- Qualquer índice candidato exige análise própria; não será criado implicitamente pela 7D.4.

### Operação e evidências

- Zero falha crítica/alta e zero migração parcial.
- Inventários antes/depois, hashes, logs sanitizados, resultados e responsáveis anexados ao relatório.
- Backup restaurado e limpeza da massa sintética comprovados.
- Lint, typecheck e build do repositório aprovados na entrega local.

## 7. Checklist de decisão (7D.4.4)

| Gate | Estado atual | Evidência necessária |
| --- | --- | --- |
| Pacote local 7D.4 | Aprovado | 24/24 gates locais, regressões e build aprovados |
| Inventário real de staging | Não testado | JSON read-only revisado e sem blockers |
| Drift reconciliado | Pendente | matriz de diferenças aprovada |
| Backup e restauração | Não testado | restauração isolada comprovada |
| Clone com migrations 72/73/74 | Não testado | execução ordenada e diff esperado |
| Segurança no schema efetivo | Não testado | 31/31 RLS |
| Indicadores operacionais | Não testado | totais independentes coincidentes |
| Desempenho em staging | Não testado | SLA aprovado e atingido |
| Modelagem financeira | Bloqueada | decisão canônica homologada |
| Produção | NO-GO | fora do escopo desta etapa |

## 8. Riscos residuais e decisão

- O inventário local não substitui a observação do schema efetivo.
- A migration 72 remove policies desconhecidas por desenho; o snapshot e a revisão são obrigatórios.
- A migration 73 pode alterar acesso operacional/financeiro existente, mesmo quando esse acesso for indevido.
- `CREATE OR REPLACE FUNCTION` não detecta sozinho todos os overloads ou consumidores externos.
- Dados, estatísticas, concorrência e infraestrutura de staging podem produzir resultados diferentes do PostgreSQL descartável.
- A restauração do provedor precisa ser comprovada, não presumida.

Parecer final da 7D.4: **GO apenas para homologação e revisão local do pacote; NO-GO para execução em staging, integração real e produção.** A autorização futura de staging depende de todos os gates pendentes acima, começando por inventário remoto read-only separado da autorização de mudança.

## 9. Validações locais executadas

| Validação | Resultado |
| --- | --- |
| Gates de prontidão 7D.4 | 24/24 aprovados |
| Contratos 7D.1/7D.2 | 36/36 aprovados |
| Preparação de desempenho 7D.3 | 29/29 aprovados |
| Controles estáticos RLS | 31/31 aprovados |
| Regressão da Etapa 6 | 17/17 aprovados |
| ESLint | Aprovado |
| TypeScript | Aprovado |
| Build Next.js | Aprovado; rota da Central de Inteligência permanece estática |

O teste de inventário real aparece deliberadamente como **não testado**, pois a 7D.4 não autorizou acesso remoto. Nenhuma migration foi aplicada e nenhum ambiente externo foi modificado.
