// CACHE OFFLINE — "a tela nunca fica em branco" (pedido explícito, 11/09/2026).
//
//   "quero que GUARDE TUDO localmente, inclusive a última página carregada,
//    para prevenir que o usuário ou o hóspede perca a conexão e fique sem
//    acesso às informações"
//
// POR QUE ESTE ARQUIVO É CARREGADO PELOS OUTROS, e não registrado sozinho:
// só existe UM service worker por escopo. O site já tinha dois disputando o
// escopo "/" — `sw-push.js` (equipe) e `sw-guest-push.js` (hóspede) —, e quem
// registrasse por último apagava o registro do outro, levando junto a
// inscrição de push. Em vez de fundir os dois (e arriscar as notificações que
// acabaram de entrar no ar), a lógica de cache mora aqui e os dois a carregam
// com `importScripts`. Quem vencer o escopo, cacheia. E para quem nunca ativou
// notificação, o app registra ESTE arquivo sozinho no boot.
//
// O QUE ELE NÃO FAZ, de propósito: não toca em nada que não seja GET de
// navegação, arquivo do build ou imagem. Chamadas de dados (server functions,
// /api) passam direto, intocadas — quem guarda dado é o cache de consultas em
// IndexedDB, que sabe a hora e a validade do que guardou. Service worker
// devolvendo JSON velho de reserva seria a pior coisa que a gente poderia
// fazer com uma operação de limpeza.
//
// REDE SEMPRE PRIMEIRO. O cache só entra quando a rede falha ou demora demais.
// Online, o comportamento é idêntico ao de antes.

const PREFIXO = "ci-";
const VERSAO = "1";
const C_HTML = PREFIXO + "html-" + VERSAO;
const C_ASSET = PREFIXO + "asset-" + VERSAO;
const C_IMG = PREFIXO + "img-" + VERSAO;
const ATUAIS = [C_HTML, C_ASSET, C_IMG];

/** Quantas imagens guardar. Foto de dano tem 2-3 MB; 150 é ~300 MB no pior
 *  caso, e o navegador desaloja sozinho antes disso. */
const TETO_IMG = 150;

/** Quanto esperar a rede antes de servir o que está guardado.
 *  Generoso de propósito: servir versão velha para quem TEM internet é pior
 *  do que esperar mais um pouco. */
const PRAZO_NAVEGACAO_MS = 6000;

/** Chave do HTML: só o caminho. Query string não muda a página no nosso app,
 *  e usá-la na chave faria `?utm=...` virar um registro novo em branco. */
function chaveHtml(req) {
  const u = new URL(req.url);
  return u.origin + u.pathname;
}

function comPrazo(promessa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("prazo")), ms);
    promessa.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const HTML_SEM_REDE =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Sem conexão</title>" +
  "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;" +
  "background:#0a0a0c;color:#f4f4f5;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
  "padding:24px;text-align:center}p{color:#8b8b96;font-size:13px;max-width:34ch;margin:8px auto 0}</style>" +
  "<div><strong>Sem conexão</strong>" +
  "<p>Esta página ainda não tinha sido aberta neste aparelho. Assim que a internet voltar, ela carrega sozinha.</p></div>";

async function navegar(req) {
  const cache = await caches.open(C_HTML);
  try {
    const rede = await comPrazo(fetch(req), PRAZO_NAVEGACAO_MS);
    if (rede && rede.ok) {
      // Guarda uma cópia desta página para a próxima vez que faltar rede.
      try {
        await cache.put(chaveHtml(req), rede.clone());
      } catch {
        /* cota cheia: seguir servindo a resposta real é o que importa */
      }
      return rede;
    }
    // 404 e 500 de verdade passam: esconder um erro real atrás de uma cópia
    // velha faria a pessoa agir sobre uma tela que não existe mais.
    if (rede) return rede;
  } catch {
    /* sem rede, ou lenta demais: cai para o que está guardado */
  }

  const salvo = await cache.match(chaveHtml(req));
  if (salvo) return salvo;

  // Nunca vimos esta página. Tenta a casca do app — no painel as telas são
  // montadas no navegador, então a casca já resolve a rota certa.
  const casca = await cache.match(self.location.origin + "/");
  if (casca) return casca;

  return new Response(HTML_SEM_REDE, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Arquivos do build têm hash no nome: são imutáveis, cache primeiro sempre. */
async function arquivoDoBuild(req) {
  const cache = await caches.open(C_ASSET);
  const salvo = await cache.match(req);
  if (salvo) return salvo;
  const rede = await fetch(req);
  if (rede && rede.ok) {
    try {
      await cache.put(req, rede.clone());
    } catch {
      /* cota */
    }
  }
  return rede;
}

async function podar(cache, teto) {
  try {
    const chaves = await cache.keys();
    if (chaves.length <= teto) return;
    // As mais antigas saem primeiro (a ordem de `keys()` é de inserção).
    for (let i = 0; i < chaves.length - teto; i += 1) await cache.delete(chaves[i]);
  } catch {
    /* poda é higiene, nunca pode derrubar uma resposta */
  }
}

/**
 * Imagem: entrega o que está guardado na hora e revalida por trás.
 *
 * As fotos dos registros vêm por URL assinada, que expira em uma hora. Servir
 * do cache é justamente o que faz a foto do dano continuar aparecendo depois
 * que a assinatura venceu — e sem rede ela é a única cópia que existe.
 */
async function imagem(req) {
  const cache = await caches.open(C_IMG);
  const salvo = await cache.match(req);
  const rede = fetch(req)
    .then((r) => {
      if (r && (r.ok || r.type === "opaque")) {
        cache
          .put(req, r.clone())
          .then(() => podar(cache, TETO_IMG))
          .catch(() => {});
      }
      return r;
    })
    .catch(() => null);
  if (salvo) return salvo;
  const r = await rede;
  if (r) return r;
  return new Response("", { status: 504 });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(C_HTML);
        await cache.add(new Request("/", { cache: "reload" }));
      } catch {
        /* sem rede na instalação: o cache se enche navegando */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const nomes = await caches.keys();
        await Promise.all(
          nomes
            .filter((n) => n.indexOf(PREFIXO) === 0 && ATUAIS.indexOf(n) === -1)
            .map((n) => caches.delete(n)),
        );
      } catch {
        /* limpeza é higiene */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(navegar(req));
    return;
  }

  const mesmaOrigem = url.origin === self.location.origin;

  if (mesmaOrigem && (url.pathname.indexOf("/assets/") === 0 || url.pathname.indexOf("/_build/") === 0)) {
    event.respondWith(arquivoDoBuild(req));
    return;
  }

  if (req.destination === "image" || req.destination === "font") {
    event.respondWith(imagem(req));
    return;
  }

  // Todo o resto — dados, server functions, /api — passa sem ser tocado.
});

/** Botão de desligamento: o app manda isto ao sair da conta e quando o
 *  cliente pedir para zerar. Ver `src/lib/offline/sw-register.ts`. */
self.addEventListener("message", (event) => {
  if (!event.data || event.data.tipo !== "ci-limpar-cache") return;
  event.waitUntil(
    (async () => {
      try {
        const nomes = await caches.keys();
        await Promise.all(
          nomes.filter((n) => n.indexOf(PREFIXO) === 0).map((n) => caches.delete(n)),
        );
      } catch {
        /* nada a fazer */
      }
    })(),
  );
});
