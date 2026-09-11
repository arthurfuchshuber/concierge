/**
 * O CONTRATO DO ENVIO DE MÍDIA (11/09/2026).
 *
 * Este teste existe por causa de um dia inteiro de auditorias perdidas: o
 * botão "Registrar situação" ficou girando sem nunca liberar, e o motivo era
 * um envio que não resolvia nem rejeitava. As quatro regras abaixo são o que
 * impede aquilo de voltar — e nenhuma delas é visível olhando a tela.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { getSession, refreshSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, refreshSession } },
}));

import { enviarMidia, garantirToken } from "@/lib/media-upload";

type Cenario = { status: number; erroDeRede?: boolean; nuncaResponde?: boolean };

let cenarios: Cenario[] = [];
let chamadas = 0;
const abortadas: FakeXHR[] = [];

class FakeXHR {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private cabecalhos: Record<string, string> = {};
  open() {}
  setRequestHeader(k: string, v: string) {
    this.cabecalhos[k] = v;
  }
  cabecalho(k: string) {
    return this.cabecalhos[k];
  }
  abort() {
    abortadas.push(this);
    this.onabort?.();
  }
  send() {
    const c = cenarios[Math.min(chamadas, cenarios.length - 1)] ?? { status: 200 };
    chamadas += 1;
    registrarUltimo(this);
    if (c.nuncaResponde) return;
    setTimeout(() => {
      if (c.erroDeRede) {
        this.onerror?.();
        return;
      }
      this.status = c.status;
      this.onload?.();
    }, 0);
  }
}
let ultimo: FakeXHR | null = null;
function registrarUltimo(x: FakeXHR) {
  ultimo = x;
}

beforeEach(() => {
  cenarios = [];
  chamadas = 0;
  abortadas.length = 0;
  ultimo = null;
  getSession.mockResolvedValue({
    data: {
      session: { access_token: "tok-123", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    },
  });
  refreshSession.mockResolvedValue({ data: { session: null } });
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = {
  bucket: "reservation-records",
  path: "prop/reserva/arquivo.mp4",
  blob: new Blob(["x"]),
  contentType: "video/mp4",
};

describe("enviarMidia", () => {
  it("envia com o token da pessoa — a política do bucket exige auth.uid()", async () => {
    cenarios = [{ status: 200 }];
    const r = await enviarMidia(base);
    expect(r.ok).toBe(true);
    expect(ultimo?.cabecalho("authorization")).toBe("Bearer tok-123");
  });

  it("sem sessão, para na hora e diz que a sessão expirou — nunca envia anônimo", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: null } });
    const r = await enviarMidia(base);
    expect(r).toMatchObject({ ok: false, motivo: "sessao" });
    expect(chamadas).toBe(0);
  });

  it("erro de rede é tentado de novo — um soluço não pode matar a auditoria", async () => {
    cenarios = [{ status: 0, erroDeRede: true }, { status: 200 }];
    const r = await enviarMidia(base);
    expect(r.ok).toBe(true);
    expect(chamadas).toBe(2);
  });

  it("403 não insiste: é permissão, e repetir não muda nada", async () => {
    cenarios = [{ status: 403 }];
    const r = await enviarMidia(base);
    expect(r).toMatchObject({ ok: false, motivo: "permissao" });
    expect(chamadas).toBe(1);
  });

  it("desiste depois de três tentativas em vez de ficar pendurado", async () => {
    cenarios = [{ status: 500 }];
    const r = await enviarMidia(base);
    expect(r).toMatchObject({ ok: false, motivo: "servidor" });
    expect(chamadas).toBe(3);
  });

  it("cancelar corta o envio pendurado — a pessoa nunca fica presa na tela", async () => {
    cenarios = [{ status: 0, nuncaResponde: true }];
    const ctrl = new AbortController();
    const promessa = enviarMidia({ ...base, signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    const r = await promessa;
    expect(r).toMatchObject({ ok: false, motivo: "cancelado" });
    expect(abortadas.length).toBe(1);
  });
});

describe("garantirToken", () => {
  it("renova quando o token está a menos de um minuto de vencer", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "velho", expires_at: Math.floor(Date.now() / 1000) + 10 } },
    });
    refreshSession.mockResolvedValue({ data: { session: { access_token: "novo" } } });
    await expect(garantirToken()).resolves.toBe("novo");
  });

  it("se a renovação falhar por rede, devolve o token que existe — não desloga", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "velho", expires_at: Math.floor(Date.now() / 1000) + 10 } },
    });
    refreshSession.mockResolvedValue({ data: { session: null } });
    await expect(garantirToken()).resolves.toBe("velho");
  });
});
