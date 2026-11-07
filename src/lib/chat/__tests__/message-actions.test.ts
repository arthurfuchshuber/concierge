import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AIRBNB_IMMUTABLE_ERROR,
  messageActions,
  messageDestination,
} from "@/lib/chat/message-actions";

const team = (channel: string | null, sessionId: string | null = null) =>
  messageActions({ channel, sessionId, isNote: false, isGuest: false });
const guest = (channel: string | null, sessionId: string | null = null) =>
  messageActions({ channel, sessionId, isNote: false, isGuest: true });
const note = (channel: string | null, sessionId: string | null = null) =>
  messageActions({ channel, sessionId, isNote: true, isGuest: false });

describe("ações da mensagem por canal de destino", () => {
  it("Airbnb: só Copiar — para equipe, IA e hóspede", () => {
    expect(team("airbnb")).toMatchObject({
      copy: true,
      edit: false,
      delete: false,
      destination: "airbnb",
    });
    expect(guest("airbnb")).toMatchObject({ copy: true, edit: false, delete: false });
  });

  it("Airbnb sem canal na mensagem (registro antigo): o prefixo da sessão decide", () => {
    expect(team(null, "airbnb:123")).toMatchObject({
      edit: false,
      delete: false,
      destination: "airbnb",
    });
  });

  it("Guia Digital: Copiar, Editar e Apagar", () => {
    expect(team("web")).toMatchObject({
      copy: true,
      edit: true,
      delete: true,
      destination: "guide",
    });
    expect(team(null, "guest-abc")).toMatchObject({
      edit: true,
      delete: true,
      destination: "guide",
    });
  });

  it("WhatsApp: Copiar e Apagar, sem Editar", () => {
    expect(team("whatsapp")).toMatchObject({
      copy: true,
      edit: false,
      delete: true,
      destination: "whatsapp",
    });
    expect(team(null, "wa:5511999999999")).toMatchObject({
      edit: false,
      delete: true,
      destination: "whatsapp",
    });
  });

  it("nota interna: Copiar, Editar e Apagar em qualquer canal (nunca sai do painel)", () => {
    for (const ch of ["airbnb", "whatsapp", "web", null]) {
      expect(note(ch), String(ch)).toMatchObject({ copy: true, edit: true, delete: true });
    }
  });

  it("mensagem do hóspede: só Copiar em qualquer canal", () => {
    for (const ch of ["airbnb", "whatsapp", "web", null]) {
      expect(guest(ch), String(ch)).toMatchObject({ copy: true, edit: false, delete: false });
    }
  });

  it("destino normalizado", () => {
    expect(messageDestination(" AIRBNB ")).toBe("airbnb");
    expect(messageDestination("WhatsApp")).toBe("whatsapp");
    expect(messageDestination("web")).toBe("guide");
    expect(messageDestination(null, "whatsapp:1")).toBe("whatsapp");
    expect(messageDestination(undefined, undefined)).toBe("guide");
  });
});

describe("guardas do servidor e da interface (estático)", () => {
  const server = readFileSync("src/lib/handoff.functions.ts", "utf8");
  const ui = readFileSync("src/components/handoff/ConversationView.tsx", "utf8");

  const handler = (name: string) => {
    const start = server.indexOf(`export const ${name}`);
    const next = server.indexOf("export const ", start + 10);
    return server.slice(start, next);
  };

  it("apagar e editar conferem o canal de destino no servidor", () => {
    expect(AIRBNB_IMMUTABLE_ERROR).toBe(
      "Mensagens enviadas ao Airbnb não podem ser excluídas ou editadas.",
    );
    for (const fn of ["editHandoffMessage", "deleteHandoffMessage"]) {
      const body = handler(fn);
      expect(body, fn).toMatch(/requireChatRespondForConversation/);
      expect(body, fn).toMatch(/messageActions\(/);
      expect(body, fn).toMatch(/channel, is_internal_note/);
      // a guarda vem ANTES da escrita
      const guard = body.indexOf("messageActions(");
      const write = body.search(/\.(update|delete)\(/);
      expect(guard, fn).toBeGreaterThan(0);
      expect(guard, fn).toBeLessThan(write);
    }
  });

  it("apagar não exige ser o autor: nenhuma trava por sender_user_id", () => {
    expect(handler("deleteHandoffMessage")).not.toMatch(/sender_user_id/);
  });

  it("a interface usa a mesma regra e não restringe mais ao autor (`mine`)", () => {
    expect(ui).toMatch(/messageActions\(/);
    expect(ui).toMatch(/actionAllowed\.edit &&/);
    expect(ui).toMatch(/actionAllowed\.delete &&/);
    expect(ui).not.toMatch(/mine: !isGuest/);
    expect(ui).not.toMatch(/actionMsg\?\.mine/);
  });
});
