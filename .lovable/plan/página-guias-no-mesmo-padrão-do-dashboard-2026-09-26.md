# Página Guias no mesmo padrão do Dashboard

## O que está errado hoje
- O cabeçalho é outro: não tem a data em cima, o título é maior e mais pesado, e os botões ficam numa faixa solta, com o botão da IA por cima.
- Não existe a estrutura do Dashboard: faixas com rótulo ("HOJE", "AMANHÃ"), cartões de números e quadrantes.
- Os cartões dos guias usam outro visual: foto gigante, selos flutuando e cores rosa/amarelo fortes.
- A visualização "Lado a lado" empilhou os selos na coluna de texto. A ideia era deixá-los em cima da foto, como no seu desenho.

## Como vai ficar

```text
SÁBADO, 26 DE SETEMBRO            (data pequena, amarelo fraco)
Guias Todos                        [Filtros] [Visualização] [+]
9 guias de imóveis, 7 publicados.

──────────── VISÃO GERAL ────────────
[ PUBLICADOS  7 ] [ RASCUNHOS  2 ] [ INCOMPLETOS  1 ]
   (tocar num cartão filtra a lista; tocar de novo limpa)

──────────── GUIAS ────────────
 quadrante "Precisam de atenção"  (rascunhos ou abaixo de 90%)
 quadrante "Prontos"              (publicados e completos)
```

1. **Cabeçalho idêntico ao do Dashboard:** mesma moldura com a data em cima, título e subtítulo que mudam com o filtro ou o cartão escolhido, e os botões no mesmo canto e no mesmo formato do Registros. O botão da IA deixa de cobrir os botões.
2. **Faixas com rótulo** ("VISÃO GERAL", "GUIAS"), iguais a "HOJE" e "AMANHÃ".
3. **Cartões de números** (Publicados, Rascunhos, Incompletos), no mesmo estilo dos cartões do Operacional. Tocar num deles filtra a lista, como em Registros.
4. **Guias em dois quadrantes**, como em Registros: "Precisam de atenção" e "Prontos". No computador ficam lado a lado e no celular um embaixo do outro. Cada quadrante mostra no máximo 5 guias e rola por dentro, com a barra sutil.
5. **Cartão do guia redesenhado no padrão dos cartões do Dashboard:** fundo escuro, borda fina, cantos iguais e textos no tamanho dos cartões atuais. O nome do proprietário fica em tom neutro, com o ícone de contato. A cidade fica discreta, sem o amarelo forte. A barra de preenchimento é fina, com o percentual, e os botões "..." e lixeira ficam à direita.
6. **Três visualizações:**
   - **Lista** (padrão): cartão compacto com a miniatura da foto.
   - **Lado a lado** (seu desenho): foto à esquerda, com o selo Público/PIN e o interruptor Rascunho/Publicado em cima da foto. No celular a foto ocupa cerca de 40% da largura; o nome, o proprietário, a cidade, a barra e os botões ficam à direita, sem nada empilhado.
   - **Grade:** foto menor, com os mesmos dados.
7. **Janelas** (Filtros, menu "...", confirmação de exclusão, duplicar) com o visual padrão das janelas do Dashboard, abrindo no centro ou do lado com mais espaço, sem cortes.
8. **Regra anti-corte** conferida no celular (393px) e no computador (1280px), nos temas claro e escuro, com prints antes de eu te entregar.

Depois disso, aplico o mesmo tratamento ao editor de guia.

## Detalhes técnicos
- Reusar `OperationShell` ou extrair dele um `PageShell` genérico com data, título, subtítulo e `actions`, em vez de `WorkspaceHeader`. Os botões usam `ACTION_BAR`, `ACTION_SEGMENT`, `ACTION_BUTTON_TONE` e `ACTION_ICON`.
- Usar `SectionLabel`, `StatCard` + `ds-card-grid`, `ds-blocks`, `ds-five-cap` e o molde de quadrante de `RecordsWorkspace`.
- Tirar o cartão do guia de `admin.guias.tsx` para `src/components/guias/GuideCard.tsx`, com `variant: "list" | "split" | "grid"`. O proprietário usa `OwnerLine variant="neutral"` e `PhoneActionButton alwaysShow`.
- A visualização escolhida continua salva no `localStorage` (`guias-view`), agora com a Lista como padrão.
- Os filtros do painel já migrados continuam; os cartões de números se juntam ao filtro de situação.
