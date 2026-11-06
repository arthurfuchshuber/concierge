import { describe, expect, it } from "vitest";
import {
  BLOCK_MARKER,
  MAX_FINDINGS_BEFORE_BLOCK,
  SECRET_MARKER,
  SECRET_SCRUBBER as G,
  SecretScrubber,
  countByCategory,
  normalizeForScan,
} from "@/lib/guest-ai/secret-scrub";
import { HISTORICAL_SHAPES } from "./helpers/b22-historical-shapes";

const scan = (t: string, previous?: string) => G.scan(t, previous === undefined ? {} : { previous });
function expectClean(text: string, secrets: string[]) {
  const r = scan(text);
  for (const s of secrets) expect(r.text, `"${s}" sobrou em ${JSON.stringify(r.text)}`).not.toContain(s);
  return r;
}

describe("B2.2 · secret-scrub — os 21 casos históricos (valores sintéticos, mesma estrutura)", () => {
  it("são exatamente 21", () => expect(HISTORICAL_SHAPES).toHaveLength(21));
  for (const c of HISTORICAL_SHAPES) {
    it(`#${c.id} (${c.speaker}) ⇒ ${c.expect}: segredo removido e conteúdo legítimo preservado`, () => {
      const r = scan(c.text);
      expect(r.status).toBe(c.expect);
      for (const s of c.secrets) expect(r.text).not.toContain(s);
      for (const k of c.keep) expect(r.text).toContain(k);
      if (c.expect === "sanitized") expect(r.text).toContain(SECRET_MARKER);
      // idempotente: reaplicar não muda nada e dá safe
      expect(scan(r.text)).toEqual({ status: "safe", text: r.text, findings: [] });
    });
  }
});

describe("B2.2 · secret-scrub — matriz por categoria (PT/EN)", () => {
  it.each([
    ["senha simples", "A senha é 4821.", ["4821"], "password"],
    ["senha com dois-pontos e palavra", "Senha: girassol", ["girassol"], "password"],
    ["senha entre crases", "senha `azul1234`", ["azul1234"], "password"],
    ["password EN", "The password is Blue2024!", ["Blue2024!"], "password"],
    ["passcode EN", "passcode: 99881", ["99881"], "password"],
    ["contraseña ES", "La contraseña es 774411", ["774411"], "password"],
    ["PIN", "Seu PIN é 5590", ["5590"], "access_code"],
    ["PIN EN", "Your pin: 1180", ["1180"], "access_code"],
    ["código da fechadura", "O código da fechadura é 9081#", ["9081#"], "access_code"],
    ["código do portão", "código do portão: 4412", ["4412"], "access_code"],
    ["gate code EN", "The gate code is 3321", ["3321"], "access_code"],
    ["door code EN", "door code: 8890#", ["8890#"], "access_code"],
    ["cofre com combinação", "A combinação do cofre é 0412", ["0412"], "password"],
    ["lockbox EN", "lockbox: 2299", ["2299"], "access_code"],
    ["teclado", "No teclado: 7731*", ["7731*"], "access_code"],
    ["área comum", "Código da academia é 6612", ["6612"], "access_code"],
    ["Wi-Fi", "Senha do Wi-Fi: CasaAzul2024", ["CasaAzul2024"], "wifi_secret"],
    ["WiFi EN", "Wifi password: sunnyday77", ["sunnyday77"], "wifi_secret"],
  ])("%s", (_n, text, secrets, category) => {
    const r = expectClean(text, secrets);
    expect(r.status).toBe("sanitized");
    expect(r.findings.map((f) => f.category)).toContain(category);
  });

  it.each([
    ["chave OpenAI", "use sk-proj-AbCdEfGh1234567890XyZ no app", "sk-proj-AbCdEfGh1234567890XyZ"],
    ["chave Stripe", "chave sk_live_51HxYzAbCdEf0123456789", "sk_live_51HxYzAbCdEf0123456789"],
    ["GitHub", "token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"],
    ["Slack", "xoxb-123456789012-AbCdEfGhIjKl", "xoxb-123456789012-AbCdEfGhIjKl"],
    ["AWS", "AKIAIOSFODNN7EXAMPLE é a chave", "AKIAIOSFODNN7EXAMPLE"],
    ["Google API", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "AIzaSyA1234567890abcdefghijklmnopqrstuv"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJhbGciOiJIUzI1NiJ9"],
    ["Bearer", "Authorization: Bearer abcdefghijklmnop1234567890", "abcdefghijklmnop1234567890"],
    ["rótulo token", "token: AbC123xYz789QwE456", "AbC123xYz789QwE456"],
    ["chave de API PT", "chave de api = Zk81Lm02Pq93Rs", "Zk81Lm02Pq93Rs"],
  ])("token/chave: %s", (_n, text, secret) => {
    const r = expectClean(text, [secret]);
    expect(["sanitized", "ambiguous"]).toContain(r.status);
    expect(r.findings.some((f) => f.category === "api_key" || f.category === "token")).toBe(true);
  });

  it("URL com usuário:senha e parâmetros de credencial; o resto da URL fica", () => {
    const r = expectClean("Acesse https://admin:p4ssW0rd@example.com/painel?token=abcDEF123456&lang=pt&sig=XyZ987#access_token=QwErTy123", ["admin:p4ssW0rd", "abcDEF123456", "XyZ987", "QwErTy123"]);
    expect(r.text).toContain("example.com/painel?token=");
    expect(r.text).toContain("lang=pt");
    expect(r.findings.every((f) => f.category === "url_credential")).toBe(true);
  });
  it("URL comum não muda", () => {
    expect(scan("Veja https://www.airbnb.com.br/rooms/123456789?adults=2").status).toBe("safe");
  });
  it("chave privada ⇒ texto inteiro bloqueado", () => {
    const r = scan("segue:\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----");
    expect(r).toEqual({ status: "blocked", text: BLOCK_MARKER, findings: [{ category: "private_key", detector: "structural" }] });
  });
  it("excesso de segredos num texto (despejo de credenciais) ⇒ bloqueado", () => {
    const dump = Array.from({ length: MAX_FINDINGS_BEFORE_BLOCK + 1 }, (_, i) => `apto ${i}: senha ${4000 + i}`).join("\n");
    const r = scan(dump);
    expect(r.status).toBe("blocked");
    expect(r.text).toBe(BLOCK_MARKER);
  });
});

describe("B2.2 · secret-scrub — tentativas de contorno", () => {
  it.each([
    ["zero-width entre dígitos", "senha: 4\u200B8\u200B2\u200B1", "4821"],
    ["soft hyphen", "senha: 48\u00AD21", "4821"],
    ["bidi override", "senha é ‮1284‬", "1284"],
    ["dígitos de largura total", "senha: ４８２１", "４８２１"],
    ["dígitos circulados", "a senha é ①②③④", "①②③④"],
    ["dígitos espaçados", "o código é 4 8 2 1", "4 8 2 1"],
    ["dígitos com hífen", "PIN: 48-21-99", "48-21-99"],
    ["Markdown negrito", "senha **4821**", "4821"],
    ["aspas tipográficas", "a senha é “azul1234”", "azul1234"],
    ["sem espaço após dois-pontos", "senha:4821", "4821"],
    ["maiúsculas", "SENHA DA PORTA: 4821", "4821"],
    ["valor na linha seguinte", "Senha:\n4821\nqualquer dúvida chame", "4821"],
    ["rótulo longe do valor", "A senha temporária do cadeado-cofre no portão de pedestres é 6624.", "6624"],
    ["valor antes do rótulo", "4455 é a senha do portão", "4455"],
    ["valor antes do dispositivo", "use 4455# no portão", "4455#"],
    ["verbo de ação EN", "Enter 9911 on the keypad", "9911"],
  ])("%s", (_n, text, secret) => {
    const r = scan(text);
    expect(r.status).not.toBe("safe");
    expect(normalizeForScan(r.text).normalize("NFKC")).not.toContain(secret.normalize("NFKC"));
    expect(r.text.replace(/\D/g, "")).not.toContain(secret.normalize("NFKC").replace(/\D/g, ""));
  });

  it("credencial dividida entre mensagens: rótulo sem valor + mensagem só com o valor ⇒ removido (ambiguous)", () => {
    expect(scan("4821", "A senha do cofre é")).toMatchObject({ status: "ambiguous", text: SECRET_MARKER });
    expect(scan("**9931**", "Segue o código:")).toMatchObject({ status: "ambiguous" });
    expect(scan("1234#", "O portão abre com o teclado").text).toBe(SECRET_MARKER);
  });
  it("sem contexto de acesso na mensagem anterior, valor isolado não é tocado", () => {
    expect(scan("4821", "Quantos hóspedes?").status).toBe("safe");
    expect(scan("Sim, 3 pessoas", "Qual o código?").status).toBe("safe");
    expect(scan("obrigado!", "A senha do cofre é").status).toBe("safe");
  });
  it("texto longo: segredo no fim de 20 mil caracteres é encontrado, sem perder o resto", () => {
    const filler = "Informação útil sobre o bairro e a estadia. ".repeat(450);
    const r = scan(`${filler}\nA senha do Wi-Fi é Praia2024.`);
    expect(r.text).not.toContain("Praia2024");
    expect(r.text.startsWith(filler.slice(0, 1000))).toBe(true);
  });
  it("desempenho: 200 mil caracteres em menos de 2 s (sem retrocesso catastrófico)", () => {
    const big = "senha senha código porta portão 1234 é é : : ".repeat(4500);
    const t0 = performance.now();
    G.scan(big);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("B2.2 · secret-scrub — preservação (falsos positivos evitados)", () => {
  it.each([
    "Check-in às 15:00 e checkout até 11h.",
    "O check-in é a partir das 15h30.",
    "Valor da diária: R$ 350,00 (10% de desconto).",
    "Apto 1203, 12º andar, bloco B.",
    "Rua das Flores, 1234 - CEP 01234-567.",
    "Telefone da portaria: (11) 98765-4321.",
    "Reserva de 12/11 a 15/11/2026 para 4 hóspedes.",
    "Código da Reserva: HMAB12X4Q",
    "O código de confirmação é HMXK29PQ1.",
    "Código de rastreamento: AB123456789BR",
    "Use o código de desconto VERAO2026 no site.",
    "A rede Wi-Fi é Loft42.",
    "WiFi: CasaAzul",
    "A senha do wifi é a mesma de antes.",
    "A senha está no guia, na aba Acesso.",
    "Esqueci a senha, pode me ajudar?",
    "A porta 3 fica no fim do corredor.",
    "O portão 2 é o de pedestres.",
    "A fechadura tem 4 dígitos.",
    "Sigam pela BR-101 até o km 205.",
    "Temos 2 quartos, 3 camas e 1 banheiro.",
    "Senha: mesma do guia",
  ])("intacto: %s", (text) => {
    const r = scan(text);
    expect(r.status).toBe("safe");
    expect(r.text).toBe(text.normalize("NFC"));
  });
  it("normalização leve preserva o texto legítimo (º, ligaduras, emojis, acentos)", () => {
    const t = "12º andar · ﬁnal · 🔑 chave na portaria · ação";
    expect(scan(t)).toEqual({ status: "safe", text: t, findings: [] });
  });
});

describe("B2.2 · secret-scrub — falsos negativos CONHECIDOS (limitação documentada)", () => {
  it.each([
    ["número por extenso", "a senha é quatro oito dois um"],
    ["leetspeak sem dígito e sem atribuição", "a senha é azulão"],
    ["valor sem nenhum indício", "anota aí: 4821"],
  ])("%s ⇒ hoje não é detectado (registrado no relatório)", (_n, text) => {
    expect(scan(text).status).toBe("safe");
  });
});

describe("B2.2 · secret-scrub — contrato, idempotência e métricas", () => {
  it("marcadores existentes não são corrompidos nem reprocessados", () => {
    const t = `Senha: ${SECRET_MARKER} e ${BLOCK_MARKER}`;
    expect(scan(t)).toEqual({ status: "safe", text: t, findings: [] });
  });
  it("idempotente em toda a matriz: segunda aplicação = mesmo texto, status safe", () => {
    const samples = [...HISTORICAL_SHAPES.map((h) => h.text), "senha: ４８２１", "use 4455# no portão", "https://a:b@x.io?token=zz11", "4455 é a senha do portão"];
    for (const s of samples) {
      const once = scan(s);
      const twice = scan(once.text);
      expect(twice.status, s).toBe("safe");
      expect(twice.text).toBe(once.text);
    }
  });
  it("achados só com categoria e detector (sem valor, trecho ou posição)", () => {
    const r = scan("senha 4821 e token: AbC123xYz789QwE456");
    for (const f of r.findings) expect(Object.keys(f).sort()).toEqual(["category", "detector"]);
    expect(JSON.stringify(r.findings)).not.toMatch(/4821|AbC123/);
    expect(countByCategory(r.findings)).toEqual({ password: 1, api_key: 1 });
  });
  it("entrada não-texto lança (o composer converte em guard_failed; nunca devolve o original)", () => {
    expect(() => G.scan(42 as never)).toThrow(TypeError);
  });
  it("apply = scan().text; instância imutável e sem estado", () => {
    expect(G.apply("senha 4821")).toBe(scan("senha 4821").text);
    expect(Object.isFrozen(G)).toBe(true);
    const a = new SecretScrubber();
    expect(a.scan("senha 4821")).toEqual(new SecretScrubber().scan("senha 4821"));
  });
  it("mensagens de equipe, legadas, descrições e manuais: mesma proteção (fonte não importa)", () => {
    for (const t of [
      "Equipe: o código do cofre é 3344",
      "IA antiga: A senha da porta é 5566",
      "Descrição: ao chegar, digite 7788 no teclado da portaria eletrônica.",
      "Manual da TV: a senha do aplicativo é Netflix2024",
    ]) {
      const r = scan(t);
      expect(r.status, t).toBe("sanitized");
      expect(r.text).not.toMatch(/3344|5566|7788|Netflix2024/);
    }
  });
});

describe("B2.2 · secret-scrub — formatos ampliados de produção (dígitos mascarados, nomes genéricos)", () => {
  const mustSanitize = [
    "Cadeado cofre 7777 ",
    "7777 é a senha do cadeado cofre",
    "A chave fica no **cadeado-cofre nº 77 — o de cima, no portão de pedestres**.\n- **Digite 7777**, alinhando os números ao centro da linha horizontal do cofre.",
    "Boa noite, Ana! A senha temporária do cadeado-cofre do portão, localizado no muro frontal, é 7777.\n\n7. Alinhe os números no centro da linha horizontal do cofre.",
    "No portaozinho de pedestres, haverá dois cadeados. Voce precisará abrir o cadeado de cima com a senha provisória 7777",
    "A senha da fechadura eletrônica é 7777. Para o cadeado-cofre, a combinação será enviada pelo chat. O Wi-Fi utiliza a senha Foz77777.",
  ];
  const mustStay = [
    "Sua entrada (check-in) estará liberada a partir de 77:77 horas.\n\nSenhas e instruções de entrada já estão liberadas em nosso Guia Digital:\n\n🔗 https://conciergeia.app/g/studio777",
    "Estacione em qualquer vaga, **exceto a primeira (nº 7)**, e siga para o **Studio 777**. As chaves e o controle do portão estão no cadeado-cofre ao lado da porta do studio.",
    "A senha pode ser obtida dentro de [Chegada](/g/studio777#checkin) ok?",
    "Para proteger seu acesso, não envio senhas ou códigos pelo chat. Abra [Ver senhas e códigos no guia](/g/studio777#senhas-acesso).",
    "haverá uma abertura de boletim de ocorrência com base nos artigos Art. 777 do Código Penal.",
    "Na saída, a chave fica sob a mesa de jantar do Studio 777, junto com o controle — não no cofre 7.",
    "O studio tem **Wi-Fi**, e a rede é **APT_777**. Para consultar a senha, abra a seção **“Ver senhas e códigos”** no guia.",
    "Vocês vão retirar a chave do apartamento 777 junto a tag que abrirá o portão de pedestre.",
    "Para o Uber, o endereço é R. Ourinhos, 777, bairro Lancaster. O acesso é independente, com a chave guardada no cadeado-cofre situado no muro frontal.",
    "[Foto enviada pelo hóspede — conteúdo: um cofre para chaves (*lockbox*) aberto, fixado em uma parede externa. Em uma das tags, há uma etiqueta adesiva com a inscrição \"777\".]",
  ];
  it.each(mustSanitize)("removido: %s", (t) => {
    const r = scan(t);
    expect(r.status).not.toBe("safe");
    expect(r.text).not.toMatch(/7777|Foz77777/);
  });
  it.each(mustStay)("intacto: %s", (t) => {
    expect(scan(t)).toEqual({ status: "safe", text: t, findings: [] });
  });
});

describe("B2.2 · secret-scrub — exclusões e marcadores forjados", () => {
  it("horários depois de rótulo de acesso não são tratados como código", () => {
    for (const t of ["Código de acesso liberado às 15:00", "Senha do portão: enviada às 14h30", "Código do cofre a partir das 15h"]) {
      const r = scan(t);
      expect(r.text).toMatch(/15:00|14h30|15h/);
    }
  });
  it("números de apartamento, rua ou unidade após o rótulo não são código", () => {
    for (const t of ["Código do portão: apto 1204 tem interfone", "Senha do Wi-Fi: rua 4512 não tem sinal", "Código de acesso: unidade 3307", "O código do portão fica no apto 1204", "Código do interfone na unidade 3307"]) {
      const r = scan(t);
      expect(r.text).toMatch(/1204|4512|3307/);
    }
  });
  it("sentinelas internas forjadas na entrada não protegem um segredo do saneamento", () => {
    const forged = "A senha é \uE0004821\uE001 e o código: 7391";
    const r = scan(forged);
    expect(r.text).not.toMatch(/4821|7391/);
    expect(r.text).not.toMatch(/[\uE000\uE001]/);
  });
});
