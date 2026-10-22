---
name: Janelas — "Voltar" (como página) vs "X" (janela pequena)
description: Regra global de fechamento de janelas: janela "como página" usa Voltar no topo direito no celular/tablet; janela pequena e desktop usam o X de canto
type: design
---

Regra global (22/10/2026, mockups aprovados da página Proprietários):

- **Janela "como página"** (ficha do proprietário, Dados cadastrais, Editar proprietário, Sobre o imóvel):
  `<DialogContent pageLike>` + `<DialogDateRow />` como 1ª linha. Abaixo de `lg` ela NÃO é tela cheia: fica
  logo abaixo do cabeçalho do sistema (60px + 20px), com 10px nas laterais, sem "X"; o "Voltar" (seta + texto)
  fica no canto superior direito, NA MESMA linha da data dourada. No computador (lg+): centralizada (880px),
  fundo preto da página (`bg-background`) e "X" de canto.
- **Janela pequena** (confirmações, menus, passos do Airbnb, avisos): sem `pageLike`, sem linha da data, mantém o "X"
  de canto em todos os tamanhos. Casca: `p-[18px]`, `gap-3.5`, título Sora 18/800, botões `h-10 rounded-[9px]`.
- Ritmo: 6px entre as linhas do cabeçalho, 24px entre blocos, 28px de padding no computador.
- Segunda linha do cabeçalho = etiqueta em caixa alta (`ds-eyebrow`, `--faint`), p.ex. "Dados cadastrais".
- Cabeçalho de imóvel com foto (Ver informações / Instruções): `PropertyPhotoHeader` (foto inteira + degradê).
