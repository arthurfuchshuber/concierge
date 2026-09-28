# Cartão de registro: visual mais bonito sem ficar mais alto

## O que muda
O cartão volta a ter a altura de antes (ou menos) e fica mais organizado:

```text
┌──────────────────────────────────────────────┐
│ [AUDITORIA DE LIMPEZA]              18:27  ⋮ │
│ Limpeza                        ┌───┐┌───┐┌──┐│
│ Anfitrião Sigma                │ ▶ ││ ▶ ││+2││
│ via Fila de Limpeza · 1 vídeo  └───┘└───┘└──┘│
└──────────────────────────────────────────────┘
```

- **Texto à esquerda**: título em destaque (letra um pouco maior e mais forte), autor embaixo e, na última linha, origem e contagem em letra menor e mais apagada. Quebra de linha natural, sem cortar.
- **Anexos à direita** em quadradinhos de cantos arredondados, levemente sobrepostos como um leque (efeito de pilha):
  - 1 anexo: um quadradinho só.
  - 2 ou 3: quadradinhos lado a lado sobrepostos.
  - 4 ou mais: mostra 2 e um terceiro com "+N" por cima.
  - Vídeo com play pequeno no centro e duração no canto; áudio com ícone de microfone e duração; arquivo com ícone de documento.
- Tocar em qualquer quadradinho abre um visualizador em tela cheia com **todos** os anexos do registro, passando de um para o outro com setas ou arrastando para o lado, e um contador "2/5".
- A etiqueta da categoria, o horário e o menu "⋮" continuam na linha de cima.
- Registro só com texto: o texto ocupa a largura toda, sem espaço vazio à direita.
- Nada cortado na borda direita, em celular (360–393px) e computador, nos temas claro e escuro.

## Conferência
- Print em 393px com 1, 2 e 5 anexos e com registro só de texto, antes de concluir.

## Detalhes técnicos
- `RecordBlock` em `ReservationRecords.tsx`: linha `flex items-center gap-3`; coluna de texto `min-w-0 flex-1`; pilha de miniaturas `shrink-0 flex -space-x-3` com miniaturas ~52px, `ring-2 ring-card`, `+N` como sobreposição semitransparente.
- `MediaThumb` ganha prop de tamanho; visualizador em tela cheia passa a receber a lista `mediaItems` e o índice inicial, com navegação anterior/próximo.
- Contagens, agrupamento, edição e exclusão sem alteração.
