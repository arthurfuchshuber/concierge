import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tempo real do painel (auditoria de lentidão, 02/11/2026):
 *  - um evento das tabelas ao vivo NÃO recarrega as consultas de "casca"
 *    (admin, assinatura, perfil, lista de clientes), que não dependem delas;
 *    voltar para a aba recarrega tudo;
 *  - o SIGNED_IN repetido da mesma pessoa, com o canal no ar, não refaz a
 *    assinatura das 38 tabelas.
 */

const h = vi.hoisted(() => ({
  subscribes: 0,
  statusCb: null as null | ((s: string) => void),
  changeCb: null as null | (() => void),
  authCb: null as null | ((event: string, session: unknown) => void),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = () => {
    const ch: any = {
      on: (_t: string, _f: unknown, cb: () => void) => ((h.changeCb = cb), ch),
      subscribe: (cb: (s: string) => void) => {
        h.subscribes += 1;
        h.statusCb = cb;
        return ch;
      },
    };
    return ch;
  };
  return {
    supabase: {
      channel,
      removeChannel: () => {},
      realtime: { setAuth: () => {} },
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          h.authCb = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    },
  };
});
vi.mock("@/lib/realtime-auth", () => ({ ensureRealtimeAuth: async () => {} }));
vi.mock("@/lib/change-pulse.functions", () => ({ getChangePulse: () => ({ pulse: "p" }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

import { LiveSync } from "@/components/LiveSync";

function setup() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <LiveSync />
    </QueryClientProvider>,
  );
  return { spy };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function predicateOf(spy: ReturnType<typeof vi.spyOn>) {
  const arg = spy.mock.calls.at(-1)?.[0] as { predicate?: (q: { queryKey: unknown[] }) => boolean } | undefined;
  return (key: string) => (arg?.predicate ? arg.predicate({ queryKey: [key] }) : true);
}

describe("LiveSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.subscribes = 0;
    h.statusCb = null;
    h.changeCb = null;
    h.authCb = null;
  });

  it("evento ao vivo recarrega a operação, mas não a casca", async () => {
    const { spy } = setup();
    await flush();
    spy.mockClear();
    act(() => h.changeCb!());
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const live = predicateOf(spy);
    expect(live("dash-list")).toBe(true);
    expect(live("dash-occupancy")).toBe(true);
    expect(live("is-admin")).toBe(false);
    expect(live("my-subscription")).toBe(false);
    expect(live("admin-customers")).toBe(false);
  });

  it("voltar para a aba recarrega tudo, inclusive a casca", async () => {
    const { spy } = setup();
    await flush();
    spy.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(130);
    });
    const all = predicateOf(spy);
    expect(all("is-admin")).toBe(true);
    expect(all("dash-list")).toBe(true);
  });

  it("SIGNED_IN repetido da mesma pessoa com o canal no ar não re-assina", async () => {
    setup();
    await flush();
    act(() => h.statusCb!("SUBSCRIBED"));
    const session = { access_token: "t", user: { id: "u1" } };
    act(() => h.authCb!("SIGNED_IN", session)); // primeiro: registra a pessoa
    await flush();
    const before = h.subscribes;
    act(() => h.statusCb!("SUBSCRIBED"));
    act(() => h.authCb!("SIGNED_IN", session));
    act(() => h.authCb!("SIGNED_IN", session));
    await flush();
    expect(h.subscribes).toBe(before);
    // outra pessoa: refaz
    act(() => h.authCb!("SIGNED_IN", { access_token: "t2", user: { id: "u2" } }));
    await flush();
    expect(h.subscribes).toBe(before + 1);
  });
});
