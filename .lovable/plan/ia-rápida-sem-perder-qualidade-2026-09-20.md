# IA rápida sem perder qualidade

## O que está acontecendo

Medi as chamadas reais de hoje. A resposta do Assistente do print levou **90 segundos**: o
sistema pensou no nível máximo, escreveu 4.257 tokens de raciocínio e só então mandou tudo
de uma vez para a tela. Enquanto isso a pessoa vê "pensando…" — nenhuma palavra aparece
antes do fim.

Duas causas, independentes:

1. **Tudo no esforço máximo.** Hoje toda mensagem do painel entra marcada como "ação", e
   ação nunca reduz o pensamento. Então "como faço para anexar um vídeo?" pensa tanto
   quanto "exclua 11 pendências".
2. **A resposta não aparece enquanto é escrita.** O motor já sabe entregar palavra por
   palavra (o chat do hóspede usa isso), mas o Assistente interno espera a resposta ficar
   pronta antes de mostrar qualquer coisa.

## O que vamos fazer

### 1. A resposta aparece enquanto é escrita (Assistente interno)

O painel passa a receber a resposta em tempo real, como no ChatGPT: as primeiras palavras
surgem em 2–4 segundos em vez de 90. Junto com elas, avisos do que está sendo feito
("consultando pendências", "olhando a reserva") no lugar do "pensando…" mudo.

Nada de qualidade é cortado: é a mesma resposta, do mesmo modelo, só que visível desde o
começo.

### 2. Pensar na medida da pergunta

A regra atual ("sempre o máximo, reduzindo quando for pertinente") continua — só passa a
valer de verdade para o Assistente interno, que hoje nunca reduz:

- **Máximo** — quando a mensagem manda o sistema FAZER algo (excluir, criar, marcar,
  enviar, alterar), quando envolve dinheiro, hóspede ou cancelamento, e em qualquer
  pergunta de julgamento ("por quê", "compare", "vale a pena").
- **Alto** — pergunta de conhecimento do dia a dia, como a do print ("como faço para
  anexar um vídeo?"). Mesma qualidade prática, bem menos espera.
- **Médio** — saudação e agradecimento soltos.

Só o que a mensagem escreve define o nível; nada é adivinhado.

### 3. Menos peso no que vai junto da pergunta

O sistema envia hoje 8 trechos de documentação inteiros em toda mensagem. Passamos a
enviar os mais relevantes já recortados. Menos texto para ler = resposta antes, com a
mesma informação.

### 4. Hóspede

O chat do hóspede já mostra as etapas e revela o texto ao final. Aplicamos ali o mesmo
ajuste de esforço (item 2) e mantemos a validação antialucinação intacta — o hóspede
continua só recebendo texto já conferido.

## Resultado esperado

| Situação | Hoje | Depois |
| --- | --- | --- |
| Pergunta do print | 90s de tela parada | primeiras palavras em ~3s, fim em ~20s |
| Pedido de ação (excluir, criar) | 20–90s | mesmo pensamento máximo, mas com texto saindo desde o início |
| "oi" / "obrigado" | segundos | instantâneo |

## Parte técnica

- Nova rota SSE `src/routes/api/assistant-stream.ts` (autenticada pelo token do usuário),
  reusando `runAgent({ onTextDelta })` — o suporte a streaming já existe em
  `src/lib/ai/gateway.server.ts` e nunca foi ligado.
- `src/lib/assistant.functions.ts` vira a camada de persistência/ação e continua servindo
  de reserva quando o streaming cair; a lógica de ferramentas e de ação preparada não muda.
- `AssistantPanel.tsx` consome o SSE (etapas + deltas), com volta automática ao caminho
  atual em caso de falha.
- `reasoningFor`: `isAction` deixa de ser fixo no painel e passa a ser detectado pela
  mensagem; novo patamar `high` como padrão de pergunta informativa.
- `retrieveSystemKnowledge`: recorte por trecho em vez de documento inteiro.
