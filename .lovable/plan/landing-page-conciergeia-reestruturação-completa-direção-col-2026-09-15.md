# Landing page ConciergeIA — reestruturação completa (direção "Coluna central")

Reescrita da página inicial inteira, do topo ao rodapé, seguindo o mockup escolhido:
coluna central estreita, muito espaço negativo, cartões escuros com borda fina e
acento roxo→magenta usado com parcimônia. Mesma paleta (#0A0A0F / #15151F, roxo
#7C1AD8, magenta #E82DAE) e mesmas fontes (Sora + Manrope).

## O que muda na página

Ordem final das seções (as atuais que não constam aqui saem):

1. **Topo fixo** — logo, menu enxuto (Produto, Recursos, Planos, Contato), botão
   "Conhecer o ConciergeIA" e "Entrar". No celular vira menu em gaveta.
2. **Abertura** — selo pulsante, título curto em duas linhas (segunda linha em
   degradê), subtítulo de uma frase, dois botões e o painel do sistema logo abaixo,
   em moldura suave.
3. **O problema** — dois cartões numerados 01 / 02, texto curto, tom consultivo.
4. **Como o ConciergeIA organiza** — narrativa Informação → Organização →
   Inteligência → Experiência em quatro passos numerados na coluna central.
5. **Bento de recursos** — grade assimétrica no computador (cartão grande de
   Atendimento IA + Guia do hóspede + quatro compactos), coluna única no celular.
6. **Para quem é** — três perfis: anfitriões profissionais, gestores de múltiplos
   imóveis e operações com equipe.
7. **Planos** — os mesmos quatro planos e preços atuais, cartões na coluna central,
   Pro destacado.
8. **Contato** — bloco final com o formulário já existente (nome, e-mail, telefone,
   nº de imóveis, mensagem), com as máscaras e o envio por e-mail que já funcionam.
9. **Rodapé** — logo, links e aviso legal.

Saem de vez: seções repetidas da versão anterior (ScatterToUnified, BeforeAfter,
DifferentiatorSection, MultiPropertySection e o CTA final duplicado), que eram o
"resto do que já tínhamos feito" que você não quis manter.

## Linguagem

- Nada de promessa de mais reservas, vendas, conversão, ROI ou margem.
- Foco em operação, organização, padronização, inteligência e experiência.
- Sem depoimentos, logos ou números de clientes inventados (o mockup trazia
  "200+ gestores" — não entra).
- Preços e nomes de planos continuam exatamente os que já estão no sistema.

## Detalhes técnicos

- `src/components/landing/sections.tsx` reescrito; primitivos (`Surface`,
  `GradientText`, `BentoCard`, `Reveal`) reaproveitados em
  `src/components/landing/primitives.tsx`, com um novo `Container` de coluna
  central (max-w-3xl para texto, max-w-6xl para o bento).
- `src/routes/index.tsx` passa a montar apenas as seções acima; `head()` mantém
  title, description, OG e o JSON-LD SoftwareApplication já existentes.
- Planos continuam vindo de `@/lib/payments.shared.ts`; formulário continua em
  `submitLandingLead` (`src/lib/landing-leads.functions.ts`), sem mudança de backend.
- Framer Motion só em entradas curtas, respeitando `prefers-reduced-motion`.
- Regra anti-corte aplicada: nada estoura a margem direita em 360–1920px;
  barras roláveis usam `ds-scroll-x`, sem degradê nas bordas.
- Verificação final: `bunx tsgo --noEmit` e capturas em 1280px e 393px, do topo
  ao rodapé, para você conferir as duas visões.
