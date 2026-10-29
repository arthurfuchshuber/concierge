# Bloqueio/Liberação de datas — calendário em janela própria + seletor de mês/ano (29/10/2026)

Implementa os mockups aprovados do canvas "Bloqueio de Datas".

## O que mudou

1. **Janela inicial sem calendário** (`CalendarBlockUI.tsx`): "Bloquear datas" / "Liberar datas" não carregam mais o
   calendário dentro delas. Entrada e Libera em são botões; tocar abre o calendário numa **janela própria POR CIMA**,
   sem esticar a janela de baixo (some também o risco de o rodapé ficar cortado no celular).
2. **Janela do calendário** (`CalendarPickWindow`): casco do sistema (`--panel`, fio de luz, "X" de canto de 32px),
   **uma cor só** (calendário sem fundo próprio), 280px, com os campos **Início / Fim** embaixo (o que está sendo escolhido
   fica com a borda rosa; tocar num deles troca o campo). Escolher a Entrada passa direto para o Fim; escolher o Fim fecha.
3. **Regra de datas (só bloqueio/liberação)** — `src/lib/manual-block-conflict.ts` (testes em
   `__tests__/manual-block-calendar.test.ts`):
   - passado: nunca; reservas e bloqueios já existentes: **esmaecidos e riscados**, sem toque;
   - Fim (Libera em): só até o dia em que a próxima reserva entra (o bloqueio não atravessa reserva) e no máximo 366 noites;
   - **Liberar**: só noites do bloqueio **manual** tocado (reserva nunca se libera); o resto fica esmaecido.
     Liberar um pedaço: o bloqueio é removido e o que sobra volta como 1 ou 2 bloqueios (se a recriação falhar, o
     bloqueio original é devolvido inteiro).
4. **Seletor rápido de mês e ano em TODOS os calendários** — `ui/month-year-picker.tsx` + `lib/month-year-options.ts`
   (testes em `__tests__/month-year-options.test.ts`). Tocar em "novembro 2026" abre a lista com **mês à esquerda e ano à
   direita**. Só aparece o que existe: sem anos/meses passados no bloqueio (de hoje até o fim do prazo do anúncio), só meses do bloqueio
   no Liberar, e `fromYear`/`toYear` viram os limites nos calendários de cadastro. Ligado em `ui/calendar.tsx` (todos os
   calendários que o usam, inclusive os que tinham o seletor nativo) e nos dois calendários de `filter-panel.tsx`
   (Período e Data única).
5. `ui/calendar.tsx`: a faixa das setas deixou de cobrir o título (`pointer-events`), para o título ser tocável.
6. `ui/dialog.tsx`: `DialogContent` ganhou `overlayClassName` (véu mais leve para a janela pequena por cima de outra).
7. `OperationWorkspace.tsx`: passa a ocupação do imóvel (reservas + bloqueios manuais) e o bloqueio tocado; "Liberar"
   aceita liberar só um pedaço.

## Observações
- Calendários com `<input type="date">` nativo (navegador) não são janelas do sistema e ficaram como estavam.
- Prazo do bloqueio = prazo do(s) anúncio(s) do imóvel: primeira data = hoje + antecedência mínima (`booking_lead_time`); última = hoje + janela máxima (`max_days_notice`). Com mais de um anúncio vale o MENOR mínimo e o MAIOR máximo (`mergeBookingWindows`). Sem dado do anúncio: sem antecedência e 270 dias (`DEFAULT_BOOKING_WINDOW_DAYS`), teto de 730. Leitura em `propertyBookingWindows` (manual-blocks.functions.ts), regras em `bookingWindowBounds` (manual-block-conflict.ts).
