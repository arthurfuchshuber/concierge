# Registros, avisos de check-in/check-out e página de Guias no novo padrão

## 1. Calendário de Período em Registros
- O calendário só permite escolher datas entre o primeiro e o último dia que têm registros, igual à Limpeza.
- Esse limite considera os imóveis e proprietários filtrados.
- Dias fora desse intervalo aparecem apagados e não podem ser tocados.

## 2. Hóspede confirma check-in / check-out no guia
- O botão de confirmar aparece sempre para o hóspede.
- Enquanto a entrada ou a saída não estiver liberada, o botão fica bloqueado. Ao tocar, uma mensagem curta explica o motivo, por exemplo: "O imóvel ainda está em limpeza. Assim que for liberado, avisamos você por aqui."
- A liberação segue exatamente as regras que o sistema já usa hoje, como a limpeza concluída. Nenhuma regra nova será criada.
- Quando o hóspede confirma, **todos os usuários internos da empresa** recebem um aviso no celular (dono e equipe, sem prestadores). Exemplos:
  - "Check-in feito pelo hóspede · Studio 101"
  - "Check-out feito pelo hóspede · Studio 101"
- Cada confirmação gera um único aviso, sem repetição.

## 3. Aviso ao hóspede quando o imóvel for liberado
- Quando o imóvel fica liberado para a entrada, o hóspede que ativou os avisos no guia recebe:
  "Seu imóvel foi liberado para check-in. Antes de sair, confirme pelo chat se já pode acessá-lo neste momento."
- Tocar no aviso abre o chat do guia.
- É enviado uma única vez por reserva.

## 4. Página Guias no padrão do Dashboard
- A aba **Destinos** sai da página por enquanto. Os dados ficam guardados, nada é apagado. Fica só "Guias de imóveis".
- Toda a página passa a seguir o mesmo padrão já aplicado ao Dashboard:
  - título e subtítulo dinâmicos
  - botão único de Filtros, com Proprietário, Cidade, Situação (publicado ou rascunho) e Imóvel
  - janelas, menus e dicas no padrão visual das janelas do Dashboard, abrindo do lado com mais espaço
  - nada cortado na margem direita
  - nome do proprietário com o ícone de contato
  - barra de rolagem discreta só dentro dos quadrantes
- O editor de cada guia recebe o mesmo tratamento, com todas as abas, janelas, confirmações e seletores. As regras e os campos continuam os mesmos.

## 5. Nova visualização "Lado a lado" (print)
- Terceira opção, ao lado de Grade e Lista.
- Cada imóvel vira um cartão horizontal, com a foto no quadrante da esquerda e, à direita, as mesmas informações de hoje:
  - selo Público e interruptor Rascunho/Publicado
  - proprietário com ícone de contato
  - nome, cidade e tipo
  - barra de preenchimento com o percentual
  - menu "..." e lixeira
- No celular, a foto ocupa cerca de 40% da largura e os textos longos terminam com reticências. Nada fica cortado.
- A escolha de visualização fica salva para a próxima visita.

## Ordem de execução
1. Registros: limite do calendário.
2. Confirmação do hóspede e os dois avisos.
3. Página Guias: padrão, filtros, retirada de Destinos e nova visualização.
4. Editor de guia no padrão.
5. Conferência no celular (393px) e no computador (1280px), sem cortes.

## Detalhes técnicos
- `listAccountRecords` passa a devolver `bounds: { min, max }`, com as datas locais de SP do primeiro e do último `created_at` dentro de `propIds`, sem aplicar o filtro de datas. O `FilterPeriodCalendar` recebe `min` e `max`.
- Antes de mudar a confirmação, mapear em `guide-access.functions.ts` e `guest-access.server.ts` a função que o hóspede usa para confirmar e a regra atual de liberação (limpeza concluída, janela de horário, não compareceu). A mesma regra fica no servidor, como trava, e na tela: a função devolve `{ ok:false, reason }` com a mensagem mostrada no botão bloqueado.
- Push interno: `sendOpsPush` com `userIds = getAccountNotifiableUsers(owner)` (dono e membros owner/agent) e dedupe `guest-self-{kind}-{stayId}`.
- Push ao hóspede: `guest-push.server.ts`, disparado no mesmo ponto em que a limpeza é concluída e aprovada (`notifyCleaningReady` e a aprovação), com dedupe por reserva no `ops_push_log`.
- Guias: `admin.guias.tsx` com `OperationShell`, `filter-panel` e `ds-overlay`. `view` passa a aceitar `"grid" | "list" | "split"`, salvo em `localStorage` e lido em `useEffect`. Rotas e links de Destinos ficam ocultos.
