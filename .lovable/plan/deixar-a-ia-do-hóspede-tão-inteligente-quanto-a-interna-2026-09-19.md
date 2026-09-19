# Deixar a IA do hóspede tão inteligente quanto a interna

## A decisão que você me pediu para ajudar a tomar

Sim: **um agente só**. Hoje existem seis "especialistas" (Reserva, Manutenção,
Experiência, Recuperação, Receita, Generalista) e, antes deles, três camadas
baratas que decidem no lugar do modelo bom: classificador de intenção,
supervisor e planejador. Todas rodam em modelos fracos (Flash / Flash-Lite).

O problema não é ter especialistas — é que eles **tiram poder do modelo bom**:

- cada especialista só enxerga uma lista curta de ferramentas, então uma
  pergunta mal roteada chega ao modelo já sem a ferramenta que resolveria;
- o especialista de Reserva pensa em esforço "baixo", ou seja, responde de
  bate-pronto;
- o classificador rotula a mensagem antes do modelo ler a conversa — foi o que
  transformou "Ola, boa tarde" do Alex em "pós-estadia" e disparou o pedido de
  avaliação.

A IA interna do painel não tem nada disso: recebe a pergunta, tem todas as
ferramentas na mão, pensa e responde. E é justamente a que você achou
inteligente.

## O que vai ser feito

### 1. Um único concierge, com todas as ferramentas

Remover supervisor e especialistas do caminho da resposta. Passa a existir um
agente só, com o catálogo completo de ferramentas (guia, reserva, disponibilidade,
recomendações, clima, cidade, busca externa, roteiro, chamar humano). Ele decide
sozinho o que consultar, como a interna já faz.

As regras que os especialistas traziam de bom (tom de recuperação em reclamação,
cuidado extra em manutenção) viram **instruções dentro do prompt único**, não
gaiolas de ferramenta.

### 2. Sem classificador e sem planejador mandando no modelo

O classificador de intenção deixa de decidir a resposta. Fica só um sinal
determinístico (palavra-chave) para urgência e para o modo de recomendação —
nada que restrinja o que o modelo pode fazer. O planejador sai: o próprio modelo
de raciocínio planeja melhor do que um Flash-Lite planejando por ele.

### 3. Modelo mais novo nas duas IAs

Hóspede e painel passam para `openai/gpt-6-astra` (o padrão atual, pensa melhor
que o `5.6-sol`). Os auxiliares que sobram (validação final, memória, resumo)
sobem de Flash-Lite para um modelo capaz, já que agora são poucos.

### 4. Esforço de raciocínio pela pergunta, nunca pelo papel

Some o `reasoningEffort` fixo por especialista. Vale a política única já escrita
em `reasoning.ts`: trivial = baixo, conversa normal = médio, comparar/planejar/
recomendar = alto.

### 5. O que **fica** (é o que segura a qualidade)

- Guardrail determinístico de segurança e de senhas/códigos travados.
- Máscara de dados sensíveis.
- Contexto da estadia, memória do hóspede e decisões humanas pendentes.
- Busca no guia (RAG), com as correções recentes de relevância.
- Validação final anti-alucinação — agora em modelo forte.
- Escalonamento para humano.

Sai a etapa de "reflexão" (reescrita da própria resposta): num modelo de
raciocínio ela só adiciona latência e chance de deturpar o que já estava certo.

## Detalhes técnicos

- `orchestrator.server.ts`: pipeline de 9 passos reduzido a
  contexto → memória → RAG → agente (tool calling) → validação → memória/log.
- `agents/supervisor.server.ts`, `planner.server.ts`, `reflection.server.ts`
  saem do caminho de execução; `agents/registry.server.ts` passa a expor um
  único agente com a whitelist completa.
- `OrchestratorResult` mantém os campos `intent`, `plan`, `routing` e
  `reflection` preenchidos de forma determinística, para não quebrar
  observabilidade, avaliação e as telas do painel que já os leem.
- `models.ts`: `agent` e `internal` → `openai/gpt-6-astra`; `validation`,
  `memory`, `summary` → modelo capaz; tabela de custo atualizada.

## Antes de ligar

A conta está sem créditos de IA (42 restantes, com bloqueio automático em 600
de uso mensal e já em 545). O teste real do chat só roda depois da recarga em
Configurações → Planos e créditos.
