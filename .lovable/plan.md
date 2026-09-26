# Ajustes finais na página Guias

1. **Espaço entre Filtros e busca:** a mesma distância que existe entre a barra de abas e a barra de filtros em Registros. O campo de busca passa a ter a mesma altura da barra de filtros.
2. **Quadro de cada grupo como antes:** volta a moldura, o fundo e a linha colorida do topo, como em Registros. A diferença é que o cabeçalho (ícone, título, linha e etiqueta) começa e termina exatamente na largura dos cartões, sem passar deles, como no seu print.
3. **Etiqueta:** "1 Guia" / "5 Guias", com a primeira letra maiúscula.
4. **Título:** "Todos os Guias" no lugar de "Guias Todos".
5. **Lado a lado ao abrir:** a página abre na visualização Lado a lado. Se você trocar para Grade, a escolha continua salva.

Nada mais muda. Vou conferir no celular (393px) e no computador (1280px), nos temas claro e escuro, e garantir que nada corta na margem direita.

## Detalhes técnicos
- `admin.guias.tsx`: dar à busca a altura `--ds-action-h` e a mesma margem usada entre abas e `ACTION_BAR` em `RecordsWorkspace`.
- `section`: voltar a usar `PANEL_SHELL` + gradiente do topo. `PanelHeading` recebe o mesmo recuo horizontal da lista (compensando o `ds-five-cap`: padding 10px à direita e margem -4px) para as bordas baterem com os cartões. Conferir por print.
- `CountPill`: `Guia`/`Guias`. `pageTitle` padrão: "Todos os Guias".
- `view` padrão `"split"` quando não houver valor salvo em `guias-view`.
