# Padronização geral + cards da Limpeza abrindo detalhes editáveis

## 1. Nome do proprietário igual em todo o sistema

O padrão é o da página Guias: **"Proprietário: [primeiro nome]"**, na mesma cor neutra do título do imóvel, com o ícone de contato ao lado quando houver telefone.

- A cor rosa sai da regra central, então todos os cards que já usam essa regra mudam juntos: Dashboard, Kanban, calendário de ocupação e tarefas.
- Estes lugares hoje escrevem o nome à mão, em rosa ou sem o "Proprietário:", e passam a usar a mesma linha padrão:
  - a janela do dia na Limpeza (a do print 1);
  - a aprovação de limpeza completa;
  - Registros;
  - o histórico da reserva;
  - o painel de imóveis nas permissões;
  - a janela de detalhes da tarefa.
- Onde hoje aparece "Sem proprietário", a linha simplesmente não aparece (regra de não mostrar campo vazio).

## 2. Janelas antigas no padrão do sistema

Algumas janelas ainda são painéis soltos. Elas não desfocam o fundo, o clique fora não volta à tela anterior e a tabela pode ser cortada à direita. Ficam no padrão estas:

- **Janela do dia nos gráficos da Limpeza (print 1):**
  - vira janela padrão: fundo desfocado, clique fora fecha e volta, mesmo arredondamento e cabeçalho;
  - a tabela Imóvel / Tipo / Valor se ajusta à largura: o nome do imóvel encolhe primeiro e quebra linha se precisar, e valor e hora nunca são cortados;
  - a etiqueta "Normal" usa a cor neutra padrão, e "Completa" também.
- **Levantamento das demais:** reviso as janelas, dicas e listas flutuantes de Dashboard (Operacional, Kanban, Limpeza, Registros) e de Guias. Toda janela ou painel desenhado à mão passa a usar a janela padrão do sistema, com desfoque, clique fora que volta à anterior, anti-corte e estilo único.
- A conferência final é feita na tela, em celular (393px) e computador (1280px), abrindo cada janela.

## 3. Cards em limpeza clicáveis, com detalhes editáveis

Tocar em qualquer card da Fila de Limpeza (Operacional e Kanban) e nos concluídos da Limpeza abre a janela de detalhes no mesmo padrão visual. Nela fica tudo o que importa, e cada item pode ser alterado ali mesmo:

- imóvel, proprietário (linha padrão), hóspede que saiu e próximo hóspede com data de chegada;
- janela da limpeza (saída → próxima entrada);
- **tipo de limpeza** (normal ou completa), que pode ser trocado; a completa continua indo para aprovação;
- **valor desta limpeza**, editável na hora, com motivo opcional e o registro de quem alterou;
- **nota interna**, editável;
- pendências do imóvel e anexos/registros, com botão para adicionar;
- histórico da reserva, em seção recolhível;
- ações: concluir limpeza, "Limpeza não será realizada" e voltar ao status anterior.

Os botões de ação do card continuam funcionando sem abrir a janela: tocar no botão faz a ação, tocar no resto do card abre os detalhes.

## Detalhes técnicos

- `card-colors.ts`: `CARD_OWNER` passa a ser neutro (mesma classe do título do imóvel em Guias). `OwnerLine` vira o componente único; `CleaningDayDetail.PropertyCell`, `CleaningApprovalPanel`, `RecordsWorkspace` (~1095), `ReservationJourneyDialog` (~134), `PropertyScopePanel` e o modal de tarefa (~5734) passam a usar `OwnerLine`/`ownerLabel`.
- `CleaningDayDetail`: o painel absoluto com seta é trocado pelo `Popover` do sistema (registrado no `global-overlay-store`). A tabela passa a usar `grid-cols-[minmax(0,1fr)_auto_auto]`.
- Varredura com `rg` por `absolute`/`fixed` com `z-` e por `text-accent` em `src/components/dashboard`, `src/components/guias` e `src/routes/_authenticated/admin.guias.tsx`. Cada painel manual é convertido em Popover/Dialog do sistema.
- Novo `CleaningDetailDialog` (Dialog registrado como "window"). Ele reaproveita `getReservationJourney`, o `setCleaningPriceOverride` e o `CleaningPriceDialog` (inline) e o `advanceArrival`/`revertArrival`. Troca de tipo após concluída: novo server fn `setCleaningType` (RLS da sessão; completa volta para `pending`, respeitando o gatilho `guard_cleaning_approval`).
- `ArrivalCard` em modo `cleaning`/`done`: `onClick` no card abre o diálogo; os botões internos usam `stopPropagation`.
