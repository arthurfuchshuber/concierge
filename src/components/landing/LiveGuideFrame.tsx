import { useEffect, useRef, useState } from "react";

/**
 * Guia do hóspede REAL dentro da moldura da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão, endereço e telefones.
 *
 * ALTURA TRAVADA (17/09/2026, pedido do cliente com print): a moldura mostra
 * o guia do topo até logo abaixo do cartão "Chegada" — contando que a faixa
 * "check-in libera em" e o aviso "Importante · Check-in" estejam visíveis —
 * e, embaixo, a barra de navegação do guia. A altura é FIXA: não é medida
 * depois de carregar e não muda com a tela.
 *
 * Como a mesma altura vale em qualquer tela: o guia é sempre desenhado com
 * 375 px de largura e reduzido/ampliado para caber na moldura, então a quebra
 * de linha dos textos e o ponto de corte são os mesmos em todo lugar.
 *
 * De onde vem o número (medido em dois prints do site publicado, que deram o
 * mesmo resultado): topo do guia → fim do cartão "Chegada" = 545 px; a linha
 * marcada pelo cliente fica 6 px abaixo (551 px); a barra de navegação do modo
 * vitrine ocupa 59 px (46 + 12 de respiro + 1 de borda). 551 + 59 = 610.
 * Se o topo do guia mudar de altura, ajuste GUIDE_HEIGHT.
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";
const GUIDE_WIDTH = 375;
const GUIDE_HEIGHT = 610;

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
      className="relative w-full min-w-0 overflow-hidden bg-[#07070d]"
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
