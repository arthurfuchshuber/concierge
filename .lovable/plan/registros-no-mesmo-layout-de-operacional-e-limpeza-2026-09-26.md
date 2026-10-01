# Registros no mesmo layout de Operacional e Limpeza

A página Registros já usa a mesma moldura (cabeçalho, barra Operacional / Kanban / Limpeza / Registros). O que ainda difere da Limpeza, e vai ser igualado peça por peça:

## 1. Cabeçalho
- Data em caixa alta dourada no topo ("SEXTA-FEIRA, 25 DE SETEMBRO"), igual à Limpeza.
- Título muda conforme o filtro, no mesmo formato de "Limpezas Últimos 7d": "Registros · Todo o período", "Danos · Últimos 30d", etc.
- Frase de apoio fixa embaixo: "Fotos, vídeos, áudios e notas registrados nos imóveis." A contagem ("38 registros · 6 em aberto") sai do subtítulo e vai para os cartões.
- Botão redondo da IA à direita, igual ao da Limpeza.

## 2. Linha de filtros
- Mesma barra dividida em duas metades iguais da Limpeza: à esquerda o período (ícone de brilho + "Todo o período" / "Últimos 7 dias"), à direita "Filtros".
- O botão "Pendências" deixa de ficar solto nessa linha e vira um cartão de número (item 3), que abre a mesma lista ao ser tocado.

## 3. Cartões de número
- Hoje: um bloco único com 6 quadrados. Passa a ser o mesmo cartão da Limpeza: ícone em caixinha + rótulo em caixa alta + número grande centralizado, 2 por linha.
- Primeira linha: "Registros" (total) e "Em aberto" (pendências, abre a lista).
- Abaixo, as categorias (Manutenção, Danos, Esquecidos, Auditoria, Outros) em cartões menores no mesmo estilo, em 2 colunas no celular e 3 ou mais no computador. Continuam servindo de filtro: tocar marca, tocar de novo desmarca.
- A cor da categoria fica só na caixinha do ícone, como hoje.

## 4. Gráfico novo "Registros por dia"
- Mesmo cartão de gráfico da Limpeza: ponto verde, título em caixa alta espaçada, fio, "role para o lado" e barras com o número em cima.
- Segue o filtro de período e de categoria e mostra só do primeiro ao último dia com registro.
- Tocar numa barra abre a tabela do dia com imóvel, categoria e situação, no mesmo formato da tabela da Limpeza.

## 5. Lista de imóveis
- Os blocos "Precisam de atenção" e "Em dia" e os cartões de imóvel continuam, com o mesmo raio, a mesma sombra e o mesmo cabeçalho dos cartões da Limpeza. O conteúdo e as ações não mudam.

## 6. Regras que continuam valendo
- Nada cortado na margem direita em 360–393px. Barras que rolam usam `ds-scroll-x`, sem degradê.
- Textos dinâmicos podem quebrar linha.
- Visualizar, editar, resolver e excluir registros continuam iguais.

## 7. Padrão para as próximas páginas
- As peças comuns (cabeçalho com data, linha de filtros em duas metades, cartão de número e cartão de gráfico) saem da Limpeza para um lugar só. A Limpeza e os Registros passam a usar as mesmas peças, e as próximas páginas também.
- O guia de padrão de layout guardado no projeto é atualizado para apontar para essas peças e mostrar a ordem da replicação: Registros agora, depois as outras páginas, uma por vez.

## Conferência
- Print da página em 393px ao lado do print da Limpeza, antes de dizer que terminou.

## Detalhes técnicos
- Extrair de `OperationWorkspace.tsx` para `src/components/ds/`: `DateEyebrowHeader` (dentro do `OperationShell`), `SplitActionBar`, `StatCard` (a partir de `KpiCard`), `DailyBarChartCard` (a partir de `CleaningDailyBarChart`) e `DayDetailTable` (a partir de `CleaningDayDetail`).
- `RecordsWorkspace.tsx`: trocar a grade `CategoriaCelula` por `StatCard`, mover `PendenciasButton` para o cartão "Em aberto" e criar a série diária a partir de `q.data` no próprio navegador, recortada com `trimSeries`. Não precisa mudar nada no servidor.
- `OperationShell` ganha as propriedades `title` e `eyebrow`.
- Atualizar `mem/design/padrao-layout-workspace.md`.
