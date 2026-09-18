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
