# Nova landing "Cyber-glass" — mais visual, menos texto

Direção escolhida: **Cyber-glass interface**. A página deixa de ser uma coluna de texto e passa a ser uma sequência de painéis de vidro iluminados, onde o próprio sistema aparece na tela em quase toda seção. No celular, cada bloco é uma peça visual que se revela ao rolar, com carrosséis que deslizam com o dedo.

## Como a página fica

1. **Abertura** — selo pulsante, um título curto de duas linhas (a última em degradê roxo→magenta) e, logo abaixo, uma tela do sistema em moldura de vidro com contorno iluminado. Dois botões: "Conhecer o ConciergeIA" e "Solicitar uma demonstração".
2. **Painel vivo** — mosaico de peças do produto (lista de imóveis, cartão de atendimento ao hóspede, tarefa do dia, registro de manutenção) em vidro fosco, com leve profundidade e brilho que segue o toque/cursor.
3. **Recursos em carrossel** — no celular, cartões grandes que deslizam na horizontal com encaixe; no computador, grade. Cada cartão é quase todo imagem/interface, com um rótulo curto e uma frase.
4. **Fluxo da operação** — quatro etapas (informação, organização, inteligência, experiência) mostradas como painéis que se acendem em sequência, com pouquíssimo texto.
5. **Para quem é** — três faixas visuais compactas, com ícone e uma linha cada.
6. **Planos** — os mesmos planos e preços atuais, em cartões de vidro; o recomendado com borda iluminada.
7. **Contato** — bloco em degradê roxo→magenta com o formulário atual (nome, e-mail, telefone, mensagem), máscaras já existentes preservadas, envio para o mesmo e-mail de hoje.
8. **Rodapé** enxuto com os links atuais.

## Regras mantidas

- Paleta grafite/roxo/magenta e fontes Sora + Manrope inalteradas.
- Nenhuma promessa de aumento de reservas, vendas ou conversão.
- Nada cortado na margem direita em telas de 360–393px; carrosséis usam `ds-scroll-x`, sem degradê nas bordas.
- Toda animação respeita a preferência de "reduzir movimento".

## Detalhes técnicos

- Reescrever `src/components/landing/sections.tsx` com as novas seções (Hero, LivePanel, FeatureRail, FlowSection, AudienceSection, LandingFooter) e adicionar primitivas de vidro (`GlassCard`, borda gradiente, glow) em `src/components/landing/primitives.tsx`.
- `src/routes/index.tsx`: nova ordem de montagem; `head()` (title, description, OG, JSON-LD) preservada.
- `LandingNav.tsx`: âncoras ajustadas às novas seções.
- Carrosséis mobile: `ds-scroll-x` + `snap-x snap-mandatory`; grade a partir de `md`.
- `framer-motion` com `useReducedMotion`; peças de produto são componentes React (não imagens de banco), para nitidez em qualquer tela.
- `PricingSection` e `LeadForm` reaproveitados, apenas revestidos no novo estilo; `submitLandingLead` intocado.
- Validação: `bunx tsgo --noEmit`, build limpo e capturas em 1280px e 393px conferindo `scrollWidth`.
