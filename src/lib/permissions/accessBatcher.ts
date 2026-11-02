/**
 * Junta todas as consultas de acesso feitas no mesmo instante (menu, cards,
 * botões, guardas de tela) numa ÚNICA chamada ao servidor por escopo.
 * Cada chamador recebe só as decisões que pediu. Falha sobe para todos
 * (falha NÃO é negação — os hooks tratam a nova tentativa).
 */
type Req = {
  permissions: string[];
  required: "NONE" | "READ" | "WRITE";
  accountOwnerId: string | null | undefined;
  propertyId: string | null;
  clientId: string | null;
  recordId: string | null;
};
type Res = { tenantId: string | null; decisions: Record<string, unknown> };
type Fetcher = (args: { data: Req }) => Promise<Res>;

type Pending = {
  perms: Set<string>;
  waiters: { perms: string[]; resolve: (r: Res) => void; reject: (e: unknown) => void }[];
  fetcher: Fetcher;
  base: Omit<Req, "permissions">;
};

const queue = new Map<string, Pending>();
let timer: ReturnType<typeof setTimeout> | null = null;
const MAX = 80;

function flush() {
  timer = null;
  const groups = [...queue.values()];
  queue.clear();
  for (const g of groups) {
    const all = [...g.perms];
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += MAX) chunks.push(all.slice(i, i + MAX));
    Promise.all(chunks.map((c) => g.fetcher({ data: { ...g.base, permissions: c } })))
      .then((results) => {
        const decisions = Object.assign({}, ...results.map((r) => r.decisions));
        const tenantId = results[0]?.tenantId ?? null;
        for (const w of g.waiters) {
          const mine: Record<string, unknown> = {};
          for (const p of w.perms) if (p in decisions) mine[p] = decisions[p];
          w.resolve({ tenantId, decisions: mine });
        }
      })
      .catch((e) => g.waiters.forEach((w) => w.reject(e)));
  }
}

export function batchedAccess<T extends Res>(fetcher: Fetcher, req: Req): Promise<T> {
  const base = {
    required: req.required,
    accountOwnerId: req.accountOwnerId ?? null,
    propertyId: req.propertyId ?? null,
    clientId: req.clientId ?? null,
    recordId: req.recordId ?? null,
  };
  const key = JSON.stringify(base);
  let g = queue.get(key);
  if (!g) {
    g = { perms: new Set(), waiters: [], fetcher, base };
    queue.set(key, g);
  }
  req.permissions.forEach((p) => g!.perms.add(p));
  const p = new Promise<Res>((resolve, reject) =>
    g!.waiters.push({ perms: req.permissions, resolve, reject }),
  );
  if (!timer) timer = setTimeout(flush, 10);
  return p as Promise<T>;
}
