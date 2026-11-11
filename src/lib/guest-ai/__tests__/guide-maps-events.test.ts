/**
 * Guia Digital × IA (06/11/2026) — eventos da cidade, recomendações do Google Maps fora do Dossiê, distância por
 * TRAJETO, contexto do item clicado, formatação por canal e refinamento de hospitalidade (fluência, visão,
 * interlocutor, rajadas). Puro / bancos falsos: nada toca a produção.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory, parseGuideContext } from "@/lib/guest-ai/history";
import { SECRET_MARKER, SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import {
  CITY_EVENTS_TAG,
  DOSSIER_TAG,
  HISTORY_TAG,
  buildSystemPrompt,
} from "@/lib/guest-ai/system-prompt";
import { GUEST_PERSONA, renderPersona } from "@/lib/guest-ai/persona";
import { primaryDossierTarget } from "@/lib/guest-ai/data/property-access.server";
import { fetchPropertyDossier } from "@/lib/guest-ai/data/property-dossier.server";
import {
  fetchCityEvents,
  normalizeCityEvents,
  type CityEventsLoad,
} from "@/lib/guest-ai/data/city-events.server";
import { hasNewerGuestMessage } from "@/lib/guest-ai/data/newer-guest-message.server";
import { googleMapsUrl } from "@/lib/guest-ai/dossier/normalize";
import { formatForChannel, unstyleUnicode } from "@/lib/guest-ai/copilot/channel-format";
import { COPILOT_BURST_QUIET_MS } from "@/lib/guest-ai/copilot/contracts";
import { DEBOUNCE_REFERENCE } from "@/lib/guest-ai/batch/message-batch";
import { CREDENTIAL_MARKER } from "@/lib/guest-ai/orchestrator/contracts";
import { issue } from "@/lib/guest-ai/trust";
import type { GuestAiDb } from "@/lib/guest-ai/data/client.server";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { cityNewsItemId, filterUpcoming } from "@/lib/city-news-window";
import { CONV, MSG, conversationContext, row } from "./helpers/b21-fixtures";
import { P1, T1, portfolioDb } from "./helpers/b22-portfolio";

const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", {
    surface: "guide_chat",
    conversationId: CONV,
    messageId: MSG,
    propertyId: P1,
    tenantId: T1,
    guestSessionId: "s",
    conversationStatus: "ai",
    reservationId: "r1",
    messageCreatedAt: "2026-11-06T12:00:00Z",
    ...over,
  }) as ValidatedTurn;
const NOW = () => new Date("2026-11-06T12:00:00Z");
const ctx = (surface: "guide_chat" | "airbnb" | "whatsapp" = "guide_chat") =>
  conversationContext({
    interlocutor: { guestId: "s", conversationId: CONV, messageId: MSG, surface, guestName: null },
    property: {
      id: P1,
      tenantId: T1,
      name: "Flat",
      timezone: "America/Sao_Paulo",
      listingFacts: null,
      dossierKnowledge: null,
    },
  });
const block = (user: string, tag: string) => {
  const open = user.indexOf(`<${tag}`);
  if (open < 0) return null;
  return JSON.parse(user.slice(user.indexOf("\n", open) + 1, user.indexOf(`</${tag}>`)).trim());
};
const history = (rows = [row({ id: MSG, content: "Tem padaria perto?" })]) =>
  normalizeHistory(rows, { conversationId: CONV, currentMessageId: MSG });
const dossier = async () => ({
  primary: await fetchPropertyDossier(primaryDossierTarget(turn(), ["P", "G"]), {
    db: portfolioDb().db,
    now: NOW,
    buildPlaybook: buildPlaybook as never,
  }),
});

// ─────────────────────────── eventos da cidade (Pilar 1) ───────────────────────────

const ITEMS = [
  {
    title: "Festival de Jazz",
    category: "evento",
    startDate: "2026-11-07",
    endDate: "2026-11-08",
    venue: "Praça Central",
    summary: "Shows gratuitos.",
  },
  {
    title: "Feira antiga",
    category: "evento",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    venue: "Centro",
  },
  { title: "Evento sem data", category: "evento" },
  { title: "Restaurante do Porto", category: "gastronomia", summary: "Frutos do mar." },
  { title: "  ", category: "evento", startDate: "2026-11-07" },
];

describe("eventos da Home do guia para a IA", () => {
  it("mesma janela do feed público: só o que a Home pode mostrar; id estável igual ao do guia", () => {
    const out = normalizeCityEvents(ITEMS, "2026-11-06");
    expect(out.map((e) => e.title)).toEqual(["Festival de Jazz", "Restaurante do Porto"]);
    expect(out[0]).toEqual({
      id: cityNewsItemId(ITEMS[0]!),
      title: "Festival de Jazz",
      category: "evento",
      startDate: "2026-11-07",
      endDate: "2026-11-08",
      venue: "Praça Central",
      summary: "Shows gratuitos.",
    });
    expect(filterUpcoming(ITEMS, "2026-11-06").map((x) => x.title)).toContain("Festival de Jazz");
    expect(cityNewsItemId({ title: "festival  de JAZZ", startDate: "2026-11-07" })).toBe(
      cityNewsItemId(ITEMS[0]!),
    );
    expect(cityNewsItemId(ITEMS[0]!)).toMatch(/^evt-[0-9a-f]{8}$/);
  });

  function newsDb(
    over: {
      prop?: Record<string, unknown> | null;
      edition?: Record<string, unknown> | null;
      fail?: boolean;
    } = {},
  ) {
    const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
    const db = {
      from(table: string) {
        const st = { table, filters: [] as Array<[string, unknown]> };
        calls.push(st);
        const q: Record<string, unknown> = {
          select: () => q,
          abortSignal: () => q,
          eq: (k: string, v: unknown) => (st.filters.push([k, v]), q),
          gte: (k: string, v: unknown) => (st.filters.push([`${k}>=`, v]), q),
          lte: (k: string, v: unknown) => (st.filters.push([`${k}<=`, v]), q),
          order: () => q,
          limit: () => q,
          maybeSingle: async () =>
            over.fail
              ? { data: null, error: { message: "x" } }
              : table === "properties"
                ? {
                    data:
                      over.prop === undefined
                        ? { id: P1, owner_id: T1, city: "Florianópolis", country: "Brasil" }
                        : over.prop,
                    error: null,
                  }
                : {
                    data:
                      over.edition === undefined
                        ? { items: ITEMS, date: "2026-11-05" }
                        : over.edition,
                    error: null,
                  },
        };
        return q;
      },
    } as unknown as GuestAiDb;
    return { db, calls };
  }

  it("cidade SEMPRE do imóvel do turno (posse conferida); edição dos últimos 8 dias, por chave da cidade", async () => {
    const { db, calls } = newsDb();
    const r = await fetchCityEvents(turn(), { db, now: new Date("2026-11-06T15:00:00Z") });
    expect(r.status).toBe("available");
    if (r.status === "available")
      expect(r.items.map((e) => e.title)).toEqual(["Festival de Jazz", "Restaurante do Porto"]);
    expect(calls[0]!.filters).toEqual([["id", P1]]);
    expect(calls[1]!.filters).toEqual([
      ["city_key", "florianopolis"],
      ["date>=", "2026-10-29"],
      ["date<=", "2026-11-06"],
    ]);
  });

  it("dono diferente, sem cidade, sem fuso comprovado, sem edição ou falha ⇒ indisponível (nunca inventa)", async () => {
    expect(
      await fetchCityEvents(turn(), {
        db: newsDb({ prop: { id: P1, owner_id: "outro", city: "Florianópolis" } }).db,
      }),
    ).toEqual({ status: "unavailable", reason: "lookup_failed" });
    expect(
      await fetchCityEvents(turn(), {
        db: newsDb({ prop: { id: P1, owner_id: T1, city: null } }).db,
      }),
    ).toEqual({ status: "unavailable", reason: "no_city" });
    expect(
      await fetchCityEvents(turn(), {
        db: newsDb({
          prop: { id: P1, owner_id: T1, city: "Cidade Inexistente XYZ", country: "Atlântida" },
        }).db,
      }),
    ).toEqual({ status: "unavailable", reason: "no_timezone" });
    expect(await fetchCityEvents(turn(), { db: newsDb({ edition: null }).db })).toEqual({
      status: "unavailable",
      reason: "no_edition",
    });
    expect(await fetchCityEvents(turn(), { db: newsDb({ fail: true }).db })).toEqual({
      status: "unavailable",
      reason: "lookup_failed",
    });
  });
});

// ─────────────────────────── composição: blocos novos ───────────────────────────

const EVENTS: CityEventsLoad = {
  status: "available",
  city: "Florianópolis",
  today: "2026-11-06",
  items: normalizeCityEvents(ITEMS, "2026-11-06"),
};

describe("composição: recomendações fora do Dossiê, distância por trajeto, eventos", () => {
  it("o Explorar do anfitrião não entra no prompt (07/11/2026): nem no Dossiê nem em bloco próprio", async () => {
    for (const surface of ["guide_chat", "airbnb", "whatsapp"] as const) {
      const r = composeTurnPrompt(
        { context: ctx(surface), history: history(), dossiers: await dossier(), cityEvents: EVENTS },
        { guard: SECRET_SCRUBBER },
      );
      if (r.kind !== "prompt") throw new Error(r.kind);
      const user = r.prompt.messages[0]!.content;
      expect(JSON.stringify(block(user, DOSSIER_TAG))).not.toMatch(/Padaria P1|Mirante P1|entorno/);
      expect(user).not.toMatch(/recomendacoes_google_maps|Padaria P1|Mirante P1|distancia_trajeto_m|link_google_maps/);
      expect([...r.prompt.sourceIds!].filter((x) => x.startsWith("gm:"))).toEqual([]);
      expect(r.manifest.unavailableSections).not.toContain("guide_places");
    }
  });

  it("eventos: título, datas, local e descrição; ids citáveis; indisponível é declarado", async () => {
    const r = composeTurnPrompt(
      { context: ctx(), history: history(), cityEvents: EVENTS },
      { guard: SECRET_SCRUBBER },
    );
    if (r.kind !== "prompt") throw new Error(r.kind);
    const ev = block(r.prompt.messages[0]!.content, CITY_EVENTS_TAG);
    expect(ev.status).toBe("disponivel");
    expect(ev.itens[0]).toEqual({
      id: `evt:${cityNewsItemId(ITEMS[0]!)}`,
      titulo: "Festival de Jazz",
      categoria: "evento",
      inicio: "2026-11-07",
      fim: "2026-11-08",
      local: "Praça Central",
      descricao: "Shows gratuitos.",
    });
    expect(r.prompt.sourceIds!.has(`evt:${cityNewsItemId(ITEMS[0]!)}`)).toBe(true);
    const off = composeTurnPrompt(
      {
        context: ctx(),
        history: history(),
        cityEvents: { status: "unavailable", reason: "no_edition" },
      },
      { guard: SECRET_SCRUBBER },
    );
    if (off.kind !== "prompt") throw new Error(off.kind);
    expect(block(off.prompt.messages[0]!.content, CITY_EVENTS_TAG)).toEqual({
      status: "indisponivel",
      motivo: "no_edition",
    });
    const none = composeTurnPrompt(
      { context: ctx(), history: history() },
      { guard: SECRET_SCRUBBER },
    );
    if (none.kind !== "prompt") throw new Error(none.kind);
    expect(none.prompt.messages[0]!.content).not.toContain(`<${CITY_EVENTS_TAG}`);
  });

  it("texto externo dos eventos passa pelo guard (segredo plantado não chega ao modelo)", () => {
    const planted: CityEventsLoad = {
      ...EVENTS,
      items: [
        {
          ...(EVENTS.status === "available" ? EVENTS.items[0]! : (null as never)),
          summary: "A senha da porta é 4821, entre pelo portão.",
        },
      ],
    };
    const r = composeTurnPrompt(
      { context: ctx(), history: history(), cityEvents: planted },
      { guard: SECRET_SCRUBBER },
    );
    if (r.kind === "prompt") {
      expect(r.prompt.messages[0]!.content).not.toContain("4821");
      expect(r.prompt.messages[0]!.content).toContain(SECRET_MARKER);
    } else expect(r.kind).toBe("unavailable");
  });

  it("contexto do item do guia na mensagem do hóspede, com os ids dos blocos", () => {
    const evId = cityNewsItemId(ITEMS[0]!);
    const h = history([
      row({
        id: MSG,
        content: 'Me conta mais sobre "Festival de Jazz".',
        guide_context: {
          kind: "city_event",
          id: evId,
          name: "Festival de Jazz",
          type: "evento",
          category: "evento",
        },
      }),
    ]);
    const r = composeTurnPrompt(
      { context: ctx(), history: h, cityEvents: EVENTS },
      { guard: SECRET_SCRUBBER },
    );
    if (r.kind !== "prompt") throw new Error(r.kind);
    const hist = block(r.prompt.messages[0]!.content, HISTORY_TAG);
    expect(hist.at(-1).contexto_do_guia).toEqual({
      tipo: "evento_da_cidade",
      id: `evt:${evId}`,
      nome: "Festival de Jazz",
      categoria: "evento",
    });
    // recomendação do Explorar nunca vira contexto (o Explorar não abre o chat)
    const h2 = history([
      row({
        id: MSG,
        content: "E essa padaria?",
        guide_context: { kind: "place", id: "rec:rec-1", name: "Padaria P1" },
      }),
    ]);
    const r2 = composeTurnPrompt({ context: ctx(), history: h2 }, { guard: SECRET_SCRUBBER });
    if (r2.kind !== "prompt") throw new Error(r2.kind);
    expect(block(r2.prompt.messages[0]!.content, HISTORY_TAG).at(-1)).not.toHaveProperty(
      "contexto_do_guia",
    );
  });

  it("forma fechada do contexto do guia; mensagem da equipe nunca carrega contexto", () => {
    expect(
      parseGuideContext({
        kind: "city_event",
        id: "evt-0a1b2c3d",
        name: "X",
        type: null,
        category: null,
      }),
    ).toEqual({ kind: "city_event", id: "evt-0a1b2c3d", name: "X", type: null, category: null });
    expect(parseGuideContext({ kind: "place", id: "rec:abc", name: "X" })).toBeNull();
    expect(parseGuideContext({ kind: "outro", id: "x", name: "X" })).toBeNull();
    expect(parseGuideContext({ kind: "city_event", id: "evt abc <script>", name: "X" })).toBeNull();
    expect(parseGuideContext("texto")).toBeNull();
    const h = normalizeHistory(
      [
        row({
          role: "assistant",
          sender_type: "human",
          guide_context: { kind: "city_event", id: "evt-0a1b2c3d", name: "X" },
        }),
        row({ id: MSG }),
      ],
      { conversationId: CONV, currentMessageId: MSG },
    );
    if (h.status !== "available") throw new Error("x");
    expect(h.entries[0]!.guideContext).toBeUndefined();
  });

  it("rajada aparente (mensagens seguidas do hóspede) vira um único turno no prompt", () => {
    const a = "00000000-0000-4000-8000-0000000000a1";
    const b = "00000000-0000-4000-8000-0000000000a2";
    const rows = [
      row({
        role: "assistant",
        sender_type: "human",
        content: "Bem-vindos!",
        created_at: "2026-11-06T11:00:00Z",
      }),
      row({ id: a, content: "Oi", created_at: "2026-11-06T11:59:50Z" }),
      row({ id: b, content: "Tudo bem?", created_at: "2026-11-06T11:59:53Z" }),
      row({ id: MSG, content: "Qual o horário do check-out?", created_at: "2026-11-06T11:59:56Z" }),
    ];
    const r = composeTurnPrompt(
      { context: ctx(), history: history(rows) },
      { guard: SECRET_SCRUBBER },
    );
    if (r.kind !== "prompt") throw new Error(r.kind);
    const user = r.prompt.messages[0]!.content;
    const hist = block(user, HISTORY_TAG);
    expect(
      hist
        .filter((x: { lote_atual?: boolean }) => x.lote_atual)
        .map((x: { texto: string }) => x.texto),
    ).toEqual(["Oi", "Tudo bem?", "Qual o horário do check-out?"]);
    expect(user).toMatch(/formam um único turno/);
    // uma mensagem só ⇒ nada de lote
    const one = composeTurnPrompt(
      { context: ctx(), history: history() },
      { guard: SECRET_SCRUBBER },
    );
    if (one.kind !== "prompt") throw new Error(one.kind);
    expect(one.prompt.messages[0]!.content).not.toMatch(/lote_atual/);
  });
});

describe("link do Google Maps: só hosts oficiais", () => {
  it("aceita Maps; recusa outro host, http, credencial na URL e google.com fora de /maps", () => {
    expect(googleMapsUrl("https://maps.google.com/?cid=1")).toBe("https://maps.google.com/?cid=1");
    expect(googleMapsUrl("https://www.google.com/maps/place/?q=place_id:x")).toContain(
      "/maps/place",
    );
    expect(googleMapsUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(googleMapsUrl("http://maps.google.com/?cid=1")).toBeNull();
    expect(googleMapsUrl("https://evil.example.com/maps")).toBeNull();
    expect(googleMapsUrl("https://user:pw@maps.google.com/")).toBeNull();
    expect(googleMapsUrl("https://www.google.com/search?q=x")).toBeNull();
    expect(googleMapsUrl(null)).toBeNull();
  });
});

// ─────────────────────────── formatação por canal (Pilar 3) ───────────────────────────

describe("formatação por canal", () => {
  it("letras estilizadas (Unicode matemático / largura total) voltam a caracteres comuns", () => {
    expect(unstyleUnicode("𝐎𝐥𝐚́ 𝘤𝘰𝘮𝘰 ｖａｉ")).toBe("Olá como vai");
  });

  it("Airbnb: sem links, sem Markdown, sem tabelas e sem marcadores; quebras de linha simples", () => {
    const t = formatForChannel(
      "## Dicas\n\n**Padaria P1** fica a cerca de 350 metros.\n\nVeja: https://maps.google.com/?cid=1\n\n- Abre às 6h\n- [Mapa](https://maps.google.com/?cid=1)\n\n| Lugar | Nota |\n|---|---|\n| Padaria | 4,7 |\n\n\n\n𝐀𝐭𝐞́ 𝐥𝐨𝐠𝐨",
      "airbnb",
    );
    expect(t).not.toMatch(/https?:|www\.|\*\*|##|\||\[|\]|^- /m);
    expect(t).toContain("Padaria P1 fica a cerca de 350 metros.");
    expect(t).toContain("Abre às 6h");
    expect(t).toContain("Padaria – 4,7");
    expect(t).toContain("Até logo");
    expect(t).not.toMatch(/\n{3,}/);
  });

  it("WhatsApp: negrito nativo leve; ** vira *; link em colchetes vira texto: url", () => {
    expect(
      formatForChannel(
        "**Padaria P1** é ótima. [Mapa](https://maps.google.com/?cid=1)",
        "whatsapp",
      ),
    ).toBe("*Padaria P1* é ótima. Mapa: https://maps.google.com/?cid=1");
    expect(formatForChannel("Fica *perto*.", "whatsapp")).toBe("Fica *perto*.");
  });

  it("Guia: texto limpo, sem Markdown; marcador de credenciais intacto em todos os canais", () => {
    expect(formatForChannel("**Oi!** Aqui está:\n\n" + CREDENTIAL_MARKER, "guide_chat")).toBe(
      "Oi! Aqui está:\n\n" + CREDENTIAL_MARKER,
    );
    for (const ch of ["airbnb", "whatsapp", "guide_chat"])
      expect(formatForChannel(`Senha: ${CREDENTIAL_MARKER}`, ch)).toContain(CREDENTIAL_MARKER);
    expect(formatForChannel("", "airbnb")).toBe("");
  });

  it("a sugestão do Copiloto passa pela formatação do canal", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "copilot", "generate.server.ts"),
      "utf8",
    );
    expect(src).toMatch(/text: formatForChannel\(stripRoboticAck\(outcome\.text\), extra\.surface\)/);
  });
});

// ─────────────────────────── prompts (Pilares 1–3 + refinamento) ───────────────────────────

describe("System Prompt e persona: Google Maps, distância, eventos, formatação e hospitalidade", () => {
  const sys = buildSystemPrompt("guide_chat");
  it("lugares: conhecimento amplo + consultas em tempo real, refletindo a fonte; Explorar fora", () => {
    expect(sys).not.toContain("recomendacoes_google_maps");
    expect(sys).toMatch(/Google Maps \/ Google Meu Negócio/);
    expect(sys).toMatch(/nota no Google com o total de avaliações quando constar e se está aberto agora/);
    expect(sys).toMatch(/O dossiê descreve só o imóvel/);
  });
  it("distância só do trajeto real consultado; tempo nunca escrito", () => {
    expect(sys).toMatch(/informe sempre a distância física do trajeto/);
    expect(sys).toMatch(/usando somente distancia_m \(ou distancia_texto\) devolvida pelas consultas/);
    expect(sys).toMatch(/Quando a consulta não trouxer distância .* não informe distância nenhuma/);
    expect(sys).toMatch(/Nunca calcule nem estime distância por conta própria/);
    expect(sys).toMatch(/Tempo de deslocamento: não ofereça por iniciativa própria/);
    expect(sys).toMatch(/varia com o trânsito, os semáforos, o horário e o ritmo da caminhada/);
    expect(sys).toMatch(/Nunca escreva minutos ou horas de deslocamento/);
  });
  it("eventos só do bloco; desconhecido ⇒ admite que não sabe", () => {
    expect(sys).toContain(`<${CITY_EVENTS_TAG}>`);
    expect(sys).toMatch(/diga com franqueza que não tem informações sobre ele/);
    expect(sys).toMatch(/contexto_do_guia/);
  });
  it("estrutura arejada e sem letras estilizadas em qualquer canal", () => {
    for (const ch of ["airbnb", "whatsapp", "guide_chat"] as const) {
      const s = buildSystemPrompt(ch);
      expect(s).toMatch(/parágrafos curtos e objetivos/);
      expect(s).toMatch(/nunca use letras estilizadas/);
    }
  });
  it("mapas nunca justificam revelar credenciais", () => {
    expect(sys).toMatch(/Mapas e rotas nunca justificam revelar senhas/);
  });
  it("refinamento: sem saudação repetida, sem ping-pong, visão natural, avarias com urgência alta e sem culpa", () => {
    expect(sys).toMatch(/não reabra a resposta com 'Olá', 'Oi de novo'/);
    expect(sys).toMatch(/Resolva por completo em uma resposta/);
    expect(sys).toMatch(
      /Nunca diga que recebeu a foto, a imagem ou o vídeo, nem agradeça pelo envio/,
    );
    // 11/11/2026: urgência pela gravidade (high em risco real ou comodidade essencial inutilizável)
    expect(sys).toMatch(/strategy answer_and_handoff, handoff\.needed true, handoff\.urgency pela gravidade \(high em risco real/);
    expect(sys).toMatch(/nunca assuma culpa ou responsabilidade formal/);
    expect(sys).toMatch(/nunca prometa prazos de terceiros/);
    expect(sys).toMatch(/Chame a pessoa pelo nome de quem está escrevendo agora/);
    const persona = renderPersona(GUEST_PERSONA);
    expect(persona).toMatch(/não confirme o recebimento de mensagens, fotos ou áudios/);
    expect(persona).toMatch(/parágrafos curtos, com quebras de linha naturais/);
  });
  it("o cabeçalho das fotos para o modelo também pede resposta natural", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "copilot", "generator.server.ts"),
      "utf8",
    );
    expect(src).toMatch(/sem dizer que recebeu a imagem nem agradecer pelo envio/);
  });
});

// ─────────────────────────── rajadas (Pilar 4 do refinamento) ───────────────────────────

describe("rajadas: respiro de 5–8 s e uma resposta só", () => {
  it("janela do Copiloto dentro da faixa de referência", () => {
    expect(COPILOT_BURST_QUIET_MS).toBeGreaterThanOrEqual(5_000);
    expect(COPILOT_BURST_QUIET_MS).toBeLessThanOrEqual(8_000);
    expect(DEBOUNCE_REFERENCE).toEqual({
      quietWindowMs: 6_000,
      minQuietWindowMs: 5_000,
      maxQuietWindowMs: 8_000,
    });
  });

  function msgDb(rows: Array<Record<string, unknown>> | null) {
    const filters: Array<[string, string, unknown]> = [];
    const db = {
      from() {
        const q: Record<string, unknown> = {
          select: () => q,
          abortSignal: () => q,
          eq: (k: string, v: unknown) => (filters.push(["eq", k, v]), q),
          gt: (k: string, v: unknown) => (filters.push(["gt", k, v]), q),
          neq: (k: string, v: unknown) => (filters.push(["neq", k, v]), q),
          limit: async () =>
            rows === null ? { data: null, error: { message: "x" } } : { data: rows, error: null },
        };
        return q;
      },
    } as unknown as GuestAiDb;
    return { db, filters };
  }

  it("mensagem mais nova do hóspede na mesma conversa ⇒ `newer`; nenhuma ⇒ `none`; falha ⇒ `unknown`", async () => {
    const a = msgDb([{ id: "x" }]);
    expect(await hasNewerGuestMessage(turn(), { db: a.db })).toBe("newer");
    expect(a.filters).toEqual([
      ["eq", "conversation_id", CONV],
      ["eq", "role", "user"],
      ["eq", "sender_type", "guest"],
      ["eq", "is_internal_note", false],
      ["gt", "created_at", "2026-11-06T12:00:00Z"],
      ["neq", "id", MSG],
    ]);
    expect(await hasNewerGuestMessage(turn(), { db: msgDb([]).db })).toBe("none");
    expect(await hasNewerGuestMessage(turn(), { db: msgDb(null).db })).toBe("unknown");
    expect(
      await hasNewerGuestMessage(turn({ messageCreatedAt: null }), { db: msgDb([{ id: "x" }]).db }),
    ).toBe("unknown");
  });
});
