# Plano de execução — Guias + Assistente IA

Como o pacote tem 7 frentes, vou propor a execução em **4 fases incrementais**, cada uma testável de forma isolada, para evitar um PR monolítico e regressões em cascata.

---

## Fase 1 — Correção crítica + limpeza imediata (urgente)

**1.1 Bug: importação "Na Cidade" não traz nada (0 encontrados)**
- Investigar `generateCityReferences` em `src/lib/maps.functions.ts` e `addAutoCityReferences` em `src/lib/city-references.functions.ts`.
- Suspeitas iniciais: (a) filtro anti-duplicidade recente (`place_id` + nome case-insensitive) está descartando tudo; (b) `MIN_RATING`/`MIN_REVIEWS` ficaram altos demais para Places API New; (c) o scope `city` não está sendo persistido; (d) o raio/region bias está vazio.
- Adicionar logs no handler, rodar manualmente via `stack_modern--invoke-server-function` para reproduzir e corrigir.

**1.2 Remover "Ver Mapa"**
- Remover botão e referências visuais em `g.$slug.explorar.tsx` e onde mais aparecer. Manter componente `<GuideMap>` no código (não deletar arquivo) para reativação futura.

**1.3 Remover "Na Cidade" do menu lateral admin**
- Tirar item de navegação em `admin.tsx`.
- A página `admin.cidades.*` continua existindo mas só acessível via link interno (não vou apagar ainda, para não quebrar a Fase 2).

---

## Fase 2 — Centralizar "Pela Cidade" dentro do guia

- No card "Pela cidade" de `admin.properties.$id.tsx`, embutir o fluxo completo:
  - botão "Gerar com IA" (chama `generateCityReferences` para a cidade da propriedade);
  - busca manual (mesma autocomplete já usada em "Aqui pertinho");
  - listagem com seleção em massa e exclusão (já existe lógica equivalente — reusar).
- Eliminar redirecionamento para `admin/cidades/$cityKey`. Após Fase 2 estável, posso deletar essas rotas em uma fase futura se você confirmar.

---

## Fase 3 — Replicação para outros guias

- Botão "Replicar" no card "Pela cidade" abre Dialog (`shadcn/ui`) com duas tabs:
  - **Guias específicos**: lista de propriedades do host com checkboxes + busca.
  - **Por cidade**: select de cidade → replica para todas as propriedades daquela cidade.
- Nova server function `replicateCityReferences({ sourcePropertyId, targetPropertyIds })` que faz upsert em massa nas propriedades-alvo, respeitando anti-duplicidade por `place_id`.

---

## Fase 4 — IA proativa, aprendizado e tipografia

**4.1 IA proativa (chat fechado)**
- Em `GuideAiChat.tsx`, adicionar bubble flutuante acima do botão, com mensagens rotativas contextuais (4–6 frases hard-coded por enquanto, escolhidas conforme a aba/contexto). Aparece após N segundos de inatividade, descartável, não reaparece na mesma sessão.

**4.2 IA com aprendizado progressivo**
- Persistir eventos de interação do guest (categorias clicadas, lugares vistos, buscas) numa nova tabela `guest_interactions` (já existe `guide_section_events` — verifico se dá pra reusar).
- Injetar resumo desses sinais no `systemPrompt` da chat function a cada turno.
- *Escopo desta fase: MVP. Embeddings/RAG ficam fora; só prompt-engineering com agregados simples.*

**4.3 Refatoração tipográfica premium**
- Adotar par tipográfico SaaS premium. Sugestão default: **Geist** (UI) + **Geist Mono** (code/labels) — ou **Inter Tight** + **Instrument Serif** para um toque editorial. Vou perguntar a preferência antes de aplicar.
- Definir escala consistente em `src/styles.css` (tokens `--font-display`, `--font-sans`, `--text-xs..--text-5xl`, `--leading-*`, `--tracking-*`).
- Aplicar via classes utilitárias em: títulos, subtítulos, descrições, menus, botões, cards, modais, forms, tabelas, empty states.
- Carregar fontes via `<link>` no `__root.tsx` (não `@import` no CSS, conforme guardrail Tailwind v4).

---

## Como sugiro tocar

Faço **Fase 1 agora** (é o que está te travando) e te devolvo para validar. Depois seguimos Fase 2 → 3 → 4 em mensagens separadas, com a Fase 4.3 (tipografia) precedida de uma escolha visual rápida do par de fontes.

Confirma esse encadeamento? Se quiser que eu já comece a Fase 1 sem esperar, é só dizer **"vai"**.
