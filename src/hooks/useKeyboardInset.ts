import { useEffect, useState } from "react";

/**
 * Quanto o teclado do celular está cobrindo da tela, em pixels.
 *
 * Pedido explícito (08/09/2026): "ao abrir o teclado, ambos os chats precisam
 * fixar o cabeçalho na tela".
 *
 * POR QUE CSS SOZINHO NÃO RESOLVE
 *
 * Um painel `fixed` é posicionado contra a *layout viewport*, que no iOS não
 * encolhe quando o teclado sobe — ele apenas cobre a tela por cima. O resultado
 * é um painel mais alto que a área visível: a página inteira desliza para o
 * campo de digitação aparecer, e o cabeçalho sai por cima. `100dvh` ajuda em
 * parte dos navegadores e não em todos, e foi por isso que o cabeçalho do
 * atendimento continuou sumindo depois da primeira tentativa.
 *
 * A medida confiável é a *visual viewport*: `window.visualViewport.height` já
 * desconta o teclado. A diferença entre ela e a altura da janela é exatamente o
 * quanto está coberto — e é isso que este hook devolve, para o painel encurtar
 * em vez de escorregar.
 *
 * Devolve 0 quando não há teclado, no desktop, ou em navegador sem a API — nesses
 * casos o layout se comporta como antes.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;

    const update = () => {
      // `offsetTop` entra na conta porque, com a página rolada por causa do
      // teclado, parte da diferença já virou deslocamento e não área coberta.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Abaixo de ~80px é barra de endereço encolhendo, não teclado: reagir a
      // isso faria o painel pular durante a rolagem normal.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
