## Diagnóstico

Achei a causa raiz do desalinhamento entre o painel e o guia público:

- O **guia público** (Explore a Região) lê os pontos "Pela cidade" da tabela compartilhada `city_references` (uma por cidade, alimentada pela IA — hoje tem 321 para Foz do Iguaçu).
- O **painel admin** ("Pela cidade") lê de outra fonte: `property_recommendations` com `scope=city` (por imóvel, salvo só quando você clica em Salvar).

Quando a IA gera, ela grava em `city_references` na hora (por isso o público já mostra), mas o painel exige clicar "Gerar com IA" + "Salvar" para popular sua cópia local. Resultado: o público mostra 321 e o painel aparece vazio.

## O que vou fazer

### 1. Sincronizar painel ↔ guia público

A seção "Pela cidade" do editor de imóvel passa a ler/escrever **diretamente** na `city_references` (mesma fonte do público). Isso significa:

- Ao abrir o imóvel, o painel já carrega automaticamente todos os pontos salvos para a cidade (sem precisar clicar em nada).
- Adicionar/remover/editar um ponto reflete imediatamente no público, sem depender de "Salvar".
- Remove a duplicação `property_recommendations(scope=city)` da UI — "Pela cidade" deixa de ser por imóvel e passa a ser por cidade (que é como o público já trata).
- "Aqui pertinho" continua igual (essa é específica do imóvel, faz sentido por imóvel).
- A função "Replicar para outros guias" deixa de fazer sentido (já é compartilhado por cidade) — vou remover.

### 2. Geração por IA mais limpa em "Referências da Cidade"

Na função `generateCityReferencesFromMaps`:

- **Dedupe agressivo por similaridade de nome** dentro da mesma cidade: "Cataratas do Iguaçu", "Iguazzu Falls", "Iguazzu Falls Park", "Iguazu National Park" → mantém só 1 (o de melhor score). Critério: normaliza tirando stopwords ("park", "national", "falls"/"cataratas", "binacional", "mirante", "tour", "visit") + Levenshtein; também agrupa quando o `place_id` é igual ou quando as coordenadas estão a < 300m com nomes parecidos.
- **Categoria correta**: já uso `classifyByPrimaryType` estrito hoje; vou apertar mais — qualquer ponto cuja categoria final divergir da query original entra como "categoria real" (não força), e descarto resultados com `primaryType` ambíguo (genéricos como `tourist_attraction` sem subtipo).
- **Ranking por qualidade**: já uso `rating × log10(reviews)`; vou aumentar o piso de reviews para "attraction" (de 120 → 200) para favorecer ícones de fato.

### 3. Capitalização

Toda exibição de nome (público + admin) passa por um helper `toTitleCase` que coloca primeira letra maiúscula e resto minúscula, respeitando palavras curtas em pt/en ("de", "da", "do", "e", "of", "the"). Aplicado no render — não altera o que está salvo, então se o Google mudar o nome, continua atualizado.

## Arquivos afetados

- `src/lib/city-references.functions.ts` — adicionar `updateCityReference`, melhorar `manualAdd` para retornar a linha criada.
- `src/lib/maps.functions.ts` — dedupe por similaridade + piso de reviews.
- `src/lib/text.ts` (novo) — helper `toTitleCase`.
- `src/routes/_authenticated/admin.properties.$id.tsx` — "Pela cidade" lê/escreve em `city_references` direto via React Query; remove "Replicar".
- `src/routes/g.$slug.explorar.tsx` — aplica `toTitleCase` no render.

## O que NÃO muda

- Dados existentes em `property_recommendations(scope=city)` ficam intactos no banco (sem migração destrutiva). Apenas deixam de aparecer no painel — o público já usa `city_references` mesmo.
- "Aqui pertinho" (scope=nearby) e todo o resto do editor.

Confirma que posso seguir? Em especial: ok remover o botão **"Replicar para outros guias"** já que "Pela cidade" passa a ser automaticamente compartilhado entre todos os imóveis da mesma cidade?