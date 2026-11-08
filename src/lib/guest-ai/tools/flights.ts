/**
 * Ferramenta `get_flight_status` — situação REAL de um voo (Etapa 3, 08/11/2026), via AviationStack
 * (`AVIATIONSTACK_API_KEY`). Sem a chave configurada, a ferramenta nem é oferecida ao modelo; se chamada,
 * responde `indisponivel`.
 *
 * - Argumento: código IATA do voo (ex.: "LA3456", "G31234") e, opcional, a data (YYYY-MM-DD).
 * - Devolve situação, companhia, origem/destino (aeroporto IATA) e horários previsto/estimado/real como o
 *   provedor informa (com fuso do aeroporto), atraso em minutos e terminal/portão quando houver.
 * - Sem voo encontrado ⇒ `sem_resultado`. A IA nunca afirma horário de voo sem este retorno.
 */
import type { GuestTool, ToolResult } from "./contracts";

export const FLIGHT_CODE = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FlightArgs {
  flight: string;
  date: string | null;
}

const STATUS: Record<string, string> = {
  scheduled: "programado",
  active: "em voo",
  landed: "pousou",
  cancelled: "cancelado",
  incident: "incidente",
  diverted: "desviado",
};

const str = (v: unknown, max = 80): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export function flightPath(args: FlightArgs): string {
  const q = new URLSearchParams({ flight_iata: args.flight, limit: "3" });
  if (args.date) q.set("flight_date", args.date);
  return `/v1/flights?${q.toString()}`;
}

function leg(x: unknown) {
  const l = (x ?? {}) as Record<string, unknown>;
  return {
    aeroporto: str(l["iata"], 4),
    nome: str(l["airport"]),
    terminal: str(l["terminal"], 10),
    portao: str(l["gate"], 10),
    previsto: str(l["scheduled"], 40),
    estimado: str(l["estimated"], 40),
    real: str(l["actual"], 40),
    atraso_min: int(l["delay"]),
  };
}

export function parseFlights(body: unknown, date: string | null): Array<Record<string, unknown>> {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((f) => !date || (f as Record<string, unknown>)["flight_date"] === date)
    .slice(0, 3)
    .map((f) => {
      const r = f as Record<string, unknown>;
      const status = str(r["flight_status"], 20);
      return {
        data: str(r["flight_date"], 10),
        situacao: status ? (STATUS[status] ?? status) : null,
        companhia: str((r["airline"] as Record<string, unknown> | undefined)?.["name"]),
        voo: str((r["flight"] as Record<string, unknown> | undefined)?.["iata"], 10),
        partida: leg(r["departure"]),
        chegada: leg(r["arrival"]),
      };
    });
}

export const getFlightStatus: GuestTool<FlightArgs> = {
  spec: {
    name: "get_flight_status",
    description:
      "Situação REAL de um voo pelo código IATA (ex.: LA3456): programado, em voo, pousou, cancelado, horários previsto/estimado/real e atraso. Use antes de falar de horário de voo; sem retorno desta consulta, não afirme horário.",
    parameters: {
      type: "object",
      properties: {
        flight_iata: { type: "string", description: "Código IATA do voo, ex.: LA3456." },
        date: { type: "string", description: "Data do voo (YYYY-MM-DD), se o hóspede informou." },
      },
      required: ["flight_iata"],
      additionalProperties: false,
    },
  },
  parse(raw) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return null;
    const code = typeof r["flight_iata"] === "string" ? r["flight_iata"].replace(/[\s-]/g, "").toUpperCase() : "";
    if (!FLIGHT_CODE.test(code)) return null;
    const d = r["date"];
    if (d !== undefined && d !== null && (typeof d !== "string" || !DATE.test(d))) return null;
    return { flight: code, date: typeof d === "string" ? d : null };
  },
  async execute(args, _ctx, deps): Promise<ToolResult> {
    if (!deps.external) return { ok: false, erro: "indisponivel" };
    const res = await deps.external("aviationstack", flightPath(args), { signal: deps.signal });
    if (!res.ok) return { ok: false, erro: "indisponivel" };
    const voos = parseFlights(await res.json(), args.date);
    if (voos.length === 0) return { ok: false, erro: "sem_resultado" };
    return { ok: true, fonte: "aviationstack", resultados: voos };
  },
};
