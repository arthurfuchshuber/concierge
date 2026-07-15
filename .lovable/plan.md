# Refatoração Engajamento — Fase 2

Escopo: exclusivamente a página `/admin/engajamento` e seu backend dedicado (`engagement-analytics.functions.ts`, `src/components/engagement/*`). Nada fora disso.

## 1. Reposicionamento: de KPIs de volume → gestão do todo

**Remover** (ruído no agregado multi-cliente):
- Insight "acessos subiram X%" e "guia menos acessado" (deltas de volume e outliers baixos).
- `QuestionsCluster` (nuvem de termos do chat — ruidoso).
- `CompletenessScatter` (redundante com o dot-plot).
- `AccessHeatmap` (largura excessiva; substituído por versão compacta).
- `DeviceMix` (pouco acionável agregado).

**Adicionar/promover como núcleo gerencial:**
- **Tempo médio de sessão** (mediana + p90). Calculado por `guest_session_id`: janela entre 1º e último `guide_section_event`, gap > 20 min quebra em nova sessão.
- **Ranking de imóveis por engajamento real**: novo dot-plot com eixo = tempo médio de sessão (não mais chatRate isolado).
- **Sessões por tempo de permanência** (histograma: <30s, 30s–2min, 2–5min, 5–15min, >15min) — revela se o guia prende atenção.
- **Profundidade de leitura**: seções/sessão + % sessões que abriram ≥3 seções.
- **Curva de retenção intra-sessão**: sessão 1 seção → 2 → 3 → 4+ (drop-off).

**Manter e refinar:**
- `TrendChart` (mantém).
- `Funnel` (mantém — já é gerencial).
- `SectionsBar` (mantém, é o que revela onde o guia entrega valor).
- `ContentImpactMatrix` (mantém — volume × auto-resolução por seção).
- POIs top/frios: **usar o nome real personalizado pelo anfitrião** em vez do `poi_key`. Consulta `property_recommendations` para resolver `place_id`/`name`.
- `FeedbackList` (mantém — acionável).
- `InsightsRibbon`: reduzir a 3 heurísticas gerenciais (atrito alto, silêncio de seção, backlog de feedback).

## 2. Nova aba **Hóspedes**

Identidade: `telefone_normalizado + checkin_date` como chave (consistente com regra já usada nas conversas).

**Lista consolidada** (tabela sortável, uma linha por hóspede):
- Nome, telefone, código de reserva, check-in, imóvel.
- Tempo total com guia aberto (soma das sessões).
- Nº de seções visitadas.
- Nº de mensagens no chat com IA (0 = sem chat).
- Última atividade.

**Detalhe do hóspede** (drill-in via `DetailSheet` existente, nova branch `kind: "guest"`):
- Card com dados do check-in.
- Métricas: tempo total, nº sessões, tempo médio, ranking de seções.
- Timeline cronológica de seções visitadas.
- Todas as conversas com a IA agrupadas (uma thread por conversa, com feedback e link "ensinar IA").

**Tabela macro de conversas** (segunda visão dentro da aba): todas as conversas do período, filtráveis por imóvel, com preview da 1ª pergunta, contagem de mensagens, hóspede identificado, e clique abre thread completa. Reaproveita `TeachAiDialog` existente para responder à IA.

Consolidação chat↔hóspede: match por (i) `guest_session_id` compartilhado com `guide_access_logs` do mesmo período, ou (ii) proximidade temporal + `guest_phone` normalizado quando disponível.

## 3. Filtros

**Multi-select de imóveis** com "Selecionar todos"/"Limpar":
- `URL search param`: `property=all` ou lista CSV `property=id1,id2,id3`.
- Backend `getEngagementAnalytics.propertyIds: string[] | null` (quebra o atual `propertyId: string | null` — só afeta esta página).
- Componente `PropertyMultiSelect` com Popover + Command (shadcn).

**Mobile: filtro unificado**:
- Em telas < md, os 3 selects colapsam num único botão "Filtros" que abre um `Sheet` bottom com: período, imóveis, dispositivo, botão "Aplicar" / "Limpar".
- Em ≥ md, layout atual permanece (agora com o multi-select).

## 4. Arquitetura técnica

- `engagement-analytics.functions.ts`: reescrever para (a) aceitar `propertyIds[]`, (b) calcular durações de sessão, (c) devolver novos campos `sessionDuration{ p50, p90, buckets[] }`, `depthCurve[]`, remover `heatmap`/`deviceMix` do DTO; POIs vêm com `displayName` resolvido.
- Nova função `getEngagementGuests` no mesmo arquivo (ou `engagement-guests.functions.ts`): retorna lista de hóspedes agregados + todas as conversas do período.
- Nova função `getGuestDetail` para o drill-in.
- Novos componentes: `PropertyMultiSelect`, `MobileFilterSheet`, `SessionDurationCard`, `DepthCurve`, `GuestsTable`, `ConversationsTable`, `GuestDetail` (extensão do `DetailSheet`).
- Rotas: `admin.engajamento.tsx` ganha aba `hospedes`, aceita `property=csv`, `q=` para busca de hóspede.

## 5. O que fica fora

- Sem novas tabelas, migrations ou tracking novo.
- Sem alteração no `TeachAiDialog`, `AiPlanLock`, chat público, nenhuma outra rota.
- Sem export CSV geral (mantém opção de export nos drill-downs se for barato).
- Sem i18n adicional além do português já vigente.

Ao aprovar, implemento tudo em um único passe.
