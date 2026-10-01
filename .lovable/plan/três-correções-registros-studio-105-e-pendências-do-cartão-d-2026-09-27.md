# Três correções: Registros, Studio 105 e pendências do cartão de limpeza

## 1. Tirar o cartão "Pendências em aberto" de Registros
O cartão sai da grade de números. Os outros cartões ficam como estão.

A diferença de 16 para 17 acontece porque esse cartão contava outra coisa. Ele contava as tarefas em aberto, e não os registros de Danos e Manutenção. Como o cartão sai, a diferença deixa de aparecer.

## 2. Studio 105 ainda aparece na Fila de Limpeza
O que o banco mostra:
- A reserva do Airbnb já está certa: entrada 26/09, saída 28/09.
- O formulário que o hóspede (Marlon) preencheu ainda guarda a saída antiga, 27/09.
- O sistema só junta formulário e reserva quando as datas de saída são iguais. Com as datas diferentes, o formulário vira um segundo cartão, com saída em 27/09, e é esse que está na Fila de Limpeza.

A correção:
- **Agora:** a saída do formulário do Marlon passa para 28/09. O cartão duplicado some da Fila de Limpeza, e fica só o cartão "Em estadia".
- **Daqui pra frente:** quando o calendário do Airbnb adiar uma saída, o formulário do hóspede ligado àquela reserva também recebe a nova data.
- **Proteção no painel:** se o formulário já estiver ligado a uma reserva, vale a data de saída da reserva, mesmo que o formulário tenha outra.

## 3. Pendências do cartão de limpeza com o visual de antes, só que recolhidas
Volta a caixa de antes, como no print 2: com borda, o fio dourado em cima, o título "CHECKLIST DESTA LIMPEZA", o fio fino e a etiqueta 0/5 à direita. A diferença é que ela mostra só essa linha de título, sem a lista. Ao tocar no título, abre a janela flutuante com a lista inteira, igual já funciona hoje.

## Detalhes técnicos
- `RecordsWorkspace.tsx`: tirar o `<PendenciasButton variant="card" />` da grade de StatCards e apagar o import.
- Migração pontual: `update guide_access_logs set checkout_date='2026-09-28' where id='cc9a8a59-39f3-4b95-a1bb-e0890b075c09'`.
- `airbnb-ical.server.ts`: no bloco que já trata a saída adiada, atualizar `checkout_date` dos `guide_access_logs` ligados via `guest_arrival_status.reservation_id` e também dos logs com o mesmo `reservation_code`, quando estiverem na data antiga.
- `arrival-board.server.ts`: em `findLogsForReservation` (≈l.131/144), aceitar um log com `checkout_date` diferente quando ele já estiver ligado à reserva por uma linha de status (`reservation_id`) ou pelo mesmo código de reserva. Ao montar o cartão, usar a saída da reserva.
- `OperationWorkspace.tsx` `CleaningChecklist`: o gatilho do Popover passa a ser a moldura antiga, com borda arredondada, fio dourado no topo, `SectionLabel` "Checklist desta limpeza", fio e `CountPill` feitas/total. Sem a lista nem o "+N pendências". O conteúdo do Popover não muda.
