import * as React from "react";

/**
 * ROLAGEM SÓ NO CONTEÚDO (pedido explícito, 08/11/2026, vale para TODO o SaaS): a barra de rolagem de
 * uma janela tem exatamente a altura da área que rola. O cabeçalho (título, subtítulo, linha de data) e o
 * X de canto ficam FORA dela — a casca da janela nunca rola nem reserva calha de barra (era essa calha que
 * afastava o X da borda).
 *
 * As bases (`DialogContent`, `AlertDialogContent`) chamam `splitWindowChildren`: os cabeçalhos que abrem
 * a janela ficam fixos e todo o resto entra no `WindowBody`, que é quem rola. Janelas que já montam a
 * própria área de rolagem (casca com `overflow-hidden`, como `WIDE_WINDOW_CLASS`) não são embrulhadas.
 */
const HEADER_NAMES = new Set([
  "DialogHeader",
  "DialogDateRow",
  "DialogTitle",
  "DialogDescription",
  "AlertDialogHeader",
  "AlertDialogTitle",
  "AlertDialogDescription",
  "ResponsiveDialogHeader",
  "DrawerHeader",
  "SheetHeader",
  "SheetTitle",
  "SheetDescription",
]);

const nameOf = (node: React.ReactElement): string => {
  const t = node.type as { displayName?: string; name?: string } | string;
  return typeof t === "string" ? "" : (t.displayName ?? t.name ?? "");
};

/** Algum filho (até 2 níveis) é o título da janela? (cabeçalho montado à mão: `<div><DialogTitle/>…</div>`) */
function holdsTitle(node: React.ReactNode, depth = 0): boolean {
  if (!React.isValidElement(node) || depth > 2) return false;
  if (/^(Alert)?DialogTitle$|^SheetTitle$/.test(nameOf(node))) return true;
  const kids = (node.props as { children?: React.ReactNode }).children;
  return React.Children.toArray(kids).some((k) => holdsTitle(k, depth + 1));
}

function isHeader(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false;
  if (HEADER_NAMES.has(nameOf(node))) return true;
  // marca explícita ou bloco que carrega o título (cabeçalho próprio da janela)
  const props = node.props as Record<string, unknown>;
  if (props["data-window-head"] !== undefined) return true;
  return typeof node.type === "string" && holdsTitle(node);
}

const FOOTER_NAMES = new Set(["DialogFooter", "AlertDialogFooter", "SheetFooter", "ResponsiveDialogFooter", "DrawerFooter"]);
const isFooter = (node: React.ReactNode) =>
  React.isValidElement(node) &&
  (FOOTER_NAMES.has(nameOf(node)) || (node.props as Record<string, unknown>)["data-window-foot"] !== undefined);

/** Abre fragmentos no nível de cima (`cond ? <>…</> : …`), para achar o cabeçalho de verdade. */
function flatten(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((c) =>
    React.isValidElement(c) && c.type === React.Fragment
      ? flatten((c.props as { children?: React.ReactNode }).children)
      : [c],
  );
}

/** A janela já cuida da própria rolagem (casca sem rolagem com área interna própria)? */
export function ownsScroll(className: string | undefined): boolean {
  return /(^|\s)overflow(-y)?-hidden(\s|$)/.test(className ?? "");
}

/**
 * Separa os cabeçalhos que ABREM a janela e os rodapés que a FECHAM (ficam fixos) do resto (vai para a
 * área que rola). Cabeçalho = `DialogHeader`/`DialogDateRow`/título solto, bloco com o título dentro, ou
 * `data-window-head`; rodapé = `DialogFooter`/`AlertDialogFooter` ou `data-window-foot`.
 */
export function splitWindowChildren(children: React.ReactNode): {
  head: React.ReactNode[];
  body: React.ReactNode[];
  foot: React.ReactNode[];
} {
  const all = flatten(children);
  let i = 0;
  while (i < all.length && isHeader(all[i])) i++;
  // Bloco único que embrulha a janela inteira (ex.: `<form>` com o título dentro) não é cabeçalho:
  // sem nada sobrando para rolar, só os cabeçalhos explícitos ficam fixos.
  if (i === all.length) {
    i = 0;
    while (
      i < all.length &&
      React.isValidElement(all[i]) &&
      (HEADER_NAMES.has(nameOf(all[i] as React.ReactElement)) ||
        ((all[i] as React.ReactElement).props as Record<string, unknown>)["data-window-head"] !== undefined)
    )
      i++;
  }
  let j = all.length;
  while (j > i && isFooter(all[j - 1])) j--;
  return { head: all.slice(0, i), body: all.slice(i, j), foot: all.slice(j) };
}

/**
 * Área que rola: mesma grade e mesmo espaçamento da janela (`gap: inherit`), encolhe quando a janela bate
 * no teto de altura e só então mostra a barra — que fica do tamanho desta área.
 */
export function WindowBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-window-body
      className="sg-elegant-scroll grid min-h-0 shrink grid-cols-[minmax(0,1fr)] content-start overflow-y-auto overscroll-contain touch-pan-y"
      style={{ gap: "inherit" }}
    >
      {children}
    </div>
  );
}
