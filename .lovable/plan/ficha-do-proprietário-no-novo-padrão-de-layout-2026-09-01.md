# Ficha do proprietário no novo padrão de layout

Aplicar na ficha de detalhes do proprietário/prestador o mesmo racional de layout já usado em Operação, Guias e Stakeholders, com o cabeçalho aprovado ("Fio de marca no topo").

## Cabeçalho (novo)

- Fio de 2px no topo com o gradiente da marca (roxo → rosa), largura total.
- Eyebrow 10.5px maiúsculo: "Proprietário" / "Prestador".
- Nome em Sora 700 22px, uma linha, truncado.
- Linha de metadados 12px separada por pontinhos: status (Ativo/Cancelando/…) · Pessoa Física ou Jurídica · vigência "21/10/2025 → 31/08/2026", já na cor do status como na listagem.
- Ações à direita como botões-ícone 36x36 com canto 0.3rem: Editar, Importar Dados (só quando o ClickSign está ativo) e kebab com as demais ações. Uma linha só, com rolagem horizontal se faltar espaço.
- Sai o cartão grande, o avatar circular de 64px, os botões largos e o bloco recolhível "DADOS PESSOAIS" solto — os dados pessoais passam a ser uma linha discreta de 36px logo abaixo do cabeçalho, ainda recolhível e fechada por padrão.

## Barra de abas

Segmented control full width igual ao das outras páginas: fundo sutil, cantos 0.3rem, abas flex-1 com 46px, aba ativa com gradiente roxo→rosa. Abas: Visão Geral, Imóveis (só proprietário), Financeiro, Documentos, Log.

## Linha do tempo

Mantida como está no mockup aprovado, com dois ajustes:

- Cards com canto 0.3rem, padding 12px, lista densa com 6px entre itens, trilho fino de 1px com marcador redondo (o mais recente em rosa da marca).
- Passa a mostrar o AUTOR de cada movimentação: "Registro · [inicial] Ana Paula · 03/08/2026, 11:44". Quando não houver autor registrado (eventos automáticos/integrações), mostra "Sistema".

## Demais blocos da ficha

Imóveis vinculados, financeiro, documentos, acessos e notas recebem o mesmo tratamento: cards planos 0.3rem, sem bordas arredondadas grandes, texto 13px/meta 12px, ações agrupadas, nada cortando na margem direita em telas estreitas.

## Detalhes técnicos

- Arquivo principal: `src/components/stakeholders/StakeholderDetailSheet.tsx` (troca de `rounded-3xl`/`rounded-2xl`/`rounded-full` por `ds-surface` 0.3rem, tipografia `ds-page-title`/`ds-section-title`/`ds-body`/`ds-meta`, barra de ações 36px, `ds-scroll-x` onde houver risco de corte).
- Autor da timeline: `stakeholder_events.created_by` já existe. No servidor (`getStakeholderDetail` em `src/lib/stakeholders.functions.ts`), resolver os `created_by` em nome/e-mail via `profiles` e devolver junto de cada evento. Sem mudança de schema.
- Feed de integrações e trilha do sistema continuam com a mesma origem de dados; muda apenas a apresentação.
- Nenhuma alteração de regra de negócio, permissões ou consultas além do enriquecimento do autor.

## Depois desta página

Com o padrão validado aqui, replicar na sequência para as demais subpáginas do SaaS (ficha do prestador usa o mesmo componente; depois hóspedes, imóveis, integrações), uma a uma.
