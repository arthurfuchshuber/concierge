/**
 * B3.3 · Entrega 2 — defesa do gerador contra mudança no REGISTRO de modelos: se um modelo permitido
 * deixar de existir ou passar a ser servido por `/chat/completions` (sem `store: false`), o gerador
 * Shadow se recusa a nascer. O registro é substituído só neste arquivo.
 */
import { describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ value: "chat" as "chat" | "missing" }));
vi.mock("@/lib/guest-ai/llm/models", async (orig) => {
  const real = await orig<typeof import("@/lib/guest-ai/llm/models")>();
  return { ...real, modelSpec: (id: string) => (mode.value === "missing" ? null : { ...real.modelSpec(id)!, wire: "chat" }) };
});

import { createShadowGatewayGenerator, issueShadowPreflight } from "@/lib/guest-ai/shadow-exec/gateway-generator.server";
import { ShadowDeadline } from "@/lib/guest-ai/shadow-exec/deadline";
import { validateShadowControl } from "@/lib/guest-ai/shadow-exec/breakers";
import { CONV, EXEC_ID, MemoryShadowStore, P_ID, T_ID, fullControl } from "./helpers/b33-shadow";

describe("B3.3 · gerador × registro de modelos", () => {
  const deps = () => {
    const v = validateShadowControl(fullControl());
    if (!v.ok) throw new Error("fixture");
    const preflight = issueShadowPreflight({ executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, stateVersion: 7, propertyActiveOk: true, integrityOk: true, pauseInactive: true, ownershipOk: true })!;
    return { preflight, limits: v.limits, deadline: new ShadowDeadline({ now: () => 0, schedule: () => () => undefined }), store: new MemoryShadowStore() };
  };
  it("modelo permitido servido por /chat (sem store:false) ⇒ gerador recusado", () => {
    mode.value = "chat";
    expect(createShadowGatewayGenerator(deps())).toBeNull();
  });
  it("modelo permitido ausente do registro ⇒ gerador recusado", () => {
    mode.value = "missing";
    expect(createShadowGatewayGenerator(deps())).toBeNull();
  });
});
