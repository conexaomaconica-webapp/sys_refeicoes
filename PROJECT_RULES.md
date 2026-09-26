# Project Rules

Antes de alterar código, leia:

1. /docs/DEVELOPMENT_PLAN.md
2. /docs/ARCHITECTURE.md
3. /docs/DATABASE.md
4. /docs/SECURITY.md

Os demais arquivos em /docs complementam essas regras.

Não avance para uma sprint futura sem autorização.
Os documentos em /docs são a fonte de verdade do projeto.

## Regras Obrigatórias de Desenvolvimento
1. Não desabilitar RLS em nenhuma tabela do Supabase.
2. Não expor nem usar `service_role` no frontend.
3. Não criar migrations destrutivas; usar migrations versionadas e incrementais em `supabase/migrations/`.
4. Não avançar para sprints futuras sem homologação e validação da sprint atual.
5. Não alterar regras de negócio sem prévio apontamento de divergência com os documentos em `/docs`.
