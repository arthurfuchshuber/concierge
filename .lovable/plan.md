Antes de gastar créditos, quero alinhar o plano. Tudo será feito em **1 rodada de edições** para caber no orçamento.

## 1. Editor de Recomendações Sigma — replicar UX do guia

Substituir a aba **Pontos** em `admin.recomendacoes-sigma.$cityKey.tsx` por uma versão idêntica ao `RecGroup` do guia:

- **Reutilizar** `PlaceAutocomplete` e `RecGroup` (vou exportá-los de `admin.properties.$id.tsx` e movê-los — sem duplicar código).
- Agrupamento por categorias da taxonomia, recolhidas por padrão, expansão única por vez.
- Campo de busca do Google Maps com bloqueio de duplicidade (via `existingPlaceIds`).
- Drag-and-drop, "Selecionar todos", mover em massa, gerar com IA — tudo herdado.
- Para cidades Sigma sem `lat/lng`, faço lookup do centro da cidade via Google Places no momento de salvar a cidade. Migration adiciona `lat`/`lng` em `sigma_city_packs`. Scope sempre `"city"`.
- Persistência: novo adaptador server-fn `sigmaSetRecs(city_key, items[])` que substitui o conjunto inteiro (mesmo padrão do guide save).

As abas **Marketplace** e **FAQ** ficam como estão (já seguem o racional do guia, segundo conferi).

## 2. Quadrante do guia — layout do header

Em `RecGroup` (`admin.properties.$id.tsx`):
- "Selecionar todos" sai da linha dos botões, vira **linha própria acima do campo de busca**, alinhado à esquerda.
- Campo de busca **vai para a esquerda** e ganha mais largura (`w-full sm:w-72`).
- Botões (Gerar IA, Editar, Replicar, etc.) continuam à direita.

## 3. Botão "Importar do SigmaGuide" sempre que houver pack

Hoje `SigmaImportButton` só aparece se o pack está `is_published=true`. Vou:
- Em `saveGuideAsSigmaPack`, **publicar automaticamente** o pack ao salvar (já que o ato de salvar via guia significa "está pronto para usar").
- Confirmar que `getMyPropertySigmaState` continua filtrando por `is_published` — assim qualquer pack salvo (admin ou via editor) faz o botão aparecer.
- Importação continua sendo **substituição total** (lock), unidirecional a partir do pack — comportamento já existente.

## Fora deste plano (5 créditos)

- Onboarding popups (já desativado por você).
- Autocomplete Google na criação da cidade Sigma (vou aproveitar a busca da própria aba Pontos para já criar o vínculo de cidade real; criação de cidade pode continuar manual por enquanto).

## Riscos / cuidados

- Exportar `RecGroup`/`PlaceAutocomplete` exige cuidado com imports — vou conferir que nenhuma dependência fica órfã.
- Migration adiciona apenas colunas opcionais — sem GRANT extra necessário.

Posso seguir?