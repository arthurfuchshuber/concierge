# Cabeçalho das janelas, proprietário neutro com contato e posicionamento seguro

## 1. Título do cabeçalho em uma linha
- Em todas as janelas que usam o cabeçalho padrão (Lista de pendências, Resolver pendência e as demais), o título fica sempre em uma única linha. Quando não couber, termina com "..." e mostra o nome completo ao passar o mouse ou tocar e segurar.

## 2. Proprietário sempre com o ícone de contato
- Em toda janela, a linha "Proprietário: Nome" passa a ter, sempre, o ícone verde de mensagem (WhatsApp / Copiar) logo à direita do nome.
- Se o imóvel não tiver telefone cadastrado, o ícone continua aparecendo, mas apagado, com a dica "Sem telefone cadastrado". Assim a posição fica igual em todas as janelas.
- O nome encolhe com "..." antes de o ícone ser empurrado para fora. O ícone nunca é cortado.

## 3. Cor do proprietário nas janelas
- Nas janelas, o nome do proprietário deixa de ser rosa e passa a usar o mesmo tom cinza neutro do print: Lista de pendências, Resolver pendência, Jornada da reserva, fichas e demais janelas.
- Os cartões das páginas, fora das janelas, continuam como estão hoje.

## 4. Onde as janelas e dicas aparecem
- Dicas, menus e listas suspensas abrem para o lado da tela com mais espaço livre. No celular, ficam mais perto do centro, em vez de colar nas bordas.
- Todas mantêm os limites já combinados:
  - no máximo 75% da altura da tela
  - largura da tela menos 16px de cada lado
  - rolagem interna quando o conteúdo passar disso, e nunca cortes na margem direita
- As janelas centrais continuam centralizadas, com os mesmos limites.

## Detalhes técnicos
- `OverlayHeader`: título com `truncate` e `title`. Nova prop `owner={{ name, phone, country }}`, que renderiza a linha do proprietário em `text-muted-foreground`, com `PhoneActionButton` sempre visível: ele ganha a prop `alwaysShow`, que mostra o ícone desabilitado quando não há telefone.
- `OwnerLine` ganha `variant="neutral"`, usada dentro dos overlays. Trocar os usos de `CARD_OWNER` dentro de `DialogContent`, `PopoverContent` e `SheetContent` (RecordsWorkspace, ReservationJourneyDialog, OperationWorkspace e fichas) pela variante neutra ou pelo `owner` do cabeçalho.
- Em `popover`, `dropdown-menu`, `tooltip`, `select` e `hover-card`: `avoidCollisions`, `sticky="always"` e `collisionPadding` padrão de 16px. Nos popovers grandes a partir do celular, `align="center"`. Manter `max-h-[min(75dvh, available-height)]` e `max-w-[calc(100vw-32px)]` em todos.
- Conferir com Playwright, a 393px e a 1280px, a Lista de pendências e Resolver pendência: título em uma linha, ícone de contato visível e nada cortado.
