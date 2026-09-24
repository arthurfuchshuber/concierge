---
name: Recomendações — regras permanentes (raio, exclusão, isolamento)
description: Raio de 30 km da residência, excluídos nunca voltam, categorias por guia e isolamento total entre contas/imóveis
type: feature
---
REGRAS DO CLIENTE (24/09/2026) — valem para todo código de recomendações (city_references, property_recommendations, geração pelo Google/IA):

1. RAIO DE 30 KM DA RESIDÊNCIA, OBRIGATÓRIO. Todo puxador automático conta a distância a partir da coordenada do IMÓVEL (não do centro da cidade) e descarta qualquer lugar a mais de 30 km, para todos os tipos. Sem coordenada nenhuma, não importa nada. Ver `generateCityReferencesFromMaps` (`MAX_RADIUS_M`) em `src/lib/maps.functions.ts`. "Aqui pertinho" continua com 2 km.
2. EXCLUÍDO NUNCA VOLTA. "Pela cidade": excluir = `is_hidden = true` + `excluded_at` (nunca apagar a linha; a geração não reativa). "Aqui pertinho": `property_rec_exclusions` guarda o place_id excluído e a geração o ignora. Só volta se o anfitrião adicionar o lugar de novo na mão.
3. CATEGORIAS SÃO DO GUIA. Renomear/criar/excluir categoria no editor do guia mexe só nos pontos daquele guia. A taxonomia global (`poi_categories`/`poi_tags`) só é editada em Admin → Taxonomia. Regerar/refresh nunca sobrescreve nome, categoria, tipo, nota ou origem editados pelo anfitrião.
4. ISOLAMENTO TOTAL. Nenhum imóvel, guia ou conta (tenant) lê ou grava dados de outro — nunca filtrar recomendações "por cidade" para servir um guia; sempre pelo escopo do guia (property_id, ou group_id do grupo de guias da MESMA conta). Única exceção: vínculo explícito (ex.: "usar recomendações Sigma").
5. Ponto em outro país (pelo endereço do Google) ganha a categoria de fronteira sozinho ("No Paraguai", "Na Argentina"…) — `src/lib/poi-country.ts`.
