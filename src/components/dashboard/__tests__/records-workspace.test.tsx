import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listMock = vi.fn();
const optionsMock = vi.fn();

vi.mock("@/lib/reservation-records.functions", () => ({
  RECORD_TITLE_MAX: 50,
  SITUATION_MEDIA_MAX: 10,
  listAccountRecords: "listAccountRecords",
  deleteReservationRecord: "del",
  updateRecordText: "update",
  createRecordSituation: "create",
  transcribeRecordAudio: "transcribe",
}));
vi.mock("@/lib/tasks.functions", () => ({
  listTaskLinkOptions: "options",
  setTaskStatus: "setTaskStatus",
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({ inputValidator: () => ({ handler: () => async () => ({}) }) }),
    inputValidator: () => ({ handler: () => async () => ({}) }),
    handler: () => async () => ({}),
  }),
  useServerFn: (fn: string) => {
    if (fn === "listAccountRecords") return (a?: unknown) => listMock(a);
    if (fn === "options") return (a?: unknown) => optionsMock(a);
    return async () => ({});
  },
}));
vi.mock("@/hooks/useImpersonation", () => ({ useImpersonation: () => ({ impersonation: null }) }));
vi.mock("@/components/dashboard/OperationWorkspace", () => ({
  OperationShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { RecordsWorkspace } from "@/components/dashboard/RecordsWorkspace";

function rec(over: Record<string, unknown> = {}) {
  const base = {
    id: "r1",
    groupId: "r1",
    kind: "photo",
    category: "damage",
    storagePath: "p/x.jpg",
    url: "https://x/x.jpg",
    mime: "image/jpeg",
    sizeBytes: 100,
    durationMs: null,
    fileName: "CASACHARM-01",
    body: "Cobre-leito manchado\nDescrição longa",
    cardMode: "cleaning",
    createdByName: "Esther",
    createdAt: new Date().toISOString(),
    taskId: "t1",
    taskStatus: "pending",
    propertyId: "prop1",
    propertyName: "Casa Charmosa",
    ownerName: "Arthur",
    isResolution: false,
    taskTitle: "Dano",
    reservationKey: "log1",
    guestName: "Marina",
    reservationCode: "4821",
    checkinDate: "2026-09-07",
    checkoutDate: "2026-09-10",
    media: [
      {
        id: "m1",
        kind: "photo",
        storagePath: "p/x.jpg",
        url: "u",
        mime: "image/jpeg",
        durationMs: null,
        sizeBytes: 1,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  return { ...base, ...over };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * A aba Registros caiu no "Algo deu errado" em produção (10/09/2026) porque o
 * servidor respondeu no formato ANTIGO (sem `media`) enquanto a tela já era a
 * nova das situações com várias mídias. O segundo caso deste arquivo é aquele
 * exato cenário: se alguém voltar a ler `record.media.length` direto, o teste
 * quebra antes de chegar no cliente.
 */
describe("Aba Registros", () => {
  it("renderiza a lista com o formato novo", async () => {
    listMock.mockResolvedValue({
      records: [
        rec(),
        rec({
          id: "r2",
          groupId: "r2",
          kind: "video",
          taskId: null,
          taskStatus: null,
          category: "cleaning_audit",
          body: "",
        }),
      ],
      counts: { forgotten: 0, damage: 1, cleaning_audit: 1, maintenance: 0, other: 0 },
      openCounts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      total: 2,
      totalOpen: 1,
      truncated: false,
    });
    optionsMock.mockResolvedValue({
      properties: [{ id: "prop1", name: "Casa Charmosa", ownerName: "Arthur" }],
      owners: [{ id: "o1", name: "Arthur" }],
      providers: [],
    });
    render(<RecordsWorkspace />, { wrapper });
    await waitFor(() => expect(screen.getAllByText(/Casa Charmosa/).length).toBeGreaterThan(0));
  });

  it("não quebra quando o registro vem SEM o campo media (resposta antiga do servidor)", async () => {
    const r = rec({ id: "r3", groupId: "r3" }) as Record<string, unknown>;
    delete r.media;
    listMock.mockResolvedValue({
      records: [r],
      counts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      openCounts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      total: 1,
      totalOpen: 1,
      truncated: false,
    });
    optionsMock.mockResolvedValue({ properties: [], owners: [], providers: [] });
    render(<RecordsWorkspace />, { wrapper });
    await waitFor(() => expect(screen.getAllByText(/Casa Charmosa/).length).toBeGreaterThan(0));
  });
});
