## Faixa "Pendências do Imóvel" com espaço igual em cima e embaixo

**Problema:** o título da faixa leva um espaço extra embaixo, herdado do cabeçalho padrão. Por isso sobra mais espaço embaixo do que em cima.

**Correção:**
- Tirar esse espaço extra só do título dentro da faixa, para que a distância até a borda de cima e até a borda de baixo fique igual.
- Manter a altura baixa atual e deixar o texto e a contagem centralizados na vertical.
- Nada muda na janela que abre ao tocar na faixa.

### Detalhes técnicos
- `src/components/dashboard/OperationWorkspace.tsx`, `CleaningChecklist`: no `PanelHeading` de dentro do botão (linha ~4164), passar `className="mb-0"`. Isso substitui o `mb-3` padrão.
- O botão fica com `py-1.5` e ganha `flex items-center`, assim o espaço fica simétrico.
