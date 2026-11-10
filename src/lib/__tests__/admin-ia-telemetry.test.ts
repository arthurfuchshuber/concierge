import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRL_PER_USD,
  FEED_FILTERS,
  LIVE_INTERVALS,
  RESERVE_MODEL,
  TELEMETRY_WINDOW_DAYS,
  TITULAR_MODEL,
  cardSnapshotRows,
  classifyOutcome,
  filterFeedRows,
  computeKpis,
  computeLearningKpis,
  LEARNING_SOURCE_LABEL,
  LEARNING_STATUS_LABEL,
  TOOL_KPIS_UNAVAILABLE,
  formatBrl,
  formatRowCost,
  formatUsd,
  isOscillation,
  matchesFilter,
  modelLabel,
  utcDayStart,
  type OpsRow,
  type SuggestionRow,
} from "@/lib/admin-ia-telemetry";
import type { TelemetryFeedRow } from "@/lib/admin-ia-telemetry.functions";

const NOW = Date.parse("2026-11-07T18:00:00Z");

function sug(p: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: p.id ?? "s1",
    propertyId: "p1",
    conversationId: "c1",
    triggerMessageId: p.triggerMessageId ?? "m1",
    surface: "airbnb",
    state: "available",
    outcomeKind: "reply",
    outcomeCode: null,
    strategy: "answer",
    warnings: [],
    modelId: TITULAR_MODEL,
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 0.01,
    latencyMs: 3000,
    gatewayError: null,
    attempts: 1,
    startedAt: "2026-11-07T15:00:00Z",
    edited: false,
    hasSuggestion: true,
    stayPhase: "pre_stay",
    reservationLinked: true,
    historyMessages: 4,
    dossierEntries: 38,
    credentialPolicy: "deny",
    senderIdentity: "resolved",
    humanInCommand: false,
    ...p,
  };
}
function op(p: Partial<OpsRow> = {}): OpsRow {
  return {
    id: "o1",
    triggerMessageId: "m1",
    action: "checkin_done",
    mode: "live",
    outcome: "applied",
    code: null,
    createdAt: "2026-11-07T15:00:01Z",
    appliedAt: "2026-11-07T15:00:02Z",
    cardBefore: null,
    cardAfter: null,
    ...p,
  };
}

describe("desfecho de cada inferência", () => {
  it("erro vence tudo; depois card aplicado; depois D9; silêncio; estados", () => {
    expect(classifyOutcome(sug({ state: "generation_failed" }), [op()])).toBe("error");
    expect(classifyOutcome(sug({ outcomeKind: "technical_error" }), [])).toBe("error");
    expect(classifyOutcome(sug({ state: "send_failed" }), [])).toBe("error");
    expect(classifyOutcome(sug({ warnings: ["credential_request_denied"] }), [op()])).toBe("card");
    expect(classifyOutcome(sug({ warnings: ["credential_request_denied"] }), [])).toBe("d9");
    expect(classifyOutcome(sug({ state: "no_suggestion" }), [])).toBe("silence");
    expect(classifyOutcome(sug({ strategy: "silence" }), [])).toBe("silence");
    expect(classifyOutcome(sug({ state: "sent" }), [])).toBe("sent");
    expect(classifyOutcome(sug({ state: "edited" }), [])).toBe("available");
    expect(classifyOutcome(sug({ state: "discarded" }), [])).toBe("discarded");
    expect(classifyOutcome(sug({ state: "superseded" }), [])).toBe("superseded");
    expect(classifyOutcome(sug({ state: "generating" }), [])).toBe("generating");
  });

  it("ação recusada no card não conta como 'Aplicou card'", () => {
    expect(classifyOutcome(sug(), [op({ outcome: "refused", code: "x" })])).toBe("available");
  });

  it("oscilação = Reserva respondeu ou houve nova tentativa", () => {
    expect(isOscillation(sug())).toBe(false);
    expect(isOscillation(sug({ modelId: RESERVE_MODEL }))).toBe(true);
    expect(isOscillation(sug({ attempts: 2 }))).toBe(true);
  });
});

describe("filtros rápidos do feed", () => {
  it("são exatamente os 4 pedidos", () => {
    expect(FEED_FILTERS.map((f) => f.label)).toEqual([
      "Todos",
      "Ações de cartão",
      "Erros e oscilações",
      "Aprovados",
    ]);
  });

  it("regra pura e filtro das linhas do servidor concordam", () => {
    const cases: Array<[SuggestionRow, OpsRow[]]> = [
      [sug({ id: "a" }), []],
      [sug({ id: "b", state: "sent" }), []],
      [sug({ id: "c", state: "generation_failed" }), []],
      [sug({ id: "d", modelId: RESERVE_MODEL }), []],
      [sug({ id: "e" }), [op()]],
      [sug({ id: "f" }), [op({ outcome: "refused", code: "x" })]],
    ];
    const feed: TelemetryFeedRow[] = cases.map(([s, o]) => ({
      id: s.id,
      startedAt: s.startedAt,
      propertyName: "Studio 105",
      ownerName: "Carla",
      ownerPhone: null,
      ownerPhoneCountry: null,
      surface: s.surface,
      triggerPreview: "oi",
      outcome: classifyOutcome(s, o),
      outcomeCode: null,
      modelId: s.modelId,
      latencyMs: s.latencyMs,
      costUsd: s.costUsd,
      hasOps: o.length > 0,
      oscillation: isOscillation(s),
    }));
    for (const f of FEED_FILTERS) {
      const expected = cases.filter(([s, o]) => matchesFilter(f.key, s, o)).map(([s]) => s.id);
      expect(
        filterFeedRows(feed, f.key).map((r) => r.id),
        f.key,
      ).toEqual(expected);
    }
    expect(filterFeedRows(feed, "cards").map((r) => r.id)).toEqual(["e", "f"]);
    expect(filterFeedRows(feed, "errors").map((r) => r.id)).toEqual(["c", "d"]);
    expect(filterFeedRows(feed, "approved").map((r) => r.id)).toEqual(["b", "e"]);
  });
});

describe("indicadores", () => {
  const rows = [
    sug({ id: "1", state: "sent", costUsd: 0.02, latencyMs: 2000, surface: "airbnb" }),
    sug({
      id: "2",
      state: "sent",
      edited: true,
      costUsd: 0.03,
      latencyMs: 4000,
      surface: "whatsapp",
    }),
    sug({
      id: "3",
      state: "available",
      costUsd: 0.01,
      latencyMs: 9000,
      surface: "guide_chat",
      modelId: RESERVE_MODEL,
    }),
    sug({ id: "4", state: "no_suggestion", hasSuggestion: false, costUsd: 0.005, latencyMs: null }),
    sug({ id: "5", state: "sent", costUsd: 1, startedAt: "2026-11-01T10:00:00Z" }),
  ];
  const ops = [
    op(),
    op({ id: "o2", outcome: "refused", code: "x" }),
    op({ id: "o3", mode: "shadow", outcome: "would_apply" }),
  ];
  const k = computeKpis(rows, ops, { nowMs: NOW, dailyLimitUsd: 3 });

  it("custo de hoje (dia UTC, o mesmo do teto) × janela de 14 dias", () => {
    expect(k.costTodayUsd).toBeCloseTo(0.065, 8);
    expect(k.costWindowUsd).toBeCloseTo(1.065, 8);
    expect(k.dailyUsePct).toBe(2);
    expect(utcDayStart(NOW)).toBe(Date.parse("2026-11-07T00:00:00Z"));
  });

  it("assertividade = enviadas sem alteração ÷ enviadas; adoção = enviadas ÷ geradas", () => {
    expect(k.sentCount).toBe(3);
    expect(k.generatedCount).toBe(4);
    expect(k.assertivenessPct).toBe(66.7);
    expect(k.adoptionPct).toBe(75);
  });

  it("latência, modelo ativo, reserva e canais de hoje", () => {
    expect(k.avgLatencyMs).toBe(Math.round((2000 + 4000 + 9000 + 3000) / 4));
    expect(k.maxLatencyMs).toBe(9000);
    expect(k.activeModel).toBe(TITULAR_MODEL);
    expect(k.reserveUsesToday).toBe(1);
    expect(k.todayBySurface).toEqual({ airbnb: 2, whatsapp: 1, guide_chat: 1 });
    expect(k.todayTotal).toBe(4);
  });

  it("ações nos cards: só o modo real conta (sombra fica de fora)", () => {
    expect(k.cardsApplied).toBe(1);
    expect(k.cardsRefused).toBe(1);
  });

  it("sem envios ou sem geradas ⇒ taxa indefinida, nunca divisão por zero", () => {
    const e = computeKpis([], [], { nowMs: NOW, dailyLimitUsd: 3 });
    expect(e.assertivenessPct).toBeNull();
    expect(e.adoptionPct).toBeNull();
    expect(e.avgLatencyMs).toBeNull();
    expect(e.costTodayUsd).toBe(0);
  });
});

describe("formatação", () => {
  it("USD principal e BRL aproximado a R$ 5,80", () => {
    expect(BRL_PER_USD).toBe(5.8);
    expect(`${formatUsd(0.42)} (${formatBrl(0.42)})`).toBe("$ 0.42 (~ R$ 2,44)");
    expect(formatUsd(0.0123225, 8)).toBe("$ 0.01232250");
    expect(formatRowCost(0.0123)).toBe("$ 0.0123");
  });
  it("rótulos de modelo e intervalos do Ao vivo", () => {
    expect(modelLabel(TITULAR_MODEL)).toBe("Astra");
    expect(modelLabel(RESERVE_MODEL)).toBe("Flash (reserva)");
    expect(LIVE_INTERVALS.map((i) => [i.label, i.ms])).toEqual([
      ["Pausar", 0],
      ["5s", 5000],
      ["10s", 10000],
      ["30s", 30000],
    ]);
    expect(TELEMETRY_WINDOW_DAYS).toBe(14);
  });
  it("foto do card antes (camelCase) e depois (colunas do banco) em linhas legíveis", () => {
    expect(cardSnapshotRows({ exists: false })).toBeNull();
    expect(cardSnapshotRows(null)).toBeNull();
    expect(
      cardSnapshotRows({
        exists: true,
        status: "pending",
        arrivalTimeOverride: "15:00:00",
        arrivalTimeSource: "staff",
      }),
    ).toEqual([
      { label: "Etapa", value: "Pendente" },
      { label: "Previsão", value: "15:00 · staff" },
    ]);
    const after = cardSnapshotRows({
      exists: true,
      status: "done",
      arrival_time_override: "22:30",
      arrival_time_source: "guest_ai",
    });
    expect(after?.[0]).toEqual({ label: "Etapa", value: "Concluído" });
    expect(after).toContainEqual({ label: "Previsão", value: "22:30 · IA" });
  });
});

describe("guardas estáticas da tela e do servidor", () => {
  const fns = readFileSync("src/lib/admin-ia-telemetry.functions.ts", "utf8");
  const route = readFileSync("src/routes/_authenticated/admin.ia.tsx", "utf8");
  const feed = readFileSync("src/components/admin/ia/TelemetryFeed.tsx", "utf8");
  const insp = readFileSync("src/components/admin/ia/TelemetryInspector.tsx", "utf8");
  const menu = readFileSync("src/routes/_authenticated/admin.tsx", "utf8");

  it("servidor só lê: nenhuma escrita, nenhuma rpc além da checagem de admin", () => {
    expect(fns).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    const rpcs = [...fns.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["has_role"]);
    // a checagem de admin vem antes de qualquer leitura administrativa em cada função
    for (const name of ["getAiTelemetry", "getAiTelemetryDetail"]) {
      const start = fns.indexOf(`export const ${name}`);
      const body = fns.slice(
        start,
        fns.indexOf("export ", start + 10) > 0 ? fns.indexOf("export ", start + 10) : undefined,
      );
      expect(body.indexOf("assertSaasAdmin"), name).toBeGreaterThan(0);
      expect(body.indexOf("assertSaasAdmin"), name).toBeLessThan(body.indexOf("client.server"));
    }
  });

  it("lê só as tabelas existentes, sem colunas inventadas", () => {
    const tables = [...fns.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set([
        "guest_ai_copilot_suggestions",
        "guest_ai_ops_actions",
        "properties",
        "property_owners",
        "property_chat_messages",
        "property_chat_conversations",
        "guest_ai_learning_entries",
        "ai_system_events",
      ]),
    );
    expect(fns).toMatch(/context_dossier_entries/);
    expect(fns).toMatch(/context_credential_policy/);
  });

  it("rota só para admin do SaaS e no menu da seção Admin SaaS", () => {
    expect(route).toMatch(/checkIsAdmin\(\)/);
    expect(route).toMatch(/redirect\(\{ to: "\/admin" \}\)/);
    const adminOnly = menu.slice(
      menu.indexOf("const adminOnlyNav"),
      menu.indexOf("] as const;", menu.indexOf("const adminOnlyNav")),
    );
    expect(adminOnly).toMatch(/\{ to: "\/admin\/ia", label: "Telemetria IA", icon: Cpu/);
  });

  it("abas pelo TabsList (ds-segmented com anti-corte), sem quebra em duas linhas", () => {
    const tabs = readFileSync("src/components/ui/tabs.tsx", "utf8");
    expect(tabs).toMatch(/ds-segmented/);
    expect(tabs).toMatch(/useAntiClipBar/);
    expect(feed).toMatch(/<TabsList/);
    expect(route).toMatch(/<TabsList/);
    expect(feed).not.toMatch(/flex-wrap[^"]*"[^>]*TabsList/);
  });

  it("nada cortado na margem: tabela com rolagem contida e cartões no celular", () => {
    expect(feed).toMatch(/overflow-x-auto md:block/);
    expect(feed).toMatch(/md:hidden/);
    expect(route).toMatch(/ds-page/);
  });

  it("Raio-X com teto max-h-[90dvh] no celular e no desktop", () => {
    expect(insp.match(/max-h-\[90dvh\]/g)?.length).toBe(2);
    expect(insp).toMatch(/Fatos do Dossiê/);
    expect(insp).toMatch(/Minimizado por privacidade/);
  });

  it("proprietário pelo OwnerLine padrão (só o nome, sem rótulo)", () => {
    for (const src of [feed, insp]) {
      expect(src).toMatch(/<OwnerLine/);
      expect(src).not.toMatch(/Propriet[aá]rio\(a\)|Pr: /);
    }
  });
});

describe("Etapa 4 (10/11/2026) · aprendizado contínuo e ferramentas", () => {
  const NOW = Date.parse("2026-11-10T12:00:00Z");
  const row = (status: string, source: string, daysAgo: number) => ({
    status,
    source,
    createdAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  });

  it("conta por status e origem, janela de 14 dias e taxa de aprovação", () => {
    const k = computeLearningKpis(
      [
        row("pending", "checkout_done", 1),
        row("pending", "incident_resolved", 2),
        row("approved", "guest_confirmation", 3),
        row("approved", "checkout_done", 20),
        row("rejected", "checkout_done", 30),
        row("revoked", "incident_resolved", 40),
      ],
      { nowMs: NOW },
    );
    expect(k).toEqual({
      total: 6,
      pending: 2,
      approved: 2,
      rejected: 1,
      revoked: 1,
      proposedWindow: 3,
      approvalPct: 66.7,
      bySource: { checkout_done: 3, incident_resolved: 2, guest_confirmation: 1 },
    });
  });

  it("degradação segura: sem registros ⇒ zeros e taxa nula (nunca NaN)", () => {
    expect(computeLearningKpis([], { nowMs: NOW })).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      revoked: 0,
      proposedWindow: 0,
      approvalPct: null,
      bySource: { checkout_done: 0, incident_resolved: 0, guest_confirmation: 0 },
    });
  });

  it("status/origem desconhecidos e data inválida não quebram: entram só no total", () => {
    const k = computeLearningKpis([{ status: "x", source: "y", createdAt: "lixo" }], { nowMs: NOW });
    expect(k).toMatchObject({ total: 1, pending: 0, approved: 0, proposedWindow: 0, approvalPct: null });
  });

  it("ferramentas: sem registro persistido ⇒ indisponível (nenhum número inventado)", () => {
    expect(TOOL_KPIS_UNAVAILABLE).toEqual({ available: false, reason: "not_persisted" });
    expect(Object.isFrozen(TOOL_KPIS_UNAVAILABLE)).toBe(true);
  });

  it("rótulos em português para todos os status e origens", () => {
    expect(Object.keys(LEARNING_STATUS_LABEL).sort()).toEqual(["approved", "pending", "rejected", "revoked"]);
    expect(Object.keys(LEARNING_SOURCE_LABEL).sort()).toEqual(["checkout_done", "guest_confirmation", "incident_resolved"]);
  });

  it("a leitura do servidor só pede status, origem e data do aprendizado (nunca o texto do fato) e segue somente leitura", () => {
    const src = readFileSync(path.resolve(__dirname, "../admin-ia-telemetry.functions.ts"), "utf8");
    expect(src).toContain('.select("status, source, created_at")');
    expect(src).not.toMatch(/guest_ai_learning_entries[\s\S]{0,200}statement/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // único RPC permitido: a verificação de papel de administrador
    expect([...src.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1])).toEqual(["has_role"]);
    expect(src).toMatch(/assertSaasAdmin\(context\.supabase, context\.userId\)/);
  });
});

describe("auditoria de mensagens da IA apagadas (10/11/2026)", () => {
  it("evento sem o texto da mensagem, só identificadores e canal", async () => {
    const { aiMessageDeletedEvent, AI_MESSAGE_DELETED_EVENT } = await import("@/lib/handoff.functions");
    const e = aiMessageDeletedEvent({ userId: "u1", conversationId: "c1", propertyId: "p1", messageId: "m1", channel: "whatsapp" });
    expect(e).toMatchObject({ eventType: AI_MESSAGE_DELETED_EVENT, eventCategory: "AI_DECISION", entityId: "m1", conversationId: "c1", propertyId: "p1", channel: "whatsapp" });
    expect(JSON.stringify(e)).not.toMatch(/content|text|statement/);
  });
  it("só mensagens da IA geram o evento e nada disso alimenta o prompt nem o aprendizado", () => {
    const h = readFileSync(path.resolve(__dirname, "../handoff.functions.ts"), "utf8");
    expect(h).toMatch(/if \(msg\.sender_type === "ai"\) \{[\s\S]{0,400}logSystemEvent/);
    const learning = readFileSync(path.resolve(__dirname, "../guest-ai/learning/learning.ts"), "utf8");
    const extractor = readFileSync(path.resolve(__dirname, "../guest-ai-learning/extractor.server.ts"), "utf8");
    for (const src of [learning, extractor]) expect(src).not.toMatch(/ai_message_deleted|ai_system_events/);
  });
  it("o painel conta as exclusões pela tabela de eventos, só leitura", () => {
    const src = readFileSync(path.resolve(__dirname, "../admin-ia-telemetry.functions.ts"), "utf8");
    expect(src).toMatch(/\.from\("ai_system_events"\)[\s\S]{0,120}count: "exact", head: true/);
    expect(src).toMatch(/eq\("event_type", "ai_message_deleted_by_team"\)/);
  });
});
