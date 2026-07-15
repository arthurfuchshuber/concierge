
# Nova página Engajamento — Behavioral Analytics

Reconstrução do zero de `admin.engajamento.tsx`. Todo o conteúdo atual (5 abas, cards numéricos, tabelas brutas) será removido. Nenhuma outra tela do sistema é tocada.

## Princípios

- Cada visualização responde uma pergunta de negócio. Sem gráfico decorativo.
- Poucas abas, profundas. Filtros globais na URL, compartilhados entre abas.
- Insights automáticos gerados no cliente a partir dos dados que já temos — nada de integração externa.
- Drill-down em toda visualização importante (Sheet lateral com detalhes).
- Estética Product Analytics: whitespace generoso, tipografia sóbria, sem excesso de tokens de cor.

## Filtros globais (barra fina fixa no topo, dentro da URL)

`?period=30d&property=all&device=all&q=`

- Período: 7d · 30d · 90d · Tudo
- Imóvel: dropdown com busca (afeta todas as abas)
- Dispositivo: Todos · Mobile · Tablet · Desktop
- Busca livre (usada em jornadas e conteúdos)

Estado via `Route.useSearch()` + `useNavigate` para permanecer entre abas e ser compartilhável.

## Arquitetura de abas (3 abas)

### 1. Panorama — "o que preciso saber agora"
Objetivo: em 5 segundos entender se o guia está funcionando.

- **Faixa de insights automáticos** (cards horizontais roláveis): frases geradas por heurísticas — "3 seções nunca foram abertas em Studio 101", "Acessos mobile caíram 34% na última semana", "8 conversas com feedback não resolvido", "FAQ 'Wi-Fi' evitou 42 conversas".
- **4 KPIs vivos** com sparkline embutido (não card gigante): Acessos únicos · Sessões que iniciaram chat · Taxa de auto-resolução (acessos sem chat) · Feedback negativo pendente.
- **Série temporal** empilhada (acessos vs conversas) — linha suave, sem eixos pesados.
- **Ranking de imóveis** em dot-plot horizontal: cada imóvel um ponto, eixo X = acessos, cor = taxa de conversa. Clicar → drill-down.

### 2. Jornada — "como o hóspede usa o guia"
Objetivo: entender comportamento de navegação.

- **Funil**: Acessou guia → Abriu ≥1 seção → Iniciou chat → Recebeu resposta útil (feedback positivo ou sem feedback negativo). Cada etapa clicável.
- **Seções consumidas** — bar chart horizontal ordenado por volume, com badge "ignorada" (0 aberturas) e "hotspot" (>P75). Ao lado, lista das **seções silenciosas** (existem no guia mas nunca foram abertas) com CTA "revisar destaque".
- **Heatmap dia da semana × hora** dos acessos — identifica janelas de atendimento e picos.
- **Distribuição de dispositivo + navegador** compacta (donut mobile/tablet/desktop) e comparativo de comportamento por dispositivo (mobile abre menos seções? converte mais em chat?).
- **Fluxo entre seções** (quando houver `guide_section_events` suficiente): sankey simplificado seção→seção mais comum. Se dado insuficiente, oculta o bloco (não mostra placeholder vazio).

### 3. Conteúdo & Dúvidas — "o que resolve, o que gera atrito"
Objetivo: descobrir quais conteúdos merecem investimento.

- **Matriz 2×2** ("Impacto do conteúdo"): eixo X = volume de aberturas, eixo Y = taxa de auto-resolução (sessões que abriram a seção e NÃO iniciaram chat). Quadrantes: Estrelas · Oportunidades · Ruído · Manutenção. Clicar em ponto abre drill.
- **Dúvidas frequentes reveladas pelo chat**: agrupamento por primeira mensagem (top substrings/termos) — mostra "sobre o que os hóspedes perguntam mesmo quando a informação existe".
- **Feedback de IA** — lista compacta de mensagens marcadas como não úteis + botão "ensinar IA" (reaproveita `TeachAiDialog` existente, sem alterá-lo). Só é reaproveitado se o hóspede clicou no "não resolveu"; caso contrário fora do escopo.
- **POIs (Aqui pertinho + Cidade)** — top 10 mais clicados e 10 nunca clicados. Reusa `getPoiEngagementCounts` / `getMarketplaceClicks`.
- **Completude vs Engajamento** — scatter: score de completude do guia × acessos por sessão. Detecta guias completos mas não usados e vice-versa.

## Drill-down

Um único componente `<DetailSheet />` (side sheet à direita). Recebe `kind: "property" | "section" | "funnelStep"` e renderiza:
- Séries temporais isoladas do item
- Top 5 fatos derivados
- Ações contextuais (abrir edição do imóvel, exportar CSV do subset)

## Insights automáticos (regras, no cliente)

Módulo `insights.ts` local à página. Recebe o payload de `getEngagementOverview` já filtrado e retorna `Array<{severity, title, detail, cta?}>`. Regras iniciais:

- Seção com 0 aberturas nos últimos 30d, mas guia publicado → "oportunidade oculta"
- Queda ≥ 25% de acessos week-over-week → "tendência de queda"
- Taxa de conversa > 60% em um imóvel específico → "atrito: hóspedes precisam perguntar demais"
- Taxa de conversa < 5% + alto tempo → "guia auto-suficiente" (positivo)
- Feedback negativo não resolvido há > 7 dias → "backlog de aprendizado"
- Guia com completude < 40 e acessos > mediana → "conteúdo escasso para demanda real"

## Backend

Uma única server function nova: `getEngagementAnalytics(filters)` em novo arquivo `src/lib/engagement-analytics.functions.ts`. Recebe `{period, propertyId, device}` e devolve um DTO calibrado para o novo layout (evita passar payloads gigantes ao cliente). A função antiga `getEngagementOverview` permanece intocada (usada em nenhum outro lugar do sistema após esta refatoração — confirmado por grep) mas fica no arquivo para não quebrar imports; se de fato só a página Engajamento usa, marcamos como deprecada em comentário — sem remover.

Dados usados (todos já existentes):
- `guide_access_logs` (acessos, user_agent, timestamp)
- `guide_section_events` (aberturas de seção)
- `property_chat_conversations` + `property_chat_messages` + `chat_message_feedback`
- `properties` (completude, publicação)
- `poi_engagement_events` (via funções já existentes)
- `host_faqs`, `host_knowledge`, `host_behavior` (counts)

Sem novas tabelas. Sem novas migrations. Sem alterar tracking.

## Bibliotecas

Reusar o que já existe no projeto:
- `recharts` (já usado) — linhas, barras, scatter, sparkline, radial
- Componentes shadcn — Tabs, Sheet, Popover, Badge, Card, Tooltip
- Sem introduzir libs de sankey/heatmap: desenhamos heatmap com CSS grid e o "sankey simplificado" com barras conectadas por SVG puro (bloco pequeno). Se complexidade explodir, degrada elegante mostrando lista ranqueada.

## Estrutura de arquivos

```
src/routes/_authenticated/admin.engajamento.tsx        (reescrito do zero)
src/components/engagement/
  GlobalFilters.tsx        — barra de filtros (URL search)
  InsightsRibbon.tsx       — cards horizontais de insights
  KpiStrip.tsx             — 4 KPIs com sparkline
  TrendChart.tsx           — série temporal principal
  PropertiesDotPlot.tsx    — ranking de imóveis
  Funnel.tsx               — funil 4 etapas
  SectionsBar.tsx          — barras + seções silenciosas
  AccessHeatmap.tsx        — heatmap dia×hora
  DeviceMix.tsx            — donut compacto
  ContentImpactMatrix.tsx  — scatter 2×2
  QuestionsCluster.tsx     — top perguntas do chat
  FeedbackList.tsx         — feedback + Teach AI
  PoiInsights.tsx          — top/bottom POIs
  CompletenessScatter.tsx  — completude × engajamento
  DetailSheet.tsx          — drill-down unificado
  insights.ts              — regras automáticas
src/lib/engagement-analytics.functions.ts              (nova server fn)
```

Cada componente ~80–200 linhas, sem props globais mágicos: recebem os slices já preparados pela rota.

## Fluxo de navegação

1. Usuário abre `/admin/engajamento` → filtros default (30d, todos).
2. Panorama carrega. Insights aparecem no topo.
3. Clique num insight/imóvel → DetailSheet à direita, sem trocar de aba.
4. Aba Jornada assume os mesmos filtros. Clique em seção → DetailSheet.
5. Aba Conteúdo idem. Ações "ensinar IA" abrem o dialog existente.

## Fora do escopo (não implementar)

- Idioma como filtro (não temos o dado hoje de forma confiável no `guide_access_logs`).
- Exportação CSV geral (só nos drill-downs pontuais).
- Alteração de qualquer outra rota, componente global, migrations, RLS, tracking client-side.
- Mudança em `TeachAiDialog`, `AiPlanLock`, `getConversationMessages`.

## Verificação após implementação

- `tsgo` limpo.
- Página carrega vazia e com dados (guiar por `getEngagementOverview` degradado quando não houver imóveis).
- Filtros persistem em URL e sobrevivem a refresh.
- Nenhum outro arquivo do projeto foi tocado além dos listados acima.
