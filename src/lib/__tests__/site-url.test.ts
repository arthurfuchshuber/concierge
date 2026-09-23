/**
 * O redirecionamento do endereço antigo, sob teste.
 *
 * Pedido (11/09/2026): "eu quero desligar [o domínio antigo], mas garantindo
 * que o redirecionamento do link antigo para o link novo funcionará
 * perfeitamente".
 *
 * "Perfeitamente" aqui tem significado preciso, e é isto que cada caso abaixo
 * trava: o caminho não pode se perder, a query não pode se perder, o método
 * não pode virar outro, e nenhum endereço que NÃO seja o antigo pode ser
 * redirecionado por engano — um redirecionamento largo demais derrubaria a
 * prévia do Lovable e o ambiente local junto.
 */
import { describe, it, expect } from "vitest";
import { SITE_ORIGIN, guideUrl, legacyHostRedirect } from "@/lib/site-url";

const ANTIGO = "https://guia.anfitriaosigma.com.br";

describe("endereço do sistema", () => {
  it("tem uma origem única e sem barra no fim", () => {
    expect(SITE_ORIGIN).toBe("https://conciergeia.app");
  });

  it("monta o link do guia a partir do slug", () => {
    expect(guideUrl("studio105")).toBe("https://conciergeia.app/g/studio105");
    expect(guideUrl("studio105", "#senhas-acesso")).toBe(
      "https://conciergeia.app/g/studio105#senhas-acesso",
    );
    expect(guideUrl("studio105", "/explorar")).toBe("https://conciergeia.app/g/studio105/explorar");
  });
});

describe("redirecionamento do endereço antigo", () => {
  it("leva o guia para o mesmo caminho no endereço novo", () => {
    const r = legacyHostRedirect(new Request(`${ANTIGO}/g/studio105`));
    expect(r?.status).toBe(301);
    expect(r?.headers.get("location")).toBe("https://conciergeia.app/g/studio105");
  });

  it("preserva a query — link de prévia e rastreio continuam valendo", () => {
    const r = legacyHostRedirect(new Request(`${ANTIGO}/g/studio105/explorar?preview=1&t=abc`));
    expect(r?.headers.get("location")).toBe(
      "https://conciergeia.app/g/studio105/explorar?preview=1&t=abc",
    );
  });

  it("a raiz vai para a raiz", () => {
    expect(legacyHostRedirect(new Request(`${ANTIGO}/`))?.headers.get("location")).toBe(
      "https://conciergeia.app/",
    );
  });

  it("usa 308 fora de GET/HEAD, para o corpo do POST não se perder", () => {
    const r = legacyHostRedirect(
      new Request(`${ANTIGO}/api/public/guest-push`, { method: "POST" }),
    );
    expect(r?.status).toBe(308);
  });

  it("respeita o host repassado pelo proxy", () => {
    const r = legacyHostRedirect(
      new Request("https://interno.exemplo/g/studio105", {
        headers: { "x-forwarded-host": "guia.anfitriaosigma.com.br" },
      }),
    );
    expect(r?.headers.get("location")).toBe("https://conciergeia.app/g/studio105");
  });

  it("NÃO redireciona o próprio endereço novo (evita laço infinito)", () => {
    expect(legacyHostRedirect(new Request("https://conciergeia.app/g/studio105"))).toBeNull();
  });

  it("NÃO redireciona a prévia do Lovable nem o ambiente local", () => {
    expect(
      legacyHostRedirect(
        new Request("https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/g/x"),
      ),
    ).toBeNull();
    expect(legacyHostRedirect(new Request("https://c6a061b9.lovableproject.com/admin"))).toBeNull();
    expect(legacyHostRedirect(new Request("http://localhost:8080/admin"))).toBeNull();
  });
});
