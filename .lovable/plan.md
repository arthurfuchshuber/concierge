# Registros sem corte + barra de rolagem só dentro dos quadrantes

## 1. Quadrantes da aba Registros (print 1)
Hoje os cartões de imóvel encostam na barra de rolagem interna e a borda direita deles fica cortada.
- A área que rola dentro dos quadrantes "Precisam de atenção" e "Em dia" ganha uma folga fixa à direita, reservada para a barra de rolagem. Os cartões encolhem para caber nessa folga, em vez de passar por baixo da barra.
- Também entra uma pequena folga em cima, embaixo e à esquerda, para a borda e a sombra dos cartões não serem cortadas.
- O mesmo ajuste vale para todo quadrante com rolagem interna no mesmo padrão.

## 2. Barra de rolagem da página
- A página inteira do sistema (a rolagem principal da tela) deixa de mostrar barra. A rolagem continua funcionando normalmente, com o dedo, o mouse ou o touchpad.
- A barra continua aparecendo só dentro dos quadrantes, janelas e listas, com um visual mais discreto:
  - lilás da marca com cerca de 35% de opacidade
  - fica um pouco mais forte (cerca de 60%) ao passar o mouse
  - espessura fina, a mesma de hoje

## Detalhes técnicos
- `src/styles.css`:
  - `html, body` (e o contêiner principal de rolagem do layout, se houver) recebem `scrollbar-width: none` e `::-webkit-scrollbar { display: none }`.
  - Na regra global da barra de rolagem, trocar a cor por `color-mix(in oklab, oklch(0.58 0.2 300) 35%, transparent)` e, ao passar o mouse, por 60%. Mesma troca no `scrollbar-color` do Firefox.
  - `@utility ds-five-cap`: `scrollbar-gutter: stable`, `padding: 2px 10px 2px 2px` e `margin-right: -4px`, para compensar a folga sem deslocar a coluna.
- Conferir com Playwright a 393px e a 1280px: a borda direita dos cartões de Registros fica visível e não aparece barra na página.
