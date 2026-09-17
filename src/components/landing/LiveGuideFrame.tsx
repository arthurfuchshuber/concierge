/**
 * Guia do hóspede REAL dentro da moldura de celular da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão, endereço e telefones.
 *
 * ALTURA FIXA DE CELULAR (17/09/2026, pedido do cliente): a moldura tem a
 * proporção de um celular de verdade (9 × 19,5, a de um iPhone atual) e NUNCA
 * muda de tamanho — nem ao carregar, nem ao rolar, nem se o conteúdo do guia
 * for mais curto que a tela. Antes a altura era medida pelo fim do cartão
 * "Chegada", o que fazia a moldura pular depois do carregamento. O conteúdo
 * que passa da altura rola dentro do próprio guia.
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";

export function LiveGuideFrame() {
  return (
    <div className="relative aspect-[9/19.5] w-full min-w-0 overflow-hidden bg-[#0a0a0f]">
      <iframe
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        // Fica no topo da landing: carregar já, sem esperar a rolagem.
        loading="eager"
        className="absolute inset-0 block size-full border-0"
      />
    </div>
  );
}
