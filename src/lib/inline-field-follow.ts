import { useEffect } from "react";

/**
 * CAMPO DE UMA LINHA SEGUE A DIGITAÇÃO (pedido explícito, 08/10/2026):
 * "toda vez que tiver um campo digitável inline, ou seja, que continue em uma
 * linha única, o visor da tela deve acompanhar a digitação — se a escrita for
 * maior que a largura do campo, o usuário deve conseguir ver sempre a parte
 * final da escrita".
 *
 * É uma regra GLOBAL, num lugar só: vale para todo `<input>` de texto do
 * sistema, atual ou futuro, sem cada tela precisar lembrar dela. O navegador já
 * costuma rolar sozinho, mas falha justamente onde mais dói — celulares com o
 * teclado aberto, campos com `padding` reservado para botão (o "x" de limpar
 * da busca) e entrada por ditado/autocorreção. Aqui garantimos o resultado.
 *
 * SÓ SEGUE QUANDO O CURSOR ESTÁ NO FIM do texto. Se a pessoa tocou no meio da
 * palavra para corrigir uma letra, o campo NÃO pode pular para o final — isso
 * tiraria da tela justamente o trecho que ela está editando.
 *
 * Nada de regra de negócio: só a rolagem horizontal do próprio campo.
 */
const TIPOS_DE_TEXTO = new Set(["text", "search", "email", "tel", "url", "password"]);

function seguirFim(el: HTMLInputElement) {
  if (!TIPOS_DE_TEXTO.has(el.type)) return;
  if (el.scrollWidth <= el.clientWidth) return; // cabe inteiro: nada a seguir

  // `email` não expõe a posição do cursor (devolve null): ali vale o fim.
  let inicio: number | null = null;
  let fim: number | null = null;
  try {
    inicio = el.selectionStart;
    fim = el.selectionEnd;
  } catch {
    /* tipo sem seleção */
  }
  const tamanho = el.value.length;
  if (inicio !== null && fim !== null && (inicio !== tamanho || fim !== tamanho)) return;

  el.scrollLeft = el.scrollWidth;
}

export function useInlineFieldFollow() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const aoDigitar = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      // Depois que o navegador fez a rolagem dele: se já estava certa, é no-op.
      requestAnimationFrame(() => seguirFim(el));
    };

    document.addEventListener("input", aoDigitar, true);
    document.addEventListener("compositionend", aoDigitar, true);
    return () => {
      document.removeEventListener("input", aoDigitar, true);
      document.removeEventListener("compositionend", aoDigitar, true);
    };
  }, []);
}
