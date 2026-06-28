## O que será implementado

Cada card de ponto/estabelecimento (no guia público e na curadoria do Sigma) recebe uma barra discreta no canto inferior direito com 4 ações:

- 👁  visualizações — somadas quando o card recebe clique OU permanece visível no viewport por 5s ou mais
- ↗  compartilhar — abre o share nativo do dispositivo (WhatsApp, Instagram, etc.) com o link do Maps do estabelecimento; fallback para copiar link
- ♥  curtir — toggle do hóspede; conta agregada
- 👎  descurtir — toggle do hóspede; conta agregada

Os links da seção "Reservas & marketplace", dentro da edição do guia (admin), recebem APENAS o ícone 👁 mostrando a quantidade de cliques recebidos.

## Estrutura técnica

**Backend (1 migration)**
- Tabela `poi_engagement_events` com `(property_id, poi_key, poi_type, event_type, anon_id, created_at)`.
- `poi_type` cobre `city_reference`, `recommendation`, `sigma_city_reference`, `marketplace_link`.
- RLS: `INSERT` aberto a `anon` + `authenticated` (sem PII); `SELECT` autenticado restrito ao dono do guia (ou admin via `has_role`).
- Índices em `(property_id, poi_key)` e `(property_id, event_type)`.
- GRANTs para `anon`, `authenticated`, `service_role`.

**Server functions (`src/lib/poi-engagement.functions.ts`)**
- `recordPoiEngagement` (público, sem auth): valida slug + tipo + evento via Zod, insere com `anon_id` enviado pelo cliente (gerado/persistido em `localStorage`). De-duplica `view` por `(anon_id, poi_key, dia)` no servidor.
- `getPoiEngagementCounts` (público, leitura agregada): retorna `{ poi_key → { views, likes, dislikes, shares } }` para o `property_id` derivado do slug.
- `getMyPoiReactions` (público, por `anon_id`): retorna quais POIs o hóspede já curtiu/descurtiu para hidratar o estado dos botões.
- `getMarketplaceClicks` (autenticado, dono do guia): retorna `{ index → clicks }` para a aba admin.

**UI**

`src/components/POIEngagementBar.tsx`
- Barra horizontal no canto inferior direito do card (absolute) com os 4 ícones em pílula translúcida.
- `useEffect` com `IntersectionObserver` dispara `view` após 5s contínuos visíveis OU no clique.
- Curtir/descurtir são mutuamente excludentes (clicar em um desliga o outro), atualização otimista, sincroniza via server fn.
- Compartilhar usa `navigator.share` quando disponível; fallback `navigator.clipboard.writeText` + toast.

`src/routes/g.$slug.explorar.tsx`
- Monta `<POIEngagementBar />` dentro de `RecCard` e `RecRow`, posicionada absoluta no canto inferior direito da área da imagem.
- Carrega `getPoiEngagementCounts` + `getMyPoiReactions` uma vez por página (TanStack Query) e passa contadores por id.

`src/routes/_authenticated/admin.recomendacoes-sigma.$id.tsx` (editor do pack Sigma)
- Mesma barra nos cards de POI da curadoria (somente leitura para visualização do admin; ações ainda funcionam mas com `poi_type = sigma_city_reference`).

`src/routes/_authenticated/admin.properties.$id.tsx`
- Em cada item de `marketplace_links`, adiciona um pequeno `👁 N` no canto inferior direito (somente leitura), alimentado por `getMarketplaceClicks`.

## Notas de privacidade

- Nenhum dado pessoal é coletado nas curtidas/views — apenas um `anon_id` UUID gerado no cliente.
- Eventos não são exibidos para outros hóspedes; apenas o agregado.
