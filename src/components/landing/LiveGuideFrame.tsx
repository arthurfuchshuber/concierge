/**
 * Guia do hóspede REAL dentro da moldura de celular da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão e telefones de contato.
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";

export function LiveGuideFrame({ height = 545 }: { height?: number }) {
  return (
    <div className="relative min-w-0 overflow-hidden bg-[#0a0a0f]" style={{ height }}>
      <iframe
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        loading="lazy"
        className="block size-full border-0"
      />
    </div>
  );
}
