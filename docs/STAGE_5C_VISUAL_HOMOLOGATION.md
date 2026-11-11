# Etapa 5C — Homologação Visual e Funcional Local

**Data:** 26/10/2026  
**Rota:** `/demonstracao/central-inteligencia`  
**Ambiente:** build local de produção (`next start`)  
**Dados:** exclusivamente sintéticos  
**Parecer visual:** **GO para encerramento da Etapa 5C**  
**Integração real e produção:** **NO-GO**

## 1. Escopo e proteções

- Nenhuma migration, tabela, policy RLS ou configuração remota foi alterada.
- O protótipo não foi conectado ao Supabase, autenticação ou serviços operacionais.
- A inspeção de recursos carregados no navegador não encontrou requisição ao Supabase.
- As alterações anteriores do cadastro de instituições foram preservadas.
- Nenhum dado real foi utilizado e nenhuma ação externa foi disparada.

## 2. Resultado consolidado

| Área | Resultado | Evidência |
| --- | --- | --- |
| Oito experiências gerenciais | Aprovado | 8/8 rotas internas exercitadas |
| Filtros de período, unidade e categoria | Aprovado | combinação e atualização dinâmica verificadas |
| Indicadores e tendências | Aprovado | valores sintéticos, semântica e contexto revisados |
| Gráficos | Aprovado | legendas, valores visíveis e alternativas textuais |
| Desktop | Aprovado | 1440 × 1000, sem overflow da página |
| Tablet | Aprovado | 768 × 1024, sem overflow da página |
| Celular | Aprovado | 390 × 844, sem overflow da página |
| Estados de carregamento, vazio e indisponibilidade | Aprovado | 4/4 estados funcionais |
| Teclado e foco | Aprovado | 16 controles alcançáveis e foco visível |
| Leitura textual | Aprovado | gráficos preservam rótulos ou alternativa textual |
| Movimento reduzido | Aprovado | animações de carregamento respeitam `prefers-reduced-motion` |
| Consistência financeira | Aprovado | valor facial, recargas e custódia permanecem separados |
| Isolamento de serviços remotos | Aprovado | nenhuma requisição Supabase observada |

A suíte reproduzível `scripts/homologate-stage5c.cjs` concluiu **21/21 verificações**
no build local de produção.

## 3. Evidências visuais

### Oito experiências em desktop

1. [Como está o mês?](evidence/stage5c/01-mes-desktop.jpg)
2. [Estamos atendendo bem?](evidence/stage5c/02-atendimento-desktop.jpg)
3. [Onde está o resultado?](evidence/stage5c/03-resultado-desktop.jpg)
4. [Qual unidade precisa de atenção?](evidence/stage5c/04-unidades-desktop.jpg)
5. [Quem está utilizando o serviço?](evidence/stage5c/05-publico-desktop.jpg)
6. [Onde estamos desperdiçando?](evidence/stage5c/06-desperdicio-desktop.jpg)
7. [Como vamos fechar o mês?](evidence/stage5c/07-previsao-desktop.jpg)
8. [O que exige ação agora?](evidence/stage5c/08-acoes-desktop.jpg)

### Tamanhos principais

- [Desktop — 1440 × 1000](evidence/stage5c/09-responsivo-desktop.jpg)
- [Tablet — 768 × 1024](evidence/stage5c/10-responsivo-tablet.jpg)
- [Celular — 390 × 844](evidence/stage5c/11-responsivo-celular.jpg)

As evidências responsivas mantêm a Unidade Norte selecionada para demonstrar a
persistência funcional do filtro acionado pelo atalho “Ver unidade crítica”.

## 4. Problemas encontrados e correções realizadas

| Severidade | Problema | Correção | Situação |
| --- | --- | --- | --- |
| Alta | “Ver unidade crítica” não executava ação | navegação para Unidades e seleção da Unidade Norte | Corrigido |
| Alta | cards escuros herdavam fundo branco e perdiam contraste | precedência explícita do fundo escuro | Corrigido |
| Média | filtro unitário reaplicava a participação da unidade a valores já unitários | fator da visão de unidades passou a excluir a redução por unidade | Corrigido |
| Média | filtro de categoria não era refletido na composição do público | donut e legenda agora apresentam a categoria selecionada | Corrigido |
| Média | reduções benéficas apareciam com semântica visual negativa | tendência passou a aceitar semântica explícita | Corrigido |
| Média | foco, estados pressionados e leitura de barras estavam incompletos | foco visível, `aria-pressed`, listas semânticas e movimento reduzido | Corrigido |

Não restou falha crítica ou alta conhecida no escopo visual local.

## 5. Consistência gerencial e financeira

- “Valor facial” permanece descrito como referência econômica, não receita líquida.
- “Recargas confirmadas” permanece um fluxo separado das refeições.
- “Saldo em custódia” permanece identificado como obrigação financeira.
- Divergências são apresentadas como exceções operacionais.
- Metas, previsões, alertas e recomendações continuam identificados como fictícios.
- Desperdício e previsão continuam bloqueados para integração e marcados como não homologados.

## 6. Validação técnica final

- `pnpm run lint`: aprovado, sem erros;
- `pnpm run typecheck`: aprovado, sem erros;
- `pnpm run build`: aprovado com Next.js 15.5.28;
- `/demonstracao/central-inteligencia`: rota estática, 11,3 kB;
- homologação funcional no build de produção: 21/21 verificações aprovadas;
- `git diff --check`: aprovado.

O build mantém o aviso preexistente sobre o plugin Next.js não detectado na
configuração do ESLint. O aviso não impediu lint, typecheck ou build.

## 7. Pendências e riscos residuais

- A inspeção de contraste foi visual e baseada nas cores efetivas do protótipo;
  não substitui uma auditoria formal automatizada de WCAG.
- Tooltips nativos do SVG dependem do comportamento do navegador; a alternativa
  textual permanece disponível e é a evidência acessível principal.
- Os dados, metas e fórmulas continuam demonstrativos e não foram aprovados para
  uso contábil ou operacional.
- A homologação não cobre leitores de tela reais em múltiplos sistemas
  operacionais, apenas semântica, foco e conteúdo textual no navegador local.

Nenhum desses itens é crítico ou alto para o encerramento do protótipo visual.

## 8. Parecer

**GO** exclusivamente para encerrar a Etapa 5C — Homologação Visual e Funcional
Local.

Permanece **NO-GO** para produção e para qualquer integração com dados reais. O
avanço continua condicionado aos sete requisitos documentados na Etapa 5B:
correções RLS, repetição dos 31 cenários de segurança, definição do escopo
financeiro por unidade, reconciliação do drift offline, aprovação contábil,
contratos de API/RPC somente leitura e homologação de desempenho/SLA.

A Etapa 6 não foi iniciada e exige autorização expressa.
