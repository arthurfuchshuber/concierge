// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: null }) }));
vi.mock("@/lib/billing/billing.functions", () => ({
  getAccountBilling: vi.fn(async () => ({ hasAccess: true, subscription: { isManual: true }, features: {}, maxGuides: 1, billing: null })),
}));
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

import { useSubscription } from "../useSubscription";

function Probe() {
  const { isPending, info } = useSubscription();
  return <div>{isPending ? "carregando" : info.isManual ? "manual" : "sem"}</div>;
}

describe("useSubscription — reabrir a tela não pisca o carregando", () => {
  it("segunda montagem já nasce com a assinatura em cache", async () => {
    const qc = new QueryClient();
    const ui = () => (
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    );
    render(ui());
    expect(await screen.findByText("manual")).toBeTruthy();
    cleanup();
    // Remonta (como trocar de aba): o primeiro quadro já mostra o conteúdo, sem "carregando".
    render(ui());
    expect(screen.queryByText("carregando")).toBeNull();
    expect(screen.getByText("manual")).toBeTruthy();
  });
});
