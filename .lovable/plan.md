# Ajustes no guia (oficial + vitrine da landing)

Tudo abaixo é feito nos componentes do guia oficial. Como a landing carrega o
guia real dentro do celular, cada correção aparece automaticamente nos dois
lugares — não existe cópia separada.

## 1. Rolagem travada com um item aberto

Ao abrir "Localização" (ou qualquer outro), a página não rola mais para ver os
itens seguintes. A causa ainda não está confirmada: pode ser o bloqueio de
rolagem usado pelos painéis do guia, ou a animação de abertura mantendo a área
sem altura. Primeiro passo: reproduzir no celular e no celular da landing,
identificar exatamente o que prende a rolagem, e só então corrigir — a correção
vale para o guia inteiro, em todas as abas.

## 2. Tags dentro dos textos

Hoje, nos passos de check-in, aparece o código cru `[[tag:senhas-acesso]]`
porque essa lista mostra o texto puro. Passa a usar o mesmo renderizador de
tags do resto do guia, e o estilo da tag muda para o pedido: nome da seção em
branco, sublinhado, clicável, levando ao local apontado. O novo estilo vale em
todo o guia (chegada, saída, observações, FAQs).

## 3. Barra "Passo a passo / Senhas"

A barra está desalinhada: os dois rótulos ficam encostados à esquerda dentro de
uma moldura larga. Passa a ser dividida em duas metades iguais, com o rótulo
centralizado em cada uma e a metade ativa destacada — mesmo desenho já usado na
tela de etapas do hóspede. Como são só dois rótulos curtos e fixos, não há
risco de corte na borda.

## 4. Borda dos itens recolhíveis

A borda externa de cada item fica quase invisível (traço bem sutil), mantendo o
fundo e o destaque atual quando o item está aberto.

## 5. Alinhamento da seta

A seta do item "Proibido Neste Espaço" fica fora de linha com as demais porque
o texto de apoio ocupa altura diferente. A seta passa a ficar sempre na mesma
altura do ícone e do título, independentemente do tamanho do texto de apoio.

## 6. Corte do celular na landing

A altura do celular na landing passa a terminar exatamente no fim do cartão
"Chegada", incluindo o espaçamento até os cartões seguintes — sem mostrar
nenhum pedaço dos quadrantes de baixo. Ajuste fino da proporção, conferido em
telas estreitas (360–393px) e no desktop.

## Detalhes técnicos

- `src/routes/g.$slug.index.tsx`: `StepList` renderiza cada passo com
  `InlineTagText` (com `onNavigate` e `infoCtx`); `SubItem` com borda
  `border-white/5`, `AccordionTrigger` com seta alinhada ao topo/ícone e `hint`
  em uma linha; `TabsList` do card Check-in trocada de `ds-segmented` para
  grid de 2 colunas iguais.
- `src/components/tags/InlineTagText.tsx`: estilo da tag passa de chip verde
  para texto branco sublinhado clicável.
- `src/components/landing/LiveGuideFrame.tsx`: ajuste da proporção do recorte.
- Investigação da rolagem: reproduzir com Playwright em 393px, checar bloqueio
  de rolagem/altura do container antes de mudar código.
- Verificação final: `bunx tsgo --noEmit` e conferência em 393px e 1280px, sem
  nada cortado na margem direita.
