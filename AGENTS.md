# Diretrizes para Agentes de IA (AGENTS.md)

Este repositório possui uma documentação funcional e arquitetural detalhada em `/docs`.
Todos os agentes e assistentes que atuarem no projeto devem seguir as diretrizes abaixo:

## Documentos de Referência Obrigatórios
1. [DEVELOPMENT_PLAN.md](file:///d:/Sys_MArefeicoes/docs/DEVELOPMENT_PLAN.md) - Roteiro de fases, sprints e critérios de conclusão.
2. [ARCHITECTURE.md](file:///d:/Sys_MArefeicoes/docs/ARCHITECTURE.md) - Arquitetura de aplicações, layouts e padrões técnicos.
3. [DATABASE.md](file:///d:/Sys_MArefeicoes/docs/DATABASE.md) - Modelagem relacional, tabelas, enums, triggers e constraints.
4. [SECURITY.md](file:///d:/Sys_MArefeicoes/docs/SECURITY.md) - Segurança, RLS, gestão de chaves e permissões.
5. [PERMISSIONS_v1_2.md](file:///d:/Sys_MArefeicoes/docs/PERMISSIONS_v1_2.md) - Matriz de perfis, escopos e ações.
6. [OFFLINE_STRATEGY.md](file:///d:/Sys_MArefeicoes/docs/OFFLINE_STRATEGY.md) - Estratégia de contingência e restrições offline.

## Regras de Execução
- **Fonte de Verdade:** A pasta `/docs` é a única fonte de verdade arquitetural e funcional.
- **Isolamento de Sprints:** Implemente apenas a sprint autorizada pelo usuário. Não avance para sprints futuras por iniciativa própria.
- **Segurança Supabase:** Nunca desabilite Row Level Security (RLS). Nunca utilize ou exponha a chave `SUPABASE_SERVICE_ROLE_KEY` no client-side.
- **Banco de Dados:** Todas as migrations devem ser salvas em `supabase/migrations/`, nomeadas com timestamp/sequência, e nunca devem ser destrutivas.
- **Validação:** Ao finalizar cada sprint, execute obrigatoriamente `npm run build`, linting e typecheck para garantir estabilidade contínua.
