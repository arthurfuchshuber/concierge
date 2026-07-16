# Redesign Home do Guia — "SigmaGuide viciante"

Vamos reestruturar a Home (`src/routes/g.$slug.index.tsx`) inspirado no esboço enviado, transformando-a num painel visual com cards imagéticos e um feed de notícias reais rolando lateralmente (cascata horizontal). Nada mexe em cadastro/popup/telefone.

## 1. Estrutura visual (baseada no esboço)

```text
┌─────────────────────────────────┐
│ HERO (foto do imóvel ao fundo,  │
│ escurecida)                     │
│  · SigmaGuide  ·  [FOZ] pill    │
│  Nome do imóvel                 │
│  Tagline                        │
└─────────────────────────────────┘
┌ Faixa check-in ─────────────────┐
│ ⏱ libera em 3h42 · barra prog.  │
└─────────────────────────────────┘
┌ O QUE VOCÊ DESEJA ACESSAR? ─────┐
│ ┌ CHEGADA (largo, destacado)──┐│
│ │ [imagem chave/porta blur]  ▸││ ← "comece aqui" badge
│ └────────────────────────────┘│
│ ┌ Saída ──┐ ┌ A residência ─┐ │
│ │ img     │ │ img            │ │
│ └─────────┘ └────────────────┘ │
│ ┌ Explore a região (largo) ───┐│
│ │ img · 182 lugares curados  ▸││
│ └────────────────────────────┘│
└─────────────────────────────────┘
┌ Dica do dia (IA) ───────────────┐
│ ☀ 19°C · céu limpo · IA ativa   │
│ Título gerado pela IA           │
│ Corpo + [Perguntar mais →]      │
│ chips de sugestão               │
└─────────────────────────────────┘
┌ O QUE ROLA HOJE · scroll ↔ ─────┐
│ [card news 1][card news 2]…    │ ← cascata horizontal
│ imagem grande, categoria pill   │
└─────────────────────────────────┘
```

## 2. Novidades técnicas

### 2.1. Notícias reais da cidade (feed IA + Google/Firecrawl)

- Nova server fn `getCityNews({ cityKey, cityLabel, country, lang })` em `src/lib/city-news.functions.ts`.
- Nova tabela `city_daily_news` (cache diário — igual estrutura de `city_daily_pulse`):
  - `city_key text`, `date date`, `items jsonb`, `created_at`, PK `(city_key, date)`.
  - RLS: leitura pública via server fn (admin client).
- Estratégia de curadoria:
  1. Usa **Firecrawl `/v2/search`** (conector já linkado, gateway ou direct) com query tipo `notícias eventos turismo {cidade} hoje` + `tbs: 'qdr:w'` (última semana) para pegar manchetes reais.
  2. Passa top 8 resultados (`title`, `description`, `url`) pra IA (`google/gemini-3.5-flash` via Lovable AI) com prompt que filtra e retorna JSON com 5–7 itens: `{title, category, summary, emoji, imageQuery, sourceUrl}`.
  3. Categoria em: `natureza`, `gastronomia`, `evento`, `passeio`, `cultura`, `noite`, `mercado`.
  4. `imageQuery`: 2–3 palavras para buscar foto (ex: "cataratas iguaçu passarela"). Server fn resolve imagem via **Google Places Photo** (já usamos em `place-photo.ts`) ou Firecrawl scrape com format `screenshot`. Fallback: usar `source.image` do resultado Firecrawl (`ogImage`).
- Fallback silencioso: se Firecrawl/IA falhar, retorna `null` → feed some (não mostra placeholder).

### 2.2. Componente `CityNewsFeed`

- Novo em `src/components/guide/CityNewsFeed.tsx`.
- Scroll horizontal com `snap-x snap-mandatory` + `overflow-x-auto scrollbar-none`.
- Cards de ~72% width no mobile, imagem topo 140px, overlay leve, categoria pill colorida por tipo (cores diferentes por categoria).
- Tap no card → `openChat("Me conte sobre: {título}")`, com botão externo pequeno para `sourceUrl` quando existir.
- Tracking: `poi_engagement_events` com `event_type: 'news_open'` reaproveitando a tabela.

### 2.3. Redesign dos cards de seção ("O que você deseja acessar?")

- Substituir accordion/blocos atuais na Home por 4 cards visuais (Chegada, Saída, Residência, Explorar):
  - Cada um com "capa" colorida (mesma paleta accent do imóvel + variação por card) e ícone grande.
  - Se o imóvel tem `main_image_url`, usa-a como plano de fundo com `opacity-25 blur-sm` no card grande "Chegada" (efeito "ofuscado" pedido).
  - Card "Chegada" com badge "comece aqui" e borda accent (destaque primário).
  - Card "Explorar" mostra contagem real de POIs (`property_recommendations` count).
- Tap navega para as seções existentes: `#chegada`, `#saida`, `#residencia`, `/g/$slug/explorar`.

### 2.4. Faixa de check-in countdown

- Novo componente inline com barra de progresso.
- Se `property.check_in_time` existir e hoje for antes → calcula "libera em Xh Ym" e barra 0–100%.
- Depois do check-in ou sem dado, mostra apenas "check-in liberado" ou some.

### 2.5. Ajustes no `HomeIntelligence` atual

- Mantém a lógica de `getDailyTip` (dica do dia + clima).
- Ajusta layout do card pra bater com o esboço: header com "☀ 19°C · céu limpo" à esquerda + "● IA ativa agora" à direita, título maior, botão outline dourado, chips abaixo.
- **Remove** a bolha "Concierge IA" separada (fica embutido no card da dica com o CTA).
- **Remove** o bloco antigo "O que rola em X" (substituído pelo `CityNewsFeed`).

## 3. Cron / cache

- Estender cron `cron.refresh-city-references` (ou novo `cron.refresh-city-news`) para pré-gerar `city_daily_news` das cidades com imóveis ativos, 1x ao dia.
- TTL implícito: `(city_key, date)` — nova entrada por dia.

## 4. Ordem de implementação

1. Migração: tabela `city_daily_news` + GRANTs + RLS.
2. Server fn `getCityNews` (Firecrawl search → IA curadoria → cache). Firecrawl já linkado; usa `uses_connector_gateway` dinâmico.
3. Componente `CityNewsFeed` + tracking.
4. Redesign dos 4 cards de seção com imagens (fundo ofuscado).
5. Faixa de check-in countdown.
6. Ajuste `HomeIntelligence` (dica do dia com novo layout, remove bolha e pulso duplicado).
7. Cron opcional para pré-aquecer notícias.

## 5. O que NÃO muda

- Popup de telefone / cadastro do hóspede — intocado.
- Rota `explorar` e link de ingresso já existente em `property_recommendations.booking_url`.
- Toda a estrutura de seções abaixo do fold (Wi-Fi, manual, FAQ, emergência, chat).

Depois que aprovar, sigo pelos passos 1→7. Posso quebrar em 2 entregas: (A) redesign visual da Home + countdown + cards (passos 4–6, sem depender de dados novos); (B) feed de notícias reais (passos 1–3 + 7).
