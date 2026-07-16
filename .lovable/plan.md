
## Redesign da Home do Guia — linguagem do V3.html

### Princípios visuais (extraídos do esboço)
- **Compacto e editorial**, não chunky. H1 21px (hoje 32px+), card title 13px, meta 10-11px
- **Paleta quente**: fundo `#100E0C`, superfícies `#1C1712`, hero `#26211A`, gold `#C9A876`, mutes `#B8AF9E` / `#8A8378`
- **Capas coloridas por seção/categoria** (marrom-gold para chegada, azul para saída, verde para residência, roxo para explore) — não usar imagem da propriedade ofuscada; usar bloco de cor sólido com ícone grande (mais legível e leve que o esboço mencionava)
- **Border 0.5px** com cores próximas do fundo, exceto Chegada que ganha border-gold 1.5px + badge "comece aqui"

### 1) HeroCompact — reescrever
- Reduzir altura de `min-h-[36svh]` para altura natural (~180px mobile)
- Header top: logo `SigmaGuide` (pequeno, gold sparkles ícone) à esquerda + badge cidade à direita (formato pill com border-gold 0.5px, texto uppercase tracking-[0.22em])
- Título abaixo em fonte serif `21px mobile / 32px desktop`, weight 500 (não 700), `line-clamp-2`, 2 linhas máx
- Fundo: photo com overlay gradient marrom quente (`#26211A` no bottom via mix), não preto puro
- Manter parallax e slider de fotos, mas com controles menores

### 2) Grid de acesso — reestruturar completamente
Trocar `grid-cols-2` uniforme por layout **assimétrico** replicando o esboço:

```text
┌─────────────────────────────┐
│ CHEGADA (col-span-2)        │  ← capa gold 64px + badge "comece aqui"
├──────────────┬──────────────┤
│ SAÍDA (azul) │ RESID. (verde)│  ← capas coloridas 54px
├──────────────┴──────────────┤
│ EXPLORE (horizontal 2-col)  │  ← capa roxa 80px lateral esquerda
├──────────────┬──────────────┤
│ FAQ (rosa)   │              │  ← se sobrar
└──────────────┴──────────────┘
```

Novo componente `SectionCard` (substitui `ThemeCard`) com props:
- `variant`: `"hero-wide" | "compact" | "horizontal-wide"`
- `tone`: `"gold" | "blue" | "green" | "purple" | "rose"` → mapa fixo de bg/border/icon color
- `badge?`: string (para "comece aqui")

Título compacto (13px), meta (10-11px muted), sem parallax, sem shadow pesado.

### 3) Countdown do check-in
- Layout do esboço: label esquerda "check-in libera em **3h42**" (gold) + horário direita muted + barra progress 3px altura, `#C9A876` fill

### 4) HomeIntelligence — ajustar visual
- Header row: `☀ 19°C · céu limpo` esquerda + `● IA ativa agora` direita (dot verde `#8FCB7A`)
- Título 17px serif "Céu azul perfeito pra cruzar a ponte hoje" (gerado pela IA)
- Body 12px muted com highlight `#C9A876` em palavras-chave
- Botão outline gold: "Perguntar mais ao ConciergeIA →"
- Chips (border gold 0.5px) abaixo: "O que fazer hoje?", "Melhor restaurante"

### 5) CityNewsFeed — cards no mesmo idioma
Mantém scroll horizontal, mas cards agora seguem 2 formatos:
- **Featured** (primeiro): capa colorida por categoria (natureza=azul, gastronomia=laranja, evento=fúcsia, etc.) com ícone grande e bookmark no canto, chip categoria abaixo + título 13px + desc 11px muted
- **Compact** (demais): row horizontal com capa 64px lateral + título + arrow, chip categoria pequena

### O que NÃO muda
- Popup de cadastro/telefone (intacto)
- Sistema de gate de acesso, unlock, wifi, códigos
- Rotas explorar, admin, fluxo de FAQ
- Server functions (getCityNews, getDailyTip já prontos)
- Regras condicionais de renderização (campo vazio = seção oculta)

### Arquivos editados
1. `src/routes/g.$slug.index.tsx` — `HeroCompact` e `ThemeCard` reescritos; grid dos cards com layout assimétrico
2. `src/components/guide/CheckinCountdown.tsx` — refinar visual para o padrão do esboço
3. `src/components/guide/HomeIntelligence.tsx` — refinar layout (clima + IA status + botão + chips)
4. `src/components/guide/CityNewsFeed.tsx` — dois formatos de card com capas coloridas

**Nenhum novo arquivo, nenhuma migração, nenhuma nova função de servidor.** Só CSS/JSX.

### Confirmação necessária
Se aprovar, executo tudo numa passada só. Posso confirmar?
