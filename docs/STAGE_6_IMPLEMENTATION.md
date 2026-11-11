# Etapa 6 — Preparação Arquitetural e Funcional para Integração

**Data:** 26/10/2026  
**Escopo:** desenvolvimento e testes exclusivamente locais  
**Desenvolvimento local:** **GO**  
**Integração com dados reais:** **NO-GO**  
**Produção:** **NO-GO**

## 1. Objetivo e limites

A Etapa 6 transformou o protótipo homologado da Central de Inteligência em uma
estrutura preparada para receber um fornecedor real no futuro, sem conectar o
Supabase, executar migrations, alterar RLS, realizar deploy ou usar dados reais.

Não foi localizado um documento independente `STAGE_5A`. Os bloqueios atribuídos
à Etapa 5A estão registrados em `STAGE_4B_HOMOLOGATION_REPORT.md` e reiterados nas
Etapas 5B e 5C; eles foram tratados como gates obrigatórios, não como autorização
para correção remota.

## 2. Arquitetura implementada

```text
Central de Inteligência (UI)
            │
            ▼
useIntelligenceSnapshot(filters)
            │
            ▼
IntelligenceDataProvider (contrato assíncrono somente leitura)
            │
            ├── SyntheticIntelligenceProvider  ← padrão atual
            │       ├── ready
            │       ├── empty
            │       └── unavailable
            │
            └── provider remoto futuro         ← bloqueado por gates
```

### 6.1 — Contratos tipados

- filtros tipados de período, unidade e categoria;
- contexto de acesso com tenant, perfil, status, instituições e unidades;
- contrato único de snapshot para resumo, atendimento, tendência, unidades,
  público, composição financeira e ações;
- resultado discriminado em `ready`, `empty` e `unavailable`;
- interface assíncrona `IntelligenceDataProvider`, sem dependência de Supabase.

### 6.2 — Indicadores operacionais

Foram preparados no fornecedor sintético:

1. refeições servidas;
2. volume por restaurante;
3. utilização por categoria;
4. comparativo por período.

O snapshot também preserva os conceitos visuais já homologados de valor facial,
recargas confirmadas, saldo em custódia e divergências. Esses indicadores
financeiros continuam sintéticos e bloqueados para integração.

O provider centraliza fatores, agregações e filtros. A UI deixou de recalcular os
dados-base, reduzindo risco de dupla aplicação de filtros.

### 6.3 — Governança e segurança

Foi implementado um catálogo de indicadores com:

- classificação operacional ou financeira;
- tipo de agregação;
- escopos exigidos: tenant, instituição e unidade;
- tabelas candidatas, apenas como documentação arquitetural;
- situação `candidate` ou `blocked`;
- bloqueadores específicos por indicador.

A matriz local de perfis estabelece:

| Perfil | Escopo futuro da Central | Classes permitidas no contrato |
| --- | --- | --- |
| Master | tenant | operacional e financeira |
| Diretor Operacional | tenant | operacional e financeira |
| Financeiro | tenant | operacional e financeira |
| Supervisor | unidades atribuídas | operacional |
| Gerente de Unidade | própria unidade | operacional |
| Operador | nenhum | nenhuma |
| Usuário Institucional | instituições atribuídas | operacional |
| Consumidor | nenhum | nenhuma |

Essa matriz não concede permissões no banco. Ela apenas define requisitos que um
provider remoto futuro deverá revalidar server-side e por RLS.

`evaluateRemoteIntegrationReadiness(...)` mantém qualquer provider remoto
bloqueado enquanto faltar tenant, perfil ativo, escopo, classificação permitida
ou um dos gates de integração.

### 6.4 — Testes e integração local

- a Central passou a consumir o hook desacoplado;
- o fornecedor sintético permanece o padrão e rejeita contexto remoto;
- mudanças de filtro disparam nova leitura assíncrona;
- carregamento, vazio e indisponibilidade continuam representados de modo seguro;
- a regressão visual da Etapa 5C foi reutilizada sem conexão externa;
- a rota continua estática no build de produção.

## 3. Arquivos criados

- `src/features/intelligence/contracts.ts`
- `src/features/intelligence/indicator-catalog.ts`
- `src/features/intelligence/access-policy.ts`
- `src/features/intelligence/providers/synthetic-intelligence.provider.ts`
- `src/features/intelligence/use-intelligence-snapshot.ts`
- `scripts/validate-stage6.cjs`
- `docs/STAGE_6_IMPLEMENTATION.md`
- `docs/evidence/stage6/*`

## 4. Arquivos modificados

- `src/components/intelligence-demo/IntelligenceDemo.tsx`
- `src/components/intelligence-demo/DemoCharts.tsx`
- `src/components/intelligence-demo/data.ts`
- `scripts/homologate-stage5c.cjs` — diretório de evidências configurável;
- `package.json` — comando `validate:stage6`.

As alterações preexistentes do cadastro de instituições foram preservadas.

## 5. Testes executados

### Suíte arquitetural da Etapa 6

Comando: `pnpm run validate:stage6`

Resultado: **17/17 aprovado**.

Cobertura:

- provider sintético padrão;
- contratos dos quatro indicadores prioritários;
- comparativo e agregações;
- filtros por unidade e categoria sem dupla redução;
- separação dos conceitos financeiros;
- estados vazio e indisponível;
- rejeição de contexto remoto pelo provider sintético;
- gates de integração;
- restrições de perfil;
- ausência de importação Supabase;
- consumo da abstração pelo protótipo.

### Regressão funcional e visual

Resultado: **21/21 aprovado**.

- oito experiências navegáveis;
- filtros combinados;
- ação “Ver unidade crítica”;
- quatro estados da interface;
- teclado e foco visível;
- desktop, tablet e celular sem overflow;
- nenhuma requisição Supabase observada.

Evidências:

- [Desktop](evidence/stage6/09-responsivo-desktop.jpg)
- [Tablet](evidence/stage6/10-responsivo-tablet.jpg)
- [Celular](evidence/stage6/11-responsivo-celular.jpg)
- as oito experiências estão registradas de `01-mes-desktop.jpg` a
  `08-acoes-desktop.jpg` no mesmo diretório.

### Gates finais

- `pnpm run typecheck`: aprovado;
- `pnpm run lint`: aprovado;
- `pnpm run build`: aprovado;
- rota `/demonstracao/central-inteligencia`: estática, 11,9 kB;
- `git diff --check`: aprovado.

O build preserva o aviso preexistente de que o plugin Next.js não foi detectado
na configuração do ESLint. O aviso não bloqueou lint, typecheck ou build.

## 6. Pendências e riscos

1. As 13 falhas RLS identificadas na Etapa 4B continuam sem correção e sem
   autorização nesta etapa.
2. Os 31 cenários de segurança precisam ser reexecutados após correções futuras.
3. O drift do schema e das policies offline continua pendente.
4. O vínculo canônico entre comensal, instituição, unidade, carteira, pagamento e
   recarga ainda precisa de decisão arquitetural e migration própria futura.
5. Nomes e fórmulas financeiras ainda dependem de aprovação contábil.
6. Não existe contrato RPC/API real homologado para os indicadores.
7. Índices, concorrência, cache e SLA ainda não foram homologados com RLS real.
8. O catálogo atual documenta fontes candidatas; ele não autoriza consulta direta
   dessas tabelas pelo navegador.

## 7. Critérios para futura integração real

Um provider remoto só poderá ser implementado e ativado após:

1. corrigir RLS e aprovar integralmente os 31 cenários de segurança;
2. reconciliar o drift do schema e das policies offline;
3. definir o vínculo canônico e o escopo financeiro por unidade;
4. aprovar nomes, fórmulas e regras de arredondamento contábil;
5. disponibilizar API/RPC exclusivamente de leitura, com `search_path` fixo quando
   houver `SECURITY DEFINER`;
6. validar tenant, perfil ativo e escopos em todas as consultas;
7. impedir que operador, consumidor ou perfil inativo acesse a Central;
8. homologar índices, concorrência, paginação, cache e SLA;
9. provar que respostas financeiras e privadas não são armazenadas pelo service
   worker;
10. executar nova regressão funcional, visual e de segurança antes de qualquer
    liberação.

## 8. Parecer de homologação local

**GO** para concluir a Etapa 6 como preparação arquitetural e funcional local.

O protótipo homologado agora possui contratos tipados, provider desacoplado,
fonte sintética padrão, indicadores prioritários, matriz de governança e testes
reproduzíveis.

Permanece **NO-GO** para integrar dados reais, alterar o Supabase, executar
migrations, realizar deploy ou operar em produção. Nenhum commit foi criado.
