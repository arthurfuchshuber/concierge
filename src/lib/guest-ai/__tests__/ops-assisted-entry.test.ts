/**
 * ENTRADA ASSISTIDA PELA EQUIPE · caso real de 12/11/2026 (Ary, Casa Completa): o hóspede avisou "acabamos de
 * chegar", a equipe liberou o acesso no chat ("Aberto", "podem seguir com as demais orientações") e ele
 * respondeu "Perfeito" / "Muitíssimo obrigado por tudo". Ninguém escreveu "entramos"; a resposta não declarou o
 * marco (`response_no_signal`) e o leitor estourou o prazo (`reader_deadline`). O card de check-in ficou pendente.
 */
import { describe, expect, it } from "vitest";
import { detectStaffAssistedEntry } from "@/lib/guest-ai/ops/assisted-entry";
import { evaluateOpsSignals, type OpsHistoryEntry, type OpsPolicyInput } from "@/lib/guest-ai/ops/policy";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import { v5 } from "./helpers/b23-chain";

const TZ = "America/Sao_Paulo";

type Row = { speaker: "guest" | "team"; text: string; at: string };
/** Conversa real (UTC; em São Paulo = 00:14 a 00:31 de 12/11, madrugada da noite de entrada de 11/11). */
const ARY: Row[] = [
  { speaker: "guest", text: "Olá! Para avisar que acabamos de pousar, estou correndo para o local!", at: "2026-11-12T03:00:36Z" },
  { speaker: "team", text: "Obrigada por avisar, Ary. Estaremos lhe aguardando.", at: "2026-11-12T03:01:00Z" },
  { speaker: "guest", text: "Sigma, estamos entrando no Uber!", at: "2026-11-12T03:14:40Z" },
  { speaker: "guest", text: "Sigma, acabamos de chegar", at: "2026-11-12T03:28:45Z" },
  { speaker: "team", text: "Aberto", at: "2026-11-12T03:29:07Z" },
  { speaker: "team", text: "Basta seguir as demais instruções ok?", at: "2026-11-12T03:29:14Z" },
  { speaker: "guest", text: "2802?", at: "2026-11-12T03:29:23Z" },
  { speaker: "guest", text: "[Foto enviada pelo hóspede]", at: "2026-11-12T03:30:14Z" },
  { speaker: "team", text: "Isso mesmo", at: "2026-11-12T03:30:22Z" },
  { speaker: "team", text: "Podem seguir com as demais orientações", at: "2026-11-12T03:30:36Z" },
  { speaker: "team", text: "Se precisarem de auxílio, é só nos acionar", at: "2026-11-12T03:30:47Z" },
  { speaker: "guest", text: "Perfeito", at: "2026-11-12T03:31:06Z" },
  { speaker: "guest", text: "Muitíssimo obrigado por tudo", at: "2026-11-12T03:31:19Z" },
];
const NOW = new Date("2026-11-12T03:31:30Z");

const rows = (r: Row[]) => r.map((x, i) => ({ messageId: `m${i + 1}`, speaker: x.speaker, text: x.text, at: x.at }));
const entries = (r: Row[]): OpsHistoryEntry[] =>
  r.map((x, i) => ({ ref: `hist:${x.speaker}:h${i + 1}`, messageId: `m${i + 1}`, speaker: x.speaker, text: x.text, at: x.at }));

const noSignal = (): ModelDecision =>
  ({ ...(v5() as unknown as ModelDecision), hospitalityMilestone: null, milestoneQuote: null, guestEtas: [] }) as ModelDecision;

const input = (over: Partial<OpsPolicyInput> = {}, r: Row[] = ARY): OpsPolicyInput => ({
  decision: noSignal(),
  history: entries(r),
  phase: "in_stay",
  timezone: TZ,
  now: NOW,
  reservation: { id: "r1", status: "confirmed", checkinDate: "2026-11-11", checkoutDate: "2026-11-15" },
  conversation: {
    status: "assigned",
    assignedTo: "u1",
    handoffReason: null,
    handoffUrgency: null,
    aiPaused: true,
    pausedUntil: null,
  },
  cards: { checkin: null, checkout: null },
  property: { checkinTime: "15:00", checkinTimeMax: "23:00", checkoutTime: "11:00", checkoutTimeMin: null },
  defaultHandoffReason: "PADRAO",
  ...over,
});

describe("detectStaffAssistedEntry (puro)", () => {
  it("CASO REAL Ary: chegada + liberação da equipe + 'Perfeito' ⇒ entrada consumada", () => {
    expect(detectStaffAssistedEntry(rows(ARY), { now: NOW })).toEqual({
      messageId: "m12",
      releaseMessageId: "m10",
      arrivalMessageId: "m4",
    });
  });

  it("antes da resposta do hóspede à liberação ⇒ ainda não", () => {
    expect(detectStaffAssistedEntry(rows(ARY.slice(0, 11)), { now: NOW })).toBeNull();
  });

  it("dúvida depois da liberação ('2802?') sem nova liberação ⇒ não", () => {
    expect(detectStaffAssistedEntry(rows(ARY.slice(0, 7)), { now: NOW })).toBeNull();
  });

  it.each([
    ["Não abriu ainda"],
    ["A porta está fechada"],
    ["Perfeito, mas a senha está errada"],
    ["Qual é o código?"],
  ])("resposta com dificuldade depois da liberação ('%s') ⇒ não", (txt) => {
    const r = [...ARY.slice(0, 11), { speaker: "guest" as const, text: txt, at: "2026-11-12T03:31:06Z" }];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });

  it("só foto depois da liberação ⇒ não (precisa de resposta escrita)", () => {
    const r = [...ARY.slice(0, 11), { speaker: "guest" as const, text: "[Foto enviada pelo hóspede]", at: "2026-11-12T03:31:06Z" }];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });

  it.each([
    ["Chegamos no aeroporto"],
    ["Acabamos de chegar em Foz"],
    ["Quando chegarmos aviso"],
    ["Ainda não chegamos"],
    ["Estamos a caminho"],
  ])("aviso que não é chegada ao imóvel ('%s') ⇒ não", (txt) => {
    const r: Row[] = [
      { speaker: "guest", text: txt, at: "2026-11-12T03:28:45Z" },
      { speaker: "team", text: "Aberto", at: "2026-11-12T03:29:07Z" },
      { speaker: "guest", text: "Perfeito, obrigado", at: "2026-11-12T03:31:06Z" },
    ];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });

  it("liberação da equipe sem aviso de chegada antes ⇒ não", () => {
    const r: Row[] = [
      { speaker: "team", text: "O imóvel está liberado a partir das 15h.", at: "2026-11-11T12:00:00Z" },
      { speaker: "guest", text: "Perfeito, obrigado", at: "2026-11-11T12:01:00Z" },
    ];
    expect(detectStaffAssistedEntry(rows(r), { now: new Date("2026-11-11T12:02:00Z") })).toBeNull();
  });

  it("liberação condicionada ou adiada pela equipe ⇒ não", () => {
    const r: Row[] = [
      { speaker: "guest", text: "Chegamos", at: "2026-11-12T03:28:45Z" },
      { speaker: "team", text: "Aguarde um instante, ainda não está liberado", at: "2026-11-12T03:29:07Z" },
      { speaker: "guest", text: "Ok, obrigado", at: "2026-11-12T03:31:06Z" },
    ];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });

  it("liberação mais de 90 min depois da chegada ⇒ não", () => {
    const r: Row[] = [
      { speaker: "guest", text: "Chegamos", at: "2026-11-12T01:00:00Z" },
      { speaker: "team", text: "Aberto", at: "2026-11-12T03:29:07Z" },
      { speaker: "guest", text: "Perfeito", at: "2026-11-12T03:31:06Z" },
    ];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });

  it("mensagem do hóspede citada pela IA/equipe não vale como chegada", () => {
    const r: Row[] = [
      { speaker: "team", text: "Quando chegarem, avisem que abrimos", at: "2026-11-12T03:28:45Z" },
      { speaker: "team", text: "Aberto", at: "2026-11-12T03:29:07Z" },
      { speaker: "guest", text: "Perfeito", at: "2026-11-12T03:31:06Z" },
    ];
    expect(detectStaffAssistedEntry(rows(r), { now: NOW })).toBeNull();
  });
});

describe("política: entrada assistida conclui o check-in sem depender do modelo", () => {
  it("CASO REAL Ary: resposta sem marco (equipe no comando, madrugada da noite de entrada) ⇒ avança o card", () => {
    const r = evaluateOpsSignals(input());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ action: "checkin_done", outcome: "would_apply", code: null, evidenceMessageId: "m12" });
  });

  it("card já concluído ⇒ nada a avaliar (sem poluir a auditoria)", () => {
    const done = { status: "done", doneAt: "2026-11-12T03:31:10Z" } as never;
    expect(evaluateOpsSignals(input({ cards: { checkin: done, checkout: null } }))).toEqual([]);
  });

  it("fora do dia da entrada ⇒ nada a avaliar", () => {
    expect(
      evaluateOpsSignals(
        input({ reservation: { id: "r1", status: "confirmed", checkinDate: "2026-11-09", checkoutDate: "2026-11-15" } }),
      ),
    ).toEqual([]);
  });

  it("reserva cancelada ⇒ recusa registrada", () => {
    const r = evaluateOpsSignals(
      input({ reservation: { id: "r1", status: "cancelled", checkinDate: "2026-11-11", checkoutDate: "2026-11-15" } }),
    );
    expect(r[0]).toMatchObject({ action: "checkin_done", outcome: "refused", code: "reservation_not_active" });
  });

  it("o modelo já declarou o marco ⇒ não duplica a avaliação", () => {
    const d = {
      ...(v5() as unknown as ModelDecision),
      hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h13"] },
      milestoneQuote: "Muitíssimo obrigado por tudo",
    } as ModelDecision;
    const r = evaluateOpsSignals(input({ decision: d }));
    expect(r.filter((e) => e.action === "checkin_done")).toHaveLength(1);
  });
});
