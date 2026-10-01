# Ajustes na visualização "Lado a lado" (Guias)

## Cartão do imóvel
1. **Chavinha de publicar:** fica sozinha no canto superior direito da foto, sem fundo e sem a palavra "Rascunho"/"Publicado". Continua amarela em rascunho e verde quando publicado.
2. **Caixinha de seleção:** vai para o canto superior direito do cartão inteiro, no lado do texto, no ponto marcado no print 2. Só o quadradinho, sem fundo, no tamanho atual.
3. **Selo "Público"/PIN:** sai da foto por enquanto.
4. **Espaço entre cartões:** maior, para dar respiro entre um imóvel e outro.

## Quadro de cada grupo ("Não publicado", "Precisam de atenção", "Prontos")
5. **Caixinha "selecionar todos":** sai do cabeçalho por enquanto.
6. **Moldura externa:** sai, junto com o fundo e a linha colorida do topo. O cabeçalho (ícone, título, linha e etiqueta "1 guia") fica alinhado exatamente às bordas dos cartões, à esquerda e à direita, sem nenhuma camada extra em volta.
7. **Rolagem:** o limite de 5 cartões por grupo continua, com a rolagem interna e a barra sutil. Nada pode cortar na margem direita.

A Grade não muda, a não ser pelo item 6: a moldura dos grupos é a mesma nas duas visualizações.

Vou conferir no celular (393px) e no computador (1280px), nos temas claro e escuro.

## Detalhes técnicos
- `GuideCard` (split): remover o `access` da foto. `pub(false)` fica sem o fundo `bg-background/75`, em `absolute right-1.5 top-1.5`. O `check` vai para `absolute right-2.5 top-2.5` no cartão, sem o span de fundo. A área de info ganha `pr-6` para o nome não passar por baixo da caixinha.
- `admin.guias.tsx`: tirar o `Checkbox` do `dot` do `PanelHeading`. A `section` deixa de usar `PANEL_SHELL`, `px-1.5`, `pt-3` e o span do gradiente, e o `PanelHeading` fica sem `px-1.5`. A lista usa `gap-3` em vez de `gap-1.5`.
- `ds-five-cap` tem uma margem negativa por causa da barra de rolagem. O alinhamento do cabeçalho com os cartões vai ser conferido por print.
