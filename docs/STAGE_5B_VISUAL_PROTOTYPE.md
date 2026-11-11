# Etapa 5B — Protótipo Visual da Central de Inteligência

**Status:** pronto para homologação visual local  
**Rota:** `/demonstracao/central-inteligencia`  
**Dados:** exclusivamente sintéticos  
**Produção:** **NO-GO**

## Validação técnica

Validação local concluída em 26/10/2026:

- `pnpm run lint`: aprovado, sem erros;
- `pnpm run typecheck`: aprovado, sem erros;
- `pnpm run build`: aprovado com Next.js 15.5.28;
- rota `/demonstracao/central-inteligencia`: gerada estaticamente no build.

O aviso do build sobre a ausência do plugin Next.js na configuração do ESLint é
preexistente e não impediu nenhuma das verificações. Esta validação não altera o
NO-GO para integração com dados reais nem para produção.

## Objetivo

O protótipo demonstra a experiência gerencial da futura Central de Inteligência sem consultar Supabase, autenticação, RPCs financeiras ou serviços operacionais.

O `BrandProvider` ignora o carregamento remoto de branding somente no prefixo da demonstração. As demais rotas mantêm o comportamento existente.

## Experiências navegáveis

1. Como está o mês?
2. Estamos atendendo bem?
3. Onde está o resultado?
4. Qual unidade precisa de atenção?
5. Quem está utilizando o serviço?
6. Onde estamos desperdiçando?
7. Como vamos fechar o mês?
8. O que exige ação agora?

Desperdício e previsão permanecem identificados como conceitos sem dados homologados.

## Componentes

- `IntelligenceDemo`: composição da página, navegação, filtros e estados.
- `MetricCard`: indicadores com contexto, tendência e semântica de cor.
- `Insight`: recomendação contextual com níveis visualmente distintos.
- `TrendChart`: evolução de 12 meses, meta fictícia e alternativa textual.
- `HorizontalBars`: comparações ordenadas com valores sempre visíveis.
- `AudienceDonut`: composição agregada por categoria com legenda textual.
- `data.ts`: biblioteca isolada de dados, filtros e formatadores sintéticos.

## Interatividade

- navegação em pílulas entre as oito perguntas;
- filtros de período, unidade e categoria;
- atualização dinâmica de todos os valores demonstrativos;
- estados de dados, carregamento, vazio e indisponibilidade;
- tooltips nativos nos pontos do gráfico;
- alternativas textuais para gráficos;
- alertas com responsável e prazo fictícios;
- responsividade para celular, tablet e desktop.

## Regras financeiras representadas

- valor facial não é rotulado como receita líquida;
- recargas confirmadas aparecem separadas do valor facial;
- saldo em custódia aparece como obrigação financeira;
- divergências mostram exceção operacional;
- metas, tendências, alertas e recomendações são identificados como fictícios.

## Integração futura

A integração com dados reais permanece bloqueada até:

1. aprovação das correções RLS da Etapa 5A;
2. nova homologação dos 31 cenários de segurança;
3. definição do escopo financeiro por unidade;
4. reconciliação do drift do schema offline;
5. aprovação contábil dos nomes e fórmulas;
6. contrato de API/RPC somente leitura para cada indicador;
7. homologação de índices, concorrência e SLA.

Os primeiros indicadores candidatos à integração gradual são refeições servidas e volume por restaurante, somente após os gates acima.

## Arquivos

- `src/app/demonstracao/central-inteligencia/page.tsx`
- `src/components/intelligence-demo/IntelligenceDemo.tsx`
- `src/components/intelligence-demo/DemoCharts.tsx`
- `src/components/intelligence-demo/data.ts`
- `src/components/branding/BrandProvider.tsx`
- `docs/STAGE_5B_VISUAL_PROTOTYPE.md`
