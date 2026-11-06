/** Decisão de modelo válida (fixture compartilhada dos testes da F2-B). */
export const validDecision = (over: Record<string, unknown> = {}) => ({
  strategy: "answer",
  reply: "O check-in é a partir das 15h. 🙂",
  handoff: { needed: false, question: null, urgency: null },
  caseRelation: "no_open_case",
  groundedOn: ["f:horario_checkin"],
  missingInformation: [],
  capabilityNeeds: [],
  credentialIntent: "none",
  commitments: [],
  ...over,
});
