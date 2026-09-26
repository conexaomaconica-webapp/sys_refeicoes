# DEVELOPMENT_PLAN.md
## Plano de Desenvolvimento por Fases e Sprints
**Projeto:** Sistema de Controle de Refeições  
**Versão:** 1.0  
**Stack:** Antigravity + Next.js + Supabase + PWA

---

# 1. Objetivo

Este documento define a ordem prática de desenvolvimento do sistema.

A implementação deve ser incremental.

Não tentar construir todos os módulos simultaneamente.

Cada sprint deve:

1. possuir objetivo claro;
2. implementar apenas o escopo definido;
3. possuir migrations próprias;
4. possuir testes;
5. ser homologada antes da próxima etapa.

---

# 2. Documentos de referência obrigatórios

Antes de qualquer implementação, considerar como fonte de verdade:

```text
SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md
PERMISSIONS_v1_2.md
FLOWS_v1_1.md
MVP.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md
PAYMENTS.md
OFFLINE_STRATEGY.md
```

---

# 3. Regra principal para o Antigravity

Não iniciar módulos futuros antes de estabilizar a base.

Ordem:

```text
FUNDAÇÃO
↓
AUTENTICAÇÃO
↓
MULTI-TENANT
↓
CADASTROS
↓
ALUNOS
↓
REFEIÇÕES E PREÇOS
↓
CARTEIRA
↓
RECARGA
↓
QR
↓
CONSUMO
↓
RECEPÇÃO
↓
PWA
↓
RELATÓRIOS
↓
AUDITORIA
↓
TESTES DE CARGA
↓
PILOTO
```

---

# 4. FASE 0 — Preparação do projeto

## Objetivo

Criar a base técnica sem regras de negócio complexas.

## Entregas

- projeto Next.js;
- TypeScript;
- estrutura de pastas;
- conexão Supabase;
- variáveis de ambiente;
- configuração de lint;
- formatação;
- ambiente local;
- staging;
- `.env.example`;
- README técnico.

## Estrutura

```text
src/
├── app/
├── components/
├── features/
├── lib/
├── server/
├── services/
├── hooks/
├── types/
└── utils/
```

## Critério de conclusão

```text
npm run build
```

deve passar sem erro.

---

# 5. SPRINT 1 — Fundação SaaS e Branding

## Objetivo

Criar estrutura básica multi-tenant.

## Banco

Criar:

```text
tenants
tenant_branding
institutions
units
```

## Interface

Criar:

- layout base;
- splash animado;
- carregamento da marca;
- página de login inicial.

## Splash

Fluxo:

```text
abrir
↓
branding
↓
splash animado
↓
verificar sessão
↓
login/dashboard
```

## Critérios de aceite

- tenant configurável;
- logo configurável;
- splash funcionando;
- instituição cadastrável;
- unidade cadastrável.

---

# 6. SPRINT 2 — Auth, Perfis e Permissões

## Banco

Criar:

```text
profiles
user_unit_access
```

## Auth

Implementar Supabase Auth.

## Perfis

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

## Segurança

- RLS inicial;
- helpers de autorização;
- redirecionamento por perfil.

## Critérios

- admin entra;
- operador entra;
- gerente entra;
- usuário não acessa tela proibida;
- tenant A não acessa tenant B.

---

# 7. SPRINT 3 — Cadastro de Alunos

## Banco

Criar:

```text
student_categories
students
```

Seed:

```text
partial
integral
```

## Funcionalidades

- lista de alunos;
- cadastro manual;
- edição;
- ativação/inativação;
- categoria;
- curso;
- foto opcional.

## Regra

```text
unique(institution_id, registration_number)
```

## Critérios

- matrícula duplicada bloqueada;
- foto opcional;
- integral/parcial funcionando;
- aluno inativo preserva histórico.

---

# 8. SPRINT 4 — Importação por Planilha

## Banco

Criar:

```text
imports
import_rows
```

## Fluxo

```text
upload
↓
validação
↓
preview
↓
confirmação
↓
importação
↓
resultado
```

## Deve tratar

- matrícula duplicada;
- categoria inválida;
- campos ausentes;
- atualização de matrícula integral.

## Critérios

- importar base real;
- identificar erros;
- apresentar resumo;
- não duplicar aluno.

---

# 9. SPRINT 5 — Tipos de Refeição e Preços

## Banco

Criar:

```text
meal_types
unit_meal_types
meal_rules
```

Seed:

```text
breakfast
lunch
dinner
```

## Admin

Criar tela de configuração:

```text
unidade
→ refeição
→ categoria
→ preço
→ subsídio
→ horário
```

## Regra

```text
UNIDADE
+
REFEIÇÃO
+
CATEGORIA
=
PREÇO
```

## Critérios

- unidade A pode ter preços diferentes da B;
- café pode ter preço diferente do almoço;
- integral = R$ 0;
- histórico de preço preservado.

---

# 10. SPRINT 6 — Carteira Financeira

## Banco

Criar:

```text
wallets
wallet_transactions
```

## Regras

Parcial:

```text
possui wallet
```

Integral:

```text
não possui wallet
```

## Funções

Criar base para:

```text
manual_wallet_adjustment()
reverse_transaction()
```

## Critérios

- saldo nunca negativo;
- histórico imutável;
- integral sem carteira.

---

# 11. SPRINT 7 — Recarga

## Banco

Criar:

```text
payment_providers
payments
recharges
payment_webhook_events
```

## Primeiro estágio

Antes do gateway real:

criar provider mock/sandbox.

## Fluxo

```text
criar recarga
↓
pagamento mock
↓
confirm_recharge()
↓
saldo atualizado
```

## Critérios

- confirmação idempotente;
- webhook duplicado não duplica saldo;
- integral bloqueado.

---

# 12. SPRINT 8 — Gateway Real

Escolher gateway antes desta sprint.

## Implementar

- Pix;
- cartão de crédito 1x;
- débito se gateway suportar;
- webhook;
- assinatura;
- conciliação.

## Não fazer

Não espalhar código do gateway pelo sistema.

Usar:

```text
PaymentProvider
```

---

# 13. SPRINT 9 — Carteirinha e QR Code

## Banco

Criar:

```text
cards
qr_tokens
```

## PWA

Criar carteirinha:

- nome;
- instituição;
- curso;
- foto opcional;
- QR.

## Segurança

QR:

```text
token seguro
```

não matrícula em texto aberto.

## Critérios

- integral possui cartão;
- parcial possui cartão;
- token revogável;
- matrícula manual funciona.

---

# 14. SPRINT 10 — consume_meal()

Esta é a sprint mais crítica.

## Banco

Criar:

```text
meal_consumptions
blocked_attempts
```

## Função

Implementar:

```text
consume_meal()
```

## Deve validar

- tenant;
- matrícula;
- status;
- unidade;
- refeição;
- horário;
- categoria;
- duplicidade;
- preço;
- saldo.

## Integral

```text
1 liberação por tipo de refeição/dia
```

## Parcial

```text
saldo suficiente
↓
débito
↓
consumo
```

## Concorrência

Testar dois terminais simultâneos.

## Critérios

- nenhum saldo negativo;
- nenhum consumo duplicado;
- transação atômica.

---

# 15. SPRINT 11 — Terminal de Recepção

## Interface

Tela única.

Estados:

```text
AGUARDANDO LEITURA
PROCESSANDO
LIBERADO
NÃO LIBERADO
SEM CONEXÃO
```

## Entrada

- scanner USB;
- câmera;
- matrícula manual.

## UX

Fluxo:

```text
ler
→ validar
→ resultado
→ reset
```

## Critérios

- mínima interação;
- leitura contínua;
- sinal visual;
- som opcional;
- foto apenas se existir.

---

# 16. SPRINT 12 — PWA do Aluno

## Parcial

Menu:

```text
Início
Carteirinha
Saldo
Recarga
Extrato
Refeições
Perfil
```

## Integral

Menu:

```text
Início
Carteirinha
Refeições
Perfil
```

Nunca mostrar:

```text
Saldo
Recarga
Extrato
```

## Notificações

- refeição utilizada;
- recarga;
- saldo baixo.

---

# 17. SPRINT 13 — Dashboards

## Admin

Criar:

- diária;
- semanal;
- mensal.

## Indicadores

- refeições;
- café;
- almoço;
- jantar;
- parcial;
- integral;
- valores;
- subsídios;
- recargas;
- bloqueios.

---

# 18. SPRINT 14 — Relatórios

## Internos

Filtros:

- período;
- instituição;
- unidade;
- tipo;
- categoria.

## Universidade

Criar:

```text
RESUMIDO
DETALHADO
```

## Resumido

- quantidade parcial;
- quantidade integral;
- total.

## Detalhado

- matrícula;
- nome;
- categoria;
- data;
- refeição;
- valor;
- subsídio.

## Exportação

```text
PDF
Excel
```

## Template

Usar:

- logo da empresa;
- nome;
- unidade;
- período;
- paginação.

---

# 19. SPRINT 15 — Auditoria e Financeiro

Criar:

```text
audit_logs
refund_requests
reversal_requests
```

## Implementar

- estorno;
- ajuste;
- devolução;
- auditoria.

---

# 20. SPRINT 16 — Segurança

Revisão completa baseada em:

```text
SECURITY.md
```

Testar:

- RLS;
- IDOR;
- tenant isolation;
- QR;
- autorização;
- saldo;
- webhook.

---

# 21. SPRINT 17 — Contingência

Aplicar:

```text
OFFLINE_STRATEGY.md
```

## Implementar

- health check;
- status online/instável/offline;
- retry seguro;
- idempotency key;
- mensagens operacionais.

Não implementar consumo offline irrestrito.

---

# 22. SPRINT 18 — Performance e Carga

Simular:

```text
3.000+ refeições/dia
múltiplos terminais
picos simultâneos
```

Medir:

```text
p50
p95
p99
```

da `consume_meal()`.

---

# 23. SPRINT 19 — Piloto

Selecionar unidade real.

## Preparação

- importar alunos;
- configurar preços;
- configurar refeições;
- criar usuários;
- instalar terminais;
- validar rede.

## Operação

Medir:

- pessoas/minuto;
- tempo médio;
- fila;
- bloqueios;
- erros;
- disponibilidade.

---

# 24. SPRINT 20 — Ajustes pós-piloto

Somente após dados reais.

Classificar:

```text
BUG
AJUSTE
MELHORIA
PÓS-MVP
```

---

# 25. Definition of Done

Nenhuma sprint é concluída apenas porque "funciona na tela".

Deve possuir:

- migration;
- RLS;
- validação;
- testes;
- tratamento de erro;
- responsividade;
- auditoria quando aplicável;
- documentação atualizada.

---

# 26. Regras de desenvolvimento

1. Não alterar migrations já aplicadas.
2. Criar migration nova para mudança.
3. Não desabilitar RLS.
4. Não usar service role no frontend.
5. Não hardcodar tenant.
6. Não duplicar lógica financeira.
7. Não permitir saldo negativo.
8. Não permitir duas refeições do mesmo tipo/dia.
9. Não apagar transações.
10. Não construir módulo futuro antes de necessidade.

---

# 27. Commits

Recomendação:

```text
feat:
fix:
refactor:
test:
docs:
chore:
```

---

# 28. Branches

Sugestão:

```text
main
develop
feature/*
fix/*
```

---

# 29. Homologação

Após cada sprint:

```text
build
↓
testes
↓
staging
↓
homologação
↓
próxima sprint
```

---

# 30. Prompt inicial recomendado para o Antigravity

```text
Leia integralmente os arquivos de documentação do projeto antes de alterar qualquer código.

Considere os arquivos .md como fonte de verdade.

Não implemente módulos futuros sem autorização.

Inicie apenas pela FASE 0 e SPRINT 1 do DEVELOPMENT_PLAN.md.

Antes de criar migrations, apresente:
1. arquivos que serão criados;
2. migrations necessárias;
3. impacto;
4. riscos.

Use Next.js + TypeScript + Supabase.
Mantenha RLS ativa.
Não use service role no frontend.
Não implemente soluções temporárias que contradigam SECURITY.md ou DATABASE.md.
```

---

# 31. Estado atual

```text
DOCUMENTAÇÃO FUNCIONAL: CONCLUÍDA
ARQUITETURA INICIAL: CONCLUÍDA
MODELAGEM INICIAL: CONCLUÍDA
PLANO DE DESENVOLVIMENTO: CONCLUÍDO
IMPLEMENTAÇÃO: PRÓXIMA ETAPA
```

---

**Fim do documento.**
