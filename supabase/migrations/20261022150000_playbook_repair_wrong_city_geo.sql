-- PLAYBOOK · reparo de bairro/CEP gravados da cidade errada (22/10/2026).
-- A busca de endereço no Google usava só "rua e número" e, sem cidade, devolvia a capital
-- (ex.: imóvel de Foz do Iguaçu recebendo "Barro Preto" e CEP de Belo Horizonte).
-- Para todo imóvel que NÃO é de Belo Horizonte e tem bairro "Barro Preto" ou CEP de BH (30000-31999)
-- gravado no Playbook: esvazia bairro e CEP (a nota do anfitrião é mantida) e apaga a marca `f:_geo`,
-- para a próxima abertura do Playbook buscar de novo, agora com cidade/estado/país.
WITH wrong AS (
  SELECT DISTINCT e.property_id
  FROM public.property_playbook_entries e
  JOIN public.properties p ON p.id = e.property_id
  WHERE coalesce(translate(lower(p.city), 'áàâãéêíóôõúç', 'aaaaeeiooouc'), '') NOT LIKE '%belo horizonte%'
    AND (
      (e.field_key = 'f:bairro' AND lower(btrim(coalesce(e.value, ''))) = 'barro preto')
      OR (e.field_key = 'f:cep' AND coalesce(e.value, '') ~ '^3[01][0-9]{3}-?[0-9]{3}$')
    )
)
UPDATE public.property_playbook_entries e
SET value = NULL
FROM wrong w
WHERE e.property_id = w.property_id
  AND e.field_key IN ('f:bairro', 'f:cep');

DELETE FROM public.property_playbook_entries e
USING (
  SELECT DISTINCT e2.property_id
  FROM public.property_playbook_entries e2
  JOIN public.properties p ON p.id = e2.property_id
  WHERE coalesce(translate(lower(p.city), 'áàâãéêíóôõúç', 'aaaaeeiooouc'), '') NOT LIKE '%belo horizonte%'
    AND e2.field_key IN ('f:bairro', 'f:cep')
    AND e2.value IS NULL
) w
WHERE e.property_id = w.property_id
  AND e.field_key = 'f:_geo';
