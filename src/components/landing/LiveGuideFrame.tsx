import { useRef, useState } from "react";

/**
 * Guia do hóspede REAL dentro da moldura de celular da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão, endereço e telefones.
 *
 * A altura é proporcional à largura (proporção de celular) para que o recorte
 * mostrado seja o mesmo em qualquer tela: vai até o fim do cartão "Chegada".
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";

export function LiveGuideFrame() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  function measureArrivalCard() {
    const frame = iframeRef.current;
    if (!frame || measuredHeight !== null) return;

    // Mede uma única vez, na tela inicial, e fixa o recorte definitivamente.
    // Depois disso, rolagem, abas e qualquer outro clique não alteram a moldura.
    const measure = () => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const arrival = doc.querySelector<HTMLElement>('[data-demo-card="checkin"]');
      const nav = doc.querySelector<HTMLElement>('nav[aria-label="Navegação do guia"]');
      if (!arrival || !arrival.isConnected) return;
      const bottom = arrival.getBoundingClientRect().bottom + doc.documentElement.scrollTop;
      if (bottom <= 0) return;
      const navHeight = nav?.getBoundingClientRect().height ?? 57;
      setMeasuredHeight(Math.ceil(bottom + 12 + navHeight));
    };

    window.setTimeout(measure, 500);
  }

  return (
    <div
      className="relative aspect-[10/14.15] min-w-0 overflow-hidden bg-[#0a0a0f]"
      style={measuredHeight ? { height: measuredHeight, aspectRatio: "auto" } : undefined}
    >
      <iframe
        ref={iframeRef}
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        // Fica no topo da landing: carregar já, sem esperar a rolagem.
        loading="eager"
        onLoad={measureArrivalCard}
        className="block size-full border-0"
      />
    </div>
  );
}
