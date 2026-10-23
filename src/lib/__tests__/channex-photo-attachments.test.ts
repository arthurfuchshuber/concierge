import { afterEach, describe, expect, it } from "vitest";
import { channexBase, isChannexUrl, parseAttachments, parseChannexMessage } from "@/lib/channex-messages.server";

const REL = "attachments/thread-1/msg-1/abc.jpeg";

describe("anexos da Channex (foto sem texto)", () => {
  afterEach(() => {
    delete process.env["CHANNEX_ENV"];
  });

  it("webhook real: message null + have_attachment + caminho relativo vira mensagem válida", () => {
    const m = parseChannexMessage({
      payload: {
        id: "m1",
        message: null,
        sender: "guest",
        have_attachment: true,
        attachments: [REL],
        message_thread_id: "thread-1",
        booking_id: "b1",
      },
    });
    expect(m).not.toBeNull();
    expect(m!.text).toBe("");
    expect(m!.attachments).toEqual([`https://app.channex.io/api/v1/${REL}`]);
    expect(m!.threadId).toBe("thread-1");
  });

  it("staging usa a base de staging", () => {
    process.env["CHANNEX_ENV"] = "staging";
    expect(channexBase()).toBe("https://staging.channex.io/api/v1");
    expect(parseAttachments([REL])).toEqual([`https://staging.channex.io/api/v1/${REL}`]);
  });

  it("aceita barra inicial, objeto {url} e mantém URLs absolutas; ignora lixo", () => {
    expect(parseAttachments([`/${REL}`])).toEqual([`https://app.channex.io/api/v1/${REL}`]);
    expect(parseAttachments([{ url: REL }])).toEqual([`https://app.channex.io/api/v1/${REL}`]);
    expect(parseAttachments(["https://cdn.exemplo.com/a.jpg", "javascript:alert(1)", "", "qualquer/coisa.png"])).toEqual([
      "https://cdn.exemplo.com/a.jpg",
    ]);
  });

  it("have_attachment sem caminho utilizável ainda não descarta a mensagem", () => {
    const m = parseChannexMessage({ payload: { id: "m2", message: null, have_attachment: true, attachments: [], message_thread_id: "t" } });
    expect(m).not.toBeNull();
    expect(m!.haveAttachment).toBe(true);
    expect(m!.attachments).toEqual([]);
  });

  it("sem texto e sem anexo continua sendo descartada", () => {
    expect(parseChannexMessage({ payload: { id: "m3", message: null, message_thread_id: "t" } })).toBeNull();
  });

  it("só URLs da Channex recebem a chave de API", () => {
    expect(isChannexUrl(`https://app.channex.io/api/v1/${REL}`)).toBe(true);
    expect(isChannexUrl(`https://staging.channex.io/api/v1/${REL}`)).toBe(true);
    expect(isChannexUrl("https://evil.com/channex.io/x.jpg")).toBe(false);
    expect(isChannexUrl("https://channex.io.evil.com/x.jpg")).toBe(false);
  });
});
