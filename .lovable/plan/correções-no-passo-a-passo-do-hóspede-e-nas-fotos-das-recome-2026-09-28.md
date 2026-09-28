# Correções no passo a passo do hóspede e nas fotos das recomendações

## 1. Primeira tela (formulário "Boas-vindas")
- Remover os quadros **Chegada** e **Saída** (os que mostram "—").
- As datas continuam sendo conferidas por trás, pelo código da reserva — só não aparecem mais nessa tela.

## 2. Tela "Tudo certo, [nome]!"
- Voltar o quadro com as informações da reserva exatamente como era antes:
  - **Check-in**: data + "a partir das [horário]"
  - **Check-out**: data + "até [horário]"
  - **Endereço**
- Mesmo visual de antes (linhas separadas por fio fino, rótulo à esquerda, valor em negrito à direita). Campo sem informação não aparece.

## 3. Ao terminar o passo a passo
- O hóspede passa a ir automaticamente para a **página inicial** do guia, e não mais para a aba Chegada.

## 4. Fotos das recomendações (quadros verdes)
- O que já conferi: as fotos estão guardadas e o endereço que entrega cada foto responde normalmente no site publicado. Então a causa ainda **não está confirmada** — o problema está no caminho entre a foto e a tela.
- Primeiro passo: abrir o guia no tamanho de celular, na página Explorar e na página inicial, e ver qual foto falha e por quê.
- Corrigir a causa encontrada e revisar todos os lugares que mostram foto de lugar: capas das categorias, lista e grade de Explorar, detalhe do lugar, sugestões da cidade na página inicial.
- Se uma foto falhar mesmo assim, mostrar fundo liso neutro (nunca quadro verde).

## Detalhes técnicos
- `GuideAccessGate.tsx` (~l.843-884): remover o grid dos `RangeButton` "Chegada/Saída"; manter `range` preenchido por `codeCheck` para o envio.
- `g.$slug.index.tsx` passo `intro` (~l.4332): restaurar o bloco de `f5fff693` (linhas Check-in/Check-out com `fmtOnbDate` + `checkinTime`/`checkoutTime`, Endereço condicional).
- `onDone` do onboarding (~l.1535): após `clearPendingOnboarding`, navegar para `/g/$slug` (index), também no botão final do passo `final`.
- Fotos: `/api/public/place-photo` retorna 200 image/jpeg em conciergeia.app. Investigar com Playwright em `/g/<slug>/explorar` e `/g/<slug>` (status das `<img>`, `onError`, CSP/referrer, escolha de capa em `g.$slug.explorar.tsx` l.265-285, cor de fundo do placeholder). Aplicar a correção em todas as telas irmãs.
