# Assistente interno: mais rápido e melhor para encontrar imóveis

## O que aconteceu na conversa dos prints
1. A pessoa escreveu "residência Florata/Arthur". A busca de imóveis compara só o **nome do imóvel**, e só se o texto aparecer inteiro dentro dele. "Florata/Arthur" não bate com nada, então a IA chamou "listar imóveis" 3 vezes e desistiu.
2. A resposta "Casa do proprietário Arthur" terminou em "Não consegui responder agora". A IA chegou ao limite de passos sem uma resposta final, porque não existe busca por proprietário.
3. Demora: um texto longo (mais de 160 caracteres) ou qualquer coisa que pareça uma ação sempre usa o esforço máximo, e cada busca que falha consome mais uma rodada de raciocínio longo. Por isso o "Olhando os imóveis" fica rodando tanto tempo.

## O que vai mudar

### 1. Busca de imóveis inteligente
- A busca passa a olhar nome, apelido, endereço, bairro, cidade e **nome do proprietário** ao mesmo tempo.
- Aceita palavras soltas e fora de ordem ("Florata/Arthur" vira "florata" + "arthur"), sem acento e com erros pequenos de digitação ("Floratta", "Artur").
- Devolve os resultados ordenados do mais provável ao menos provável, dizendo por que cada um bateu (ex.: "proprietário: Arthur Silva").
- Quando a busca fica vazia, já devolve as opções mais parecidas, em vez de voltar vazia.

### 2. A IA pergunta em vez de desistir
- 1 imóvel bem provável: segue direto e diz qual escolheu ("Entendi como Residência Florata, do Arthur").
- 2 a 5 possíveis: pergunta numa frase curta com as opções ("Seria a Residência Florata ou a Casa Arthur Centro?").
- Nenhum: pergunta o que falta (nome, bairro ou proprietário). Nunca inventa e nunca responde "tente de outro jeito".
- A regra também vale para hóspedes, reservas, prestadores e proprietários citados de forma vaga.

### 3. Nunca mais "Não consegui responder agora"
- Se a IA chegar ao limite de passos sem uma resposta, ela faz uma última rodada curta **sem usar ferramentas** e resume o que achou e o que falta saber.

### 4. Mais rapidez sem perder qualidade
- Texto longo **não** vai mais sozinho para o esforço máximo. O máximo fica para dinheiro, hóspede, reclamação, cancelamento e para o momento de **confirmar** uma ação.
- O começo de uma ação ("criar tarefa", "vincular") usa esforço alto: localizar o imóvel e montar o rascunho não precisa do topo. A confirmação continua no máximo.
- Buscas repetidas com os mesmos parâmetros na mesma resposta são reaproveitadas, sem consultar de novo.
- A mensagem de andamento passa a dizer o que está acontecendo ("Procurando 'Florata' e 'Arthur'…").

### 5. Conferência
- Refaço o caso dos prints ("Tarefas: residência Florata/Arthur…" e depois "Casa do proprietário Arthur") e meço o tempo antes e depois.
- Testes automáticos para a busca aproximada e para a regra de perguntar.

## Detalhes técnicos
- `src/lib/ai/assistant-tools.server.ts`: reescrever `matchProperties` com tokenização, normalização NFD, distância de Levenshtein ≤1 para tokens com ≥5 letras e pontuação por campo (nome > apelido > proprietário > endereço/bairro/cidade). Faz join com o proprietário do imóvel (stakeholders) só dentro de `ctx.propertyIds`, sem ampliar o acesso. Retorna `motivo` e `sugestoes` quando não há resultado. Atualizar a descrição de `listar_imoveis` (a busca aceita proprietário/endereço).
- Prompt interno (`prompts.ts` / registry do generalista): bloco "RESOLVER AMBIGUIDADE" com as regras 1 / 2–5 / 0, no máximo 2 buscas por entidade antes de perguntar.
- `src/lib/ai/gateway.server.ts`: ao esgotar `maxSteps` sem texto, chamada final com `tool_choice: none` pedindo um resumo curto. `assistant-run.server.ts` deixa de usar o texto genérico de fallback.
- `src/lib/ai/reasoning.ts`: remover o gatilho `message.length > 160 → max`; `looksLikeAction` passa a dar `high` na montagem e `max` só com `isAction`/confirmação/`highRisk`. Atualizar `__tests__`.
- Cache de ferramentas por execução (mapa `nome+args` dentro de uma resposta).
- Nada muda na IA do hóspede, nas permissões ou no consumo por mensagem simples.
