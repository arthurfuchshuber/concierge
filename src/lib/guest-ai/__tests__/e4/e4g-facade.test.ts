/**
 * ENTREGA 4 · revisão GLOBAL — FACHADA SOMENTE LEITURA de `getGuestAiDb` (decisão D9: obrigatória antes do
 * primeiro tick real). Três provas, todas locais, sem rede real e sem credencial real:
 *  1. unidade: só `select` existe; escrita, tabela fora da lista e propriedades do cliente são recusadas;
 *  2. cliente supabase-js REAL (2.x) com `fetch` interceptado: uma leitura vira GET; insert/update/upsert/
 *     delete lançam ANTES de qualquer requisição (o `fetch` não é chamado);
 *  3. varredura estática: toda tabela lida pelo módulo está na lista; nenhum arquivo de produção do módulo
 *     usa o cliente administrativo fora de `client.server.ts`; a fachada está ligada em `getGuestAiDb`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortableDb,
  GUEST_AI_READ_TABLES,
  GuestAiReadOnlyError,
  getGuestAiDb,
  readOnlyGuestAiDb,
} from "@/lib/guest-ai/data/client.server";

const ROOT = path.resolve(__dirname, "..", "..");
function sources(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    if (n === "__tests__") return [];
    return statSync(f).isDirectory() ? sources(f) : f.endsWith(".ts") ? [f] : [];
  });
}
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Cliente falso que registra tudo o que chega a ele (nada deve chegar nas escritas). */
function spyClient() {
  const reached: string[] = [];
  const builder = new Proxy(
    {},
    {
      get(_t, prop) {
        return (...args: unknown[]) => {
          reached.push(`${String(prop)}(${JSON.stringify(args)})`);
          return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
        };
      },
    },
  );
  return {
    reached,
    client: {
      from: (t: string) => (reached.push(`from(${t})`), builder),
      rpc: () => reached.push("rpc"),
      auth: {},
      storage: {},
    },
  };
}

afterEach(() => {
  vi.doUnmock("@/integrations/supabase/client.server");
});

describe("E4 global · fachada somente leitura (unidade)", () => {
  it("só `select` passa; insert/update/upsert/delete e qualquer outro método lançam write_not_allowed SEM chegar ao cliente", () => {
    const s = spyClient();
    const db = readOnlyGuestAiDb(s.client);
    db.from("properties").select("id").eq("id", "x");
    expect(s.reached).toEqual(["from(properties)", 'select(["id"])']);
    for (const m of [
      "insert",
      "update",
      "upsert",
      "delete",
      "rpc",
      "csv",
      "abortSignal",
      "anything",
    ]) {
      const before = s.reached.length;
      expect(() => (db.from("properties") as Record<string, () => unknown>)[m]!(), m).toThrowError(
        GuestAiReadOnlyError,
      );
      try {
        (db.from("properties") as Record<string, () => unknown>)[m]!();
      } catch (e) {
        expect((e as GuestAiReadOnlyError).code).toBe("write_not_allowed");
      }
      // só o `from` (permitido) foi registrado; o método recusado nunca chegou ao cliente
      expect(
        s.reached.slice(before).every((x) => x === "from(properties)"),
        m,
      ).toBe(true);
    }
  });
  it("tabela fora da lista (inclusive as do Shadow e de credenciais) ⇒ table_not_allowed, nada chega ao cliente", () => {
    const s = spyClient();
    const db = readOnlyGuestAiDb(s.client);
    for (const t of [
      "guest_ai_shadow_control",
      "guest_ai_shadow_executions",
      "host_integration_credentials",
      "profiles",
      "auth.users",
      "subscriptions",
      "PROPERTIES",
      "",
    ]) {
      try {
        db.from(t);
        throw new Error(`aceitou ${t}`);
      } catch (e) {
        expect((e as GuestAiReadOnlyError).code, t).toBe("table_not_allowed");
      }
    }
    expect(s.reached).toEqual([]);
  });
  it("a fachada expõe SÓ `from` (sem rpc, auth, storage, schema, channel) e não pode ser alterada", () => {
    const db = readOnlyGuestAiDb(spyClient().client) as unknown as Record<string, unknown>;
    expect(Object.keys(db)).toEqual(["from"]);
    for (const k of ["rpc", "auth", "storage", "schema", "channel", "functions"])
      expect(db[k], k).toBeUndefined();
    expect(Object.isFrozen(db)).toBe(true);
    const b = (db.from as (t: string) => Record<string, unknown>)("properties");
    expect(() => {
      (b as Record<string, unknown>).insert = () => 1;
    }).toThrow();
  });
  it('o construtor não é "thenable" nem expõe símbolos (await não executa nada; nada além de `select` sai)', async () => {
    const s = spyClient();
    const b = readOnlyGuestAiDb(s.client).from("properties") as unknown as Record<
      string | symbol,
      unknown
    >;
    expect(b.then).toBeUndefined();
    expect(b[Symbol.iterator]).toBeUndefined();
    expect(b[Symbol.toPrimitive]).toBeUndefined();
    expect(await (b as unknown as Promise<unknown>)).toBe(b);
    expect(s.reached).toEqual(["from(properties)"]);
  });
  it("compatível com o cancelamento (`abortableDb`): select segue com o sinal; escrita continua recusada", () => {
    const s = spyClient();
    const ac = new AbortController();
    const db = abortableDb(readOnlyGuestAiDb(s.client), ac.signal);
    expect(() => db.from("property_chat_messages").insert({})).toThrowError(GuestAiReadOnlyError);
    expect(() => db.from("guest_ai_shadow_control")).toThrowError(GuestAiReadOnlyError);
    // propriedade não funcional atravessa as duas camadas sem virar chamada (o construtor segue sem `then`)
    expect((db.from("properties") as unknown as Record<string, unknown>).then).toBeUndefined();
  });
  it("`getGuestAiDb()` devolve a fachada sobre o cliente administrativo (nunca o cliente cru)", async () => {
    const s = spyClient();
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: s.client }));
    const db = await getGuestAiDb();
    expect(db).not.toBe(s.client);
    expect(() => db.from("properties").delete()).toThrowError(GuestAiReadOnlyError);
    expect(s.reached).toEqual(["from(properties)"]);
  });
});

describe("E4 global · fachada sobre o supabase-js REAL (fetch interceptado; nenhuma rede)", () => {
  const real = () => {
    const requests: Array<{ method: string; url: string }> = [];
    const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input) });
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-0/0" },
      });
    }) as typeof fetch;
    const client = createClient(
      "https://exemplo-sintetico.supabase.co",
      "chave-sintetica-de-teste",
      { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchFake } },
    );
    return { requests, db: readOnlyGuestAiDb(client as never) };
  };
  it("leitura vira GET no PostgREST; escrita lança antes de qualquer requisição", async () => {
    const r = real();
    const res = await r.db
      .from("properties")
      .select("id,owner_id")
      .eq("id", "7b000000-0000-4000-8000-000000000002");
    expect(res.error).toBeNull();
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]!.method).toBe("GET");
    expect(r.requests[0]!.url).toContain("/rest/v1/properties?select=id%2Cowner_id");
    for (const m of ["insert", "update", "upsert", "delete"] as const) {
      expect(
        () =>
          (r.db.from("properties") as unknown as Record<string, (x?: unknown) => unknown>)[m]!({
            id: "x",
          }),
        m,
      ).toThrowError(GuestAiReadOnlyError);
    }
    expect(r.requests).toHaveLength(1);
    expect(r.requests.every((q) => q.method === "GET")).toBe(true);
  });
});

describe("E4 global · varredura estática da fachada", () => {
  it("toda tabela lida pelo módulo (literal) está na lista; nenhuma tabela da lista é do Shadow nem de credenciais", () => {
    const used = new Set<string>();
    for (const f of sources())
      for (const m of code(f).matchAll(/\.from\("([a-z_]+)"\)/g)) used.add(m[1]!);
    // tabelas passadas por variável (escopo e lease)
    for (const t of [
      "property_chat_conversations",
      "property_chat_messages",
      "properties",
      "guest_ai_conversation_leases",
    ])
      used.add(t);
    expect(
      [...used].filter((t) => !(GUEST_AI_READ_TABLES as readonly string[]).includes(t)),
    ).toEqual([]);
    expect(
      GUEST_AI_READ_TABLES.filter((t) =>
        /^guest_ai_shadow_|credential|secret|token|profiles|subscription/.test(t),
      ),
    ).toEqual([]);
  });
  it("só client.server.ts toca o cliente administrativo, e `getGuestAiDb` sempre embrulha com a fachada", () => {
    const users = sources()
      .filter((f) => /supabaseAdmin/.test(code(f)))
      .map((f) => path.relative(ROOT, f));
    expect(users).toEqual(["data/client.server.ts"]);
    const c = code(path.join(ROOT, "data/client.server.ts"));
    expect(c).toMatch(/return readOnlyGuestAiDb\(supabaseAdmin as unknown as GuestAiDb\);/);
    expect(c).not.toMatch(/return supabaseAdmin as unknown as GuestAiDb/);
  });
});
