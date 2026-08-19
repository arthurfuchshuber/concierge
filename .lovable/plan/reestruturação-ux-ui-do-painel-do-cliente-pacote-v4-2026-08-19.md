# Reestruturação UX/UI do painel do cliente (pacote v4)

Aplicar o pacote enviado como padrão único do painel do anfitrião: mesma escala tipográfica, mesmo espaçamento, um único tamanho de botão, mesmo cabeçalho de página e mesmos cards em todas as telas.

## Fundação (antes de mexer em qualquer página)

Camada de tokens e componentes compartilhados, para que as páginas fiquem idênticas por construção e não por retrabalho manual:

- Escala tipográfica: Page Title (Sora 700 · 22px · -0.01em), Page Subtitle (Manrope 400 · 13px · muted), Section Title (Sora 700 · 15px), Card Title (Sora 700 · 13.5px), Body (Manrope 500 · 13px), Meta (Manrope 500 · 12px · muted), Eyebrow (Manrope 700 · 10.5px · uppercase · tom âmbar).
- Escala de espaçamento base 4px: 4/8/12/16/20/24/32/40 com uso fixo (40px do cabeçalho da página ao primeiro conteúdo, 32px entre seções, 24px entre título de seção e conteúdo, 16–20px de padding interno de card).
- Botão: **uma** altura só, 36px, em toda a interface. Variantes: padrão, primária (gradiente roxo→magenta) e ícone (36×36). No mobile, botões com ícone universalmente reconhecível (mapa, mais opções, fechar, copiar, editar) perdem o texto; rótulos ambíguos ("Assumir conversa", "Reabrir") mantêm o texto.
- `PageHeader`: eyebrow + título + subtítulo, com o espaçamento do pacote, usado por todas as páginas.
- `PillScroller`: barras de filtros/abas nunca quebram em segunda linha nem escondem itens atrás de "mais" — rolam na horizontal com esmaecimento na borda indicando conteúdo.
- Card padrão: raio, borda, fundo e padding únicos; ações do card alinhadas com o botão de 36px.
- Consolidação de ações: onde hoje há botões espalhados (Data, Status, Ordenar, Exportar), passa a haver um único **Filtros** com contador + menu "mais opções".

## Telas, na ordem de execução

1. **Shell** — cabeçalho mobile (menu + logo ConciergeIA), gaveta lateral (Dashboard, Guias, Stakeholders, IA Concierge, Atendimento, Administrativo + bloco de usuário com avatar de iniciais, nome e e-mail no rodapé) e barra inferior (Dashboard, Guias, Pessoas, IA, Suporte) com o item ativo em pílula gradiente.
2. **Dashboard** — os 7 KPIs reais (Check-ins pendentes, Checkouts pendentes, faixa fina "Em limpeza", Check-ins amanhã, Checkouts amanhã, Em estadia, Imóveis livres), cores por tipo, card de progresso (instruções de check-in / senha de acesso) com tooltip de quem viu, filtro Hoje/Amanhã/7 dias/Todos e quadro de operação com os cards de reserva no formato do pacote.
3. **Guias** — abas Imóveis/Destinos, faixa de uso do plano, busca + Filtros com contador + alternância de visualização + botão "+", e card de guia (selo PIN/Público, selo de status, capa, proprietário acima do título, cidade, barra de completude com %, ações Editar/Ver/mais).
4. **Editor do guia** — O guia, Marca/upload, Check-in, Check-out, FAQ, Recomendações, A casa, Acessos e Conversas no padrão do pacote.
5. **Atendimento e IA** — lista de conversas (filtros Precisa humano/Meus/Com a IA, busca, cards com barra lateral de urgência e chip "Com <pessoa>"), chat, Conhecimento e Aprendizados.
6. **Pessoas e Administrativo** — Proprietários, Prestadores, Hóspedes, formulário de proprietário (dados cadastrais, CPF/CNPJ, contato, endereço, toggle de acesso ao sistema com senha provisória), Perfil, Permissões (incluindo estado vazio real), Integrações (incluindo integração conectada) e Assinatura (plano, cartão, pagamentos, limite de plano atingido).
7. **Padrões do sistema** — estados vazios (conta nova e busca sem resultado), confirmação de exclusão, toast, presença/digitando, seletor de data/hora, skeleton de carregamento, estados de upload de imagem e os diálogos (detalhe de stakeholder, edição em massa, vincular guias).

## Detalhes técnicos

- Tokens novos em `src/styles.css` (`@theme` + utilitários), sem alterar a identidade cromática existente.
- Novos componentes em `src/components/ui-kit/`: `PageHeader`, `PillScroller`, `KpiCard`, `SectionTitle`, `AppCard`, além do ajuste das variantes do `Button` para altura única.
- Fontes Sora e Manrope sempre declaradas com fallback `,sans-serif`.
- Alterações restritas a apresentação: nenhuma regra de negócio, consulta, permissão ou fluxo de dados é modificada.

Cada fase é entregue e revisável separadamente; posso seguir direto de uma para a outra sem nova aprovação.
