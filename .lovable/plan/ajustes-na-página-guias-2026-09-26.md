# Ajustes na página Guias

## O que muda

1. **Quadrantes por situação**
   - "NÃO PUBLICADO" (em amarelo suave): todos os guias em rascunho.
   - "PRECISAM DE ATENÇÃO": publicados, mas abaixo de 100% preenchidos.
   - "PRONTOS": publicados e 100% preenchidos.
   - Os quadrantes vazios somem.

2. **Chavinha de publicar no canto superior direito da foto**
   - Lista: só a chavinha, sem palavra.
   - Lado a lado: chavinha com a palavra "Rascunho" ou "Publicado".
   - A chavinha fica amarela em rascunho e verde quando está publicado.
   - O selo Público/PIN continua no canto superior esquerdo da foto.

3. **Menu "..."**: a lixeira passa para dentro do menu, como "Excluir guia" em vermelho, e o "..." fica onde a lixeira estava.

4. **Busca mais esperta**: os resultados aparecem enquanto você digita, já pelas primeiras letras de cada palavra. Por exemplo, "clay" encontra os guias do "Clayton". A busca ignora acentos e maiúsculas e aceita um erro de digitação em palavras longas. Ela procura no título do anúncio, no nome do proprietário, na cidade, no país, no endereço, no subtítulo e no link. Os resultados mais parecidos aparecem primeiro.

5. **Nova ordem da página**:
   ```text
   data / título / subtítulo
   [ PUBLICADOS ] [ RASCUNHOS ] [ PARCIAIS ]
   [ Visualização | + Novo | Filtros ]
   [ Buscar... ]
   quadrantes
   ```
   - Sai a linha "GUIAS · 9".
   - Na barra, o "Filtros" fica sempre na ponta direita, o "Novo" no meio e a visualização na esquerda.

6. **Só duas visualizações**: sai a Grade e ficam Lista e Lado a lado. Quem tinha salvo a Grade abre na Lista.

7. **Selecionar um ou mais guias nas duas visualizações**
   - Cada cartão ganha uma caixinha de seleção no canto superior direito da área de texto, onde o seu print marcou.
   - Cada quadrante ganha uma caixinha "selecionar todos" no fim do cabeçalho. A etiqueta com a quantidade ("1 guia") fica logo à esquerda dela.
   - As ações em lote que já existem continuam iguais.

8. **Regra anti-corte** conferida no celular (393px) e no computador (1280px), nos temas claro e escuro.

## Detalhes técnicos
- `admin.guias.tsx`: dividir em três listas (`draftList`, `attentionList` com publicados e score < 100, `readyList`). O cabeçalho "Não publicado" usa o tom amarelo já presente nos tokens.
- A busca vai usar `normText` e `tokens` de `src/lib/ai/fuzzy-match.ts`. Cada termo digitado precisa bater por prefixo em alguma palavra dos campos, ou por um erro de digitação quando tiver 5 letras ou mais. A ordem segue a pontuação e depois cai para a ordem atual.
- `GuideCard`: remover a variante `grid`. `pub` recebe `withLabel` e vai para `absolute right-1.5 top-1.5`. O Switch usa as cores amarela e verde por token nos estados `unchecked` e `checked`. O checkbox vai para o topo direito da área de info, e a lixeira sai da prop `actions`.
- `view` aceita só `"list" | "split"`, e o alternador vira de dois estados.
