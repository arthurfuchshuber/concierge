import { useEffect, useState } from "react";

/**
 * Geometria da área REALMENTE visível da tela.
 *
 * Pedido explícito (08/09/2026, terceira vez): "ao abrir o teclado, ambos os
 * chats precisam fixar o cabeçalho na tela".
 *
 * POR QUE A PRIMEIRA E A SEGUNDA TENTATIVA FALHARAM
 *
 * A primeira usou `100dvh`, que não é respeitado por todos os navegadores. A
 * segunda calculava "quanto o teclado cobre" como
 * `window.innerHeight - visualViewport.height` e encolhia o painel por esse
 * tanto. Isso funciona no iOS, onde o teclado se sobrepõe à página sem mudar
 * `innerHeight` — e **não funciona no Android**, onde a janela encolhe sozinha
 * quando o teclado abre. Lá a conta dá zero, o hook devolvia zero e nada
 * acontecia. Os dois chats seguiram perdendo o cabeçalho no Android, que é
 * justamente o aparelho testado.
 *
 * O QUE ESTA VERSÃO FAZ
 *
 * Para de tentar adivinhar o teclado e passa a devolver a geometria da visual
 * viewport: onde ela começa (`top`) e qual a altura dela (`height`). Um painel
 * ancorado nesses dois números ocupa exatamente a área visível nos dois
 * sistemas — sem depender de qual estratégia o navegador escolheu. É a mesma
 * medida que o navegador usa para decidir o que mostrar.
 *
 * Fora do navegador, ou sem a API, devolve a janela inteira: o layout se
 * comporta como antes.
 */
export type ViewportBox = {
  /** Distância do topo da janela até o começo da área visível. */
  top: number;
  /** Altura da área visível, já sem o teclado. */
  height: number;
  /** Há teclado (ou algo grande) cobrindo a tela. */
  keyboardOpen: boolean;
  /** Pixels cobertos na parte de baixo — usado só onde o painel é ancorado
   * pelo rodapé (a janela do desktop). Lido aqui para nenhum componente
   * precisar tocar em `window` durante o render, o que quebraria no SSR. */
  covered: number;
};

function read(): ViewportBox {
  if (typeof window === "undefined") return { top: 0, height: 0, keyboardOpen: false, covered: 0 };
  const vv = window.visualViewport;
  if (!vv) return { top: 0, height: window.innerHeight, keyboardOpen: false, covered: 0 };
  return {
    top: Math.round(vv.offsetTop),
    height: Math.round(vv.height),
    covered: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
    // Serve só para decisões cosméticas (área segura do aparelho, por exemplo).
    // O posicionamento NÃO depende deste sinal.
    keyboardOpen: window.innerHeight - vv.height - vv.offsetTop > 80 || vv.offsetTop > 8,
  };
}

export function useVisualViewport(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>(() => read());

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const update = () => setBox(read());
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return box;
}

/**
 * Estilo pronto para um overlay de tela cheia que precisa respeitar o teclado.
 * Substitui `fixed inset-0`: mesma ideia, mas colado na área visível de
 * verdade — é isso que mantém o cabeçalho do chat na tela.
 */
export function viewportOverlayStyle(box: ViewportBox): {
  position: "fixed";
  left: 0;
  right: 0;
  top: number;
  height: number;
} {
  return { position: "fixed", left: 0, right: 0, top: box.top, height: box.height };
}
