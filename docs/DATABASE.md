# DATABASE.md
## Modelo de Dados — Sistema de Controle de Refeições
**Versão:** 1.0  
**Status:** Modelagem inicial para implementação  
**Stack:** Supabase + PostgreSQL  
**Documentos relacionados:**  
- `SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md`
- `PERMISSIONS_v1_2.md`
- `FLOWS_v1_1.md`
- `MVP.md`
- `ARCHITECTURE.md`

---

# 1. Objetivo

Este documento define o modelo de dados inicial do sistema.

Deve orientar:

- criação das migrations;
- relacionamentos;
- constraints;
- índices;
- Row Level Security;
- funções transacionais;
- auditoria;
- relatórios;
- integração com pagamentos.

O modelo deve priorizar:

- consistência;
- segurança;
- rastreabilidade;
- multi-tenant;
- performance;
- capacidade de evolução.

---

# 2. Princípios do banco

1. Todas as entidades principais devem respeitar `tenant_id`.
2. Movimentações financeiras não devem ser excluídas.
3. Consumo de refeição e débito devem ser transacionais.
4. Não permitir saldo negativo.
5. Não permitir consumo duplicado por aluno + data + tipo de refeição.
6. Histórico deve ser preservado.
7. Alterações de preço não podem alterar consumos antigos.
8. Regras devem ser normalizadas.
9. RLS obrigatória em tabelas sensíveis.
10. Migrations devem ser pequenas, versionadas e ordenadas.

---

# 3. Extensões recomendadas

```sql
pgcrypto
```

Opcionalmente:

```sql
uuid-ossp
```

Preferir:

```sql
gen_random_uuid()
```

---

# 4. Enums sugeridos

Os nomes podem ser refinados antes da implementação.

## user_role

```text
admin_general
operations_director
finance
supervisor
unit_manager
operator
institution_user
student
```

## student_status

```text
active
suspended
cancelled
graduated
inactive
```

## student_category_code

```text
partial
integral
```

## meal_type_code

```text
breakfast
lunch
dinner
```

## wallet_transaction_type

```text
recharge
meal_debit
refund
reversal
manual_adjustment
```

## payment_status

```text
pending
confirmed
failed
cancelled
refunded
```

## recharge_status

```text
pending
confirmed
failed
reversed
```

## consumption_status

```text
approved
blocked
reversed
```

## import_status

```text
pending
processing
completed
completed_with_errors
failed
```

---

# 5. tenants

Representa cada empresa cliente da plataforma.

```text
id uuid PK
name text
slug text unique
legal_name text nullable
document text nullable
status text
created_at timestamptz
updated_at timestamptz
```

Índices:

```text
unique(slug)
```

---

# 6. tenant_branding

Configuração visual do tenant.

```text
id uuid PK
tenant_id uuid FK tenants
app_name text
logo_url text nullable
splash_background text nullable
splash_animation_type text nullable
splash_duration_ms integer nullable
primary_color text nullable
secondary_color text nullable
report_logo_url text nullable
report_header_text text nullable
report_footer_text text nullable
created_at timestamptz
updated_at timestamptz
```

Constraint:

```text
unique(tenant_id)
```

---

# 7. institutions

Universidades/faculdades atendidas.

```text
id uuid PK
tenant_id uuid FK tenants
name text
short_name text nullable
document text nullable
status text
created_at timestamptz
updated_at timestamptz
```

Índice:

```text
(tenant_id, name)
```

---

# 8. units

Restaurantes/unidades operacionais.

```text
id uuid PK
tenant_id uuid FK tenants
institution_id uuid FK institutions
name text
city text
state text
status text
timezone text default 'America/Bahia'
created_at timestamptz
updated_at timestamptz
```

Índices:

```text
(tenant_id, institution_id)
(tenant_id, status)
```

---

# 9. profiles

Perfil relacionado a `auth.users`.

```text
id uuid PK references auth.users(id)
tenant_id uuid FK tenants
full_name text
email text nullable
phone text nullable
role user_role
institution_id uuid nullable
status text
created_at timestamptz
updated_at timestamptz
```

Observação:

- `id` deve ser o mesmo UUID de `auth.users.id`.

---

# 10. user_unit_access

Permite acesso a múltiplas unidades.

```text
id uuid PK
tenant_id uuid FK tenants
user_id uuid FK profiles
unit_id uuid FK units
created_at timestamptz
```

Constraint:

```text
unique(user_id, unit_id)
```

---

# 11. student_categories

Categorias funcionais dos alunos.

```text
id uuid PK
tenant_id uuid FK tenants
code student_category_code
name text
description text nullable
requires_wallet boolean
status text
created_at timestamptz
updated_at timestamptz
```

Registros iniciais:

```text
partial
integral
```

Regras:

```text
partial.requires_wallet = true
integral.requires_wallet = false
```

---

# 12. students

Cadastro principal do aluno.

```text
id uuid PK
tenant_id uuid FK tenants
institution_id uuid FK institutions
user_id uuid nullable references auth.users(id)
category_id uuid FK student_categories
registration_number text
full_name text
course text nullable
email text nullable
phone text nullable
photo_url text nullable
status student_status
created_at timestamptz
updated_at timestamptz
```

Constraint crítica:

```text
unique(institution_id, registration_number)
```

Observações:

- foto é opcional;
- validação ocorre pela matrícula;
- `user_id` pode ser nulo antes da ativação do PWA.

Índices:

```text
(tenant_id, institution_id)
(institution_id, registration_number)
(category_id)
(status)
```

---

# 13. meal_types

Tipos de refeição.

```text
id uuid PK
tenant_id uuid FK tenants
code meal_type_code
name text
status text
created_at timestamptz
updated_at timestamptz
```

Registros iniciais:

```text
breakfast
lunch
dinner
```

Constraint:

```text
unique(tenant_id, code)
```

---

# 14. unit_meal_types

Define quais refeições estão habilitadas por unidade.

```text
id uuid PK
tenant_id uuid FK tenants
unit_id uuid FK units
meal_type_id uuid FK meal_types
enabled boolean
start_time time nullable
end_time time nullable
created_at timestamptz
updated_at timestamptz
```

Constraint:

```text
unique(unit_id, meal_type_id)
```

---

# 15. meal_rules

Define preço e subsídio por:

```text
unidade + tipo de refeição + categoria
```

Estrutura:

```text
id uuid PK
tenant_id uuid FK tenants
unit_id uuid FK units
meal_type_id uuid FK meal_types
category_id uuid FK student_categories
full_price numeric(12,2)
student_price numeric(12,2)
subsidy_amount numeric(12,2)
enabled boolean
effective_from timestamptz
effective_to timestamptz nullable
created_at timestamptz
updated_at timestamptz
```

Constraint:

```text
check(student_price >= 0)
check(full_price >= 0)
check(subsidy_amount >= 0)
```

Recomendação:

```text
subsidy_amount = full_price - student_price
```

Pode ser calculado na aplicação ou no banco.

Não sobrescrever histórico de regra.

Preferir criar nova vigência.

Índices:

```text
(unit_id, meal_type_id, category_id, enabled)
(effective_from, effective_to)
```

---

# 16. wallets

Carteira financeira.

Aplicável a categorias que exigem pagamento.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
balance numeric(12,2) default 0
status text
created_at timestamptz
updated_at timestamptz
```

Constraint:

```text
unique(student_id)
check(balance >= 0)
```

Observação:

- aluno integral não precisa possuir wallet.

---

# 17. wallet_transactions

Livro razão financeiro.

```text
id uuid PK
tenant_id uuid FK tenants
wallet_id uuid FK wallets
student_id uuid FK students
type wallet_transaction_type
amount numeric(12,2)
balance_before numeric(12,2)
balance_after numeric(12,2)
reference_type text nullable
reference_id uuid nullable
description text nullable
created_by uuid nullable FK profiles
created_at timestamptz
```

Regras:

- nunca deletar;
- reversão deve gerar nova transação;
- `amount` pode seguir convenção positiva/negativa ou tipo + valor absoluto.

Preferência:

```text
amount positivo para crédito
amount negativo para débito
```

Constraint:

```text
check(balance_after >= 0)
```

Índices:

```text
(wallet_id, created_at desc)
(student_id, created_at desc)
(reference_type, reference_id)
```

---

# 18. payment_providers

Opcional para abstração de gateway.

```text
id uuid PK
tenant_id uuid FK tenants
code text
name text
status text
created_at timestamptz
```

---

# 19. payments

Registro da cobrança no gateway.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
provider_id uuid nullable FK payment_providers
external_payment_id text nullable
method text
amount numeric(12,2)
status payment_status
raw_response jsonb nullable
confirmed_at timestamptz nullable
created_at timestamptz
updated_at timestamptz
```

Constraint importante:

```text
unique(provider_id, external_payment_id)
```

---

# 20. recharges

Recarga da carteira.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
wallet_id uuid FK wallets
payment_id uuid nullable FK payments
amount numeric(12,2)
status recharge_status
source text
unit_id uuid nullable FK units
operator_id uuid nullable FK profiles
confirmed_at timestamptz nullable
created_at timestamptz
updated_at timestamptz
```

Sources:

```text
pix
credit_card
debit_card
cash
manual
```

---

# 21. meal_consumptions

Registro de utilização da refeição.

```text
id uuid PK
tenant_id uuid FK tenants
institution_id uuid FK institutions
unit_id uuid FK units
student_id uuid FK students
category_id uuid FK student_categories
meal_type_id uuid FK meal_types
meal_rule_id uuid FK meal_rules
operator_id uuid nullable FK profiles
consumption_date date
consumed_at timestamptz
full_price numeric(12,2)
student_price numeric(12,2)
subsidy_amount numeric(12,2)
balance_before numeric(12,2) nullable
balance_after numeric(12,2) nullable
validation_method text
status consumption_status
created_at timestamptz
```

Validação:

```text
validation_method:
qr
manual_registration
```

Constraint crítica:

```text
unique(student_id, consumption_date, meal_type_id)
```

Essa constraint impede duas refeições do mesmo tipo no mesmo dia.

Se no futuro houver regra por unidade, revisar conforme necessidade.

---

# 22. blocked_attempts

Opcional, mas recomendado para auditoria operacional.

```text
id uuid PK
tenant_id uuid FK tenants
unit_id uuid FK units
student_id uuid nullable FK students
registration_number text nullable
meal_type_id uuid nullable FK meal_types
reason_code text
operator_id uuid nullable FK profiles
occurred_at timestamptz
metadata jsonb nullable
```

Útil para:

- relatórios de bloqueio;
- métricas;
- análise operacional.

---

# 23. cards

Representa carteirinha.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
card_type text
status text
created_at timestamptz
updated_at timestamptz
```

Tipos:

```text
digital
physical
```

---

# 24. qr_tokens

Identificador seguro da carteirinha.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
card_id uuid nullable FK cards
token text unique
status text
issued_at timestamptz
expires_at timestamptz nullable
revoked_at timestamptz nullable
created_at timestamptz
```

Observação:

- token não precisa expor matrícula.

---

# 25. notifications

Notificações internas.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
type text
title text
message text
read_at timestamptz nullable
created_at timestamptz
```

---

# 26. refund_requests

Solicitações de devolução.

```text
id uuid PK
tenant_id uuid FK tenants
student_id uuid FK students
wallet_id uuid FK wallets
amount numeric(12,2)
reason text
status text
requested_at timestamptz
reviewed_by uuid nullable FK profiles
reviewed_at timestamptz nullable
notes text nullable
```

---

# 27. reversal_requests

Solicitações de estorno.

```text
id uuid PK
tenant_id uuid FK tenants
transaction_id uuid FK wallet_transactions
requested_by uuid FK profiles
reason text
status text
reviewed_by uuid nullable FK profiles
reviewed_at timestamptz nullable
created_at timestamptz
```

---

# 28. audit_logs

Auditoria.

```text
id uuid PK
tenant_id uuid FK tenants
user_id uuid nullable FK profiles
action text
entity_type text
entity_id uuid nullable
old_value jsonb nullable
new_value jsonb nullable
unit_id uuid nullable FK units
ip_address inet nullable
created_at timestamptz
```

Índices:

```text
(tenant_id, created_at desc)
(user_id, created_at desc)
(entity_type, entity_id)
```

---

# 29. imports

Lotes de importação.

```text
id uuid PK
tenant_id uuid FK tenants
institution_id uuid FK institutions
unit_id uuid nullable FK units
uploaded_by uuid FK profiles
file_name text
status import_status
total_rows integer default 0
success_rows integer default 0
error_rows integer default 0
created_at timestamptz
completed_at timestamptz nullable
```

---

# 30. import_rows

Resultado linha a linha.

```text
id uuid PK
import_id uuid FK imports
row_number integer
registration_number text nullable
status text
error_message text nullable
payload jsonb
created_at timestamptz
```

---

# 31. report_templates

Template institucional.

```text
id uuid PK
tenant_id uuid FK tenants
name text
logo_url text nullable
company_name text
header_text text nullable
footer_text text nullable
primary_color text nullable
secondary_color text nullable
is_default boolean
created_at timestamptz
updated_at timestamptz
```

---

# 32. system_settings

Configurações gerais.

```text
id uuid PK
tenant_id uuid FK tenants
key text
value jsonb
created_at timestamptz
updated_at timestamptz
```

Constraint:

```text
unique(tenant_id, key)
```

---

# 33. Relações principais

```text
tenant
├── institutions
│   └── units
├── profiles
├── students
│   ├── wallet
│   │   └── wallet_transactions
│   ├── recharges
│   ├── payments
│   ├── meal_consumptions
│   ├── cards
│   ├── qr_tokens
│   └── notifications
├── student_categories
├── meal_types
├── meal_rules
├── audit_logs
└── report_templates
```

---

# 34. Função crítica consume_meal()

Recomendação:

```text
public.consume_meal(...)
```

Entradas:

```text
p_student_identifier
p_unit_id
p_meal_type_id
p_operator_id
p_validation_method
```

Saída:

```json
{
  "status": "approved",
  "student_id": "...",
  "student_name": "...",
  "category": "partial",
  "meal_type": "lunch",
  "student_price": 2.00,
  "balance_before": 20.00,
  "balance_after": 18.00
}
```

---

# 35. consume_meal — fluxo transacional

```text
BEGIN
```

1. resolver tenant;
2. resolver aluno pela matrícula/token;
3. validar status ativo;
4. validar unidade;
5. validar tipo de refeição;
6. validar se refeição está habilitada;
7. validar horário;
8. validar categoria;
9. verificar duplicidade;
10. buscar regra vigente;
11. calcular cobrança;
12. se parcial:
    - bloquear wallet;
    - verificar saldo;
13. inserir meal_consumption;
14. se parcial:
    - inserir wallet_transaction;
    - atualizar wallet.balance;
15. registrar auditoria mínima;
16. retornar sucesso.

```text
COMMIT
```

Erro:

```text
ROLLBACK
```

---

# 36. Bloqueio de concorrência

Para parcial:

```sql
select ...
from wallets
where id = ...
for update
```

Também usar unique constraint em consumo:

```text
student_id + consumption_date + meal_type_id
```

Assim:

- dois terminais simultâneos;
- mesma matrícula;
- mesma refeição;

resultam em apenas um sucesso.

---

# 37. Função confirm_recharge()

Objetivo:

- confirmar pagamento;
- evitar duplicidade;
- creditar carteira;
- registrar transação.

Entradas:

```text
external_payment_id
provider
```

Fluxo:

```text
BEGIN
```

1. localizar payment;
2. verificar status;
3. se já confirmado: retornar idempotente;
4. atualizar payment;
5. atualizar recharge;
6. bloquear wallet;
7. inserir wallet_transaction;
8. atualizar saldo;
9. criar notificação.

```text
COMMIT
```

---

# 38. Idempotência

Obrigatória em:

- webhooks;
- recargas;
- estornos;
- ajustes;
- consume_meal quando houver retry técnico.

Chaves possíveis:

```text
external_payment_id
idempotency_key
```

---

# 39. Função reverse_transaction()

Objetivo:

- estornar sem apagar histórico.

Fluxo:

```text
transação original
↓
nova transação reversa
↓
saldo atualizado
↓
auditoria
```

---

# 40. Função manual_wallet_adjustment()

Somente:

```text
admin_general
finance
```

Deve exigir:

- valor;
- motivo;
- usuário;
- referência.

---

# 41. Views recomendadas

## v_daily_meal_summary

Agrega:

- unidade;
- data;
- tipo;
- categoria;
- quantidade;
- valor aluno;
- subsídio.

## v_institution_meal_summary

Agrega:

- instituição;
- período;
- parciais;
- integrais;
- total.

## v_wallet_statement

Facilita extrato.

---

# 42. Materialized views

Não necessárias inicialmente.

Avaliar apenas se relatórios ficarem pesados.

---

# 43. Índices prioritários

## students

```text
(institution_id, registration_number)
(tenant_id, status)
(category_id)
```

## meal_consumptions

```text
(student_id, consumption_date, meal_type_id)
(unit_id, consumed_at)
(institution_id, consumed_at)
(category_id, consumed_at)
```

## wallet_transactions

```text
(wallet_id, created_at desc)
(student_id, created_at desc)
```

## payments

```text
(provider_id, external_payment_id)
(status, created_at)
```

## recharges

```text
(student_id, created_at desc)
(status)
```

---

# 44. Soft delete

Evitar soft delete em excesso.

Para entidades operacionais:

```text
status
active/inactive
```

Para financeiro:

```text
nunca deletar
```

---

# 45. Exclusão em cascata

Usar com cautela.

Recomendação:

- financeiro: `restrict`;
- consumo: `restrict`;
- auditoria: `restrict`;
- entidade de configuração sem histórico: analisar caso a caso.

Evitar cascata que apague histórico.

---

# 46. RLS — princípios

Toda tabela sensível deve validar:

```text
tenant_id
```

Depois:

```text
role
scope
institution
unit
student ownership
```

---

# 47. RLS — students

Aluno:

```text
students.user_id = auth.uid()
```

Admin:

```text
tenant_id = current_tenant_id()
```

Gerente:

```text
unit/institution scope autorizado
```

A modelagem exata de vínculo com unidade será fechada no desenho final.

---

# 48. RLS — wallet

Aluno parcial:

```text
wallet.student_id = current_student_id()
```

Integral:

- não deve possuir wallet.

---

# 49. RLS — meal_consumptions

Aluno:

- visualiza apenas próprios consumos.

Operador:

- pode inserir via função segura;
- não deve inserir livremente direto na tabela.

Gerente:

- apenas escopo da unidade.

Instituição:

- apenas própria instituição.

---

# 50. RLS — audit_logs

Somente perfis autorizados.

Nunca aluno.

Nunca operador comum.

---

# 51. Service role

Nunca no frontend.

Somente em:

- backend seguro;
- Edge Function;
- processos controlados.

---

# 52. Storage

Buckets:

```text
student-photos
tenant-assets
report-assets
```

Políticas:

- aluno pode ler própria foto;
- upload conforme permissão;
- tenant assets restritos por tenant.

---

# 53. Integridade de tenant

Sempre validar que FKs relacionadas pertencem ao mesmo tenant.

Exemplo inválido:

```text
student tenant A
+
institution tenant B
```

Idealmente garantir por lógica server-side e testes.

---

# 54. Histórico de categoria

Recomendação futura:

```text
student_category_history
```

Campos:

```text
student_id
category_id
effective_from
effective_to
changed_by
```

Pode ser implementado já no MVP se necessário para auditoria.

---

# 55. Histórico de preço

`meal_rules` já deve trabalhar por vigência.

Nunca atualizar uma regra antiga de forma destrutiva quando houver consumos ligados.

Criar nova regra.

---

# 56. Data operacional

Usar:

```text
consumption_date
```

separada de:

```text
consumed_at
```

Isso simplifica:

- limite diário;
- relatórios;
- timezone.

---

# 57. Timezone

Default:

```text
America/Bahia
```

Armazenar timestamps em UTC.

Converter na aplicação.

---

# 58. Relatório institucional resumido

Query conceitual:

```text
group by category
count consumptions
```

Separar:

```text
partial
integral
```

---

# 59. Relatório detalhado

Buscar:

- matrícula;
- nome;
- categoria;
- data;
- refeição;
- unidade;
- valor pago;
- subsídio.

Aplicar escopo de instituição.

---

# 60. Segurança da matrícula

Matrícula pode ser pesquisável.

Mas QR deve usar token seguro.

Evitar expor regras internas no QR.

---

# 61. Integridade do integral

Aluno integral:

- não cria wallet;
- não gera wallet_transaction;
- student_price = 0;
- consumo continua registrado;
- subsídio é registrado.

---

# 62. Integridade do parcial

Aluno parcial:

- exige wallet ativa;
- exige saldo suficiente;
- gera débito;
- gera consumo;
- atualiza saldo.

---

# 63. Migrações sugeridas

Ordem inicial:

```text
001_extensions.sql
002_tenants.sql
003_branding.sql
004_institutions.sql
005_units.sql
006_profiles.sql
007_user_unit_access.sql
008_student_categories.sql
009_students.sql
010_meal_types.sql
011_unit_meal_types.sql
012_meal_rules.sql
013_wallets.sql
014_wallet_transactions.sql
015_payment_providers.sql
016_payments.sql
017_recharges.sql
018_meal_consumptions.sql
019_cards.sql
020_qr_tokens.sql
021_notifications.sql
022_refund_requests.sql
023_reversal_requests.sql
024_audit_logs.sql
025_imports.sql
026_import_rows.sql
027_report_templates.sql
028_settings.sql
029_rls.sql
030_functions.sql
031_views.sql
032_seed.sql
```

---

# 64. Seed inicial

Criar:

```text
meal_types:
breakfast
lunch
dinner

student_categories:
partial
integral
```

---

# 65. Não usar tabela genérica demais

Evitar modelar tudo em:

```text
settings
metadata
jsonb
```

Dados centrais devem ter tabelas próprias.

---

# 66. Uso de JSONB

Usar apenas onde faz sentido:

- payload bruto de gateway;
- auditoria;
- importação;
- metadata.

Não usar JSONB para substituir modelagem relacional principal.

---

# 67. Critérios de aceite do banco

Antes de avançar:

- tenant isolado;
- matrícula única;
- saldo nunca negativo;
- duplicidade de refeição bloqueada;
- integral sem wallet;
- parcial com wallet;
- price rule por unidade/refeição/categoria;
- consumo transacional;
- recarga idempotente;
- RLS ativa;
- auditoria funcional.

---

# 68. Testes de banco obrigatórios

## Students

- matrícula duplicada;
- tenant incorreto;
- status inválido.

## Wallet

- saldo negativo;
- dupla transação.

## Consumption

- consumo duplicado;
- concorrência;
- integral;
- parcial sem saldo;
- parcial com saldo.

## Payment

- webhook repetido;
- external id duplicado.

## RLS

- aluno lendo outro aluno;
- gerente lendo outra unidade;
- tenant acessando outro tenant.

---

# 69. Próximos documentos

Depois deste arquivo:

```text
SECURITY.md
PAYMENTS.md
OFFLINE_STRATEGY.md
```

---

# 70. Fonte de verdade

Este documento define o modelo de dados inicial.

Mudanças de estrutura relevantes devem ser atualizadas aqui antes de migrations definitivas.

---

**Fim do documento.**
