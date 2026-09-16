# Ajustes na landing: texto, brilho, celular clicável e novo formulário

## 1. Frase de abertura

- Quebra de linha antes de "Rotinas": primeira linha "Tudo em um só lugar!", segunda linha com o restante ("Rotinas, IA de atendimento ao hóspede, organização e visualização de pendências, entre outras.").
- "Tudo em um só lugar!" em branco gelo (tom levemente mais claro e frio que o texto de apoio), o resto segue no cinza atual.

## 2. Brilho em movimento na palavra "CÉREBRO"

- Um reflexo diagonal suave e contínuo atravessa a palavra, sem piscar nem mudar a cor do degradê roxo→magenta.
- Fica parado para quem prefere menos animação no sistema.

## 3. Barra inferior do celular clicável

- Os quatro botões dentro do mockup (Início, Chegada, Saída, Explorar) passam a funcionar: tocar troca a tela mostrada no celular.
- Cada botão leva ao exemplo correspondente: Início abre a capa do guia, Chegada o check-in, Saída o check-out, Explorar a curadoria da região.
- A barra de recursos acima e a seta de avançar continuam funcionando; tocar na barra inferior sincroniza o recurso selecionado acima.

## 4. Botões rosa com canto quase reto

- Curvatura reduzida ao mínimo em todos os botões rosa da página (chamada do topo, planos e envio do formulário), mantendo o brilho que já passa por eles.

## 5. Novo layout do formulário (direção "Vidro cyber")

- Painel único com cantos arredondados, foto escurecida no topo com um traço em degradê roxo→magenta e o título forte sobre ela.
- Campos em vidro fosco (fundo translúcido, borda fina), maiores e mais legíveis, com o rótulo dentro do campo; ao focar, a borda acende em roxo e o fundo clareia levemente.
- Ordem: Nome, E-mail, WhatsApp, Empresa/Operação, Quantidade de imóveis, Principal desafio (opcional).
- Botão de envio largo em degradê magenta→roxo, canto quase reto, com o reflexo passando.
- Linha final discreta sobre privacidade dos dados.
- No desktop segue em dois lados (informação + campos); no celular empilha, sem nada cortado na margem direita.
- Os contatos por e-mail e WhatsApp continuam presentes no lado de informação.
- Máscaras de preenchimento, validações e o envio por e-mail permanecem exatamente como estão.

## Detalhes técnicos

- `src/components/landing/sections.tsx`: subtítulo do Hero com quebra e span em branco gelo; `ResultShowcase` ganha estado de tela derivado também da barra inferior; botões rosa com raio mínimo.
- `src/components/landing/ResultScreens.tsx`: `BottomBar` passa a receber `onSelect`; `ScreenShell` repassa; cada tela exporta sua chave de navegação para o mapeamento nav → tela.
- `src/components/landing/primitives.tsx`: `GradientText` com variante de brilho animado (máscara deslizante), respeitando `prefers-reduced-motion`.
- `src/components/landing/LeadForm.tsx`: apenas apresentação — estrutura, campos, máscaras e `submitLandingLead` inalterados.
- Verificação final com `tsgo` e conferência em 1280px e 393px.
