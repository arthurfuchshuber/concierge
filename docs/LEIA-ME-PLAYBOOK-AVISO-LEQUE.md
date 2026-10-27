# Aviso do hóspede, leque da fila, botão da IA e janela do campo (27/10/2026)

Implementação FIEL do canvas "ConciergeIA · Playbook atual" (quadros: Aviso · Proposta A, Aviso · Fila com 4 hóspedes em cascata, Campo · Proposta A). Base: ZIP `concierge-main` (os cinco arquivos tocados estavam idênticos ao Lovable no commit 66ddcf62).

## Arquivos
- `src/components/handoff/QuickChatBubbles.tsx` — o balão virou o **cartão ancorado no botão da IA** (bico apontando para ele):
  - largura 330px (300px com leque), 10px de margem lateral, casca `ds-overlay`, X de canto padrão das janelas (32px) que dispensa o aviso;
  - foto do hóspede (inicial) com a **bolinha do canal** (Airbnb vermelho, WhatsApp verde, Guia digital violeta), nome, **ícone de mensagem verde** (menu padrão WhatsApp/Copiar via `PhoneActionButton`, apagado se não há telefone), "· agora" (ou "há N min/h/d"), imóvel em UMA linha com reticências, período `DD/MM/AAAA → DD/MM/AAAA` em dourado;
  - etiqueta dourada **"Precisa de atendimento"** (um hóspede) ou **"Atendimento"** + `1º · check-in em N dias` (leque); motivo em até 3 linhas; botões **Responder** (claro) e **Depois**;
  - **leque**: quando há mais de 1 hóspede, avatares em arco ao redor do botão, ordenados pelo check-in mais próximo (topo do arco = 1º, com o cartão aberto; seguindo para a esquerda 2º e 3º; o excedente vira "+N"); arco tracejado ligando os avatares; tocar num avatar traz o cartão dele; tocar no "+N" traz o 4º;
  - "Responder" abre o mini-chat no mesmo lugar (como já era); "Abrir completo" e "Recolher" mantidos. O modo "lista" antigo saiu: o leque o substitui.
- `src/lib/handoff-queue-order.ts` (novo) — ordem da fila (check-in mais próximo; estadia em andamento primeiro; sem data no fim; empate = quem esperou mais), dias até o check-in no fuso de São Paulo, textos ("check-in em 7 dias", "agora"…).
- `src/components/handoff/FloatingHandoffDock.tsx` — passa ao cartão check-in/check-out, telefone e horário do chamado (já vinham em `details`), e a base do botão (`fabBottom`, respeitando `--page-footer-h`).
- `src/components/FloatingDock.tsx` — **botão da IA**: esfera de 48px no degradê da marca (`#b04af0 → #7c1ad8 → #c2269a`) com brilho interno, ícone de estrelas branco, **flutuação** de 4px a cada 3,4s (parada para quem pede menos movimento) e **selo claro com o total** de chamados (99+ no máximo); a flutuação mora na esfera e não no botão, para não brigar com o arrasto vertical; menu "Atendimento / Assistente" ajustado ao novo tamanho.
- `src/styles.css` — `@keyframes fab-float` e `.fab-float`.
- `src/components/playbook/PlaybookPage.tsx` — **janela do campo**: cabeçalho com quadro de 44px com o ícone da categoria, título (Sora 18px) e `N · Categoria` embaixo, filete separando o valor, valor em 15px/500, **etiqueta colorida da audiência** (Público verde, Reserva Ativa âmbar, Equipe Interna neutra) com a explicação ao lado e as abas Texto | Nota | IA no rodapé (sem mudança). "Replicar" continua, agora na mesma linha da etiqueta.
- `src/lib/playbook-field-icons.ts` (novo) — um ícone por campo do catálogo (ex.: Climatização = floco de neve); campo criado à mão cai no ícone da seção; FAQ e prestador têm o seu.
- Testes novos: `src/lib/__tests__/handoff-queue-order.test.ts`, `src/components/handoff/__tests__/QuickChatBubbles.test.tsx`.

## Decisões minhas (o canvas não dizia — confirme)
1. **"Depois"** dispensa só aquele hóspede do aviso (ele continua na fila e no contador do botão); no leque, o próximo da fila assume o cartão. O **X** dispensa o aviso inteiro.
2. **Novo chamado com check-in mais próximo**: entra na fila e o leque reordena sozinho; o aviso reaparece para chamados NOVOS (regra que já existia: só alerta conversa que ainda não alertou nesta sessão). Um aviso dispensado não volta sozinho.
3. O texto do cartão é o motivo do chamado (`handoff_reason`); sem motivo, o parágrafo não aparece.
4. Os ícones por campo da janela são escolha minha (o canvas só mostrava o de Climatização).

## Não verificado
Não rodei o app no navegador nem comparei visualmente com o canvas. Ver o relatório de testes/tipos na mensagem de entrega.
