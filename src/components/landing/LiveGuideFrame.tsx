import { useEffect, useRef, useState } from "react";

/**
 * Guia do hóspede REAL dentro da moldura de celular da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão, endereço e telefones.
 *
 * ALTURA TRAVADA (17/09/2026, pedido do cliente com print): a moldura mostra
 * o guia do topo até logo abaixo do cartão "Chegada", contando que a faixa
 * "check-in libera em" e o aviso "Importante · Check-in" estejam visíveis, e
 * a barra de navegação do guia embaixo. Essa altura é FIXA — não é medida
 * depois de carregar (antes era, e a moldura pulava).
 *
 * Como a mesma altura vale em qualquer tela: o guia é sempre desenhado com
 * 375 px de largura (um celular comum) e reduzido/ampliado para caber na
 * moldura. Assim a quebra de linha dos textos é a mesma em todo lugar e o
 * corte cai sempre no mesmo ponto. As medidas, na largura de 375 px:
 *   topo do guia → fim do cartão "Chegada" ........ 601 px
 *   respiro abaixo do cartão ...................... 12 px
 *   barra de navegação do modo vitrine ............ 59 px (46 + 12 + borda)
 * Se o topo do guia mudar de altura, ajuste GUIDE_HEIGHT.
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";
const GUIDE_WIDTH = 375;
const GUIDE_HEIGHT = 672;

export function LiveGuideFrame() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setScale(box.clientWidth / GUIDE_WIDTH);
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative w-full min-w-0 overflow-hidden bg-[#0a0a0f]"
      style={{ aspectRatio: `${GUIDE_WIDTH} / ${GUIDE_HEIGHT}` }}
    >
      <iframe
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        // Fica no topo da landing: carregar já, sem esperar a rolagem.
        loading="eager"
        className="absolute top-0 left-0 block border-0 transition-opacity duration-300"
        style={{
          width: GUIDE_WIDTH,
          height: GUIDE_HEIGHT,
          transform: `scale(${scale ?? 1})`,
          transformOrigin: "top left",
          // Só aparece depois de saber a escala, para não piscar no tamanho errado.
          opacity: scale === null ? 0 : 1,
        }}
      />
    </div>
  );
}
