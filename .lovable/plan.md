# Linha do tempo de registros: layout compacto e contagem correta

## O caso do Studio 104 (verificado no banco)

O registro das 12:27 tem **duas linhas**: um **vídeo** (STUDIO104-01) e uma **nota de texto** ("Limpeza"), gravadas juntas na mesma situação.

A tela trata as duas como se fossem mídia. Por isso:
- o rodapé diz "2 mídias" quando existe 1 vídeo só;
- o menu oferece "Excluir foto 1" e "Excluir foto 2" — nem foto é, e um dos itens é o texto.

Não há arquivo perdido nem vídeo corrompido: a contagem e os rótulos é que estão errados.

## O que muda

### 1. Contagem e rótulos honestos
- O texto da situação deixa de contar como mídia. O rodapé passa a mostrar o que realmente existe: "1 vídeo", "3 fotos", "2 fotos · 1 vídeo".
- O menu nomeia cada item pelo tipo real: "Excluir vídeo", "Excluir foto 2", "Excluir áudio", "Excluir texto da situação".
- Quando a situação tem só texto e nenhuma mídia, nada de grade nem contagem.

### 2. Layout novo: miniatura pequena à esquerda, informação à direita
Cada registro vira uma faixa horizontal compacta:

```text
┌──────────────────────────────────────────────┐
│ [AUDITORIA DE LIMPEZA]              12:27  ⋮ │
│ ┌────────┐  Limpeza                          │
│ │ ▶ 0:42 │  Esther Villar · via Fila         │
│ │ vídeo  │  1 vídeo                          │
│ └────────┘                                   │
└──────────────────────────────────────────────┘
```

- Miniatura quadrada pequena (cerca de 72px), com selo do tipo (vídeo/foto/áudio/arquivo) e play por cima quando é vídeo.
- Texto da situação, autor, origem e contagem ficam à direita da miniatura, em linhas curtas.
- Tocar na miniatura abre a mídia em tela cheia (é lá que o vídeo toca grande) — o card da linha do tempo não fica mais dominado por um player.
- Áudio continua com a barra de tocar, ocupando a largura da coluna da direita.

### 3. Várias mídias na mesma situação: faixa rolável
- Com mais de uma mídia, as miniaturas viram uma **fileira horizontal rolável** no lugar da miniatura única, mantendo a informação à direita.
- A rolagem usa a utilidade `ds-scroll-x` do projeto (sem degradê de fade, conforme a regra do projeto), com contador "1/4" discreto.
- Nada ultrapassa a margem direita em telas de 360–393px.

### 4. Vários registros da mesma reserva
A lista já rola verticalmente; com o card mais baixo, cabem 4–5 registros na mesma altura em que hoje cabe 1. O separador de dia ("HOJE") continua.

## Parte técnica

- `src/components/dashboard/ReservationRecords.tsx`:
  - `RecordBlock` reescrito: separa `group.items` em `mediaItems` (kind ≠ "note") e `noteItem`; miniatura/faixa rolável + coluna de informação com `min-w-0`.
  - Rótulos do `DropdownMenu` por `kind` real, com índice só quando há mais de uma mídia do mesmo tipo.
  - Rodapé com resumo por tipo em vez de `group.items.length`.
  - Visualização em tela cheia da mídia reaproveitando o `Dialog` já importado.
- `groupRecords` não muda (o agrupamento por `groupId` está correto).
- Sem alterações de banco, de envio de mídia ou de exclusão — só apresentação e rótulos.
