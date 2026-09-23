/**
 * AS PEÇAS DE MOLDURA DO PADRÃO "PRESENÇA" — um lugar só, para as três abas.
 *
 * Pedido explícito (18/09/2026): "não é só replicar a paleta, mas sim o
 * layout inteiro". Até aqui cada aba tinha reescrito o seu cabeçalho de
 * bloco e o seu rótulo de seção por conta própria: a Operacional usava
 * ponto + palavra + fio que some, a Limpeza usava só a palavra solta no topo
 * do gráfico, e os Registros usavam palavra + fio reto. Três desenhos para a
 * mesma função é o que fazia as abas parecerem três produtos.
 *
 * As duas peças abaixo são a forma única. Quem quiser um cabeçalho de bloco
 * ou um rótulo de seção chama daqui — mudar o padrão volta a ser mudar UM
 * arquivo, como já acontece com as cores em `card-colors.ts`.
 *
 * O raio dos cartões também mora aqui (`PANEL_SHELL`): 14px é o raio dos
 * cartões da Operacional, e era o que os gráficos da Limpeza e os cartões de
 * imóvel dos Registros não seguiam (usavam 0.3rem, quase um canto reto).
 */

import type { ReactNode } from "react";

/**
 * A casca de um bloco: luz do `ds-3d`, fundo de cartão e o raio de 14px.
 * Sem respiro — cada bloco escolhe o seu, porque um gráfico e um cartão de
 * imóvel não respiram igual.
 */
export const PANEL_SHELL = "ds-3d relative overflow-hidden rounded-[14px] border-0 bg-card";

/**
 * CABEÇALHO DE BLOCO — ponto, rótulo em caixa alta, fio que vai sumindo e,
 * quando houver, uma informação à direita (contagem, aviso, "i").
 *
 * Nasceu no quadrante de engajamento da Operacional e é o desenho aprovado
 * pelo cliente; daqui vai para os gráficos da Limpeza e para os blocos dos
 * Registros sem nenhuma variação.
 *
 * `dot` aceita um nó próprio (o ponto degradê da marca, por exemplo) ou uma
 * cor sólida via `dotColor`; sem nenhum dos dois, o ponto some e o rótulo
 * começa a linha.
 */
export function PanelHeading({
  title,
  dot,
  dotColor,
  right,
  className,
}: {
  title: string;
  /** Marcador próprio (ícone, ponto degradê). Vence `dotColor`. */
  dot?: ReactNode;
  /** Cor sólida do ponto padrão (ex.: "#7fb79a"). */
  dotColor?: string;
  /** O que fecha a linha à direita — contagem, aviso, `InfoHint`. */
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? "mb-3"}`}>
      {dot ??
        (dotColor ? (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
        ) : null)}
      <span className="ds-eyebrow shrink-0 text-[10px] tracking-[0.2em] text-muted-foreground">
        {title}
      </span>
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_9%,transparent)] to-transparent"
      />
      {right ? <span className="shrink-0">{right}</span> : null}
    </div>
  );
}

/**
 * RÓTULO DE SEÇÃO — a palavra CENTRADA, com o fio dos dois lados (pedido
 * explícito, 18/09/2026: "a palavra deve ficar ao meio, e a linha deve
 * continuar visível ao lado direito e esquerdo da palavra").
 *
 * Divide a página em vez de começar um bloco: é o que separa os atrasados do
 * resto na Operacional e os imóveis em dia dos que precisam de atenção nos
 * Registros.
 */
export function SectionLabel({
  children,
  className,
  tone,
  count,
}: {
  children: string;
  className?: string;
  /** "late" pinta SÓ a palavra no rosa terroso — o fio continua neutro. */
  tone?: "late";
  /** Contagem opcional, colada na palavra ("Em dia · 12"). */
  count?: number;
}) {
  return (
    <div className={`flex items-center gap-3 pt-1.5 ${className ?? ""}`}>
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-l from-[color-mix(in_oklab,var(--foreground)_14%,transparent)] to-transparent"
      />
      <span
        className={`ds-eyebrow shrink-0 text-[10px] tracking-[0.18em] ${
          tone === "late" ? "ds-falta" : "ds-faint"
        }`}
      >
        {children}
        {count != null ? ` · ${count}` : ""}
      </span>
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_14%,transparent)] to-transparent"
      />
    </div>
  );
}

/**
 * PÍLULA DE CONTAGEM — o número neutro que fecha um cabeçalho de bloco.
 * Mesmo desenho da contagem da faixa de limpeza e do bloco "Precisam de
 * atenção", que antes eram dois códigos diferentes com o mesmo resultado.
 */
export function CountPill({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-5 shrink-0 items-center rounded-full bg-foreground/[0.06] px-2 text-[10px] font-extrabold tabular-nums text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
      {children}
    </span>
  );
}

/**
 * O BOTÃO DE AÇÃO DO CABEÇALHO — uma cadeia de classes só, para todos eles.
 *
 * REGRA (pedido explícito, 18/09/2026: "os botões de filtros precisam ficar
 * bem mais finos... temos que colocar como regra"). Usam isto: Filtros
 * (Kanban, Limpeza e Registros), Pendências, o interruptor das janelas da
 * Limpeza — e qualquer botão de ação que venha depois.
 *
 * Antes, cada um repetia à mão a mesma cadeia de doze classes. Eram quatro
 * cópias da mesma decisão: na primeira vez que o cliente pediu "mais baixo",
 * eu mexi em três e esqueci o quarto, e foi ele quem viu pelo print.
 *
 * As DUAS medidas vêm de `--ds-action-h` / `--ds-action-h-lg` em
 * `styles.css`; aqui fica a forma, lá fica o número.
 *
 * No celular o botão divide a largura com os irmãos e mostra o rótulo; no
 * computador vira um quadrado só de ícone, com a altura da barra de abas, que
 * é a regra que o cliente fixou em 18/09/2026 ("sendo o mesmo tamanho/altura
 * da barra de menu"). Quem usa põe o ícone e um `<span className="lg:hidden">`
 * com o rótulo.
 */
/**
 * OS BOTÕES DE AÇÃO SÃO UMA PEÇA SÓ, PARTIDA AO MEIO (pedido explícito,
 * 18/09/2026, mockup aprovado): "é possível juntarmos esses 2 botões como se
 * fosse um só, mas dividindo o clique deles ao meio? quando clicado à direita
 * abre Filtros, à esquerda abre Pendências — fazer isso nas outras subpáginas
 * também".
 *
 * `ACTION_BAR` é a casca (a única com luz, fundo e raio) e `ACTION_SEGMENT` é
 * cada metade, sem casca própria. O fio entre elas vem do `divide-x` da
 * barra, então dois, três ou um botão funcionam sem ninguém combinar nada: um
 * botão sozinho simplesmente ocupa a peça inteira, como no Kanban.
 *
 * A ALTURA continua vindo de `--ds-action-h` / `--ds-action-h-lg`
 * (`styles.css`) — 28px no celular, e no computador a altura da barra de abas,
 * porque ali a peça fica colada nela.
 */
export const ACTION_BAR =
  "ds-3d ds-3d-hover relative flex h-[var(--ds-action-h)] w-full overflow-hidden rounded-[9px] bg-card divide-x divide-[color-mix(in_oklab,var(--foreground)_11%,transparent)] lg:h-[var(--ds-action-h-lg)] lg:w-auto lg:rounded-[13px]";

/** Cada metade da peça. Sem fundo e sem borda: quem tem casca é a barra. */
export const ACTION_SEGMENT =
  "relative flex flex-1 items-center justify-center gap-2 px-3 text-[12px] font-bold transition-colors lg:w-[var(--ds-action-h-lg)] lg:flex-none lg:gap-0 lg:px-0";

/** O tom padrão (cinza que acende no hover). Um botão ligado troca por outro. */
export const ACTION_BUTTON_TONE = "text-muted-foreground hover:text-foreground";

/** Tamanho do ícone dentro de um botão de ação. */
export const ACTION_ICON = "size-[15px] shrink-0";

/* As peças dos quadrantes de Filtros moram em `filter-panel.tsx`. */
