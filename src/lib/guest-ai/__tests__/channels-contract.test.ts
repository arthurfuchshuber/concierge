import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F0 · os três canais chamam o slot SÓ com identificadores (sem cliente de banco,
 * sem imóvel/dono/nome/texto vindos do canal) e passam o id da mensagem gravada.
 */
const ROOT = process.env["GUEST_AI_REPO_ROOT"] ?? process.cwd();
const CHANNELS = [
  "src/routes/api/public/guide-chat.ts",
  "src/lib/channex-messages.server.ts",
];

function slotCall(file: string): string {
  const src = readFileSync(path.join(ROOT, file), "utf8");
  const calls = src.match(/requestGuestAiReply\(\{[\s\S]*?\}\);/g) ?? [];
  expect(calls.length, `${file}: uma chamada ao slot`).toBe(1);
  return calls[0] ?? "";
}

describe("F0 · contrato dos canais com o slot", () => {
  for (const file of CHANNELS) {
    it(`${file}: só identificadores`, () => {
      const call = slotCall(file);
      expect(call).not.toMatch(/supabase|admin\b|propertyId|ownerId:|guestName|message:|reservationCode/);
      expect(call).toMatch(/surface:/);
      expect(call).toMatch(/conversationId/);
      expect(call).toMatch(/messageId:/);
      expect(call).toMatch(/expectedOwnerId:/);
    });
  }
});
