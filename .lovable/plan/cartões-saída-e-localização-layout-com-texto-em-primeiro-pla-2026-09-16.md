# Cartões "Saída" e "Localização" — layout com texto em primeiro plano

Escopo: apenas os dois cartões pequenos lado a lado da tela inicial do guia. O cartão "Chegada", o "Explore a região", o clima e o restante da página ficam como estão.

## O problema hoje

Nesses dois cartões, o ícone redondo grande ocupa quase metade da largura e empurra o texto para uma coluna estreita. Resultado: o título "Localização & Wi-Fi" aparece cortado como "Locali…" e a informação real ("Check-out até 11h", "Endereço · Wi-Fi") fica espremida em duas linhas minúsculas.

## Como fica

Direção escolhida: texto em primeiro plano.

- O ícone deixa de ser um círculo grande ao lado do texto. Vira um ícone pequeno, do mesmo tamanho da letra, numa linha de topo junto com o nome da categoria em caixa alta discreta ("SAÍDA", "LOCALIZAÇÃO").
- Abaixo, a informação real ganha o destaque: "Check-out até 11h00" e o bairro/cidade, em texto maior e mais legível, usando a largura inteira do cartão.
- Uma segunda linha curta e discreta completa: no cartão de saída, o complemento do horário; no de localização, a rede de Wi-Fi (mascarada no modo demonstração).
- Rótulo encurtado para "Localização" no topo, sem nenhum corte de texto — o "& Wi-Fi" passa a ser a linha de apoio.
- Os dois cartões ficam com a mesma altura, cantos e cor de fundo atuais, dentro da paleta e das fontes já usadas no guia.

## Regras respeitadas

- Nenhum texto truncado com reticências e nada encostando ou ultrapassando a margem direita, em qualquer largura de tela.
- A mudança é feita no guia oficial, então a vitrine da landing (que exibe o guia real) reflete automaticamente — sem duplicar código.
- Quando um dado não existe (sem horário de check-out, sem Wi-Fi), a linha correspondente simplesmente não aparece, sem placeholder.
- Sem pílulas, divisórias internas ou blocos de métrica — os elementos que você rejeitou nas versões anteriores.

## Detalhes técnicos

- Arquivo: `src/routes/g.$slug.index.tsx`.
- `SectionCard` ganha um tratamento próprio para `variant="compact"`: cabeçalho em linha (ícone `size-4` + rótulo `text-[10px]` uppercase), seguido de valor principal e linha secundária opcional.
- Novos campos opcionais no card (`value` e `hint`) para os itens `saida` e `locwifi`; os demais cards seguem usando `title`/`desc` como hoje.
- `hero-wide` e `horizontal-wide` permanecem inalterados.
- Sem `truncate` no título compacto; `line-clamp-2` só na linha de apoio.
- Verificação com Playwright em 393px confirmando ausência de corte lateral e de reticências.
