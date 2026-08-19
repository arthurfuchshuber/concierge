# Problema

Estamos estourando a cota `SearchTextRequest per minute` do Google Places
(90x HTTP 429 em ~4s). Chamadas paralelas sem throttling em:

- `src/lib/city-news.functions.ts` — `attachPlacePhotos` faz `Promise.all` sobre N notícias, cada uma disparando `places:searchText`.
- `src/lib/maps.functions.ts` — 5 pontos (~linhas 303, 317, 513, 1041, 1068) fazem `searchText` em paralelo por request.

# Solução proposta

1. Criar `src/lib/places-throttle.server.ts`:
   - Fila global com concorrência máxima (ex.: 4 requisições simultâneas).
   - Cache LRU em memória por `textQuery+regionCode+fieldMask` com TTL de ~24h (útil para fotos e IDs de lugares repetidos entre requests).
   - Retry com backoff exponencial (250ms → 1s → 2s) apenas em 429/5xx, no máximo 2 retries; retorna `null` se persistir.
   - Helper `placesSearchText(body, fieldMask, signal?)` que encapsula fetch para o gateway.

2. Refatorar os 5 call sites em `src/lib/maps.functions.ts` e o `attachPlacePhotos` em `src/lib/city-news.functions.ts` para usar o helper.

3. Para `attachPlacePhotos`, trocar `Promise.all` por processamento pela fila (o helper cuida da concorrência) — mantém latência aceitável e evita rajadas.

4. Manter os `AbortSignal.timeout` atuais e logs quando o fetch falhar depois dos retries.

# Fora do escopo

- Aumento de cota no Google Cloud (ação manual do dono).
- Cache persistente em banco (podemos avaliar depois se in-memory não bastar em multi-worker).

# Verificação

- Build + typecheck.
- Smoke test: abrir guia público de uma cidade com muitas notícias e conferir que fotos carregam sem 429 nos logs.
