/**
 * O REGISTRO DO CACHE OFFLINE — e o cuidado que ele exige (11/09/2026).
 *
 * REGRA DE OURO: não roubar o escopo de quem já está lá. Se já existe um
 * service worker registrado em "/", ele é um dos de push — e ele já carrega
 * `sw-cache.js` por dentro (`importScripts`). Registrar outro arquivo no mesmo
 * escopo criaria um registro NOVO e descartaria o antigo, levando junto a
 * inscrição de push da pessoa. Ou seja: quem tem notificação perderia a
 * notificação para ganhar cache. Não.
 *
 * Então só registramos quando o escopo está livre — o caso de quem nunca
 * ativou notificação, que é a maioria.
 *
 * E O BOTÃO DE DESLIGAMENTO. Service worker é a peça mais perigosa de um app
 * na web: mal configurado, ele serve a versão velha para sempre e a correção
 * que você publicar não chega em ninguém. Por isso existe `desligarOffline()`,
 * exposto em `window.desligarOffline` — em qualquer aparelho, abrindo o
 * console, uma chamada apaga os caches e remove o registro. Espero nunca
 * precisar; é justamente por isso que tem que existir antes.
 */

const CAMINHO = "/sw-cache.js";
const ESCOPO = "/";

function suportado(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Manda o service worker que estiver no comando esvaziar os caches. */
export async function limparCachesDoNavegador(): Promise<void> {
  if (!suportado()) return;
  try {
    navigator.serviceWorker.controller?.postMessage({ tipo: "ci-limpar-cache" });
  } catch {
    /* segue para a limpeza direta */
  }
  // Direto também: se nenhum service worker estiver no comando, a mensagem
  // acima cai no vazio e os caches ficariam lá.
  try {
    if (typeof caches !== "undefined") {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n.startsWith("ci-")).map((n) => caches.delete(n)));
    }
  } catch {
    /* nada a fazer */
  }
}

/** Desliga tudo: caches fora, registro removido. Rede de segurança. */
export async function desligarOffline(): Promise<void> {
  await limparCachesDoNavegador();
  if (!suportado()) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* nada a fazer */
  }
}

/**
 * A CORRIDA QUE PRECISAVA SER ELIMINADA (11/09/2026).
 *
 * O registro do cache acontece no boot; o registro do push acontece quando a
 * pessoa toca em "Ativar". Normalmente há segundos entre um e outro — MENOS no
 * primeiro acesso do hóspede, onde a tela de notificações aparece logo na
 * abertura. Se as duas chamadas se cruzarem e a do cache resolver por último,
 * o script que fica valendo no escopo é o `sw-cache.js`, que não tem tratador
 * de `push`: a inscrição existiria e nenhuma notificação chegaria. Silencioso,
 * intermitente e quase impossível de reproduzir.
 *
 * Por isso quem vai registrar push ESPERA o registro do cache terminar. Os
 * dois fluxos de push chamam isto antes de `register()`.
 */
let registroEmAndamento: Promise<void> | null = null;

export function aguardarRegistroDeCache(): Promise<void> {
  // O `.catch` não é decoração: quem chama isto é o fluxo de ATIVAR
  // NOTIFICAÇÃO. Se esta promessa rejeitasse, o `await` lá estouraria e a
  // pessoa veria "Erro ao ativar notificações" por causa do cache — que não
  // tem nada a ver com push. O registro do cache nunca pode atrapalhar o
  // caminho feliz do botão Ativar.
  return (registroEmAndamento ?? Promise.resolve()).catch(() => {});
}

export async function registrarCacheOffline(): Promise<void> {
  if (registroEmAndamento) return registroEmAndamento;
  registroEmAndamento = registrarAgora();
  return registroEmAndamento;
}

async function registrarAgora(): Promise<void> {
  if (!suportado()) return;
  // Em desenvolvimento o service worker só atrapalha: ele guarda o bundle e
  // esconde a recarga a quente.
  if (import.meta.env.DEV) return;

  try {
    const existente = await navigator.serviceWorker.getRegistration(ESCOPO);
    if (existente) {
      // Já há alguém no escopo (um dos de push). Ele carrega o cache por
      // dentro; só pedimos que procure atualização do script.
      void existente.update().catch(() => {});
      return;
    }
    await navigator.serviceWorker.register(CAMINHO, { scope: ESCOPO });
  } catch {
    /* navegador sem suporte, modo anônimo, política do site: segue sem cache */
  }
}

/** Guarda a última rota aberta — a rede de segurança do "abriu em branco". */
const CHAVE_ROTA = "ci-ultima-rota";

export function lembrarRota(caminho: string): void {
  try {
    if (caminho && caminho !== "/auth") window.localStorage.setItem(CHAVE_ROTA, caminho);
  } catch {
    /* sem localStorage, sem memória de rota — e tudo bem */
  }
}

export function ultimaRota(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_ROTA);
  } catch {
    return null;
  }
}

export function esquecerRota(): void {
  try {
    window.localStorage.removeItem(CHAVE_ROTA);
  } catch {
    /* nada a fazer */
  }
}
