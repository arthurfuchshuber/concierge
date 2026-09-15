# Landing ConciergeIA — visual estrondoso, imagens reais

Direção escolhida: **Glassmorphism bento** (v1), com o formulário no layout do mockup 2.
Paleta e fontes travadas: grafite #0A0A0F / #15151F, roxo #7C1AD8, magenta #E82DAE, Sora + Manrope.

## O que muda

### 1. Imagens reais no lugar dos desenhos simulados
- Capturo telas reais do sistema (com dados de demonstração): painel de operação, atendimento ao hóspede, rotinas do dia, imóveis/proprietários e guia do hóspede no celular.
- Cada captura entra em moldura premium: janela de navegador com barra superior, borda iluminada roxo→magenta, sombra longa e leve perspectiva.
- Cenas fotográficas realistas de hospedagem (interior de apartamento à noite, recepção, celular na mão) entram como fundo suave atrás das capturas, sempre escurecidas para o texto continuar legível.
- Os componentes desenhados hoje (ChatVisual, TasksVisual, GuideVisual, etc.) saem de cena.

### 2. Estrutura da página (bento)
- **Abertura**: selo, título grande com "hospedagem" em degradê, subtítulo curto, dois botões e a captura do painel em moldura de navegador, grande e centralizada.
- **Bento de recursos** (grade de 12 colunas):
  - Cartão largo "Atendimento ao hóspede" com a captura do celular saindo pelo canto inferior direito.
  - Cartão alto em degradê roxo→magenta "Guia do hóspede".
  - Cartão "Rotinas do dia" — **sem ícone de relógio**, título alinhado no topo, igual ao cartão vizinho.
  - Cartão largo "Imóveis e proprietários" com captura inclinada ao lado.
- **Como funciona**: quatro etapas (informação, organização, inteligência, experiência).
- **Para quem é**: três perfis.
- **Planos** e **Formulário** (abaixo).
- No celular: mesma ordem, cartões empilhados, capturas em largura total, nada cortado na margem direita.

### 3. Planos
- Plano **Starter sai** da página.
- Ficam **Pro**, **Business** (destacado) e **Enterprise**, com os preços atuais.
- No Pro, em vez de nada, entram listados os recursos que eram do Starter; no Business o texto "Tudo do Starter, mais:" vira "Tudo do Pro, mais:".
- O botão **"Comparativo detalhado"** e a tabela recolhida saem.

### 4. Formulário (layout do mockup 2)
- Painel único de cantos bem arredondados dividido em dois:
  - Esquerda: fundo fotográfico escurecido, título forte, texto curto e os contatos (e-mail e WhatsApp) com ícones circulares.
  - Direita: campos em caixas grandes e arredondadas — nome em linha cheia, e-mail e telefone lado a lado, mensagem em bloco, botão largo de envio.
- As máscaras de preenchimento (nome, e-mail, telefone) e o envio por e-mail continuam exatamente como estão.
- No celular os dois lados viram um em cima do outro.

## Cuidados
- Nada de promessa de mais reservas, vendas, conversão ou porcentagens inventadas — o texto segue falando de operação, organização e experiência.
- Nenhum dado real de hóspede aparece nas capturas.
- Conferência final em 1280px e 393px: nada cortado na margem direita.

## Detalhes técnicos
- Capturas feitas no próprio sistema via navegador automatizado, recortadas e publicadas como assets de CDN (`lovable-assets`), referenciadas por ponteiro `.asset.json`.
- Cenas fotográficas geradas em alta qualidade e também publicadas como assets.
- Novos componentes em `src/components/landing/`: `ProductShot.tsx` (moldura de navegador/celular) e `BentoGrid` dentro de `sections.tsx`; `visuals.tsx` é removido.
- `PricingSection.tsx`: remove a coluna `starter`, o bloco do comparativo e o estado recolhido; `payments.shared.ts` permanece intacto (o Starter continua existindo no sistema, só não aparece na página).
- `LeadForm.tsx`: só o layout muda; validação, máscaras e `submitLandingLead` ficam iguais.
- Animações com framer-motion respeitando `prefers-reduced-motion`.
