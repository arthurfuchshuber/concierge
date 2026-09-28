# Cartão de registro: anexos em cima, texto embaixo

## O que muda
- Todo cartão de registro passa a ter sempre a mesma ordem, com qualquer quantidade de anexos (1, 2 ou 10):
  1. Linha de cima: etiqueta da categoria, horário e menu "⋮" (como hoje).
  2. **Fileira de quadradinhos** com os anexos (fotos, vídeos, áudios e arquivos), lado a lado, do mesmo tamanho.
  3. **Texto embaixo**, ocupando a largura toda: título, autor, origem e contagem ("1 vídeo", "3 fotos").
- Se os quadradinhos não couberem na largura, a fileira rola para o lado com o dedo, sem nada cortado na borda direita e sem degradê.
- Cada quadradinho continua com o selo do tipo (VÍDEO, FOTO…) e o botão de play nos vídeos. Tocar abre em tela cheia, como hoje.
- Registro só com texto, sem anexo: não mostra fileira, só o texto.
- Áudio vira um quadradinho com ícone e duração. Tocar abre o player.

## Conferência
- Print em celular (393px) com 1 e com vários anexos, nos temas claro e escuro, sem nada cortado.

## Detalhes técnicos
- `RecordBlock` em `ReservationRecords.tsx`: remover o layout lateral de 1 mídia e usar sempre a faixa `ds-scroll-x` de miniaturas quadradas (~64px) seguida do bloco de texto `w-full`.
- Mantém `groupRecords`, contagens, menu de exclusão e visualizador em tela cheia sem alterações.
