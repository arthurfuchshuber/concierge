# "Pisca" ao trocar de janela (23/10/2026)

Sintoma: ao clicar em Cancelar/Concluir/Adicionar (qualquer clique que leva de uma janela a outra), a tela principal aparecia por um instante e a janela voltava.
Causa: cada janela tem seu próprio véu (overlay) com fade. Ao trocar, o véu da janela antiga fazia fade-out enquanto o da nova fazia fade-in a partir de transparente — a soma dos dois deixava um vão em que o fundo aparecia sem véu/desfoque.
Correção (global, nos véus das bases):
- src/lib/global-overlay-store.ts — novo `anyWindowOpenNow()` (leitura pontual da pilha de janelas).
- src/components/ui/dialog.tsx, alert-dialog.tsx, sheet.tsx — o véu que nasce quando JÁ existe outra janela aberta (ou saindo) não faz fade-in (`data-[state=open]:!animate-none`): entra cheio, sem vão. O fade-out e a abertura de uma janela sozinha continuam iguais.
Não verificado em navegador real nem pela suíte (sem acesso às dependências aqui): teste abrindo a lista de situações → Adicionar situação → Cancelar, e Concluir pendência → diferença de valores.
