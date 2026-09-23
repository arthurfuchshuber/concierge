import "./lib/error-capture";

import serverEntryModule from "@tanstack/react-start/server-entry";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { legacyHostRedirect } from "./lib/site-url";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const serverEntry = serverEntryModule as ServerEntry;

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * CABEÇALHOS DE SEGURANÇA BÁSICOS (16/09/2026).
 *
 * Nenhuma resposta do app trazia esses cabeçalhos. Ficaram de fora, de
 * propósito, os que podem quebrar algo sem teste no navegador real:
 * `Content-Security-Policy` (Meta Pixel, Google Fonts, mapas, Paddle) e
 * `X-Frame-Options`/`frame-ancestors` (a landing mostra o guia num iframe e o
 * editor do Lovable também enquadra o app) e `Permissions-Policy` (o checkout
 * do Paddle roda em iframe e pode usar a API de pagamento). Só entra aqui o que não muda
 * comportamento. Um cabeçalho que a rota já definiu nunca é sobrescrito.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  let out = response;
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!out.headers.has(k)) out.headers.set(k, v);
    }
  } catch {
    // Headers imutáveis (resposta repassada de um fetch): copia e aplica.
    out = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!out.headers.has(k)) out.headers.set(k, v);
    }
  }
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Endereço antigo → endereço novo, antes de qualquer outra coisa. Vale
    // para página, API e arquivo: um QR code impresso com o domínio anterior
    // continua abrindo o guia certo. Ver `lib/site-url.ts`.
    const mudanca = legacyHostRedirect(request);
    if (mudanca) return mudanca;

    try {
      const response = await serverEntry.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
