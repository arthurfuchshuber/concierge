# Restaurar o controle "IA no Airbnb" por anúncio

## Problema confirmado
A rodada de auditoria #121 ("Integrações 4 cards") removeu o card Airbnb e o painel que tinha:
- liga/desliga da IA por anúncio;
- escolha de quem assina as respostas (remetente por anúncio).

As funções do servidor continuam existindo, mas nenhuma tela as chama. Anúncios novos entram com a IA ligada e não há como desligar pela tela.

## O que fazer
1. Manter Integrações com os 4 cards (decisão da #121 preservada).
2. Adicionar uma seção "IA no Airbnb" dentro da janela da integração Airbnb já existente (fluxo de conta Airbnb), listando cada anúncio conectado com:
   - interruptor "IA responde neste anúncio";
   - seletor "Quem assina as respostas".
3. Visível só para quem administra a conta; respeita as regras anti-corte (uma linha por anúncio, sem cortar na margem direita em 360px).
4. Teste: desligar um anúncio grava `airbnb_ai_enabled = false` e a mensagem do hóspede vai para a fila humana.

## Detalhes técnicos
- Reaproveitar `getAirbnbAiToggles`, `setAirbnbAiToggle`, `getListingSenders` de `src/lib/channex.functions.ts` (sem mudança de banco).
- Base visual: trecho do antigo `ChannexPanel.tsx` (recuperável do commit anterior a 0e939e15), registrando a janela no `global-overlay-store`.
