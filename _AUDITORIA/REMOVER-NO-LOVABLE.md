# Limpeza sugerida — fazer no Lovable (o ZIP não apaga arquivos)

Nenhum destes arquivos é importado, nem de forma estática nem dinâmica, e nenhum é citado por rota ou script (conferido em 16/09/2026 na árvore do commit `f7beeaa8`). Servidor de funções que não é importado não entra no build, então nenhum deles está exposto hoje. A remoção é só limpeza.

Depois de apagar, rode `npx tsc --noEmit` e `npx vite build`.

## Confiança alta: pode apagar
- src/lib/city-pulse.functions.ts
- src/lib/api/example.functions.ts
- src/lib/config.server.ts (usado só pelo exemplo acima)
- src/lib/chat.functions.ts
- src/lib/ai/governance/scopes.ts
- src/components/ds/TypingIndicator.tsx
- src/components/engagement/ConversationsTable.tsx
- src/components/guide/FirstVisitTour.tsx
- src/components/landing/ChatMockup.tsx
- src/components/landing/GuideMockup.tsx
- src/components/permissions/UserAccessManager.tsx
- src/components/permissions/UserPermissionSummary.tsx
- src/components/ui/: alert, aspect-ratio, avatar, breadcrumb, carousel, chart, collapsible, context-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, separator, sidebar, slider, table, toggle, toggle-group (`.tsx`)

## Validar antes (server functions sem tela; podem ter sido pensadas para uso futuro)
- src/lib/ai-ops.functions.ts
- src/lib/ai/reindex-all.functions.ts
- src/lib/engagement-admin.functions.ts
- src/lib/etiquetas.functions.ts
- src/lib/host-behavior.functions.ts
- src/lib/recommendations-move.functions.ts
- src/lib/permissions/permission.selftest.server.ts
- src/lib/permissions/permission.enforce.selftest.server.ts
- src/lib/permissions/permission.migration.selftest.server.ts
- src/lib/permissions/permission.migration.report.server.ts
- Ao remover, tirar os nomes correspondentes de `src/lib/audit-fn-labels.server.ts`.

## Dependências (só depois de apagar os `ui/` acima, pelo Lovable, para atualizar os lockfiles)
- embla-carousel-react, input-otp, react-hook-form, @hookform/resolvers, react-resizable-panels
- @radix-ui/react-aspect-ratio, -avatar, -collapsible, -context-menu, -hover-card, -menubar, -navigation-menu, -progress, -radio-group, -separator, -slider, -toggle, -toggle-group
- Validar (sem import em `src/`): ai, @ai-sdk/openai-compatible, @mendable/firecrawl-js, qrcode
