# Landing page ConciergeIA — refino "Bento precisão"

Direção escolhida: **Bento precisão**. Paleta e fontes atuais mantidas (grafite #0A0A0F / #15151F, roxo #7C1AD8, magenta #E82DAE, Sora + Manrope). O que muda é a composição: mais ar, hierarquia mais forte e a operação apresentada em uma grade bento.

## O que você vai ver

**Abertura (hero)**
- Título centralizado, bem maior, com a segunda linha em degradê roxo→magenta.
- Selo discreto acima do título com ponto pulsante.
- Dois botões: "Conhecer o ConciergeIA" (sólido) e "Solicitar uma demonstração" (contorno).
- Brilhos suaves de fundo, sem exageros.
- Abaixo, o painel de produto (a simulação do sistema que já existe hoje) em um quadro com borda iluminada — mantido, apenas reemoldurado e com mais respiro.

**Grade bento da operação** (substitui os blocos de módulos/ecossistema atuais)
Cartões de tamanhos diferentes, alinhados com rigor, cada um com conteúdo real:
- Atendimento IA (cartão grande, ícone em degradê)
- Gestão de imóveis (cartão grande)
- Proprietários e fornecedores (cartão compacto com número em destaque)
- Inventário e registros (cartão compacto)
- Guia do hóspede (cartão largo, com a peça visual inclinada ao lado)

**Demais seções** (problema, antes/depois, múltiplos imóveis, diferenciais, planos, formulário, rodapé)
- Mantidas em conteúdo, realinhadas ao mesmo acabamento: mesma família de cartões, mesmos raios de canto, mesmo espaçamento vertical, títulos e rótulos padronizados.
- Onde hoje há listas soltas, viram cartões da mesma grade — menos ruído, mais unidade.

## O que não muda

- Paleta, fontes, planos e preços.
- Formulário de contato e o aviso por e-mail para sigma@anfitriaosigma.com.br.
- Textos de posicionamento: nada de promessa de mais reservas, vendas ou conversão.
- Nenhuma prova social (logos/depoimentos) volta.

## Detalhes técnicos

- Reescrita de `src/components/landing/sections.tsx` (Hero, EcosystemSection, ModulesSection, AiSection, GuideSection e demais) e ajuste de composição em `src/routes/index.tsx`.
- Tokens: os valores do protótipo escolhido entram como variáveis locais do tema escuro da landing, sem cores cruas espalhadas nos componentes.
- Grade bento com `grid-cols-1 md:grid-cols-4 lg:grid-cols-6` e spans variáveis; em telas estreitas tudo empilha em coluna única.
- Movimento: framer-motion já instalado — revelação suave ao rolar e brilho leve de borda no hover, respeitando `prefers-reduced-motion`.
- Regra anti-corte aplicada: nada ultrapassa a margem direita em 360–393px; barras horizontais, se houver, usam `ds-scroll-x`.
- SEO e JSON-LD da rota preservados.
