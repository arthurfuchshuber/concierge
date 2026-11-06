/**
 * MEMÓRIA DO HÓSPEDE · processo pós-checkout: validação da saída (evidência, isolamento hospitalidade ×
 * avaliação interna, guard de segredos), fatos objetivos de horário, montagem com teto de custo e o ciclo
 * completo (idempotência, sem conversa, falhas isoladas, desligamento). Sem rede: transporte falso.
 */
import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_DIMENSIONS,
  StayMemoryOutputError,
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
  runGuestMemoryCycle,
  type GuestMemoryStore,
  type PendingStay,
  type ProfileMemory,
  type StayMaterial,
} from "@/lib/guest-memory/worker.server";
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

class MemoryStore implements GuestMemoryStore {
  pendingList: PendingStay[] = [];
  materials = new Map<string, StayMaterial | null>();
  titular: { canonicalId: string } | { skipped: string } = { canonicalId: "g1" };
  profiles = new Map<string, ProfileMemory>([
    ["g1", { reservationIds: new Set(), notes: [], assessment: {}, stays: [] }],
  ]);
  records: Array<{ reservationId: string; result: StayMemoryResult }> = [];
  marks: Array<[string, string, string]> = [];
  async pending(limit: number) {
    return this.pendingList.slice(0, limit);
  }
  async material(s: PendingStay) {
    return this.materials.has(s.reservationId) ? this.materials.get(s.reservationId)! : null;
  }
  async upsertTitular() {
    return this.titular;
  }
  async profile(_t: string, id: string) {
    return this.profiles.get(id) ?? null;
  }
  async record(i: { reservationId: string; result: StayMemoryResult }) {
    this.records.push({ reservationId: i.reservationId, result: i.result });
    return "recorded" as const;
  }
  async mark(r: string, _t: string, status: string, reason: string) {
    this.marks.push([r, status, reason]);
  }
}
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
  outcomes: Array<ProviderOutcome | ((req: ProviderRequest) => ProviderOutcome)>,
): LlmProvider & { calls: ProviderRequest[] } {
  const p = {
    id: "fake",
    calls: [] as ProviderRequest[],
    async complete(req: ProviderRequest) {
      p.calls.push(req);
      const o = outcomes[Math.min(p.calls.length - 1, outcomes.length - 1)]!;
      return typeof o === "function" ? o(req) : o;
    },
  };
  return p;
}
const CONV = [
  msg(1, "hospede_titular", "Pode deixar travesseiros extras?"),
  msg(2, "equipe", "Claro!"),
  msg(3, "hospede_titular", "Obrigada"),
];

describe("Memória pós-checkout · ciclo (processo assíncrono)", () => {
  it("estadia com checkout confirmado ⇒ uma chamada, grava resumo + hospitalidade + avaliação separadas", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    const p = provider([okJson(output())]);
    const r = await runGuestMemoryCycle({ store: s, provider: p, env: {}, log: () => {} });
    expect(r).toMatchObject({ status: "ran", processed: 1, recorded: 1, failed: 0 });
    expect(r.costUsd).toBeGreaterThan(0);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.messages[0]!.content).toBe(GUEST_MEMORY_SYSTEM_PROMPT);
    const rec = s.records[0]!.result;
    expect(rec.behavioralNotes.every((n) => !/dano|antes do horário/.test(n.texto))).toBe(true);
    expect(Object.keys(rec.internalAssessment).sort()).toEqual(
      [...ASSESSMENT_DIMENSIONS, "versao"].sort(),
    );
    expect(rec.summary.hospitalidade.length).toBe(1);
    expect(s.marks).toEqual([["r1", "done", "recorded"]]);
  });

  it("idempotente: estadia já resumida no perfil ⇒ nenhuma chamada ao modelo", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material(CONV));
    s.profiles.get("g1")!.reservationIds.add("r1");
    const p = provider([okJson(output())]);
    await runGuestMemoryCycle({ store: s, provider: p, env: {}, log: () => {} });
    expect(p.calls).toHaveLength(0);
    expect(s.records).toHaveLength(0);
    expect(s.marks).toEqual([["r1", "done", "already_recorded"]]);
  });

  it("sem conversa ⇒ registra a estadia sem chamar o modelo; memória consolidada preservada", async () => {
    const s = new MemoryStore();
    s.profiles.get("g1")!.notes = [{ categoria: "preferencia", texto: "Gosta de café" }];
    s.pendingList = [stay("r1")];
    s.materials.set("r1", material([]));
    const p = provider([okJson(output())]);
    await runGuestMemoryCycle({ store: s, provider: p, env: {}, log: () => {} });
    expect(p.calls).toHaveLength(0);
    expect(s.records[0]!.result.summary.fonte).toBe("sem_conversa");
    expect(s.records[0]!.result.behavioralNotes).toEqual([
      { categoria: "preferencia", texto: "Gosta de café" },
    ]);
  });

  it("falhas isoladas: titular sem âncora (skipped), modelo falha, JSON inválido; a seguinte é processada", async () => {
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
    const r = await runGuestMemoryCycle({ store: s, provider: p, env: {}, log: () => {} });
    expect(s.marks.map((m) => m.slice(1))).toEqual([
      ["failed", "llm_rate_limited"],
      ["failed", "output_missing_sections"],
      ["done", "recorded"],
    ]);
    expect(r).toMatchObject({ processed: 3, recorded: 1, failed: 2 });

    const t = new MemoryStore();
    t.titular = { skipped: "no_anchor" };
    t.pendingList = [stay("r9")];
    t.materials.set("r9", material(CONV));
    await runGuestMemoryCycle({
      store: t,
      provider: provider([okJson(output())]),
      env: {},
      log: () => {},
    });
    expect(t.marks).toEqual([["r9", "skipped", "titular_no_anchor"]]);
  });

  it("GUEST_MEMORY_WORKER=off desliga sem tocar em nada", async () => {
    const s = new MemoryStore();
    s.pendingList = [stay("r1")];
    const r = await runGuestMemoryCycle({
      store: s,
      provider: provider([okJson(output())]),
      env: { GUEST_MEMORY_WORKER: "off" },
      log: () => {},
    });
    expect(r.status).toBe("off");
    expect(s.marks).toEqual([]);
  });

  it("ISOLAMENTO na leitura da IA de atendimento: avaliação interna e resumos nunca são lidos", () => {
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).not.toContain("internal_assessment");
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).not.toContain("stay_summaries");
    expect(GUEST_PROFILE_COLUMNS as readonly string[]).toContain("behavioral_notes");
  });
});
