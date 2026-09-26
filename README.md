# Sistema de Controle de Refeições

Plataforma de alta disponibilidade para controle de acesso, recarga de saldo, validação de subsídios e registro de consumo de refeições em restaurantes universitários, concebida para suporte multiunidade e modelo SaaS.

---

## 🛠 Stack Tecnológica

- **Framework Web:** [Next.js](https://nextjs.org/) (App Router, React 19)
- **Linguagem:** [TypeScript](https://www.typescriptlang.org/)
- **Backend & Auth:** [Supabase](https://supabase.com/) (PostgreSQL + RLS + Supabase Auth + Storage)
- **Estilização:** CSS Moderno / Design Tokens (Sem dependência de Tailwind)
- **Mobilidade:** Progressive Web App (PWA) instalável
- **Padronização:** ESLint + Prettier

---

## 📁 Estrutura do Projeto

A organização de pastas segue estritamente `/docs/DEVELOPMENT_PLAN.md` e `/docs/ARCHITECTURE.md`:

```text
src/
├── app/                  # Rotas e páginas (App Router)
│   ├── (public)/         # Splash e login
│   ├── (student)/        # PWA do aluno (carteirinha, saldo, recargas, refeições)
│   ├── (admin)/          # Painel de gestão (instituições, unidades, regras)
│   ├── (reception)/      # Terminal de recepção e leitura rápida de QR
│   └── (institution)/    # Portal e relatórios da universidade
├── components/           # Componentes reaproveitáveis de UI
│   └── ui/
├── features/             # Módulos organizados por domínio de negócio
├── lib/
│   └── supabase/         # Clientes Supabase (Browser, Server SSR, Admin)
├── server/               # Server actions e mutações seguras de backend
├── services/             # Abstrações de provedores externos (ex: gateway)
├── hooks/                # React Hooks personalizados
├── types/                # Definições de tipagem TypeScript e schema Supabase
└── utils/                # Funções utilitárias puras
supabase/
└── migrations/           # Migrations SQL versionadas e sequenciais
```

---

## 🔒 Princípios de Segurança e Regras do Projeto

Conforme definido em `PROJECT_RULES.md` e `SECURITY.md`:

1. **RLS (Row Level Security):** Nunca desabilite RLS nas tabelas do Supabase.
2. **Service Role:** A chave `SUPABASE_SERVICE_ROLE_KEY` é estritamente de servidor e **nunca** deve ser prefixada com `NEXT_PUBLIC_` ou exposta no frontend.
3. **Isolamento Multi-tenant:** Todas as tabelas e consultas respeitam o escopo do `tenant_id`.
4. **Idempotência Financeira:** Operações de débito e recarga são atômicas e rastreáveis; registros financeiros nunca são excluídos fisicamente.
5. **Validação Contínua:** Nenhuma sprint é dada como concluída sem validação via `npm run build` e typechecking.

---

## 🚀 Como Executar

### 1. Pré-requisitos
- Node.js 18+ (recomendado Node 20 ou 22+)
- npm ou pnpm

### 2. Configuração de Variáveis de Ambiente
Copie o arquivo de exemplo e preencha suas credenciais do Supabase:
```bash
cp .env.example .env.local
```

### 3. Instalação das Dependências
```bash
npm install
```

### 4. Execução em Desenvolvimento
```bash
npm run dev
```
Acesse [http://localhost:3000](http://localhost:3000).

### 5. Verificação e Build de Produção
```bash
npm run typecheck
npm run lint
npm run build
```

---

## 🗺 Roteiro de Desenvolvimento (Fases e Sprints)

- [x] **FASE 0:** Preparação da Base Técnica, Next.js, Supabase SSR e Governança
- [ ] **SPRINT 1:** Fundação SaaS e Branding (`tenants`, `institutions`, `units`, splash)
- [ ] **SPRINT 2:** Autenticação, Perfis e Permissões (`profiles`, RLS)
- [ ] **SPRINT 3:** Cadastro de Alunos
- [ ] **SPRINT 4:** Importação em Lote via Planilha
- [ ] **SPRINT 5:** Tipos de Refeição e Regras de Preço
- [ ] **SPRINT 6:** Carteira Financeira e Movimentações
- [ ] **SPRINT 7:** Recarga e Sandbox de Pagamento
- [ ] **SPRINT 8:** Gateway de Pagamento Real (Pix / Cartão)
- [ ] **SPRINT 9:** Carteirinha e Tokens de QR Code
- [ ] **SPRINT 10:** Função Transacional Crítica `consume_meal()`
- [ ] **SPRINT 11:** Terminal de Recepção de Alta Velocidade
- [ ] **SPRINT 12:** PWA do Aluno
- [ ] **SPRINT 13:** Dashboards Operacionais e Gerenciais
- [ ] **SPRINT 14:** Relatórios Gerenciais e Faturamento
- [ ] **SPRINT 15:** Auditoria e Estornos
- [ ] **SPRINT 16:** Auditoria de Segurança Completa
- [ ] **SPRINT 17:** Estratégia de Contingência e Instabilidade
- [ ] **SPRINT 18:** Testes de Carga e Concorrência
- [ ] **SPRINT 19:** Operação Piloto
- [ ] **SPRINT 20:** Ajustes Pós-Piloto
