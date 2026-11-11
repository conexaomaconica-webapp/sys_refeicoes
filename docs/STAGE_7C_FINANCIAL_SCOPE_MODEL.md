# Proposta de modelagem canônica do escopo financeiro

**Etapa:** 7C — preparação local

**Natureza:** proposta arquitetural; nenhuma migration desta modelagem foi criada
ou aplicada

## 1. Decisão central

O domínio precisa separar dois conceitos que não são equivalentes:

1. **elegibilidade operacional:** em quais unidades um comensal pode ser atendido
   durante determinado período;
2. **origem financeira:** em qual unidade uma cobrança, recarga, débito ou
   recebimento foi originado.

A carteira não deve pertencer a uma unidade. Ela representa saldo em custódia do
comensal dentro do tenant e pode ser utilizada em mais de uma unidade autorizada.
Associar `wallets` diretamente a uma unidade dividiria artificialmente o saldo,
criaria problemas de transferência e confundiria custódia com resultado da
operação.

## 2. Modelo proposto

```text
tenant
└── institution
    ├── student/comensal
    │   ├── student_unit_assignments (vigência operacional)
    │   └── wallet (única no tenant)
    │       └── wallet_transactions (origem financeira imutável)
    └── unit
        ├── meal_consumptions
        ├── cash_shifts / cash_movements
        ├── payments (origem opcional)
        └── recharges (origem opcional)
```

### 2.1 `student_unit_assignments`

Nova relação temporal proposta:

| Campo | Regra |
| --- | --- |
| `id` | UUID imutável |
| `tenant_id` | obrigatório |
| `institution_id` | obrigatório e igual em estudante/unidade |
| `student_id` | comensal cadastrado na instituição |
| `unit_id` | unidade operacional autorizada |
| `valid_from` | início da vigência |
| `valid_to` | nulo enquanto vigente |
| `is_primary` | unidade principal para apresentação, não para custódia |
| `source` | `import`, `manual` ou `integration` |
| `created_by`, `created_at` | auditoria obrigatória |

Regras:

- estudante e unidade devem pertencer ao mesmo tenant e instituição;
- um estudante pode possuir múltiplas unidades vigentes;
- no máximo uma atribuição primária vigente;
- períodos do mesmo estudante/unidade não podem se sobrepor;
- encerramento cria vigência histórica; não apaga registros;
- `imports.unit_id` pode sugerir a atribuição inicial, mas não é, sozinho, fonte
  permanente de autorização.

### 2.2 Carteira

`wallets` permanece com cardinalidade `1:1` por estudante no tenant:

```text
wallet -> tenant + student
```

Não adicionar `unit_id` à carteira. Supervisor e gerente não devem consultar a
tabela bruta. Quando a necessidade funcional for aprovada, devem consumir uma
projeção/RPC read-only por unidade, com o menor conjunto de campos necessário.

### 2.3 Origem das transações

Campos propostos para eventos que ainda não registram origem completa:

```text
institution_id uuid nullable
unit_id uuid nullable
origin_kind text not null
```

`origin_kind` diferencia:

- `unit`: operação iniciada em unidade identificada;
- `self_service`: recarga iniciada pelo próprio consumidor, sem unidade;
- `central`: ajuste ou operação financeira central;
- `system`: compensação automática ou integração.

Quando `origin_kind = 'unit'`, `institution_id` e `unit_id` são obrigatórios e a
FK composta deve garantir que a unidade pertence à instituição e ao tenant.
Nos demais casos, ambos devem ser nulos, evitando a atribuição fictícia de uma
operação central ou digital a um estabelecimento.

Aplicação por entidade:

| Entidade | Tratamento proposto |
| --- | --- |
| `payments` | adicionar origem; cobrança self-service pode ficar sem unidade |
| `recharges` | formalizar o `unit_id` existente como origem e adicionar instituição/origin kind |
| `wallet_transactions` | registrar snapshot da origem; débito herda consumo, crédito herda recarga |
| `meal_consumptions` | já possui unidade e instituição; permanece fonte do débito da refeição |
| `cash_movements` | origem continua sendo o turno de caixa, que já possui unidade |

Depois da confirmação, a origem financeira é imutável. Estorno ou correção deve
gerar novo evento compensatório, nunca reatribuir o evento original.

## 3. Regras de propagação

| Fluxo | Origem canônica |
| --- | --- |
| Débito de refeição | `meal_consumptions.institution_id/unit_id` |
| Recarga presencial | unidade do operador/turno autorizado |
| Recarga self-service | sem unidade; `origin_kind = self_service` |
| Pagamento de gateway | origem da solicitação que criou a cobrança |
| Ajuste financeiro central | sem unidade; `origin_kind = central` |
| Reversão | mesma origem do evento revertido |

As RPCs transacionais devem validar a atribuição vigente do estudante quando o
fluxo exigir elegibilidade na unidade. A validação temporal não deve ser
implementada apenas em RLS ou frontend.

## 4. Estratégia de acesso

### Perfis globais

`admin_general`, `operations_director` e `finance` continuam limitados ao tenant.

### Supervisor e gerente

Após homologação da modelagem, podem consultar somente:

- estudantes com atribuição vigente em uma unidade autorizada;
- eventos financeiros cujo `unit_id` esteja em `user_unit_access`;
- projeções agregadas da unidade;
- eventual situação mínima da carteira necessária à operação, por RPC
  específica e sem acesso cru à tabela.

Não podem consultar:

- eventos `self_service`, `central` ou `system` sem unidade;
- saldo em custódia global do tenant;
- histórico originado em outra unidade;
- credenciais, payloads brutos de gateway ou conciliação global.

### Instituição e consumidor

- `institution_user` mantém acesso acadêmico aos próprios comensais, mas não
  recebe dados financeiros internos por esta proposta;
- consumidor mantém acesso apenas à própria carteira e às próprias transações,
  independentemente da unidade de origem.

## 5. Consultas gerenciais

Indicadores por unidade devem usar eventos com origem, nunca ratear o saldo da
carteira:

- valor facial: `meal_consumptions.unit_id`;
- recargas da unidade: `recharges.unit_id` confirmadas;
- recebimentos de balcão: unidade do `cash_shift`;
- débito de carteira por unidade: `wallet_transactions.unit_id` do consumo;
- saldo em custódia: métrica global do tenant, sem soma por unidade;
- recargas self-service: grupo separado, sem unidade.

Isso preserva a separação já homologada entre valor facial, recargas, caixa e
saldo em custódia.

## 6. Migração futura sugerida

Uma futura etapa, ainda não autorizada, deve ser dividida:

1. criar a relação de atribuições e os campos de origem como opcionais;
2. preencher somente origens comprováveis por FK/referência existente;
3. classificar os registros restantes como central/self-service, sem fabricar
   unidade;
4. atualizar RPCs para gravar a origem de novos eventos;
5. criar índices e policies read-only por unidade;
6. executar reconciliação contábil e os cenários RLS;
7. somente depois substituir a contenção fail-closed.

Não se recomenda tornar `unit_id` obrigatório em todas as transações, pois
operações digitais e centrais legitimamente não pertencem a uma unidade.

## 7. Decisões ainda necessárias

1. Supervisor/gerente podem visualizar o saldo total da carteira de um estudante
   atribuído à unidade ou apenas status/limite operacional?
2. Um comensal pode ter múltiplas unidades simultâneas ou apenas uma principal?
3. Quem pode criar/encerrar atribuições e com qual vigência retroativa?
4. Recarga presencial exige turno de caixa ou pode existir operação administrativa
   sem caixa?
5. Como classificar pagamentos antigos cuja origem não seja comprovável?
6. Relatórios institucionais poderão conter valores financeiros agregados?

Até essas decisões serem homologadas, as policies financeiras das migrations 72
e 73 permanecem fail-closed para supervisor e gerente.

