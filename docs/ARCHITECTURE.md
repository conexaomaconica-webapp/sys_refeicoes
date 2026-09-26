# ARCHITECTURE.md
## Arquitetura Funcional e Técnica
**Projeto:** Sistema de Controle de Refeições  
**Versão:** 1.0  
**Status:** Arquitetura inicial do MVP  
**Stack:** Antigravity + Next.js + Supabase + PWA  
**Documentos relacionados:**  
- `SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md`
- `PERMISSIONS_v1_2.md`
- `FLOWS_v1_1.md`
- `MVP.md`

---

# 1. Objetivo

Este documento define a arquitetura funcional e técnica da primeira versão do sistema.

A arquitetura deve suportar:

- operação multiunidade;
- separação por tenant;
- controle por instituição;
- PWA para alunos;
- painel administrativo;
- terminal de recepção;
- carteira financeira;
- recargas;
- consumo;
- relatórios;
- auditoria;
- expansão futura para SaaS.

---

# 2. Stack principal

## Frontend / Web

```text
Next.js
TypeScript
React
PWA
```

## Backend

```text
Supabase
PostgreSQL
Supabase Auth
Supabase Storage
RLS
Database Functions / RPC
Edge Functions quando necessário
```

## Desenvolvimento

```text
Antigravity
Git
Migrations versionadas
```

---

# 3. Visão geral da arquitetura

```text
                    ┌──────────────────────┐
                    │      USUÁRIOS        │
                    └──────────┬───────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌────────────────┐   ┌────────────────┐   ┌────────────────────┐
│ PWA DO ALUNO   │   │ ADMIN / GESTÃO │   │ RECEPÇÃO / TERMINAL │
└───────┬────────┘   └───────┬────────┘   └──────────┬─────────┘
        │                    │                       │
        └──────────────┬─────┴───────────────┬──────┘
                       ▼                     ▼
                ┌────────────────────────────────┐
                │          NEXT.JS APP           │
                │  UI + Server Actions + APIs    │
                └──────────────┬─────────────────┘
                               │
                               ▼
                ┌────────────────────────────────┐
                │            SUPABASE            │
                │ Auth / DB / Storage / RLS      │
                └───────┬─────────┬──────────────┘
                        │         │
                        ▼         ▼
                 PostgreSQL   Storage
                        │
                        ▼
              RPC / Functions críticas
```

---

# 4. Aplicações do sistema

O sistema será composto por três experiências principais.

---

# 5. PWA do aluno

Aplicação web responsiva instalável.

Responsável por:

- login;
- carteirinha;
- histórico de refeições;
- notificações;
- perfil;
- saldo, para alunos parciais;
- recarga, para alunos parciais;
- extrato, para alunos parciais.

---

# 6. Splash animado

Antes da tela de login, a PWA deverá possuir um splash animado.

Objetivos:

- reforçar identidade da marca;
- criar uma abertura premium;
- mascarar carregamento inicial;
- melhorar percepção de qualidade;
- preparar sessão e configuração antes do login.

---

## 6.1 Fluxo do splash

```text
Abrir PWA
        ↓
Splash animado
        ↓
Carregar configuração do tenant
        ↓
Verificar sessão
        ↓
Sessão válida?
   ┌────┴─────┐
   │          │
  SIM        NÃO
   │          │
   ▼          ▼
Dashboard    Login
```

---

## 6.2 Conteúdo do splash

Elementos previstos:

- logomarca da empresa;
- nome do sistema/produto;
- animação leve;
- fundo institucional;
- indicador de carregamento discreto.

Evitar:

- animações longas;
- vídeos pesados;
- bloqueio desnecessário do usuário.

---

## 6.3 Duração

Recomendação:

```text
mínimo visual: ~800ms
máximo desejado: ~2s
```

Se o carregamento já tiver concluído, a animação não deve prolongar artificialmente a entrada.

---

## 6.4 Tecnologia

Preferir:

```text
CSS animations
Framer Motion
SVG animado
```

Evitar arquivos de vídeo pesados.

---

# 7. Login

Após o splash:

```text
Login
```

Fluxo:

```text
usuário informa credencial
↓
Supabase Auth
↓
sessão criada
↓
perfil identificado
↓
tenant identificado
↓
escopo carregado
↓
redirecionamento
```

---

# 8. Redirecionamento por perfil

```text
student
→ PWA aluno

operator
→ recepção

unit_manager
→ dashboard da unidade

supervisor
→ dashboard multiunidade

finance
→ dashboard financeiro

operations_director
→ dashboard operacional

admin_general
→ administração global

institution_user
→ portal institucional
```

---

# 9. Layouts separados

Recomenda-se separar layouts por contexto:

```text
/app
/admin
/reception
/institution
```

Exemplo conceitual:

```text
/app/*
/admin/*
/reception/*
/institution/*
```

---

# 10. Estrutura sugerida do Next.js

```text
src/
├── app/
│   ├── (public)/
│   │   ├── splash/
│   │   └── login/
│   │
│   ├── (student)/
│   │   ├── home/
│   │   ├── card/
│   │   ├── recharge/
│   │   ├── statement/
│   │   ├── meals/
│   │   └── profile/
│   │
│   ├── (admin)/
│   │   ├── dashboard/
│   │   ├── institutions/
│   │   ├── units/
│   │   ├── students/
│   │   ├── categories/
│   │   ├── finance/
│   │   ├── reports/
│   │   ├── users/
│   │   └── settings/
│   │
│   ├── (reception)/
│   │   └── reception/
│   │
│   └── (institution)/
│       ├── dashboard/
│       └── reports/
│
├── components/
├── features/
├── lib/
├── server/
├── services/
├── hooks/
├── types/
└── utils/
```

---

# 11. Princípio de domínio

Evitar organizar toda a aplicação apenas por tela.

Preferir também organização por domínio.

Exemplo:

```text
features/
├── students/
├── meals/
├── wallets/
├── recharges/
├── reception/
├── reports/
├── permissions/
└── notifications/
```

---

# 12. Supabase

O Supabase será responsável por:

```text
Auth
PostgreSQL
RLS
Storage
Realtime, se necessário
Functions
Edge Functions
```

---

# 13. Auth

Perfis internos e alunos utilizarão Supabase Auth.

Não armazenar senha diretamente em tabelas próprias.

Tabela de perfil conceitual:

```text
profiles
```

Relacionada com:

```text
auth.users
```

---

# 14. Tenant

Mesmo no MVP, a arquitetura deve ser preparada para multi-tenant.

Estrutura:

```text
tenant
↓
institutions
↓
units
```

Todas as entidades importantes devem ser associadas ao tenant.

---

# 15. Entidades conceituais

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
report_templates
```

---

# 16. Tipos de refeição

Tabela conceitual:

```text
meal_types
```

Registros iniciais:

```text
BREAKFAST
LUNCH
DINNER
```

Exibição:

```text
Café da manhã
Almoço
Jantar
```

---

# 17. Regras de refeição por unidade

Tabela conceitual:

```text
meal_rules
```

Deve permitir definir:

```text
unit_id
meal_type_id
category_id
student_price
subsidy_value / full_value
start_time
end_time
enabled
```

---

# 18. Categorias

Mínimo:

```text
PARTIAL
INTEGRAL
```

---

# 19. Parcial

Características:

- possui carteira;
- possui saldo;
- pode recarregar;
- possui extrato;
- paga valor conforme regra.

---

# 20. Integral

Características:

- não possui saldo;
- não possui recarga;
- não possui extrato financeiro;
- possui 1 acesso por tipo de refeição habilitado por dia;
- valor do aluno = R$ 0,00.

---

# 21. Carteira

Arquitetura:

```text
wallets
wallet_transactions
```

Não armazenar lógica financeira apenas no frontend.

---

# 22. Saldo

Pode existir campo de saldo materializado para performance.

Mesmo assim:

```text
wallet_transactions
```

deve ser o histórico contábil.

Qualquer estratégia de saldo materializado deve preservar integridade transacional.

---

# 23. Recargas

Fluxo:

```text
PWA
↓
Next.js
↓
Gateway
↓
Webhook
↓
Backend
↓
wallet_transaction
↓
saldo
```

---

# 24. Gateway

Ainda não definido.

A arquitetura deve abstrair o provedor.

Interface conceitual:

```text
PaymentProvider
```

Métodos:

```text
createPixCharge()
createCardCharge()
getPaymentStatus()
refundPayment()
verifyWebhook()
```

---

# 25. Webhooks

Webhooks devem:

- validar assinatura;
- ser idempotentes;
- registrar tentativa;
- não duplicar crédito;
- atualizar pagamento;
- gerar transação financeira.

---

# 26. Terminal de recepção

Pode rodar em:

- desktop;
- tablet;
- notebook;
- celular compatível.

A interface deve ser extremamente simples.

---

# 27. Scanner

Suportar:

```text
scanner USB
camera
entrada manual
```

Scanner USB geralmente funciona como teclado.

O frontend deve manter foco preparado para nova leitura.

---

# 28. Fluxo técnico da recepção

```text
scanner lê QR
↓
frontend extrai token
↓
chama consume_meal()
↓
backend valida
↓
retorna resultado
↓
interface mostra status
↓
reset automático
```

---

# 29. consume_meal()

A operação crítica deve rodar no backend.

Preferência:

```text
PostgreSQL Function / RPC
```

ou operação server-side com garantia transacional.

---

# 30. Responsabilidades de consume_meal()

```text
validar tenant
validar unidade
resolver matrícula
validar aluno
validar status
validar categoria
validar tipo de refeição
validar horário
verificar duplicidade
buscar regra financeira
calcular cobrança
verificar saldo
registrar consumo
registrar débito
atualizar saldo
retornar resposta
```

---

# 31. Constraint contra duplicidade

Criar proteção de banco para impedir:

```text
mesmo student_id
+
mesma data operacional
+
mesmo meal_type_id
+
mesma regra/unidade quando aplicável
```

A regra exata será definida em `DATABASE.md`.

---

# 32. QR Code

O QR deve apontar para um identificador seguro.

Não é necessário mostrar a matrícula diretamente.

Fluxo:

```text
qr_token
↓
student
↓
matrícula
```

A validação de negócio continua sendo pela matrícula.

---

# 33. Foto

Armazenar no Supabase Storage.

Campo:

```text
photo_url
```

Opcional.

Nunca bloquear acesso por ausência de foto.

---

# 34. Storage

Buckets conceituais:

```text
student-photos
tenant-assets
report-assets
```

---

# 35. Relatórios

Relatórios podem ser gerados server-side.

Formato:

```text
PDF
Excel
```

---

# 36. Template institucional

Tabela/configuração:

```text
report_templates
```

Dados:

```text
tenant_id
logo_url
company_name
header_text
footer_text
primary_color
secondary_color
```

Evitar hardcode da marca.

---

# 37. Relatório universidade

Dois modos:

```text
summary
detailed
```

---

# 38. Summary

Retorna:

- total parcial;
- total integral;
- total geral;
- período;
- unidade;
- instituição.

---

# 39. Detailed

Retorna:

- matrícula;
- nome;
- categoria;
- refeição;
- data;
- unidade;
- valor pago;
- subsídio.

---

# 40. Dashboard

Consultas agregadas.

Evitar carregar registros individuais quando só for necessário agregado.

Possíveis estratégias:

```text
SQL Views
Materialized Views, se necessário
RPC agregada
```

---

# 41. Auditoria

Tabela:

```text
audit_logs
```

Registrar ações críticas.

Não usar auditoria como simples console log.

---

# 42. RLS

RLS obrigatória em tabelas sensíveis.

Políticas por:

```text
tenant
user
role
institution
unit
```

---

# 43. Service Role

Nunca usar service role no frontend.

Uso apenas em ambiente seguro:

```text
server
edge function
backend controlado
```

---

# 44. Server Actions

Podem ser usadas para ações administrativas simples.

Operações críticas financeiras devem preferir funções transacionais.

---

# 45. Edge Functions

Usar quando necessário para:

- webhooks;
- integração externa;
- tarefas server-side específicas;
- chamadas seguras a provedores.

Não usar Edge Function sem necessidade.

---

# 46. Realtime

Não é obrigatório no MVP.

Pode ser utilizado futuramente para:

- dashboard em tempo real;
- atualização de recarga;
- status de recepção.

Priorizar simplicidade no MVP.

---

# 47. Notificações

No MVP:

- notificações internas no PWA.

Opcional posteriormente:

- push web;
- e-mail;
- WhatsApp.

---

# 48. Estado da aplicação

Evitar estado global excessivo.

Preferir:

```text
Server Components
queries server-side
cache controlado
state local
```

Usar stores globais apenas quando realmente necessário.

---

# 49. Cache

Dados que podem ser cacheados:

- identidade visual;
- tipos de refeição;
- configurações estáveis.

Não cachear de forma insegura:

- saldo;
- status de consumo;
- liberação.

---

# 50. PWA

Recursos:

```text
manifest
ícone
instalação
standalone
splash
cache de assets
```

Não implementar offline financeiro completo no MVP.

---

# 51. Splash e PWA

O splash deve funcionar tanto:

- em acesso via navegador;
- em modo instalado.

No modo instalado, considerar o splash nativo do sistema + splash interno da aplicação.

Evitar duplicação visual excessiva.

---

# 52. Tema visual

A aplicação deve possuir sistema de tema por tenant.

Configurações:

```text
logo
nome
cores
ícone
splash
relatório
```

---

# 53. Configuração do splash

Estrutura conceitual:

```text
tenant_branding
```

Campos possíveis:

```text
logo_url
splash_background
splash_animation_type
splash_duration
app_name
```

---

# 54. Performance

Prioridades:

1. recepção;
2. consume_meal();
3. saldo;
4. recarga;
5. dashboard.

---

# 55. Meta de interação da recepção

Fluxo:

```text
scan
→ request
→ result
→ reset
```

Sem navegação entre telas.

---

# 56. Observabilidade

Registrar:

- erros críticos;
- falha de pagamento;
- falha de webhook;
- falha de consumo;
- latência de consume_meal();
- indisponibilidade.

---

# 57. Logs

Separar:

```text
audit logs
application logs
payment logs
```

Não misturar propósitos.

---

# 58. Tratamento de erro

Frontend deve receber:

```text
code
message
context seguro
```

Evitar expor detalhes internos do banco.

---

# 59. Códigos de erro

Exemplo:

```text
STUDENT_NOT_FOUND
STUDENT_INACTIVE
MEAL_ALREADY_USED
INSUFFICIENT_BALANCE
OUTSIDE_MEAL_WINDOW
SYSTEM_UNAVAILABLE
```

---

# 60. Segurança

Princípios:

- least privilege;
- RLS;
- server-side validation;
- idempotência;
- logs;
- dados sensíveis protegidos;
- sem service role no cliente.

---

# 61. LGPD

O sistema deverá considerar:

- minimização de dados;
- finalidade;
- retenção;
- controle de acesso;
- logs;
- proteção da foto;
- política de exclusão/anomização futura.

Detalhar em `SECURITY.md`.

---

# 62. Offline

Não implementar offline financeiro completo no MVP.

Criar depois:

```text
OFFLINE_STRATEGY.md
```

---

# 63. Disponibilidade

O terminal deve detectar:

- perda de rede;
- backend indisponível;
- timeout.

Mostrar status claro ao operador.

---

# 64. Timeout

Não deixar a interface travada indefinidamente.

Definir timeout operacional curto e fallback visual.

---

# 65. Banco

Todas as alterações devem ser feitas por migrations versionadas.

Não editar produção manualmente sem migration correspondente.

---

# 66. Migrations

Estrutura:

```text
supabase/migrations/
```

Uma migration por alteração lógica.

Evitar arquivo único gigante.

---

# 67. Ambientes

Recomendado:

```text
local
staging
production
```

---

# 68. Variáveis de ambiente

Separar:

```text
public
server-only
```

Nunca expor:

```text
service_role_key
gateway_secret
webhook_secret
```

---

# 69. Testes

Cobrir:

- permissões;
- RLS;
- consume_meal();
- recargas;
- duplicidade;
- integral;
- parcial;
- relatórios.

---

# 70. Teste de carga

Obrigatório antes do piloto.

Simular:

- centenas de leituras;
- múltiplos terminais;
- acessos concorrentes;
- pico de refeição.

---

# 71. CI/CD

Recomendado:

```text
lint
typecheck
test
build
migration validation
deploy
```

---

# 72. Estratégia de deploy

Aplicação Next.js:

```text
Vercel ou infraestrutura equivalente
```

Supabase:

```text
projeto dedicado
```

A escolha final de hospedagem será feita posteriormente.

---

# 73. Fluxo de inicialização

```text
abrir aplicação
↓
carregar branding
↓
mostrar splash
↓
verificar sessão
↓
carregar perfil
↓
resolver escopo
↓
redirecionar
```

---

# 74. Splash para usuário autenticado

Se o usuário já estiver autenticado:

```text
splash
↓
validação rápida
↓
dashboard
```

Não mostrar login novamente.

---

# 75. Splash para primeira abertura

```text
splash
↓
login
```

---

# 76. Splash e erro

Se houver erro ao carregar configuração:

```text
splash
↓
estado de erro
↓
tentar novamente
```

Evitar loop infinito.

---

# 77. Splash e acessibilidade

A animação deve respeitar:

```text
prefers-reduced-motion
```

Quando ativo:

```text
reduzir ou remover animação
```

---

# 78. Arquitetura de permissões

Criar helper central:

```text
can(user, action, resource)
```

ou modelo equivalente.

Nunca espalhar condicionais de role sem padronização.

---

# 79. Navegação por perfil

Menus devem ser derivados de permissão.

Não apenas de role.

---

# 80. API interna

Evitar criar endpoints redundantes.

Preferir:

- Server Actions;
- Route Handlers;
- RPC;
- funções compartilhadas.

---

# 81. Arquitetura do relatório PDF

Fluxo:

```text
usuário solicita relatório
↓
server valida permissão
↓
consulta dados
↓
aplica template
↓
gera PDF
↓
retorna arquivo
```

---

# 82. Excel

Fluxo semelhante:

```text
consulta
↓
transformação
↓
arquivo XLSX
```

---

# 83. Escalabilidade

Preparar para:

- múltiplas universidades;
- múltiplas cidades;
- milhares de alunos;
- milhares de refeições diárias;
- múltiplos terminais simultâneos.

---

# 84. Evoluções futuras

Arquitetura deve permitir:

- catraca;
- biometria;
- reconhecimento facial;
- NFC;
- totem;
- app nativo;
- integração acadêmica;
- ERP.

---

# 85. Não implementar agora

Não incluir no MVP técnico:

- app nativo;
- reconhecimento facial;
- biometria;
- NFC;
- catraca;
- totem;
- offline financeiro irrestrito.

---

# 86. Ordem técnica recomendada

```text
1. setup Next.js
2. setup Supabase
3. auth
4. tenants
5. branding
6. splash
7. perfis
8. instituições
9. unidades
10. alunos
11. categorias
12. tipos de refeição
13. regras de preço
14. carteiras
15. recargas
16. QR
17. consume_meal()
18. recepção
19. PWA
20. relatórios
21. dashboard
22. auditoria
23. testes
24. carga
25. piloto
```

---

# 87. Próximo documento

Após este arquivo:

```text
DATABASE.md
```

deve definir:

- tabelas;
- colunas;
- tipos;
- FKs;
- constraints;
- índices;
- enums;
- RLS;
- funções críticas.

---

# 88. Fonte de verdade

Este documento define a arquitetura inicial do MVP.

Alterações estruturais relevantes devem ser registradas antes de implementação definitiva.

---

**Fim do documento.**
