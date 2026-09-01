# "Editar Proprietário" no padrão de layout do produto — mockups primeiro

Duas etapas. **Etapa 1 é só mockup** (nenhum arquivo do app é tocado). Só depois do
seu OK visual eu mexo no código.

Observação: no modo de planejamento eu só consigo escrever este arquivo de plano —
não consigo gerar o arquivo de mockup ainda. Assim que você aprovar, a **primeira
coisa** que faço é publicar os mockups e esperar sua validação.

## O que está fora do padrão hoje

Na tela atual (`StakeholderFormDialog`):

- Título em `font-display text-2xl` (fora da escala: deveria ser Page Title Sora 700 22px).
- Rótulos dos campos em `text-xs` (fora da escala: Meta/Label deve ser 12px / eyebrow 10.5px UPPERCASE).
- Cartões de "Pessoa Física / Pessoa Jurídica" com cantos arredondados tipo pílula e
  gradiente próprio, em vez do segmented control padrão (46px, cantos 0.3rem,
  ativo em gradiente roxo→rosa).
- Rodapé com `ds-scroll-x justify-center` — as ações deveriam ficar alinhadas à
  direita, botões de 36px.
- Divisórias de seção ("DADOS CADASTRAIS") com estilo próprio em vez do título de
  seção padrão.
- No mobile o dialog fica muito alto e sem hierarquia; campos longos como
  "Pessoa Físi…" aparecem truncados.

## Etapa 1 — Mockups (entregáveis)

Um arquivo HTML navegável (tema escuro, igual ao print) com:

1. Dialog completo em desktop — cabeçalho, seletor PF/PJ, seções, rodapé.
2. Dialog completo em mobile (393px) — mesma tela do seu print, corrigida.
3. Estado "Pessoa Jurídica" (CNPJ, Razão social, Nome fantasia).
4. Seções: Dados cadastrais · Contato · Acesso ao sistema · Endereço · Extras.
5. Estados: campo obrigatório vazio, erro de CPF/CNPJ, busca de CEP carregando,
   salvando (botão em loading).
6. Variante "Novo Proprietário" e variante "Prestador" (com categorias e valor/diária).

## Etapa 2 — Implementação (após aprovação dos mockups)

- Cabeçalho: título Sora 700 22px + subtítulo Manrope 13px muted (mesmo par do
  `WorkspaceHeader`), sem competir com títulos de seção.
- Seletor PF/PJ: segmented control padrão — largura total, 46px, cantos 0.3rem,
  fundo `foreground/5`, aba ativa em gradiente `#7C1AD8 → #E82DAE`, `ds-segmented`
  (nunca 2 linhas, nunca corte na margem direita, sem gradient fade).
- Títulos de seção: Sora 700 15px, 24px de respiro até o conteúdo.
- Rótulos: Manrope 12px muted; campos e botões com 36px de altura.
- Rodapé: ações alinhadas à direita ("Cancelar" neutro + "Salvar alterações"
  primário), sem `justify-center`.
- Espaçamento pela escala base 4px (12px entre campos, 16/20px de padding,
  32px entre seções).
- Cantos de contêineres estruturais em 8px; botões/badges/chips inalterados.
- Mobile: nada truncado ("Pessoa Física" inteiro), dialog rolável só no corpo,
  cabeçalho e rodapé fixos.

## Detalhes técnicos

- Arquivo afetado na Etapa 2: `src/components/stakeholders/StakeholderFormDialog.tsx`
  (e, se necessário, ajustes pontuais em `src/styles.css` para reaproveitar `ds-*`).
- Apenas camada de apresentação: nenhuma mudança em server functions, validações,
  máscaras (CPF/CNPJ/CEP), autopreenchimento ou regras de negócio.
- Reuso de `ds-page-title`, `ds-page-subtitle`, `ds-meta`, `ds-eyebrow`,
  `ds-segmented`, `ds-scroll-x`.
