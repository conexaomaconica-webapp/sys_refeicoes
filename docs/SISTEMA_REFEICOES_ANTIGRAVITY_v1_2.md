# SISTEMA DE CONTROLE DE REFEIÇÕES
## Documento de Suporte ao Desenvolvimento no Antigravity
**Versão:** 1.0  
**Status:** Planejamento / Pré-desenvolvimento  
**Stack prevista:** Antigravity + Next.js + Supabase + PWA

---

# 1. Objetivo do projeto

Desenvolver uma plataforma para controle de acesso, recarga, saldo, consumo e subsídio de refeições em restaurantes universitários.

O principal problema a resolver é a lentidão e insegurança do processo atual, no qual alunos realizam pagamentos via Pix ou dinheiro e precisam apresentar comprovantes na entrada.

O sistema deve substituir esse fluxo por uma operação automatizada, permitindo que o aluno:

1. possua uma conta vinculada à matrícula;
2. mantenha saldo pré-pago;
3. faça recarga;
4. exiba uma carteirinha digital ou física com QR Code;
5. tenha sua elegibilidade validada no momento da entrada;
6. tenha o valor correto debitado automaticamente;
7. seja liberado ou bloqueado em poucos segundos.

O sistema deve ser pensado desde o início para operação multiunidade e futura comercialização como SaaS para outras empresas de alimentação coletiva.

---

# 2. Contexto operacional

A empresa opera em diversas cidades da Bahia e possui contratos em:

- universidades;
- faculdades;
- presídios;
- empresas.

O primeiro foco do sistema será o ambiente universitário.

Em uma única universidade podem existir:

- aproximadamente 1.700 a 2.000 usuários;
- mais de 3.000 refeições por dia;
- operação concentrada em almoço e jantar;
- grande fluxo de pessoas em intervalos curtos.

O sistema deve priorizar:

- velocidade;
- disponibilidade;
- segurança financeira;
- simplicidade de operação;
- baixa dependência de ações manuais.

---

# 3. Objetivos principais

## 3.1 Operacionais

- reduzir o tempo médio de atendimento;
- aumentar a quantidade de alunos processados por minuto;
- eliminar a conferência manual de comprovantes;
- impedir consumo duplicado no mesmo turno;
- automatizar a validação do aluno.

## 3.2 Financeiros

- controlar saldo pré-pago;
- registrar recargas;
- debitar refeições;
- registrar subsídios;
- permitir conciliação;
- gerar dados confiáveis para fechamento e faturamento.

## 3.3 Estratégicos

- suportar múltiplas unidades;
- suportar múltiplas instituições;
- permitir regras diferentes por unidade;
- preparar o produto para operação SaaS futura.

---

# 4. Stack tecnológica definida

## 4.1 Desenvolvimento

- Antigravity como ambiente principal de apoio ao desenvolvimento;
- Next.js como framework principal;
- TypeScript;
- Supabase como backend principal;
- PostgreSQL via Supabase;
- Supabase Auth;
- Supabase Storage;
- Row Level Security (RLS);
- PWA para o portal do aluno.

## 4.2 Aplicações previstas

### Portal/PWA do aluno
Responsável por:

- saldo;
- recarga;
- extrato;
- carteirinha digital;
- histórico de refeições;
- notificações;
- atualização de dados permitidos.

### Painel administrativo
Responsável por:

- instituições;
- unidades;
- alunos;
- categorias;
- preços;
- subsídios;
- usuários;
- permissões;
- relatórios;
- auditoria;
- configurações.

### Terminal de recepção
Responsável por:

- leitura de QR Code;
- digitação manual de matrícula;
- validação;
- débito;
- registro da refeição;
- exibição de LIBERADO ou NÃO LIBERADO.

---

# 5. Princípios técnicos

1. Nunca confiar apenas no frontend para validações financeiras.
2. Débito de saldo e registro da refeição devem ocorrer de forma atômica.
3. O saldo nunca pode ficar negativo.
4. O mesmo aluno não pode consumir duas refeições do mesmo tipo no mesmo dia.
5. Permissões devem ser validadas no backend e reforçadas com RLS.
6. Movimentações financeiras não devem ser apagadas.
7. Correções financeiras devem ocorrer por estorno ou lançamento compensatório.
8. Logs de auditoria devem ser mantidos para ações críticas.
9. Regras de negócio devem permanecer centralizadas.
10. O sistema deve ser preparado para múltiplos tenants, mesmo que o primeiro cliente utilize sozinho no início.

---

# 6. Modelo SaaS conceitual

A plataforma deve ser preparada para atender várias empresas no futuro.

Estrutura conceitual:

```text
PLATAFORMA
└── EMPRESA / TENANT
    ├── INSTITUIÇÕES
    │   └── UNIDADES / RESTAURANTES
    ├── USUÁRIOS INTERNOS
    ├── ALUNOS
    ├── CATEGORIAS
    ├── CARTEIRAS
    ├── REFEIÇÕES
    ├── RECARGAS
    └── RELATÓRIOS
```

Mesmo no primeiro cliente, recomenda-se o uso de um `tenant_id` ou estrutura equivalente nas entidades principais.

---

# 7. Perfis de usuário previstos

## Administrador geral

Acesso amplo à operação autorizada.

Pode visualizar:

- todas as unidades;
- todas as instituições;
- alunos;
- configurações;
- relatórios;
- financeiro;
- auditoria.

## Diretor operacional

Visão operacional ampla.

Pode acompanhar:

- unidades;
- volume de refeições;
- desempenho;
- bloqueios;
- indicadores operacionais.

## Financeiro

Acesso a:

- recargas;
- consumo;
- subsídios;
- estornos;
- conciliação;
- relatórios financeiros.

## Supervisor

Pode possuir acesso a várias unidades atribuídas.

## Gerente

Acesso apenas às unidades sob sua responsabilidade.

## Operador

Acesso restrito à operação de entrada.

Funções principais:

- escanear QR Code;
- digitar matrícula;
- visualizar resultado;
- consultar dados mínimos necessários ao atendimento.

Não pode:

- alterar saldo;
- alterar categoria;
- liberar bloqueio manualmente;
- alterar regras.

## Universidade / Instituição

Perfil opcional.

Inicialmente poderá consultar:

- volume de refeições;
- lista de alunos.

## Aluno

Pode acessar apenas seus próprios dados e operações permitidas.

---

# 8. Cadastro do aluno

Campos previstos:

```text
nome_completo
matricula
instituicao_id
unidade_id (quando aplicável)
curso
situacao
categoria_id
email
telefone
foto_url (opcional)
created_at
updated_at
```

A foto do aluno é opcional. Quando cadastrada, poderá ser exibida no perfil, carteirinha e tela de atendimento apenas como apoio visual. A foto não participa da validação de acesso.

Possíveis situações:

```text
active
suspended
cancelled
graduated
inactive
```

A nomenclatura final pode ser ajustada antes da migration.

---

# 9. Regras de cadastro

## RN-001
Cada aluno deve possuir matrícula vinculada à instituição.

## RN-002
A matrícula deve ser única dentro da instituição.

## RN-003
Cada aluno ficará inicialmente vinculado a uma única instituição por vez.

## RN-004
A instituição poderá enviar alunos por planilha.

## RN-005
Também deve existir cadastro manual por usuário autorizado.

## RN-006
Alunos inativos, suspensos, cancelados ou formados não devem ser liberados.

## RN-007
O aluno poderá editar apenas campos autorizados.

## RN-008
Matrícula, categoria, instituição e situação acadêmica devem ser protegidas.

---

# 10. Categoria e subsídio

Todo aluno deve estar associado a uma categoria.

Exemplos:

```text
Parcial
Integral
Outras categorias futuras
```

A cobrança deve considerar:

```text
UNIDADE
+
TIPO DE REFEIÇÃO
+
CATEGORIA
=
VALOR DO ALUNO
+
VALOR SUBSIDIADO
```

Cada unidade pode possuir valores próprios para café da manhã, almoço e jantar.

Exemplo:

```text
Unidade A
Café da manhã - Parcial: R$ 1,00
Almoço - Parcial: R$ 2,00
Jantar - Parcial: R$ 2,00
Integral: R$ 0,00 em cada tipo habilitado
```

Para bolsa integral:

```text
Participação do aluno: R$ 0,00
Subsídio: valor integral da refeição
```

---

# 11. Regras financeiras

## RN-009
Cada categoria pode possuir uma participação financeira diferente.

## RN-010
Cada unidade pode possuir regras e valores diferentes.

## RN-011
Cada tipo de refeição poderá possuir valor próprio dentro de cada unidade.

## RN-012
A cobrança deverá considerar unidade + tipo de refeição + categoria.

## RN-013
O sistema deve registrar separadamente:

- valor total da refeição;
- valor pago pelo aluno;
- valor subsidiado.

## RN-014
Alterações futuras de preço não devem alterar registros históricos.

## RN-015
Somente administradores autorizados podem alterar categorias e preços.

---

# 12. Carteira financeira

Cada aluno que não possui gratuidade deve possuir uma carteira de saldo.

Estrutura conceitual:

```text
wallet
wallet_transactions
```

Tipos de transação:

```text
recharge
meal_debit
refund
reversal
manual_adjustment
```

---

# 13. Regras da carteira

## RN-014
O saldo não pode ficar negativo.

## RN-015
A carteira deve possuir histórico imutável de movimentações.

## RN-016
O saldo exibido deve resultar de operações válidas e confirmadas.

## RN-017
Um pagamento pendente não pode ser considerado saldo.

## RN-018
Débito de refeição e registro de consumo devem ser transacionais.

## RN-019
Falha no débito deve cancelar a liberação.

---

# 14. Recargas

Formas previstas:

- Pix;
- cartão de débito;
- cartão de crédito em 1x;
- recarga presencial.

A integração com gateway de pagamento será definida posteriormente.

---

# 15. Regras de recarga

## RN-020
A recarga digital deve entrar automaticamente após confirmação do pagamento.

## RN-021
Deve existir valor mínimo configurável.

## RN-022
Podem existir valores sugeridos.

## RN-023
O aluno poderá inserir valor personalizado acima do mínimo.

## RN-024
Recarga presencial deve registrar operador e unidade.

## RN-025
Toda recarga deve gerar transação financeira.

## RN-026
Estornos devem ser auditáveis.

## RN-027
Devolução de saldo deve seguir política administrativa ainda a definir.

## RN-028
A política de recarga por terceiros ainda deve ser validada.

---

# 16. Carteirinha

O aluno poderá possuir:

- carteirinha digital;
- carteirinha física.

Ambas devem apontar para a mesma identidade lógica.

Informações previstas:

- nome;
- foto, quando cadastrada;
- instituição;
- curso;
- QR Code.

A presença da foto é opcional e não interfere na liberação do acesso.

---

# 17. Segurança do QR Code

A validação do aluno será feita exclusivamente pela matrícula.

O QR Code funciona como meio de leitura rápida da matrícula ou de um identificador interno diretamente associado a ela.

A foto, quando existente, não participa da validação.

A matrícula pode ser permanente, mas o QR Code não deve necessariamente expor a matrícula em texto simples.

Recomendação:

```text
QR Code
   ↓
identificador seguro / token
   ↓
matrícula do aluno
   ↓
registro interno do aluno
```

A estratégia final ainda será definida.

Possibilidades futuras:

- identificador permanente não previsível;
- token rotativo;
- token assinado;
- QR dinâmico.

---

# 18. Fluxo de entrada

Fluxo principal:

```text
Aluno chega ao restaurante
        ↓
Apresenta QR Code
        ↓
Operador realiza leitura
        ↓
Sistema identifica aluno
        ↓
Valida situação acadêmica
        ↓
Valida categoria
        ↓
Identifica turno
        ↓
Verifica se refeição já foi utilizada
        ↓
Verifica saldo ou gratuidade
        ↓
Calcula cobrança
        ↓
Debita saldo
        ↓
Registra consumo
        ↓
LIBERADO
```

Em caso de falha:

```text
NÃO LIBERADO
+
motivo objetivo
```

---

# 19. Regra central de liberação

```text
aluno válido
AND matrícula ativa
AND categoria válida
AND refeição disponível
AND não consumida no turno
AND (saldo suficiente OR gratuidade)
= LIBERADO
```

Caso contrário:

```text
NÃO LIBERADO
```

---

# 20. Controle de refeições

Inicialmente existirão:

- café da manhã;
- almoço;
- jantar.

Cada unidade poderá habilitar ou desabilitar tipos de refeição conforme sua operação.

Regra padrão:

```text
1 café da manhã por dia
1 almoço por dia
1 jantar por dia
```

O aluno não pode utilizar duas vezes o mesmo tipo de refeição no mesmo dia.

Mesmo que possua saldo suficiente, a segunda tentativa deve ser bloqueada.

Para alunos da categoria integral, o sistema deve permitir 1 liberação por tipo de refeição habilitado no dia, sem débito de saldo.

---

# 21. Registro de consumo

Cada consumo deve registrar no mínimo:

```text
tenant_id
institution_id
unit_id
student_id
category_id
meal_type
date
timestamp
full_meal_value
student_amount
subsidy_amount
balance_before
balance_after
validation_method
operator_id
status
```

---

# 22. Tela de recepção

A tela deve ser otimizada para velocidade.

Após leitura:

```text
LIBERADO
```

ou

```text
NÃO LIBERADO
```

Informações relevantes:

- foto, quando cadastrada;
- nome;
- matrícula;
- categoria;
- refeição;
- valor debitado;
- saldo restante;
- motivo do bloqueio.

A matrícula é a chave de validação do aluno. A foto tem função apenas informativa.

A interface deve possuir forte contraste visual.

Som e indicadores visuais podem ser configuráveis.

---

# 23. Bloqueios previstos

Motivos iniciais:

```text
STUDENT_INACTIVE
INVALID_QR
STUDENT_NOT_FOUND
MEAL_ALREADY_USED
INSUFFICIENT_BALANCE
CATEGORY_INVALID
UNIT_NOT_ALLOWED
OUTSIDE_MEAL_WINDOW
PAYMENT_ERROR
SYSTEM_ERROR
```

Os códigos finais devem ser padronizados antes da implementação.

---

# 24. Liberação manual

O operador comum não pode ignorar bloqueios.

Caso futuramente exista exceção:

- somente gerente ou administrador autorizado;
- deve exigir justificativa;
- deve registrar usuário;
- deve registrar data e hora;
- deve gerar log de auditoria.

---

# 25. Portal/PWA do aluno

Funções obrigatórias do MVP:

## Aluno parcial

- login;
- consulta de saldo;
- recarga;
- extrato;
- carteirinha digital;
- atualização de dados permitidos;
- notificações;
- histórico de refeições;
- quantidade de refeições no período;
- valores pagos no período.

## Aluno integral

- login;
- carteirinha digital;
- atualização de dados permitidos;
- notificações;
- histórico de refeições;
- quantidade de refeições no período.

Alunos integrais não devem visualizar nem acessar funcionalidades de saldo, recarga ou extrato financeiro.

---

# 26. Notificações

Eventos previstos:

```text
RECHARGE_CONFIRMED
LOW_BALANCE
MEAL_CONSUMED
REFUND_COMPLETED
ACCOUNT_STATUS_CHANGED
```

O alerta de saldo baixo deve possuir valor configurável.

---

# 27. Dashboard

Deve permitir visão:

- diária;
- semanal;
- mensal.

Indicadores iniciais:

- refeições totais;
- almoço;
- jantar;
- quantidade por categoria;
- valor pago pelos alunos;
- valor subsidiado;
- recargas;
- bloqueios;
- alunos atendidos.

---

# 28. Relatórios

Relatórios essenciais internos:

- refeições por dia;
- refeições por turno;
- refeições por unidade;
- refeições por categoria;
- refeições por instituição;
- valores pagos;
- valores subsidiados;
- recargas;
- saldos;
- estornos;
- bloqueios.

## Relatório destinado à universidade

O relatório institucional deve informar, no mínimo:

- quantidade de matrículas da categoria parcial que utilizaram o restaurante;
- quantidade de matrículas da categoria integral/gratuita que utilizaram o restaurante;
- período de referência;
- unidade/instituição correspondente.

O sistema deve permitir gerar esse relatório em dois formatos:

### Resumido

Apresenta os totais consolidados por período e categoria.

Exemplo:

```text
Parciais: 1.245 refeições
Integrais/Gratuitas: 832 refeições
Total: 2.077 refeições
```

### Detalhado

Apresenta a listagem individual dos atendimentos, contendo quando aplicável:

- matrícula;
- nome do aluno;
- categoria;
- data;
- turno/refeição;
- unidade;
- valor pago pelo aluno;
- valor subsidiado.

## Template institucional

Os relatórios destinados à universidade devem utilizar um template padronizado com a identidade visual da empresa operadora.

O template deverá permitir:

- logomarca da empresa;
- nome da empresa;
- identificação da instituição/unidade;
- período do relatório;
- título do relatório;
- resumo dos indicadores;
- paginação;
- data de emissão.

Exportação:

- Excel;
- PDF.

O sistema não precisa inicialmente emitir nota fiscal ou faturamento.

Deve gerar informações para o financeiro realizar o faturamento externo.

---

# 29. Conciliação financeira

Deve ser possível relacionar:

```text
recargas recebidas
+
ajustes
-
consumos
-
devoluções
-
estornos
=
saldo consolidado
```

Também deve ser possível reconciliar valores recebidos no gateway com registros internos.

---

# 30. Offline e contingência

A operação principal será online.

Ainda deve ser definido o comportamento offline.

Problema crítico:

```text
Terminal A offline
Aluno utiliza refeição

Terminal B offline
Aluno tenta utilizar novamente
```

O sistema não pode assumir que um modo offline completo é seguro sem estratégia específica.

Prioridade:

1. consistência financeira;
2. prevenção de consumo duplicado;
3. disponibilidade.

A solução de contingência será definida na arquitetura.

---

# 31. Auditoria

Ações críticas devem gerar log.

Exemplos:

- alteração de categoria;
- alteração de preço;
- ajuste de saldo;
- estorno;
- alteração de status do aluno;
- importação de alunos;
- alteração de permissões;
- eventual liberação excepcional.

Estrutura conceitual:

```text
audit_logs
```

Campos mínimos:

```text
tenant_id
user_id
action
entity_type
entity_id
old_value
new_value
timestamp
ip_address (quando aplicável)
```

---

# 32. MVP

O MVP deve conter:

## Administração

- autenticação;
- instituições;
- unidades;
- alunos;
- importação por planilha;
- cadastro manual;
- categorias;
- preços;
- usuários;
- perfis;
- permissões.

## Financeiro

- carteira;
- saldo;
- recarga;
- histórico;
- estorno;
- conciliação básica.

## Aluno

- PWA;
- saldo;
- recarga;
- extrato;
- carteirinha;
- histórico;
- notificações.

## Restaurante

- leitura de QR Code;
- busca por matrícula;
- validação;
- débito;
- registro;
- liberação/bloqueio.

## Gestão

- dashboard;
- relatórios;
- exportações;
- auditoria.

---

# 33. Fora do MVP inicial

Não implementar no primeiro ciclo, salvo nova decisão:

- reconhecimento facial;
- biometria;
- catraca automática;
- NFC;
- totem;
- app nativo;
- integração direta com todos os sistemas acadêmicos;
- ERP completo;
- emissão fiscal.

A arquitetura deve permitir essas evoluções posteriormente.

---

# 34. Estrutura inicial de entidades

Lista conceitual, não definitiva:

```text
tenants
institutions
units
profiles
user_roles
user_unit_access
students
student_categories
meal_types
meal_rules
wallets
wallet_transactions
recharges
payments
meal_consumptions
cards
qr_tokens
notifications
audit_logs
imports
import_rows
settings
```

Não criar migrations definitivas antes de validar o modelo relacional.

---

# 35. Recomendação para Supabase

Utilizar:

- Auth para usuários internos e alunos;
- PostgreSQL para dados transacionais;
- RLS em todas as tabelas sensíveis;
- Storage para fotos;
- RPC / Database Functions para operações críticas;
- Edge Functions apenas quando necessário para integrações externas/webhooks.

Operações críticas candidatas a funções transacionais:

```text
consume_meal()
confirm_recharge()
reverse_transaction()
manual_wallet_adjustment()
import_students()
```

---

# 36. Operação crítica: consume_meal()

A operação deve ser atômica.

Fluxo conceitual:

```text
BEGIN

lock student/wallet context

validate tenant
validate unit
validate student
validate status
validate category
validate meal period
validate duplicate consumption
calculate amount
validate balance

insert meal_consumption

if amount > 0:
    insert wallet_transaction
    update wallet balance

COMMIT
```

Se qualquer etapa falhar:

```text
ROLLBACK
```

Nunca debitar saldo sem registrar consumo.

Nunca registrar consumo pago sem debitar saldo.

---

# 37. Performance

O sistema deve considerar picos de milhares de atendimentos.

A tela de recepção deve:

- carregar pouco JavaScript;
- evitar consultas desnecessárias;
- minimizar round-trips;
- possuir feedback imediato;
- manter scanner pronto para próxima leitura.

A operação de validação deve ocorrer preferencialmente em uma única chamada ao backend.

---

# 38. Métricas do piloto

A unidade piloto deve medir:

- tempo médio por atendimento;
- quantidade de pessoas por minuto;
- tempo de fila;
- percentual de bloqueios;
- motivo dos bloqueios;
- falhas de leitura;
- falhas de pagamento;
- disponibilidade do sistema.

---

# 39. Pendências

Ainda precisam ser confirmados:

- política exata de pagamento por terceiros;
- política de devolução;
- regras de estorno;
- modelo offline;
- acesso da instituição;
- relatórios específicos exigidos por cada universidade;
- segurança final do QR Code;
- modelo de integração futura com catraca;
- gateway de pagamentos;
- autenticação inicial do aluno;
- estratégia de onboarding;
- LGPD e política de retenção de dados.

---

# 40. Ordem recomendada para desenvolvimento

Não iniciar diretamente pela interface.

Sequência sugerida:

```text
1. validar regras de negócio
2. definir perfis e matriz de permissões
3. desenhar fluxos
4. fechar MVP
5. definir arquitetura
6. modelar banco
7. criar migrations
8. configurar RLS
9. implementar autenticação
10. implementar cadastros-base
11. implementar carteira
12. implementar recargas
13. implementar consumo
14. implementar recepção
15. implementar PWA
16. implementar dashboards
17. implementar auditoria
18. realizar testes de carga
19. piloto
20. ajustes
```

---

# 41. Regras para o Antigravity

Ao trabalhar neste projeto:

1. Não alterar regras de negócio sem registrar a mudança neste arquivo.
2. Não criar novas entidades sem justificar.
3. Não duplicar lógica de negócio em múltiplos componentes.
4. Não confiar em validação apenas no frontend.
5. Não permitir saldo negativo.
6. Não permitir consumo duplicado.
7. Não excluir histórico financeiro.
8. Não enfraquecer RLS para resolver erros rapidamente.
9. Não misturar dados de tenants.
10. Não criar migrations destrutivas sem análise.
11. Trabalhar com migrations separadas e versionadas.
12. Priorizar segurança e integridade em operações financeiras.
13. Sempre preservar auditoria.
14. Manter interfaces de operação simples e rápidas.
15. Antes de implementar algo não previsto, consultar este documento.

---

# 42. Fonte de verdade

Este arquivo deve funcionar como referência funcional do projeto durante o desenvolvimento.

Em caso de conflito entre:

- uma implementação existente;
- uma interpretação do desenvolvedor;
- uma sugestão automática;
- uma regra registrada neste documento;

a regra registrada neste documento deve ser considerada prioritária até que seja formalmente revisada.

---

# 43. Próximos documentos

Antes do desenvolvimento completo, criar:

- `PERMISSIONS.md`
- `FLOWS.md`
- `MVP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `SECURITY.md`
- `PAYMENTS.md`
- `OFFLINE_STRATEGY.md`

Estes arquivos deverão complementar este documento, e não substituir as regras aqui registradas.

---

# 44. Estado atual

**Fase atual:** definição funcional.

**Ainda não iniciar desenvolvimento definitivo do banco ou migrations sem concluir:**

1. matriz de permissões;
2. fluxos operacionais;
3. MVP detalhado;
4. decisões pendentes críticas.

---

**Documento-base para desenvolvimento no Antigravity.**
