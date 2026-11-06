import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// jsdom não tem ResizeObserver (a barra de filtros usa a regra anti-corte).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const listMock = vi.fn();
const optionsMock = vi.fn();

vi.mock("@/lib/reservation-records.functions", () => ({
  RECORD_TITLE_MAX: 50,
  SITUATION_MEDIA_MAX: 10,
  getNewRecordOptions: "newRecordOptions",
  listAccountRecords: "listAccountRecords",
  deleteReservationRecord: "del",
  restoreReservationRecord: "restore",
  undoRecordSituation: "undoSituation",
  updateRecordText: "update",
  createRecordSituation: "create",
  transcribeRecordAudio: "transcribe",
}));
vi.mock("@/lib/tasks.functions", () => ({
  listTaskLinkOptions: "options",
  setTaskStatus: "setTaskStatus",
  restoreTask: "restoreTask",
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
// O canal ao vivo (17/09/2026) não faz parte do que este teste verifica.
vi.mock("@/hooks/useRealtimeInvalidate", () => ({ useRealtimeInvalidate: () => {} }));

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

  /**
   * 03/10/2026: a faixa dizia "13 pendências" ao lado de cartões que somavam
   * 8 + 14 + 1. O número da faixa agora vem do servidor (a mesma leitura dos
   * cartões) e as etiquetas o decompõem.
   */
  it("a faixa de alerta usa o total do servidor", async () => {
    listMock.mockResolvedValue({
      records: [rec()],
      counts: { forgotten: 0, damage: 14, incident: 1, cleaning_audit: 73, maintenance: 8, other: 0 },
      openCounts: { forgotten: 0, damage: 7, incident: 1, cleaning_audit: 0, maintenance: 5, other: 0 },
      total: 96,
      totalOpen: 13,
      pendingOpen: 13,
      pendingProperties: 6,
      truncated: false,
    });
    optionsMock.mockResolvedValue({ properties: [], owners: [], providers: [] });
    render(<RecordsWorkspace />, { wrapper });
    await waitFor(() => expect(screen.getByText("13 pendências")).toBeTruthy());
    expect(screen.getByText("6 imóveis")).toBeTruthy();
  });

  /**
   * 01/11/2026 (mockup aprovado): "remova esses filtros" + "título ao centro, com o efeito do dashboard
   * operacional". O quadrante "Precisam de atenção" perdeu o botão de ordenar e ganhou o rótulo centralizado.
   */
  it("não há divisores 'Precisam de atenção' / 'Em dia' entre os cartões, nem botão de ordenar", async () => {
    listMock.mockResolvedValue({
      records: [rec()],
      counts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      openCounts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      total: 1,
      totalOpen: 1,
      truncated: false,
    });
    optionsMock.mockResolvedValue({ properties: [], owners: [], providers: [] });
    render(<RecordsWorkspace />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /pendência/i })).toBeTruthy());
    expect(screen.queryByText(/PRECISAM DE ATENÇÃO/i)).toBeNull();
    expect(screen.queryByText(/EM DIA/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /ordenar/i })).toBeNull();
  });

  /**
   * 01/11/2026 (mockup aprovado): o Detalhe do Registro mostra, ao lado do quadrado da mídia, o TÍTULO e a
   * DESCRIÇÃO que o usuário cadastrou; a fileira de ações segue o padrão dos cartões (25 px, cantos de 6 px).
   */
  it("o detalhe mostra título e descrição do registro, o quadrado da mídia e a fileira de ações padrão", async () => {
    listMock.mockResolvedValue({
      records: [rec()],
      counts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      openCounts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      total: 1,
      totalOpen: 1,
      truncated: false,
    });
    optionsMock.mockResolvedValue({ properties: [], owners: [], providers: [] });
    render(<RecordsWorkspace />, { wrapper });
    // O cartão do imóvel abre a lista de pendências; dela, o registro.
    fireEvent.click(await screen.findByRole("button", { name: /pendência/i }));
    fireEvent.click(await screen.findByText("Cobre-leito manchado"));
    expect(await screen.findByText("Descrição longa")).toBeTruthy();
    expect(screen.getAllByText("Registro").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Ampliar mídia" })).toBeTruthy();
    // Dados da reserva no mesmo cartão (sem blocos separados).
    expect(screen.getByText("Código da Reserva")).toBeTruthy();
    expect(screen.getByText("Registrado por")).toBeTruthy();
    expect(screen.queryByText("Prestador")).toBeNull();
    const resolvido = screen.getByRole("button", { name: /Resolvido/ });
    expect(resolvido.className).toContain("h-[25px]");
    expect(resolvido.className).toContain("bg-emerald-600");
    expect(screen.getByRole("button", { name: "Excluir" }).className).toContain("size-[25px]");
  });

  it("registro sem mídia não ganha o quadrado", async () => {
    listMock.mockResolvedValue({
      records: [
        rec({
          kind: "note",
          url: null,
          storagePath: null,
          body: "Travesseiro 2",
          media: [],
        }),
      ],
      counts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      openCounts: { forgotten: 0, damage: 1, cleaning_audit: 0, maintenance: 0, other: 0 },
      total: 1,
      totalOpen: 1,
      truncated: false,
    });
    optionsMock.mockResolvedValue({ properties: [], owners: [], providers: [] });
    render(<RecordsWorkspace />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /pendência/i }));
    fireEvent.click(await screen.findByText("Travesseiro 2"));
    await screen.findByText("Código da Reserva");
    expect(screen.queryByRole("button", { name: /Ampliar mídia|mídias/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Baixar todas as mídias" })).toBeNull();
  });
});
