import { useRef } from "react";

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

  function alignArrivalCard() {
    const frame = iframeRef.current;
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!frame || !win || !doc) return;

    let attempts = 0;
    const align = () => {
      const arrival = doc.querySelector<HTMLElement>('[data-demo-card="checkin"]');
      if (!arrival) {
        if (attempts++ < 20) window.setTimeout(align, 150);
        return;
      }
      const navHeight = 62;
      const gapAboveNav = 12;
      const arrivalBottom = arrival.getBoundingClientRect().bottom + win.scrollY;
      win.scrollTo({ top: Math.max(0, arrivalBottom - frame.clientHeight + navHeight + gapAboveNav) });
    };

    window.setTimeout(align, 200);
  }

  return (
    <div className="relative aspect-[10/14.15] min-w-0 overflow-hidden bg-[#0a0a0f]">
      <iframe
        ref={iframeRef}
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        loading="lazy"
        onLoad={alignArrivalCard}
        className="block size-full border-0"
      />
    </div>
  );
}
