# Redesign da Home Pública do Guia — Concierge Luxuoso

Como os protótipos não renderizaram no chat, vou seguir com a direção **V3 · Concierge Luxuoso** — a que melhor traduz "de outro mundo, elegante, tecnológico" mantendo a estrutura do esboço. Ajustes serão feitos em **ambos os temas** (dark e light) e sem inventar conteúdo negativo.

## Direção visual

- **Hero cinematográfico**: foto da hospedagem em 4:5 com máscara de gradiente, título em Playfair Display itálico, destaque em gradiente âmbar→rosa→roxo (dark) / índigo sólido (light). Nome + tagline sempre em uma linha equilibrada.
- **Glassmorphism celestial**: `bg-white/[0.04]` + `backdrop-blur-2xl` + borda `white/10`, com auréolas de cor (`blur-3xl`) atrás dos cards principais. No light: `bg-card` sólido + sombra suave + auréolas com opacidade baixa.
- **Grid assimétrico de Acessos Rápidos**: card "Chegada" full-width com CTA gradiente e aura roxa; abaixo, dois cards satélite (Saída / A residência) e uma linha compacta (clima · status IA).
- **Card Concierge IA**: painel maior com fundo em gradiente `from-[#1a0b2e] via-[#2d1b4e] to-[#4c1d95]` (dark) / `from-purple-50 via-white to-pink-50` (light), avatar em vidro, chips de sugestão com hover, botão primário luminoso.
- **Feed "O que rola em [cidade]"**: título em **uma única linha** (whitespace-nowrap + tracking calibrado + tamanho responsivo), cards verticais 4:5 com foto, pill de categoria colorida, título serifado, hover-zoom sutil.
- **FAQ**: card único elegante com contador de perguntas e chevron animado.
- **Micro-detalhes**: pontos de status com halo pulsante, gradiente sutil respirando no header, entrada em stagger via Framer Motion (já disponível), transições `[0.2,0.8,0.2,1]`.

## Conteúdo

Estritamente positivo e sobre a cidade: turismo, gastronomia, eventos locais, passeios, cultura, natureza, mercado. O prompt de `city-news.functions.ts` já filtra — vou reforçar o system prompt para excluir explicitamente notícias negativas/policiais/tragédias.

## Alterações técnicas

Arquivos a editar (nenhum código de backend novo, só apresentação):

1. **`src/routes/g.$slug.index.tsx`** — reestruturar hero, headers de seção, grid de acessos rápidos, wrapper geral. Adicionar auréolas globais de fundo em ambos os temas.
2. **`src/components/guide/HomeIntelligence.tsx`** — refinar card IA (gradiente novo, avatar em vidro, tipografia serifada no título, chips maiores, botão CTA luminoso).
3. **`src/components/guide/CityNewsFeed.tsx`** — título em uma linha via `whitespace-nowrap` + `tracking-[0.2em]` + tamanho responsivo (`text-[11px] md:text-[13px]`), cards 4:5 com pill categoria e hover-zoom. Reforçar `openChat` com contexto positivo.
4. **`src/components/guide/CheckinCountdown.tsx`** — harmonizar visual com nova linguagem (halo âmbar mais suave, borda glass).
5. **`src/lib/city-news.functions.ts`** — reforçar prompt do modelo para excluir conteúdo negativo (crimes, tragédias, política) e focar em turismo/gastronomia/eventos/passeios/cultura.
6. **`src/styles.css`** — adicionar (se necessário) tokens auxiliares para halos e gradientes celestiais reutilizáveis, e keyframe `aurora-drift` para respiração sutil dos gradientes de fundo.

## Regras invioláveis

- Ambos os temas (dark + light) — nada de estilizar só um.
- Apenas classes semânticas do design system (nada de `text-white`/`bg-black` hard-coded); onde precisar de cor absoluta em glass (ex: `bg-white/[0.04]`), aplicar via condicional de tema.
- Regra global de tipografia mantida: pontuação nunca inicia linha; campos vazios do painel ocultam a seção inteira.
- Título "O QUE ROLA EM FOZ DO IGUAÇU" **em uma linha** — testado em 360px de largura.
- Conteúdo do feed: só positivo, só cidade.

## Validação após implementação

- Playwright: screenshot da home nos dois temas em 375px e 1280px, confirmar título do feed em uma linha, hero legível, cards com brilho.
- Console/network: sem 500 em `getCityNews` / `getDailyTip`.

Depois de aprovado, implemento tudo em um único passo.
