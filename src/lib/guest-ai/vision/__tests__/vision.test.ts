/**
 * Etapa 2 da IA Guest — visão de incidentes (07/11/2026).
 * (a) diagnóstico bem-sucedido (vazamento, código de erro) chega à sugestão e ao encaminhamento;
 * (b) fallback gracioso: foto corrompida, prazo de 8 s, recusa do modelo, diagnóstico malformado;
 * (c) nenhuma frase robótica de recibo ("recebi sua foto");
 * (d) slot continua null e fotos nunca passam por cima da política D9.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  VISION_LOAD_TIMEOUT_MS,
  VISUAL_DIAGNOSIS_KEYS,
  containsRoboticAck,
  VISUAL_DIAGNOSIS_SPEC,
  diagnosisNeedsTeam,
  diagnosisReliable,
  diagnosisUrgency,
  parseVisualDiagnosis,
  reconcileVisualDiagnosis,
  stripRoboticAck,
  type VisualDiagnosis,
} from "@/lib/guest-ai/vision/analyzer";
import {
  DECISION_FORMAT_SPEC,
  parseDecision,
  parseDecisionText,
} from "@/lib/guest-ai/orchestrator/decision";
import { CURRENT_DECISION_VERSION } from "@/lib/guest-ai/orchestrator/contracts";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { projectOutcome } from "@/lib/guest-ai/copilot/generate.server";
import { createCopilotGenerator, IMAGE_NOT_LOADED } from "@/lib/guest-ai/copilot/generator.server";
import type { ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { harness, turn, v5, v6 } from "../../__tests__/helpers/b23-chain";
import { okJson } from "../../__tests__/helpers/copilot-provider";

const LEAK: VisualDiagnosis = {
  hasIncident: true,
  category: "plumbing",
  severity: "high",
  detectedApplianceOrFixture: "sifão da pia da cozinha",
  userFriendlyDiagnosis: "Há água acumulada sob a pia e gotejamento na conexão do sifão.",
  suggestedAction: "Feche o registro sob a pia e coloque um recipiente embaixo.",
  requiresStaffIntervention: true,
  visualEvidence: "Poça de água no gabinete e gotas na rosca do sifão.",
  uncertainty: "low",
};
const AC_E4: VisualDiagnosis = {
  hasIncident: true,
  category: "appliance",
  severity: "low",
  detectedApplianceOrFixture: "ar-condicionado split (visor com E4)",
  userFriendlyDiagnosis:
    "O visor mostra o código E4, que costuma indicar proteção de temperatura ou filtro obstruído.",
  suggestedAction:
    "Desligue no controle, aguarde alguns minutos e ligue de novo; se voltar, avise.",
  requiresStaffIntervention: false,
  visualEvidence: "Visor do split com o código E4 aceso.",
  uncertainty: "medium",
};

const run = (decision: unknown) => {
  const h = harness(decision);
  return runTurnChain({ turn: turn(), traceId: "vis-1" }, h.deps);
};
const extra = (imagesSent: number) => ({
  surface: "guide_chat",
  humanInCommand: false,
  reservationLinked: true,
  imagesSent,
});

// ───────────── (a) diagnóstico bem-sucedido ─────────────

describe("(a) diagnóstico visual bem-sucedido", () => {
  it("contrato v6: a cadeia exige visualDiagnosis; o formato pedido ao modelo descreve o schema", () => {
    expect(CURRENT_DECISION_VERSION).toBe(6);
    expect(DECISION_FORMAT_SPEC).toContain('"visualDiagnosis"');
    for (const k of VISUAL_DIAGNOSIS_KEYS) expect(DECISION_FORMAT_SPEC).toContain(`"${k}"`);
    for (const c of ["plumbing", "electrical", "appliance", "lock", "cleanliness", "other"])
      expect(DECISION_FORMAT_SPEC).toContain(`"${c}"`);
  });

  it("parse do diagnóstico de vazamento e de código de erro", () => {
    for (const d of [LEAK, AC_E4]) {
      const r = parseDecision(v6({ visualDiagnosis: d }), { expectVersion: 6 });
      expect(r.ok && r.decision.visualDiagnosis).toEqual(d);
    }
    expect(parseVisualDiagnosis(null)).toBeNull();
    // v5 continua aceita (compatibilidade), sem diagnóstico
    const old = parseDecision(v5());
    expect(old.ok && old.version).toBe(5);
  });

  it("vazamento grave na foto ⇒ sugestão natural e encaminhamento com urgência alta", async () => {
    const reply =
      "Pela foto, parece que a conexão do sifão embaixo da pia está vazando. Feche o registro sob a pia e coloque um balde embaixo enquanto isso.";
    const out = await run(v6({ reply, intents: ["problem_report"], visualDiagnosis: LEAK }));
    expect(out.kind).toBe("reply");
    const p = projectOutcome(out, extra(1));
    expect(p.state).toBe("available");
    expect(p.text).toBe(reply);
    expect(p).toMatchObject({ handoffNeeded: true, handoffUrgency: "high" });
    expect(p.warnings).toContain("handoff_recommended");
  });

  it("código de erro simples ⇒ orienta sem acionar a equipe", async () => {
    const out = await run(
      v6({
        reply:
          "Identifiquei o código E4 no visor do ar-condicionado; desligue no controle, aguarde alguns minutos e ligue de novo.",
        intents: ["problem_report"],
        visualDiagnosis: AC_E4,
      }),
    );
    const p = projectOutcome(out, extra(1));
    expect(p).toMatchObject({ state: "available", handoffNeeded: false });
  });

  it("urgência coerente com a gravidade; exigência da equipe ou gravidade alta ⇒ encaminha", () => {
    expect(diagnosisUrgency(LEAK)).toBe("high");
    expect(diagnosisUrgency({ ...AC_E4, severity: "medium" })).toBe("normal");
    expect(diagnosisUrgency(AC_E4)).toBe("low");
    expect(diagnosisNeedsTeam(LEAK)).toBe(true);
    expect(diagnosisNeedsTeam(AC_E4)).toBe(false);
    expect(diagnosisNeedsTeam({ ...AC_E4, severity: "high" })).toBe(true);
    expect(diagnosisNeedsTeam({ ...AC_E4, hasIncident: false, severity: "high" })).toBe(false);
  });

  it("o prompt manda usar conhecimento técnico geral, sem travar no dossiê e sem inventar estrutura", () => {
    const sys = buildSystemPrompt("whatsapp");
    expect(sys).toMatch(
      /use o seu conhecimento técnico geral \(marcas, modelos, painéis, códigos de erro, disjuntores/,
    );
    expect(sys).toMatch(/Nunca trave dizendo que algo não consta no dossiê/);
    expect(sys).toMatch(
      /não afirme como fato onde fica algo deste imóvel que não esteja declarado/,
    );
    expect(sys).toMatch(/não peça ao hóspede nada perigoso/);
    expect(sys).toMatch(/preencha visualDiagnosis/);
  });
});

// ───────────── (b) fallback ─────────────

const MODEL = "google/gemini-3.8-flash";
const prompt = (): ComposedPrompt => ({
  system: "Você é o concierge.",
  messages: [{ role: "user", content: "mensagem atual: o chuveiro não esquenta, mandei foto" }],
  sourceIds: null,
  promptVersion: "t",
});
const IMG = {
  ref: "hist:guest:h5",
  at: "2026-11-07T10:00:05Z",
  dataUrl: "data:image/jpeg;base64,/9j/AAAA",
  tokenBound: 1_120,
};
function capture() {
  const seen: ProviderRequest[] = [];
  return {
    seen,
    provider: {
      id: "fake",
      async complete(req: ProviderRequest) {
        seen.push(req);
        return okJson({ ok: true });
      },
    },
  };
}
const gen = (over: Partial<Parameters<typeof createCopilotGenerator>[0]>) => {
  const cap = capture();
  const g = createCopilotGenerator({
    modelId: MODEL,
    maxOutputTokens: 1_536,
    reasoningEffort: "auto",
    remainingMs: () => 20_000,
    beforeNetwork: async () => true,
    traceId: "s",
    provider: cap.provider,
    log: () => {},
    ...over,
  });
  return { g, cap };
};
const allText = (req: ProviderRequest) => JSON.stringify(req.messages);

describe("(b) fallback gracioso da visão", () => {
  afterEach(() => vi.useRealTimers());

  it("foto corrompida/ilegível ⇒ segue só com texto e o aviso, sem quebrar o turno", async () => {
    const { g, cap } = gen({
      loadVision: async () => ({ images: [], failed: [{ ref: "hist:guest:h5", at: null }] }),
    });
    await g.generate(prompt(), new AbortController().signal);
    expect(allText(cap.seen[0]!)).toContain(IMAGE_NOT_LOADED);
    expect(allText(cap.seen[0]!)).not.toContain("data:image");
    expect(g.telemetry()).toMatchObject({ status: "called", imagesSent: 0, imagesNotLoaded: 1 });
  });

  it("leitura das fotos que trava ⇒ cortada em 8 s, turno segue em texto", async () => {
    vi.useFakeTimers();
    const { g, cap } = gen({ loadVision: () => new Promise(() => {}) });
    const p = g.generate(prompt(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(VISION_LOAD_TIMEOUT_MS + 1);
    await p;
    expect(VISION_LOAD_TIMEOUT_MS).toBe(8_000);
    expect(allText(cap.seen[0]!)).toContain(IMAGE_NOT_LOADED);
    expect(g.telemetry()).toMatchObject({ status: "called", imagesSent: 0 });
  });

  it("falha ao carregar ⇒ texto + aviso (nunca derruba)", async () => {
    const { g, cap } = gen({
      loadVision: async () => {
        throw new Error("storage");
      },
    });
    await g.generate(prompt(), new AbortController().signal);
    expect(allText(cap.seen[0]!)).toContain(IMAGE_NOT_LOADED);
  });

  it("recusa do modelo (filtro) ⇒ falha fechada com código, sem texto parcial", async () => {
    const provider = {
      id: "fake",
      async complete() {
        return {
          kind: "ok" as const,
          text: "",
          finishReason: "content_filter" as const,
          usage: null,
          requestId: null,
        };
      },
    };
    const { g } = gen({ provider, loadVision: async () => ({ images: [IMG], failed: [] }) });
    await expect(g.generate(prompt(), new AbortController().signal)).rejects.toMatchObject({
      code: "gateway_failed",
    });
    expect(g.telemetry().error).toBe("content_filtered");
  });

  it("diagnóstico malformado ⇒ ignorado (null) e a resposta em texto segue válida", () => {
    for (const bad of [
      { ...LEAK, category: "fogo" },
      { ...LEAK, extra: 1 },
      { ...LEAK, userFriendlyDiagnosis: "" },
      { ...LEAK, visualEvidence: "" },
      { ...LEAK, uncertainty: "talvez" },
      (({ uncertainty: _u, ...rest }) => rest)(LEAK),
      (({ visualEvidence: _e, ...rest }) => rest)(LEAK),
      "vazamento",
      3,
    ]) {
      const r = parseDecisionText(JSON.stringify(v6({ visualDiagnosis: bad })), {
        expectVersion: 6,
      });
      expect(r.ok).toBe(true);
      expect(r.ok && r.decision.visualDiagnosis).toBeNull();
    }
  });

  it("diagnóstico sem foto no turno é descartado (o modelo não vê o que não recebeu)", async () => {
    expect(reconcileVisualDiagnosis(LEAK, 0)).toBeNull();
    expect(reconcileVisualDiagnosis(LEAK, 1)).toEqual(LEAK);
    const out = await run(
      v6({ reply: "Vou te ajudar com isso.", intents: ["problem_report"], visualDiagnosis: LEAK }),
    );
    expect(projectOutcome(out, extra(0))).toMatchObject({ handoffNeeded: false });
  });
});

// ───────────── (c) sem frases robóticas ─────────────

describe("(c) nenhuma frase robótica de recibo", () => {
  it.each([
    [
      "Recebi sua foto! Pela foto, o registro está semiaberto.",
      "Pela foto, o registro está semiaberto.",
    ],
    [
      "Obrigado pela foto. O disjuntor do chuveiro parece desarmado.",
      "O disjuntor do chuveiro parece desarmado.",
    ],
    [
      "Olá, Ana! Recebi a imagem que você mandou. Identifiquei o código E4 no visor.",
      "Olá, Ana! Identifiquei o código E4 no visor.",
    ],
    [
      "Identifiquei que você enviou um anexo. A fechadura está sem bateria.",
      "A fechadura está sem bateria.",
    ],
    ["Thanks for the photo! The breaker looks tripped.", "The breaker looks tripped."],
    ["Gracias por la foto. El grifo está abierto.", "El grifo está abierto."],
  ])("remove o recibo do início: %s", (input, expected) => {
    expect(containsRoboticAck(input)).toBe(true);
    expect(stripRoboticAck(input)).toBe(expected);
  });

  it("não mexe em texto natural (inclusive 'pela foto', 'identifiquei o código')", () => {
    for (const t of [
      "Pela foto que você enviou, parece que o registro está semiaberto.",
      "Identifiquei o código E4 no visor do ar-condicionado.",
      "Obrigado por avisar! Já vou te ajudar.",
    ]) {
      expect(containsRoboticAck(t)).toBe(false);
      expect(stripRoboticAck(t)).toBe(t);
    }
  });

  it("a sugestão do Copiloto nunca sai com o recibo", async () => {
    const out = await run(
      v6({
        reply: "Recebi sua foto! Pela foto, parece que o registro ao lado da pia está semiaberto.",
        intents: ["problem_report"],
        visualDiagnosis: AC_E4,
      }),
    );
    const p = projectOutcome(out, extra(1));
    expect(p.text).toBe("Pela foto, parece que o registro ao lado da pia está semiaberto.");
    expect(containsRoboticAck(p.text!)).toBe(false);
  });

  it("o prompt proíbe o recibo em qualquer canal", () => {
    for (const ch of ["airbnb", "whatsapp", "guide_chat"] as const) {
      expect(buildSystemPrompt(ch)).toMatch(
        /Nunca diga que recebeu a foto, a imagem ou o vídeo, nem agradeça pelo envio/,
      );
    }
  });
});

// ───────────── (d) slot e D9 ─────────────

describe("(d) slot null e D9 blindado", () => {
  const ROOT = path.resolve(__dirname, "..", "..");

  it("slot.server.ts devolve null e não conhece a visão", async () => {
    expect(readFileSync(path.join(ROOT, "slot.server.ts"), "utf8")).not.toMatch(/vision|analyzer/i);
    const { requestGuestAiReply } = await import("@/lib/guest-ai/slot.server");
    await expect(
      requestGuestAiReply({ surface: "whatsapp" as never, conversationId: "c", messageId: "m" }),
    ).resolves.toBeNull();
  });

  it("o módulo de visão é puro: sem banco, rede, credenciais, D9, log ou persistência", () => {
    const src = readFileSync(path.join(ROOT, "vision", "analyzer.ts"), "utf8");
    expect(src).not.toMatch(
      /supabase|client\.server|\bfetch\(|console\.|credential-policy|fetchSensitiveCredentials|CredentialGrant|\.from\(|\.rpc\(/,
    );
  });

  it("o diagnóstico não é persistido: a linha da sugestão não carrega o texto visual", async () => {
    const out = await run(
      v6({
        reply: "Pela foto, a pia está vazando.",
        intents: ["problem_report"],
        visualDiagnosis: LEAK,
      }),
    );
    const p = projectOutcome(out, extra(1));
    expect(JSON.stringify(p)).not.toContain(LEAK.userFriendlyDiagnosis);
    expect(JSON.stringify(p)).not.toContain(LEAK.detectedApplianceOrFixture!);
  });

  it("foto de fechadura não libera senha: com D9 negado, pedido de credencial nunca vira texto com código", async () => {
    const lock: VisualDiagnosis = {
      ...AC_E4,
      category: "lock",
      detectedApplianceOrFixture: "fechadura eletrônica",
      userFriendlyDiagnosis: "Visor da fechadura apagado.",
      suggestedAction: "Toque no teclado para acordar.",
    };
    const out = await run(
      v6({
        reply: "Aqui está a senha: [[CREDENCIAIS]]",
        credentialIntent: "would_deliver",
        intents: ["operational_request"],
        visualDiagnosis: lock,
      }),
    );
    // a decisão de credenciais é do sistema: sem liberação no contexto, a cadeia recusa ou marca o pedido negado
    if (out.kind === "reply")
      expect(projectOutcome(out, extra(1)).warnings).toContain("credential_request_denied");
    else expect(["refused", "human_action"]).toContain(out.kind);
    expect(JSON.stringify(out)).not.toMatch(/senha: \d/);
  });

  it("o prompt reforça que foto não libera credenciais e que códigos vistos nunca são repetidos", () => {
    expect(buildSystemPrompt("guide_chat")).toMatch(/Uma foto nunca libera senhas ou códigos/);
  });
});

describe("Etapa 2 (08/11/2026): evidência visual e incerteza", () => {
  it("schema exige visualEvidence e uncertainty (fail-closed); formato pedido ao modelo descreve os dois", () => {
    expect(parseVisualDiagnosis(LEAK)).toEqual(LEAK);
    expect(VISUAL_DIAGNOSIS_SPEC).toMatch(/"visualEvidence": string/);
    expect(VISUAL_DIAGNOSIS_SPEC).toMatch(/"uncertainty": "low"\|"medium"\|"high"/);
  });

  it("incerteza alta = diagnóstico não confiável; baixa/média = confiável", () => {
    expect(diagnosisReliable(LEAK)).toBe(true);
    expect(diagnosisReliable(AC_E4)).toBe(true);
    expect(diagnosisReliable({ ...LEAK, uncertainty: "high" })).toBe(false);
    expect(diagnosisReliable(null)).toBe(false);
  });

  it("o prompt manda perguntar ao hóspede, sem afirmar causa, quando a foto não permite concluir", () => {
    const sys = buildSystemPrompt("whatsapp");
    expect(sys).toMatch(/Sem diagnóstico confiável \(uncertainty high\), não afirme causa nem invente/);
    expect(sys).toMatch(/pergunte ao hóspede/);
  });
});
