/**
 * ESCALA PROPORCIONAL DA INTERFACE (pedido explícito, 09/11/2026).
 *
 * Converte TODO valor em px do CSS gerado (classes arbitrárias do Tailwind
 * como `text-[13px]`, `w-[240px]`, e o styles.css) para rem. Assim, quando a
 * fonte-base do <html> muda (ver `src/lib/ui-scale.ts`), a tela inteira cresce
 * ou encolhe junto, sem depender do zoom do navegador.
 *
 * - Valores de até 1px (bordas finas) ficam em px.
 * - Media queries não são tocadas (elas já usam rem do tamanho padrão do
 *   navegador, então os breakpoints seguem olhando a janela real).
 */
const PX = /(-?\d*\.?\d+)px\b/g;
const BASE = 16;
const plugin = () => ({
  postcssPlugin: "px-to-rem",
  Declaration(decl) {
    if (!decl.value || !decl.value.includes("px")) return;
    // não mexe em url(...) nem em strings
    if (/url\(|["']/.test(decl.value)) return;
    const next = decl.value.replace(PX, (m, n) => {
      const v = parseFloat(n);
      if (!Number.isFinite(v) || Math.abs(v) <= 1) return m;
      return `${+(v / BASE).toFixed(5)}rem`;
    });
    if (next !== decl.value) decl.value = next;
  },
});
plugin.postcss = true;
export default plugin;
