/**
 * MEMÓRIA DO HÓSPEDE · processo pós-checkout: validação da saída (evidência, isolamento hospitalidade ×
 * avaliação interna, guard de segredos), fatos objetivos de horário, montagem com teto de custo e o ciclo
 * completo (idempotência, sem conversa, falhas isoladas, desligamento). Sem rede: transporte falso.
 */
import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_DIMENSIONS,
  StayMemoryOutputError,
  hospitalityRisk,
  sanitizeHospitalityNotes,
  validateStayMemoryOutput,
  type StayMemoryResult,
} from "@/lib/guest-memory/contracts";
import {
  GUEST_MEMORY_SYSTEM_PROMPT,
  buildStayMemoryPrompt,
  deriveStayFacts,
  type StayMessage,
} from "@/lib/guest-memory/prompt";
import {
  guestMemoryConfig,
  isCompanionSession,
  runGuestMemoryCycle,
  type GuestMemoryStore,
  type PendingStay,
  type ProfileMemory,
  type StayMaterial,
} from "@/lib/guest-memory/worker.server";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import type {
  LlmProvider,
  ProviderOutcome,
  ProviderRequest,
} from "@/lib/guest-ai/llm/providers/types";
import { llmMessageText } from "@/lib/guest-ai/llm/contracts";
import { GUEST_PROFILE_COLUMNS } from "@/lib/guest-ai/data/projections";

const REFS = new Set(["msg:1", "msg:2", "msg:3", "fato:checkin_confirmado_antes_do_horario"]);
const dim = (nivel: string, resumo: string, evidencias: string[] = []) => ({
  nivel,
  resumo,
  evidencias,
});
const output = (over: Record<string, unknown> = {}) => ({
  estadia: {
    hospitalidade: [
      { categoria: "preferencia", texto: "Pediu travesseiros extras", evidencias: ["msg:1"] },
      { categoria: "rotina", texto: "Sem evidência", evidencias: [] },
      { categoria: "preferencia", texto: "Evidência inventada", evidencias: ["msg:99"] },
    ],
    avaliacao: {
      comunicacao: dim("positivo", "Respondeu rápido e com cordialidade", ["msg:2"]),
      regras_e_horarios: dim("atencao", "Check-in confirmado 2h antes do horário oficial", [
        "fato:checkin_confirmado_antes_do_horario",
      ]),
      cuidado_com_o_imovel: dim("atencao", "Sem registro da equipe", []),
      incidentes: dim("sem_dados", ""),
    },
  },
  consolidado: {
    notas_de_hospitalidade: [
      { categoria: "preferencia", texto: "Gosta de travesseiros extras" },
      {
        categoria: "orientacao_operacional",
        texto: "Costuma pedir saída tardia; reforçar gentilmente o horário oficial de saída",
      },
      { categoria: "outro", texto: "Causou dano na toalha" },
      { categoria: "outro", texto: "Chegou sem avisar antes do horário" },
    ],
    avaliacao_interna: {
      comunicacao: { nivel: "positivo", resumo: "Comunicação boa nas estadias" },
      regras_e_horarios: { nivel: "atencao", resumo: "Tende a chegar antes do horário" },
      cuidado_com_o_imovel: { nivel: "inventado", resumo: "x" },
      incidentes: { nivel: "neutro", resumo: "" },
    },
  },
  ...over,
});

describe("Memória pós-checkout · validação da saída do modelo", () => {
  it("estadia: hospitalidade só com evidência real; dimensão sem evidência vira sem_dados", () => {
    const r = validateStayMemoryOutput(output(), REFS);
    expect(r.summary.hospitalidade).toEqual([
      { categoria: "preferencia", texto: "Pediu travesseiros extras", evidencias: ["msg:1"] },
    ]);
    expect(r.summary.avaliacao.comunicacao).toEqual(
      dim("positivo", "Respondeu rápido e com cordialidade", ["msg:2"]),
    );
    expect(r.summary.avaliacao.regras_e_horarios.nivel).toBe("atencao");
    expect(r.summary.avaliacao.cuidado_com_o_imovel).toEqual(dim("sem_dados", "", []));
    expect(r.summary.fonte).toBe("modelo");
  });

  it("ISOLAMENTO: julgamento, dano ou incidente nunca entra na hospitalidade; fica só na avaliação interna", () => {
    const r = validateStayMemoryOutput(output(), REFS);
    expect(r.behavioralNotes.map((n) => n.texto)).toEqual([
      "Gosta de travesseiros extras",
      "Costuma pedir saída tardia; reforçar gentilmente o horário oficial de saída",
    ]);
    expect(r.internalAssessment.regras_e_horarios).toEqual({
      nivel: "atencao",
      resumo: "Tende a chegar antes do horário",
    });
    expect(r.internalAssessment.cuidado_com_o_imovel).toEqual({ nivel: "sem_dados", resumo: "" });
    expect(r.internalAssessment.incidentes).toEqual({ nivel: "sem_dados", resumo: "" });
    expect(JSON.stringify(r.behavioralNotes)).not.toMatch(/dano|antes do horário|Tende/);
  });

  it("guard de segredos na saída: código de acesso é saneado ou o item sai", () => {
    const notes = sanitizeHospitalityNotes([
      { categoria: "cuidado", texto: "A senha da porta é 7319-4471, usar sempre" },
    ]);
    expect(JSON.stringify(notes)).not.toContain("7319-4471");
  });

  it("estrutura inválida ⇒ erro fechado (nunca grava)", () => {
    expect(() => validateStayMemoryOutput(null, REFS)).toThrow(StayMemoryOutputError);
    expect(() => validateStayMemoryOutput({ estadia: {} }, REFS)).toThrow(StayMemoryOutputError);
    expect(() => validateStayMemoryOutput([1], REFS)).toThrow(StayMemoryOutputError);
  });

  it("o prompt do processo separa as duas partes e exige evidência", () => {
    expect(GUEST_MEMORY_SYSTEM_PROMPT).toMatch(/duas partes que nunca se misturam/);
    expect(GUEST_MEMORY_SYSTEM_PROMPT).toMatch(/só para a equipe humana/);
    expect(GUEST_MEMORY_SYSTEM_PROMPT).toMatch(/evidencias/);
  });
});

describe("Memória pós-checkout · fatos objetivos (sistema, não modelo)", () => {
  const base = {
    timeZone: "America/Sao_Paulo",
    checkinDate: "2026-02-01",
    checkoutDate: "2026-02-04",
    checkinTime: "15:00",
    checkoutTime: "11:00",
    checkinCard: { status: "done", done_at: "2026-02-01T16:00:00Z", concluded_at: null },
    checkoutCard: { status: "done", done_at: "2026-02-04T14:00:00Z", concluded_at: null },
  };
  const val = (facts: ReturnType<typeof deriveStayFacts>, id: string) =>
    facts.find((f) => f.id === id)!.valor;

  it("check-in confirmado antes do horário oficial, no fuso do imóvel (13:00 local × 15:00 oficial)", () => {
    const f = deriveStayFacts(base);
    expect(val(f, "fato:checkin_oficial")).toBe("2026-02-01 15:00 (America/Sao_Paulo)");
    expect(val(f, "fato:checkin_confirmado")).toBe("2026-02-01 13:00");
    expect(val(f, "fato:checkin_confirmado_antes_do_horario")).toBe(
      "sim, 120 min antes do horário oficial",
    );
    expect(val(f, "fato:checkout_confirmado")).toBe("2026-02-04 11:00");
  });

  it("sem fuso ou sem confirmação ⇒ desconhecido; saída tardia só com autorização formal completa", () => {
    expect(
      val(deriveStayFacts({ ...base, timeZone: null }), "fato:checkin_confirmado_antes_do_horario"),
    ).toBe("desconhecido");
    expect(val(deriveStayFacts({ ...base, checkinCard: null }), "fato:checkin_confirmado")).toBe(
      "nao_registrado",
    );
    expect(val(deriveStayFacts(base), "fato:late_checkout_autorizado")).toBe("nao");
    const late = {
      ...base.checkoutCard,
      late_checkout_time: "14:00:00",
      late_checkout_approved_at: "2026-02-03T10:00:00Z",
      late_checkout_by: "u1",
    };
    expect(
      val(deriveStayFacts({ ...base, checkoutCard: late }), "fato:late_checkout_autorizado"),
    ).toBe("sim, até 14:00");
    expect(
      val(
        deriveStayFacts({ ...base, checkoutCard: { ...late, late_checkout_by: null } }),
        "fato:late_checkout_autorizado",
      ),
    ).toBe("nao");
  });
});

const msg = (i: number, speaker: StayMessage["speaker"], text: string): StayMessage => ({
  id: `msg:${i}`,
  speaker,
  channel: "airbnb",
  at: `2026-02-0${(i % 3) + 1}T10:00:00Z`,
  text,
});

describe("Memória pós-checkout · montagem com teto de custo", () => {
  const input = (messages: StayMessage[]) => ({
    previousNotes: [{ categoria: "preferencia" as const, texto: "Gosta de café" }],
    previousAssessment: {},
    previousStays: [],
    stay: { checkinDate: "2026-02-01", checkoutDate: "2026-02-04" },
    facts: deriveStayFacts({
      timeZone: null,
      checkinDate: null,
      checkoutDate: null,
      checkinTime: null,
      checkoutTime: null,
      checkinCard: null,
      checkoutCard: null,
    }),
    messages,
  });
  const opts = { modelId: "google/gemini-3.8-flash", maxOutputTokens: 2048, maxCallCostUsd: 0.02 };

  it("cabe ⇒ todas as mensagens; segredos saneados; notas internas rotuladas; refs = fatos + mensagens enviadas", () => {
    const b = buildStayMemoryPrompt(
      input([
        msg(1, "hospede_titular", "Oi! A senha da porta é 7319-4471?"),
        msg(2, "nota_interna_equipe", "Toalha manchada na vistoria"),
      ]),
      opts,
    )!;
    const user = llmMessageText(b.messages[1]!.content);
    expect(user).not.toContain("7319-4471");
    expect(user).toContain('"falante":"nota_interna_equipe"');
    expect(b.refs.has("msg:1") && b.refs.has("msg:2") && b.refs.has("fato:checkin_oficial")).toBe(
      true,
    );
    expect(b.droppedMessages).toBe(0);
  });

  it("acima do teto ⇒ saem as mensagens MAIS ANTIGAS (refs só das que ficaram); nem o mínimo cabe ⇒ null", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      msg(i + 1, "hospede_titular", "x".repeat(1_100)),
    );
    const b = buildStayMemoryPrompt(input(many), { ...opts, maxCallCostUsd: 0.01 })!;
    expect(b.droppedMessages).toBeGreaterThan(0);
    expect(b.refs.has("msg:1")).toBe(false);
    expect(b.refs.has("msg:300")).toBe(true);
    expect(buildStayMemoryPrompt(input([]), { ...opts, maxCallCostUsd: 0.000001 })).toBeNull();
  });
});

// ───────────────────────── ciclo completo ─────────────────────────

/**
 * Store em memória que reproduz a semântica do banco: aquisição exclusiva com posse (lease) e prazo,
 * até 3 tentativas, reserva de custo no teto diário, gravação só com a posse vigente e idempotente por reserva.
 */
class MemoryStore implements GuestMemoryStore {
  pendingList: PendingStay[] = [];
  materials = new Map<string, StayMaterial | null>();
  titular: { canonicalId: string } | { skipped: string } = { canonicalId: "g1" };
  profiles = new Map<string, ProfileMemory>([
    ["g1", { reservationIds: new Set(), notes: [], assessment: {}, stays: [] }],
  ]);
  records: Array<{ reservationId: string; result: StayMemoryResult }> = [];
  finishes: Array<[string, string, string]> = [];
  runs = new Map<
    string,
    { status: string; attempts: number; token: string | null; expires: number }
  >();
  attempts: Array<{
    reservationId: string;
    reserved: number;
    spent: number | null;
    outcome: string | null;
    token: string;
  }> = [];
  now = 1_000_000;
  seq = 0;
  materialDelay = 0;
  async pending(limit: number) {
    return this.pendingList
      .filter((p) => {
        const r = this.runs.get(p.reservationId);
        return (
          !r ||
          (r.status !== "done" &&
            r.status !== "skipped" &&
            r.attempts < 3 &&
            !(r.status === "processing" && r.expires > this.now))
        );
      })
      .slice(0, limit);
  }
  async claim(
    s: PendingStay,
    o: { leaseSeconds: number; reserveUsd: number; dailyCapUsd: number },
  ) {
    const r = this.runs.get(s.reservationId);
    if (r && (r.status === "done" || r.status === "skipped")) return { kind: "completed" as const };
    if (r && r.status === "processing" && r.expires > this.now) return { kind: "busy" as const };
    if (r && r.status === "processing") {
      const a = this.attempts.find((x) => x.token === r.token && x.outcome === null)!;
      a.outcome = "abandoned";
      a.spent = a.reserved;
      r.status = "failed";
    }
    if (r && r.attempts >= 3) return { kind: "exhausted" as const };
    const day = this.attempts.reduce((n, a) => n + (a.spent ?? a.reserved), 0);
    if (day + o.reserveUsd > o.dailyCapUsd + 1e-9)
      return { kind: "budget_daily_exceeded" as const };
    const token = `tok-${++this.seq}`;
    const attempts = (r?.attempts ?? 0) + 1;
    this.runs.set(s.reservationId, {
      status: "processing",
      attempts,
      token,
      expires: this.now + o.leaseSeconds * 1000,
    });
    this.attempts.push({
      reservationId: s.reservationId,
      reserved: o.reserveUsd,
      spent: null,
      outcome: null,
      token,
    });
    return { kind: "claimed" as const, token, attempt: attempts };
  }
  async material(s: PendingStay) {
    if (this.materialDelay) await new Promise((r) => setTimeout(r, this.materialDelay));
    return this.materials.has(s.reservationId) ? this.materials.get(s.reservationId)! : null;
  }
  async upsertTitular() {
    return this.titular;
  }
  async profile(_t: string, id: string) {
    return this.profiles.get(id) ?? null;
  }
  async record(i: { reservationId: string; token: string; result: StayMemoryResult }) {
    const r = this.runs.get(i.reservationId);
    if (!r || r.status !== "processing" || r.token !== i.token || r.expires <= this.now)
      return "lease_lost" as const;
    const p = this.profiles.get("g1")!;
    if (p.reservationIds.has(i.reservationId)) return "exists" as const;
    p.reservationIds.add(i.reservationId);
    this.records.push({ reservationId: i.reservationId, result: i.result });
    return "recorded" as const;
  }
  async finish(
    reservationId: string,
    token: string,
    status: string,
    reason: string,
    spent: number,
  ) {
    const r = this.runs.get(reservationId);
    if (!r || r.status !== "processing" || r.token !== token) return "lease_lost" as const;
    r.status = status;
    r.token = null;
    const a = this.attempts.find((x) => x.token === token)!;
    a.outcome = status;
    a.spent = spent;
    this.finishes.push([reservationId, status, reason]);
    return "finished" as const;
  }
}
const ON = { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "1" };
const stay = (id: string): PendingStay => ({
  reservationId: id,
  propertyId: "p1",
  tenantId: "t1",
  checkoutDate: "2026-02-04",
});
const material = (messages: StayMessage[]): StayMaterial => ({
  otaGuestId: "airbnb:1",
  phones: ["5547999990001"],
  guestName: "Paula Nogueira",
  checkinDate: "2026-02-01",
  checkoutDate: "2026-02-04",
  checkinTime: "15:00",
  checkoutTime: "11:00",
  timeZone: "America/Sao_Paulo",
  checkinCard: { status: "done", done_at: "2026-02-01T16:00:00Z", concluded_at: null },
  checkoutCard: { status: "done", done_at: "2026-02-04T14:00:00Z", concluded_at: null },
  messages,
});
const okJson = (body: unknown): ProviderOutcome => ({
  kind: "ok",
  text: JSON.stringify(body),
  finishReason: "stop",
  usage: { inputTokens: 3000, outputTokens: 600, totalTokens: 3600 },
  requestId: "r",
});
function provider(
  outcomes: Array<ProviderOutcome>,
  delayMs = 0,
): LlmProvider & { calls: ProviderRequest[] } {
  const p = {
    id: "fake",
    calls: [] as ProviderRequest[],
    async complete(req: ProviderRequest) {
      p.calls.push(req);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return outcomes[Math.min(p.calls.length - 1, outcomes.length - 1)]!;
    },
  };
  return p;
}
const CONV = [
  msg(1, "hospede_titular", "Pode deixar travesseiros extras?"),
  msg(2, "equipe", "Claro!"),
  msg(3, "hospede_titular", "Obrigada"),
];
const run = (s: MemoryStore, p: LlmProvider, env: Record<string, string> = ON, limit?: number) =>
  runGuestMemoryCycle({ store: s, provider: p, env, limit, log: () => {} });

describe("Memória pós-checkout · FAIL-CLOSED (configuração validada antes de tudo)", () => {
  it.each<[string, Record<string, string>]>([
    ["variável ausente", {}],
    ["valor off", { GUEST_MEMORY_WORKER: "off", GUEST_MEMORY_DAILY_COST_USD: "1" }],
    ["valor vazio", { GUEST_MEMORY_WORKER: "", GUEST_MEMORY_DAILY_COST_USD: "1" }],
    ["maiúsculas (ON)", { GUEST_MEMORY_WORKER: "ON", GUEST_MEMORY_DAILY_COST_USD: "1" }],
    ["true", { GUEST_MEMORY_WORKER: "true", GUEST_MEMORY_DAILY_COST_USD: "1" }],
    ["espaço ( on)", { GUEST_MEMORY_WORKER: " on", GUEST_MEMORY_DAILY_COST_USD: "1" }],
    ["sem teto diário", { GUEST_MEMORY_WORKER: "on" }],
    ["teto inválido", { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "abc" }],
    ["teto zero", { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "0" }],
    ["teto negativo", { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "-1" }],
    ["teto acima de 10", { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "50" }],
  ])("desligado: %s — nenhuma consulta, aquisição ou chamada", async (_, env) => {
    const s = new MemoryStore();
    let queried = 0;
    s.pending = async () => ((queried += 1), []);
    s.pendingList = [stay("r1")];
    const p = provider([okJson(output())]);
    expect((await run(s, p, env)).status).toBe("off");
    expect(queried).toBe(0);
    expect(p.calls).toHaveLength(0);
    expect(guestMemoryConfig(env)).toBeNull();
  });

  it("habilitado só com GUEST_MEMORY_WORKER=on e teto válido; limite máximo de 10 por execução", () => {
    expect(guestMemoryConfig(ON)).toEqual({
      enabled: true,
      dailyCapUsd: 1,
      limit: 10,
      runBudgetUsd: 0.2,
    });
    expect(guestMemoryConfig(ON, 50)!.limit).toBe(10);
    expect(guestMemoryConfig(ON, 3)).toMatchObject({ limit: 3, runBudgetUsd: 0.06 });
  });
});

describe("Memória pós-checkout · ciclo", () => {
  it("estadia com checkout confirmado ⇒ adquire, uma chamada, grava resumo + hospitalidade + avaliação separadas", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const p = provider([okJson(output())]);
    const r = await run(s, p);
    expect(r).toMatchObject({ status: "ran", processed: 1, recorded: 1, failed: 0, notClaimed: 0 });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.messages[0]!.content).toBe(GUEST_MEMORY_SYSTEM_PROMPT);
    const rec = s.records[0]!.result;
    expect(rec.behavioralNotes.every((n) => hospitalityRisk(n.texto) === null)).toBe(true);
    expect(Object.keys(rec.internalAssessment).sort()).toEqual(
      [...ASSESSMENT_DIMENSIONS, "versao"].sort(),
    );
    expect(s.finishes).toEqual([["r1", "done", "recorded"]]);
    expect(s.attempts[0]).toMatchObject({ reserved: 0.02, outcome: "done" });
    expect(s.attempts[0]!.spent!).toBeGreaterThan(0);
  });

  it("idempotente: estadia já resumida ⇒ nenhuma chamada ao modelo; concluída nunca é readquirida", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const p = provider([okJson(output())]);
    await run(s, p);
    await run(s, p);
    expect(p.calls).toHaveLength(1);
    expect(
      await s.claim(stay("r1"), { leaseSeconds: 300, reserveUsd: 0.02, dailyCapUsd: 1 }),
    ).toEqual({ kind: "completed" });
  });

  it("sem conversa ⇒ registra sem chamar o modelo (custo 0); memória consolidada preservada", async () => {
    const s = new MemoryStore();
    s.profiles.get("g1")!.notes = [{ categoria: "preferencia", texto: "Gosta de café" }];
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material([]));
    const p = provider([okJson(output())]);
    await run(s, p);
    expect(p.calls).toHaveLength(0);
    expect(s.records[0]!.result.summary.fonte).toBe("sem_conversa");
    expect(s.records[0]!.result.behavioralNotes).toEqual([
      { categoria: "preferencia", texto: "Gosta de café" },
    ]);
    expect(s.attempts[0]).toMatchObject({ spent: 0 });
  });

  it("falhas isoladas e auditáveis; titular sem âncora ⇒ skipped", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1"), stay("r2"), stay("r3")];
    for (const id of ["r1", "r2", "r3"]) s.materials.set(id, material(CONV));
    const p = provider([
      {
        kind: "error",
        error: { code: "rate_limited", retryable: true, httpStatus: 429 },
        usage: null,
        requestId: null,
      },
      okJson({ nada: true }),
      okJson(output()),
    ]);
    const r = await run(s, p);
    expect(s.finishes.map((m) => m.slice(1))).toEqual([
      ["failed", "llm_rate_limited"],
      ["failed", "output_missing_sections"],
      ["done", "recorded"],
    ]);
    expect(r).toMatchObject({ processed: 3, recorded: 1, failed: 2 });
    const t = new MemoryStore();
    t.titular = { skipped: "no_anchor" };
    t.pendingList = [stay("r9")];
    t.materials.set("r9", material(CONV));
    await run(t, provider([okJson(output())]));
    expect(t.finishes).toEqual([["r9", "skipped", "titular_no_anchor"]]);
  });
});

describe("Memória pós-checkout · concorrência e idempotência (antes da chamada ao modelo)", () => {
  it("duas execuções simultâneas sobre as mesmas estadias ⇒ cada estadia processada UMA vez, uma chamada cada", async () => {
    const s = new MemoryStore();
    s.materialDelay = 5;
    s.pendingList = [stay("r1"), stay("r2"), stay("r3")];
    for (const id of ["r1", "r2", "r3"]) s.materials.set(id, material(CONV));
    const p = provider([okJson(output())], 5);
    const [a, b] = await Promise.all([run(s, p), run(s, p)]);
    expect(p.calls).toHaveLength(3);
    expect(s.records.map((r) => r.reservationId).sort()).toEqual(["r1", "r2", "r3"]);
    expect(a.processed + b.processed).toBe(3);
    expect(a.notClaimed + b.notClaimed).toBeGreaterThan(0);
  });

  it("execução interrompida (posse vencida) ⇒ recuperada por outro worker; o atrasado não grava (sem duplicação)", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const first = await s.claim(stay("r1"), {
      leaseSeconds: 300,
      reserveUsd: 0.02,
      dailyCapUsd: 1,
    });
    expect(first.kind).toBe("claimed");
    expect(
      await s.claim(stay("r1"), { leaseSeconds: 300, reserveUsd: 0.02, dailyCapUsd: 1 }),
    ).toEqual({ kind: "busy" });
    s.now += 301_000; // worker 1 travou: posse venceu
    const p = provider([okJson(output())]);
    await run(s, p);
    expect(s.attempts.map((a) => a.outcome)).toEqual(["abandoned", "done"]);
    expect(s.attempts[0]!.spent).toBe(0.02); // abandonada conta pelo valor reservado
    const late = await s.record({
      reservationId: "r1",
      token: (first as { token: string }).token,
      result: s.records[0]!.result,
    });
    expect(late).toBe("lease_lost");
    expect(s.records).toHaveLength(1);
  });

  it("no máximo 3 tentativas por estadia (inclusive abandonadas); depois, esgotada", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const fail = provider([
      {
        kind: "error",
        error: { code: "provider_unavailable", retryable: true, httpStatus: 503 },
        usage: null,
        requestId: null,
      },
    ]);
    await run(s, fail);
    await run(s, fail);
    await run(s, fail);
    expect(s.runs.get("r1")!.attempts).toBe(3);
    await run(s, fail);
    // cada tentativa = 1 aquisição (o Gateway pode repetir internamente uma vez; está no pior caso reservado)
    expect(s.attempts).toHaveLength(3);
    expect(fail.calls.length).toBeLessThanOrEqual(3 * 2);
    expect(
      await s.claim(stay("r1"), { leaseSeconds: 300, reserveUsd: 0.02, dailyCapUsd: 1 }),
    ).toEqual({ kind: "exhausted" });
  });
});

describe("Memória pós-checkout · custo agregado", () => {
  it("teto diário considera tentativas anteriores e reservas em curso: para ANTES de adquirir e de chamar", async () => {
    const s = new MemoryStore();
    // já gasto hoje: 0,03 (inclui uma tentativa em curso de outro worker, contada pelo reservado)
    s.attempts.push({
      reservationId: "x1",
      reserved: 0.02,
      spent: 0.01,
      outcome: "done",
      token: "old-1",
    });
    s.attempts.push({
      reservationId: "x2",
      reserved: 0.02,
      spent: null,
      outcome: null,
      token: "old-2",
    });
    s.pendingList = ["r1", "r2", "r3"].map(stay);
    for (const id of ["r1", "r2", "r3"]) s.materials.set(id, material(CONV));
    const p = provider([okJson(output())]);
    const r = await run(s, p, { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "0.04" });
    // gasto 0,01 + reserva em curso 0,02 + nova reserva 0,02 = 0,05 > 0,04 ⇒ para sem adquirir nem chamar.
    // Sem contar a reserva em curso (0,01 + 0,02 = 0,03) passaria: é ela que protege contra concorrência.
    expect(r.stoppedBy).toBe("daily_budget");
    expect(p.calls).toHaveLength(0);
    // depois que a tentativa em curso termina com o custo real, o teto libera
    s.attempts[1]!.spent = 0.001;
    s.attempts[1]!.outcome = "done";
    await run(s, p, { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "0.04" });
    expect(p.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("teto por execução: limite de 10 estadias × US$ 0,02 (pior caso)", async () => {
    const s = new MemoryStore();
    const ids = Array.from({ length: 15 }, (_, i) => `r${i}`);
    s.pendingList = ids.map(stay);
    for (const id of ids) s.materials.set(id, material(CONV));
    const p = provider([okJson(output())]);
    const r = await run(s, p, { GUEST_MEMORY_WORKER: "on", GUEST_MEMORY_DAILY_COST_USD: "5" }, 50);
    expect(r.processed).toBe(10);
    expect(p.calls).toHaveLength(10);
  });

  it("pior caso por chamada conta as DUAS tentativas do Gateway: o pedido é montado para caber em US$ 0,01", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    const big = Array.from({ length: 400 }, (_, i) =>
      msg(i + 1, "hospede_titular", "y".repeat(1_150)),
    );
    s.materials.set("r1", material(big));
    const p = provider([okJson(output())]);
    await run(s, p);
    const req = p.calls[0]!;
    const bytes = new TextEncoder().encode(
      req.messages.map((m) => llmMessageText(m.content)).join(""),
    ).length;
    const spec = modelSpec("google/gemini-3.8-flash")!;
    expect(estimateCostUsd(spec, bytes + 128, 2048) * 2).toBeLessThanOrEqual(0.02 + 1e-9);
  });
});

describe("Memória pós-checkout · privacidade (sanitizador conservador)", () => {
  const blocked = [
    "A toalha ficou manchada depois da estadia",
    "Deixou o sofá estragado",
    "Quebrou a taça da cozinha",
    "Houve um desentendimento com a equipe",
    "Os vizinhos reclamaram do barulho",
    "Fez uma festa no apartamento",
    "Suspeita de ter levado o controle remoto",
    "Foi grosseiro com a limpeza",
    "Insistiu muito em entrar mais cedo",
    "Chegou antes do horário sem avisar",
    "Não recomendaria hospedar de novo",
    "Pagou a taxa extra de R$ 150",
    "Pediu reembolso de 2 diárias",
    "Precisou de desconto para fechar",
    "Teve vazamento no banheiro durante a estadia",
    "O ar-condicionado não funcionou",
    "A senha do Wi-Fi é casa2026",
    "Código da porta 4471",
    "Telefone dele é 47 99999-0001",
    "The towel was stained",
    "Complained about the noise",
    "Hubo un problema con la llave",
    "Rompió la lámpara",
    "Mentiu sobre o número de hóspedes",
    "Cuidado com este hóspede",
  ];
  const kept = [
    "Prefere travesseiros extras",
    "Trabalha remoto e valoriza Wi-Fi estável",
    "Costuma pedir saída tardia; reforçar gentilmente o horário oficial de saída",
    "Viaja com um cachorro pequeno",
    "Gosta de café coado pela manhã",
    "Costuma chegar à noite; deixar as instruções de entrada bem claras com antecedência",
  ];
  it.each(blocked)("NÃO entra em behavioral_notes: %s", (texto) => {
    expect(sanitizeHospitalityNotes([{ categoria: "outro", texto }])).toEqual([]);
  });
  it.each(kept)("hospitalidade neutra entra: %s", (texto) => {
    expect(
      sanitizeHospitalityNotes([{ categoria: "preferencia", texto }]).map((n) => n.texto),
    ).toEqual([texto]);
  });
  it("também na estadia: item de hospitalidade com conteúdo de avaliação sai mesmo com evidência", () => {
    const r = validateStayMemoryOutput(
      output({
        estadia: {
          hospitalidade: [
            { categoria: "outro", texto: "Deixou o banheiro danificado", evidencias: ["msg:1"] },
          ],
          avaliacao: {},
        },
      }),
      REFS,
    );
    expect(r.summary.hospitalidade).toEqual([]);
  });
  it("acompanhante: WhatsApp de outro número nunca vira titular", () => {
    expect(isCompanionSession("wa:5547900000000", ["5547999990001"])).toBe(true);
    expect(isCompanionSession("wa:+55 47 99999-0001", ["5547999990001"])).toBe(false);
    expect(isCompanionSession("airbnb:thread", ["5547999990001"])).toBe(false);
    expect(isCompanionSession("wa:", ["5547999990001"])).toBe(true);
  });
  it("logs do ciclo só com códigos: nenhum texto de conversa, nota ou avaliação", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const logs: string[] = [];
    await runGuestMemoryCycle({
      store: s,
      provider: provider([okJson(output())]),
      env: ON,
      log: (e) => logs.push(JSON.stringify(e)),
    });
    const all = logs.join("\n");
    expect(all).not.toMatch(/travesseiros|Respondeu|Tende|dano/);
    expect(Object.keys(JSON.parse(logs[0]!)).sort()).toEqual([
      "attempt",
      "reason",
      "reservation",
      "status",
    ]);
  });
  it("ISOLAMENTO na leitura da IA de atendimento: avaliação interna e resumos nunca são lidos", () => {
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).not.toContain("internal_assessment");
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).not.toContain("stay_summaries");
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).toContain("behavioral_notes");
  });
});
