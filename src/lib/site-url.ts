/**
 * O ENDEREÇO DO SISTEMA — um lugar só (11/09/2026).
 *
 * Pedido: "comprei conciergeia.app e quero alterar no sistema inteiro (...) é
 * possível corrigirmos em massa sem precisar alterar um a um?".
 *
 * Era possível porque o link do guia nunca foi gravado em lugar nenhum: ele é
 * montado na hora, a partir do slug do imóvel. O problema é que o PEDAÇO DA
 * FRENTE — o domínio — estava escrito à mão em 36 pontos do código, em quatro
 * variações diferentes que já tinham se desencontrado entre si:
 *
 *   · guia.anfitriaosigma.com.br      (o endereço real, na maioria dos lugares)
 *   · sigmaconcierge.lovable.app      (WhatsApp e iCal)
 *   · sigmaguide.lovable.app          (prévia de e-mail)
 *   · project--c6a0…lovable.app       (envio proativo)
 *
 * Quatro respostas para uma pergunta só é como um sistema passa a mandar links
 * diferentes para o mesmo hóspede. Agora existe UMA resposta, aqui, e trocar
 * de domínio de novo é editar uma linha — ou nem isso, bastando definir
 * `SITE_URL` nas variáveis de ambiente do projeto.
 *
 * Nada de `VITE_*` para isto: o valor é o mesmo para todo mundo e não é
 * segredo, mas a regra da casa vale — o que o navegador precisa saber, ele
 * descobre por `window.location`.
 */

/** O endereço oficial. Trocar aqui troca o sistema inteiro. */
const PADRAO = "https://conciergeia.app";

function doAmbiente(nome: string): string | null {
  if (typeof process === "undefined" || !process.env) return null;
  const v = process.env[nome];
  return v && v.trim() ? v.trim() : null;
}

function normalizar(url: string): string {
  const limpo = url.trim().replace(/\/+$/, "");
  return limpo.startsWith("http") ? limpo : `https://${limpo}`;
}

/** Origem do sistema — "https://conciergeia.app", sem barra no fim. */
export const SITE_ORIGIN = normalizar(
  doAmbiente("SITE_URL") ?? doAmbiente("PUBLIC_SITE_URL") ?? doAmbiente("VITE_APP_URL") ?? PADRAO,
);

/** Só o host, para textos e assinaturas de e-mail: "conciergeia.app". */
export const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

/** URL absoluta de um caminho interno. `siteUrl("/precos")`. */
export function siteUrl(path = "/"): string {
  if (!path || path === "/") return SITE_ORIGIN;
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * O link do guia de um imóvel. É a função que responde à pergunta "e os links
 * de cada imóvel?": todos saem daqui, então todos mudam juntos.
 */
export function guideUrl(slug: string, path = ""): string {
  const base = `${SITE_ORIGIN}/g/${encodeURIComponent(slug)}`;
  if (!path) return base;
  return `${base}${path.startsWith("/") || path.startsWith("#") || path.startsWith("?") ? path : `/${path}`}`;
}

/* ------------------------------------------------------------------ *
 * REDIRECIONAMENTO DO ENDEREÇO ANTIGO
 * ------------------------------------------------------------------ */

/**
 * Domínios que já foram o endereço do sistema e agora só existem para levar
 * ao novo. Ficam listados explicitamente — e não por regra genérica — porque
 * um redirecionamento amplo demais derrubaria a prévia do Lovable e o
 * ambiente local.
 *
 * Pode ser ampliado sem tocar no código pela variável `LEGACY_HOSTS`
 * (separada por vírgula).
 */
export const LEGACY_HOSTS: string[] = [
  "guia.anfitriaosigma.com.br",
  "www.guia.anfitriaosigma.com.br",
  // www → raiz, para o caso de o DNS do domínio novo também publicar o www.
  "www.conciergeia.app",
  ...(doAmbiente("LEGACY_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
];

/**
 * Se a requisição chegou por um endereço antigo, devolve a resposta de
 * redirecionamento para o MESMO caminho no endereço novo. Senão, devolve null.
 *
 * Detalhes que fazem isto funcionar "perfeitamente", que foi o pedido:
 *  · preserva caminho, query e âncora — um QR code que aponta para
 *    /g/studio105#senhas-acesso chega exatamente ali;
 *  · 301 para GET/HEAD (permanente: o Google transfere o histórico da página
 *    para o endereço novo) e 308 para os demais métodos, que é o único que
 *    obriga o cliente a repetir POST/PUT com o corpo intacto;
 *  · roda ANTES de qualquer rota, no ponto de entrada do servidor — vale para
 *    página, API e arquivo estático, sem depender de nada do roteador.
 *
 * ATENÇÃO — o que isto exige do DNS: redirecionar só é possível enquanto o
 * endereço antigo ainda CHEGAR aqui. "Desligar" o domínio antigo no registrador
 * mata o link na origem, e nenhum código no mundo redireciona o que não chega.
 * O caminho certo é o contrário: manter o domínio antigo apontado para o
 * projeto e deixar que ele responda só isto — um empurrão para o novo.
 */
export function legacyHostRedirect(request: Request): Response | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  const host = (request.headers.get("x-forwarded-host") ?? url.host).toLowerCase();
  const semPorta = host.split(":")[0];
  if (!LEGACY_HOSTS.includes(host) && !LEGACY_HOSTS.includes(semPorta)) return null;

  const destino = `${SITE_ORIGIN}${url.pathname}${url.search}`;
  const permanente = request.method === "GET" || request.method === "HEAD";

  return new Response(null, {
    status: permanente ? 301 : 308,
    headers: {
      location: destino,
      // Um ano de cache no redirecionamento de páginas; nada de cache nos
      // outros métodos, que não são idempotentes.
      ...(permanente ? { "cache-control": "public, max-age=31536000" } : {}),
    },
  });
}
