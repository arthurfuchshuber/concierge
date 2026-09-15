import { useEffect, useRef, useState } from "react";

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
  const timerRef = useRef<number | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  function measureArrivalCard() {
    const frame = iframeRef.current;
    if (!frame) return;

    // O recorte é o fim do cartão "Chegada" da tela inicial. Em outras abas
    // esse cartão não existe: nesse caso mantemos a última altura válida
    // (antes a moldura colapsava para a altura da barra inferior).
    const measure = () => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const arrival = doc.querySelector<HTMLElement>('[data-demo-card="checkin"]');
      const nav = doc.querySelector<HTMLElement>('nav[aria-label="Navegação do guia"]');
      if (!arrival || !arrival.isConnected) return;
      const bottom = arrival.getBoundingClientRect().bottom;
      if (bottom <= 0) return;
      const navHeight = nav?.getBoundingClientRect().height ?? 57;
      const next = Math.ceil(bottom + 12 + navHeight);
      setMeasuredHeight((prev) => (prev === next ? prev : next));
    };

    window.setTimeout(measure, 200);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(measure, 500);
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
        loading="lazy"
        onLoad={measureArrivalCard}
        className="block size-full border-0"
      />
    </div>
  );
}
