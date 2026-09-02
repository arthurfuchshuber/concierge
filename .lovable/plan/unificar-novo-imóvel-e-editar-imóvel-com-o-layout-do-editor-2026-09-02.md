# Unificar "Novo imóvel" e "Editar imóvel" com o layout do editor de guia

Hoje existem três telas diferentes para os mesmos campos do imóvel:

1. Editor de guia (`Editar guia`) — layout aprovado: abas, cards densos, rodapé de ações.
2. Tela "Novo imóvel" / "Editar" sem guia — mesmos cards, mas sem a barra de abas e com cabeçalho próprio.
3. Popup "Editar imóvel" — outro componente, com cards grandes/arredondados e sem barra de abas.

O objetivo é que as três usem exatamente a mesma casca visual, com apenas a aba "A casa" ativa (as demais visíveis e bloqueadas com cadeado).

## O que muda (visual)

- Barra de abas idêntica à do editor de guia em todas as telas, com "A casa" ativa (gradiente roxo→rosa) e "O guia / Checkin / Checkout / FAQ & Contatos / Recomendações" com cadeado, rolando na horizontal sem cortar (regra ANTI-CORTE).
- Mesmo cabeçalho: "Voltar", título 22px, subtítulo 13px, linha de presença/etiquetas.
- Mesmos cards densos (cantos 0,3rem, título 13px, descrição 11px, ícone 28px), mesma ordem de seções: Identificação, Custos e Duração da Limpeza, Endereço, Calendário Airbnb, Regras, Manual, Detalhamento, Contato do anfitrião.
- Mesmo rodapé de ações à direita, rolável, com botão primário em gradiente.
- No popup, a mesma casca dentro do sheet (sem "Voltar"), com rodapé Fechar / Salvar alterações.

Mockup para validação: `imovel-layout-mockup.png` (A = tela cheia, B = popup).

## Detalhes técnicos

- Extrair a aba "A casa" do editor (`src/routes/_authenticated/admin.properties.$id.tsx`) para um componente compartilhado, ex.: `src/components/admin/PropertyHouseTab.tsx`, junto com o `Stepper` (mover para `src/components/editor/Stepper.tsx`) — assim o editor completo, a tela lean e o popup renderizam o mesmo JSX.
- Tela lean (`showLeanInfoScreen`, ~linha 1745): passa a renderizar `Stepper` com `lockedValues` para as 5 abas restantes + `DenseSections`/`SectionGroup` do componente compartilhado.
- `src/components/admin/PropertyQuickEditDialog.tsx` (1015 linhas): substituir a montagem própria das seções pelo componente compartilhado, envolto em `DenseSections`, mantendo `ResponsiveDialog`, autosave, presença e transferência de proprietário como estão.
- Sem mudança de dados, validação ou regras de negócio — apenas apresentação e reuso de componentes.

## Riscos

- O popup usa autosave e o editor usa salvar explícito; o componente compartilhado recebe `value`/`onChange` genéricos para preservar os dois comportamentos.
