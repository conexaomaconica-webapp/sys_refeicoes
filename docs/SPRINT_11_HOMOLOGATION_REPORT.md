# Homologação transacional da Sprint 11

**Data:** 19/10/2026  
**Ambiente:** banco remoto de testes  
**Resultado final:** APROVADA — 26/26 verificações  
**Persistência:** nenhuma; transação integralmente revertida.

## Resultado após a migration 50

A migration `20261019000050_fix_import_update_concurrency_and_guard.sql`
corrigiu a comparação temporal e o contexto interno da atualização acadêmica.
A repetição integral da homologação foi aprovada:

- 1.000 linhas no manifesto;
- 980 linhas válidas processadas;
- 20 rejeições isoladas e identificáveis;
- zero falhas de execução entre as linhas válidas;
- reclassificação parcial → integral efetivada com vigência e histórico;
- saldo residual e ledger preservados;
- hash duplicado e confirmação repetida bloqueados;
- cancelamento sem criação de aluno;
- snapshot concorrente obsoleto isolado sem sobrescrita;
- rollback de todas as tabelas conferido;
- zero resíduos `HOMO-S11-*`.

## Cenário principal

Foi criado dentro de uma única transação um lote sintético de 1.000 linhas:

- 980 classificadas como válidas;
- 20 classificadas como inválidas;
- uma das válidas atualizaria um aluno parcial para integral;
- o aluno possuía carteira com saldo residual de R$ 42,50.

O preview registrou corretamente 1.000 linhas, 980 válidas e 20 rejeições. A
confirmação processou as novas inclusões, preservou carteira e ledger e manteve
as rejeições isoladas. A atualização parcial para integral, entretanto, foi
classificada incorretamente como conflito concorrente.

## Falhas da primeira execução diagnóstica

1. O resultado não atingiu 980 processadas sem falha de execução.
2. O manifesto não apresentou 980 linhas processadas.
3. O aluno parcial não foi atualizado para integral.
4. O histórico não atingiu os 980 registros esperados.

Erro persistido na linha de atualização:

```text
Conflito de concorrencia: aluno alterado apos o preview.
```

## Causa

`confirm_and_process_import` compara `updated_at::TEXT` com o valor ISO enviado
pelo cliente Supabase. Os dois valores representam o mesmo instante, mas usam
formatação textual diferente. A RPC interpreta essa diferença de representação
como alteração concorrente.

Também foi identificado um segundo bloqueio no caminho de correção: o trigger
`trg_students_prevent_tampering` rejeita mudanças acadêmicas sempre que
`auth.uid()` não é nulo, inclusive quando a alteração é executada pela RPC
administrativa `SECURITY DEFINER`. A próxima correção deverá permitir somente o
contexto interno controlado da importação, sem liberar UPDATE direto no cliente.

## Verificações aprovadas

- contexto administrativo e categorias válidas;
- preview 1.000/980/20;
- status `completed_with_errors`;
- preservação do saldo residual;
- ledger inalterado;
- bloqueio de hash duplicado;
- bloqueio de confirmação repetida;
- cancelamento e impedimento de confirmar lote cancelado;
- isolamento real de conflito concorrente;
- proteção contra sobrescrita da alteração concorrente;
- contagens restauradas após rollback;
- nenhum aluno ou lote `HOMO-S11-*` residual.

## Correção aplicada

A migration 50 implementou:

1. comparação de timestamps como `TIMESTAMPTZ`, não como texto;
2. contexto interno restrito para a RPC administrativa atualizar dados
   acadêmicos sem enfraquecer o trigger para chamadas diretas;
3. manutenção da validação de usuário, tenant, papel e transição atômica;
4. manutenção de `anon` sem `EXECUTE`.

A migration 50 foi aplicada exclusivamente no banco remoto de testes. A
homologação foi repetida com rollback e aprovada em 26/26. Produção permanece
NO-GO.
