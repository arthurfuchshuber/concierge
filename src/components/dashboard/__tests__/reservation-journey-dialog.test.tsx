import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let journey: Record<string, unknown> = {};
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => journey, createServerFn: () => ({}) }));
vi.mock("@/lib/reservation-journey.functions", () => ({ getReservationJourney: () => journey }));

import { ReservationJourneyDialog } from "@/components/dashboard/ReservationJourneyDialog";

const base = {
  guestName: "Fernanda Clara Oliveira Da Silva",
  propertyName: "Casa Charmosa Próx. a Avenida das Cataratas",
  ownerName: "Arthur T. Fuchshuber",
  reservationCode: null,
  checkinDate: "2026-10-29",
  checkoutDate: "2026-11-04",
  tasks: [],
  activity: [],
  propertyCoverUrls: [],
  ownerPhone: null,
  ownerPhoneCountry: null,
  recordsCount: 0,
  payoutAmount: 2253.31,
  payoutCurrency: "BRL",
  payoutCommission: 501.79,
};
const step = (key: string, label: string, state: string, at: string | null = null, detail: string | null = null) => ({
  key,
  label,
  state,
  at,
  detail,
  actor: null,
});

function show(data: Record<string, unknown>) {
  journey = data;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReservationJourneyDialog open onOpenChange={() => {}} logId="l1" reservationId="r1" />
    </QueryClientProvider>,
  );
}

describe("Histórico da Reserva — opção C", () => {
  it("em estadia: etapas, cartão do momento (desde…), linhas e histórico", async () => {
    show({
      ...base,
      statusLabel: "Em estadia",
      steps: [
        step("reserva", "Reserva registrada", "done", "2026-10-07T06:07:00Z", "29/10/2026 → 04/11/2026"),
        step("checkin", "Check-in", "done", "2026-10-30T05:47:00Z", "Presença confirmada na entrada"),
        step("estadia", "Em estadia", "done", "2026-10-30T05:47:00Z", "Hóspede no imóvel"),
        step("checkout", "Checkout", "pending", null, "Aguardando confirmação"),
      ],
    });
    expect((await screen.findAllByText("Em estadia")).length).toBeGreaterThan(1);
    expect(screen.getByText(/^desde /)).toBeTruthy();
    expect(screen.getByText("Hóspede")).toBeTruthy();
    expect(screen.getByText("Comissão")).toBeTruthy();
    expect(screen.getByText("Histórico")).toBeTruthy();
    expect(screen.getByLabelText("Etapas da reserva")).toBeTruthy();
  });

  it("cancelada: etapa 'Cancelada' e valores riscados", async () => {
    show({
      ...base,
      statusLabel: "Cancelada",
      canceled: true,
      steps: [
        step("reserva", "Reserva registrada", "done", "2026-10-10T14:00:00Z"),
        step("cancelada", "Reserva cancelada", "done", "2026-10-21T17:20:00Z", "Cancelada na plataforma"),
      ],
    });
    expect((await screen.findAllByText("Cancelada")).length).toBeGreaterThan(0);
    const val = screen.getByText("R$ 2.253,31");
    expect(val.className).toContain("line-through");
  });
});
