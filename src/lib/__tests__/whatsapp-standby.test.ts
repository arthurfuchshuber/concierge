/**
 * WhatsApp em STANDBY (10/11/2026): nenhum código, URL ou chamada do Sinch ativo; envio devolve resultado
 * controlado; rota neutra só responde 200 informativo; tela mostra o aviso.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WHATSAPP_STANDBY_MESSAGE, WHATSAPP_STANDBY_RESULT } from "@/lib/whatsapp-standby";
import { sendWhatsappMessageToConversation } from "@/lib/whatsapp-send.server";

const SRC = path.resolve(__dirname, "../..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = path.join(d, n);
    if (n === "node_modules" || n === "__tests__" || n === "generated") return [];
    return statSync(f).isDirectory() ? walk(f) : /\.(ts|tsx)$/.test(n) ? [f] : [];
  });

describe("WhatsApp em standby", () => {
  it("nenhum código ou URL do Sinch permanece ativo (só menções em comentários de histórico)", () => {
    for (const f of walk(SRC)) {
      if (f.endsWith(path.join("integrations", "supabase", "types.ts"))) continue; // tipos gerados do banco
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, path.relative(SRC, f)).not.toMatch(/sinch/i);
    }
    expect(existsSync(path.join(SRC, "routes/api/public/whatsapp/sinch-webhook.ts"))).toBe(false);
  });

  it("envio devolve o resultado controlado de standby (sem lançar, sem gravar)", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_t, k) => (touched.push(String(k)), () => { throw new Error("não deveria tocar o banco"); }) });
    await expect(sendWhatsappMessageToConversation(db as never, "u1", { conversationId: "c", text: "oi" })).resolves.toEqual({
      ok: false,
      reason: "whatsapp_channel_standby_for_meta",
    });
    expect(touched).toEqual([]);
    expect(WHATSAPP_STANDBY_RESULT).toEqual({ ok: false, reason: "whatsapp_channel_standby_for_meta" });
  });

  it("rota neutra da Meta responde 200 informativo em GET e POST", async () => {
    const { Route } = await import("@/routes/api/public/whatsapp/webhook");
    const handlers = (Route as unknown as { options: { server: { handlers: Record<string, () => Promise<Response>> } } }).options.server.handlers;
    for (const m of ["GET", "POST"]) {
      const r = await handlers[m]!();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, status: "standby", reason: "whatsapp_channel_standby_for_meta" });
    }
  });

  it("o chat avisa em vez de falhar em silêncio e a tela mostra o aviso", () => {
    const cv = readFileSync(path.join(SRC, "components/handoff/ConversationView.tsx"), "utf8");
    expect(cv).toMatch(/if \(!r\.ok\) throw new Error\(WHATSAPP_STANDBY_MESSAGE\)/);
    const page = readFileSync(path.join(SRC, "components/admin-pages/WhatsappBusinessPage.tsx"), "utf8");
    expect(page).toMatch(/WHATSAPP_STANDBY_MESSAGE/);
    expect(page).not.toMatch(/Proprietário\(a\):|Pr:/);
    expect(WHATSAPP_STANDBY_MESSAGE).toBe("Canal WhatsApp em Standby (Migração para API Oficial Cloud da Meta)");
  });
});
