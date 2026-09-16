# Nova landing page do ConciergeIA

Substituir completamente a página inicial atual por uma página premium, escura e tecnológica, focada em gerar contatos qualificados. Os planos que hoje aparecem na página continuam, adaptados ao novo visual.

## Narrativa da página (ordem das seções)

1. **Menu fixo** — logo ConciergeIA, links Produto / Como funciona / Recursos / Para quem é / Planos, botão "Conhecer o ConciergeIA". No celular, menu sanfona minimalista.
2. **Abertura (hero)** — "Tudo o que você precisa para operar sua hospedagem. Em um só lugar." + subtítulo, dois botões ("Conhecer o ConciergeIA" e "Ver como funciona") e, ao lado, uma simulação do painel mostrando imóveis, proprietários, fornecedores, inventário, registros, atendimento com IA e guia do hóspede.
3. **Frase de impacto** — "Sua operação já tem todas essas informações. A questão é onde elas estão." Peças soltas (WhatsApp, planilhas, anotações, documentos, memória) se unindo visualmente em um único bloco: ConciergeIA.
4. **O problema** — "Quando a operação cresce, a informação se espalha." Lista enxuta dos pontos de dor e fecho: "O problema não é ter informação. É conseguir encontrá-la quando você precisa."
5. **A solução** — "O ConciergeIA organiza o conhecimento da sua operação." Diagrama de ecossistema ligando imóveis, proprietários, fornecedores, inventário, instruções, registros, atendimento, guia e IA a um centro comum.
6. **Módulos** — "Tudo conectado. Tudo acessível." Os 8 módulos com os textos enviados, em cards discretos com profundidade sutil.
7. **IA** — "Uma IA que conhece a sua operação." Simulação de conversa com os dois exemplos (check-out e mercado próximo), deixando claro que ela responde com base no que está cadastrado.
8. **Guia do hóspede** — "Seu imóvel merece mais do que um manual." Simulação do guia em tela de celular com as categorias (Bem-vindo, Check-in, Wi-Fi, Recomendações etc.).
9. **Antes e depois** — "Menos procura. Mais controle." Perguntas soltas do dia a dia que se dissolvem em "Está tudo no ConciergeIA."
10. **Multi-imóvel** — "De um imóvel a dezenas. A organização continua."
11. **Diferencial** — "Não é apenas gestão. É conhecimento operacional." Comparação ferramentas isoladas x ConciergeIA.
12. **Planos** — os mesmos quatro planos de hoje (Starter, Pro, Business, Enterprise), com os mesmos preços, textos e destinos dos botões, redesenhados no visual escuro. O comparativo detalhado continua, recolhido por padrão.
13. **Prova social** — espaços elegantes e claramente marcados para logos, depoimentos e números. Nada inventado.
14. **Chamada final** — "Sua operação merece um lugar para chamar de casa." com os dois botões.
15. **Formulário** — Nome, Empresa/Operação, Quantidade de imóveis, WhatsApp, E-mail e a pergunta opcional sobre o principal desafio. Botão "Quero conhecer o ConciergeIA" e mensagem de sucesso "Recebemos seus dados. Em breve, entraremos em contato."
16. **Rodapé** — enxuto, com links legais já existentes.

## O que acontece com o formulário

Cada envio fica guardado no sistema (nome, operação, quantidade de imóveis, WhatsApp, e-mail, desafio, data e origem) e dispara um aviso por e-mail para você a cada novo pedido. Os registros ficam disponíveis para consulta posterior.

**Preciso confirmar com você:** para qual endereço de e-mail devo enviar os avisos de novo contato? Posso começar com o e-mail da sua conta de administrador se preferir.

## Visual

Fundo escuro com muito espaço negativo, tipografia Sora/Manrope já da marca, brilhos e gradientes muito discretos em roxo→magenta, bordas delicadas, cards com profundidade sutil. Animações suaves de entrada ao rolar e microinterações leves nos botões e cards — nada chamativo. Página inteira pensada para celular, tablet e computador, sem nada cortado na margem direita.

## Detalhes técnicos

- Rota `/` reescrita (`src/routes/index.tsx`), com novos componentes em `src/components/landing/`: `LandingNav`, `Hero`, `DashboardMockup`, `ScatterToUnified`, `ProblemSection`, `EcosystemSection`, `ModulesSection`, `ChatMockup`, `GuideMockup`, `BeforeAfter`, `MultiPropertySection`, `DifferentiatorSection`, `PricingSection`, `SocialProofSection`, `FinalCTA`, `LeadForm`, `LandingFooter`.
- Tema escuro local à landing (escopo próprio de tokens), sem alterar os tokens globais do painel/guia.
- Animações com `framer-motion` (já instalado), respeitando `prefers-reduced-motion`.
- Planos reaproveitam `PLAN_COMPARISON_GROUPS` de `@/lib/payments.shared` e mantêm o rastreio Meta Pixel já existente.
- Nova tabela `landing_leads` no Cloud (RLS: inserção pública apenas via função de servidor; leitura restrita a administradores) + `GRANT`s.
- Envio do lead por `createServerFn` com validação Zod, gravação via cliente administrativo e aviso por e-mail usando `sendAppEmail` com um novo template registrado.
- SEO: título "ConciergeIA | O sistema operacional inteligente da sua hospedagem", meta description conforme o briefing, canonical, og/twitter, JSON-LD de SoftwareApplication (o FAQPage atual sai junto com o conteúdo antigo).
- Barra de rolagem horizontal apenas onde necessário via `ds-scroll-x`, sem degradês nas bordas.

## Fora de escopo

Integração com CRM externo (o formulário fica preparado, mas sem conexão), alterações no painel administrativo, no guia do hóspede ou na página de preços.
