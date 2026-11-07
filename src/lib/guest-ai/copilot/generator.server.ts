/**
 * COPILOTO — gerador que liga a cadeia (`runTurnChain`) ao Lovable AI Gateway (`generateGuestLlm`, F2-A).
 *
 * Terceiro (e único novo) chamador do Gateway, ao lado do Orchestrator e do gerador Shadow (o teste
 * `data-boundary` fixa a lista). Reaproveita integralmente o Gateway existente: timeout (≤ 15 s), nova
 * tentativa, classificação dos 17 erros, JSON validado e bloqueio de valores proibidos. Aqui só se somam
 * as regras do Copiloto:
 *  - UMA chamada por geração (a repetição interna é do Gateway e já está no orçamento);
 *  - custo POR TURNO limitado ANTES da rede (limite superior de tokens de entrada em bytes + teto de saída);
 *  - verificação `beforeNetwork` imediatamente antes da chamada (a sugestão ainda é a vigente? não foi
 *    substituída por mensagem mais nova do hóspede?) — se não, nada sai para a rede;
 *  - prazo = o que RESTA do prazo global (nenhuma etapa ganha relógio próprio).
 * Nunca devolve texto de erro do provedor: só códigos fechados (`CopilotGeneratorStop`).
 */
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import type {
  LlmContentPart,
  LlmErrorCode,
  LlmMessage,
  ReasoningEffort,
} from "@/lib/guest-ai/llm/contracts";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import { COPILOT_MAX_TURN_COST_USD } from "./contracts";

export type CopilotGeneratorStopCode =
  | "generator_reused"
  | "deadline_expired"
  | "superseded"
  | "budget_turn_exceeded"
  | "model_unregistered"
  | "gateway_failed";

export class CopilotGeneratorStop extends Error {
  constructor(readonly code: CopilotGeneratorStopCode) {
    super(code);
    this.name = "CopilotGeneratorStop";
  }
}

export interface CopilotGeneratorTelemetry {
  readonly status: "idle" | "blocked" | "called" | "failed";
  readonly blockCode: CopilotGeneratorStopCode | null;
  readonly estimatedInputTokens: number | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly error: LlmErrorCode | null;
  /** Fotos do hóspede enviadas ao modelo nesta chamada. */
  readonly imagesSent: number;
  /** Fotos que não foram ao modelo (falha de leitura, formato, tamanho ou orçamento do turno). */
  readonly imagesNotLoaded: number;
  /** Esforço de raciocínio enviado (`auto` no Copiloto); ausente antes da chamada. */
  readonly reasoningEffort?: ReasoningEffort;
  /** Teto de saída efetivo da chamada (cheio ou recuo, sempre dentro do teto de custo do turno). */
  readonly maxOutputTokens?: number;
  /** Modelo que de fato respondeu (o Reserva, se o Titular caiu). Ausente antes da chamada. */
  readonly model?: string;
}

/** Foto do hóspede já preparada (Data URL) pela camada de dados, com o id citável do histórico. */
export interface CopilotVisionImage {
  ref: string | null;
  at: string | null;
  dataUrl: string;
  tokenBound: number;
}
export interface CopilotVisionInput {
  /** Da mais recente para a mais antiga. */
  images: readonly CopilotVisionImage[];
  /** Fotos que não puderam ser carregadas (viram o aviso `[imagem não carregada]`). */
  failed: ReadonlyArray<{ ref: string | null; at: string | null }>;
}
export const NO_VISION: CopilotVisionInput = Object.freeze({ images: [], failed: [] });

/** Aviso literal quando uma foto não vai ao modelo. */
export const IMAGE_NOT_LOADED = "[imagem não carregada]";

export const VISION_HEADER =
  "Fotos enviadas pelo hóspede nesta conversa (da mais recente para a mais antiga), anexadas abaixo. " +
  "Use apenas o que estiver claramente visível; não invente detalhes. Responda ao que a foto mostra na sequência " +
  "natural da conversa, sem dizer que recebeu a imagem nem agradecer pelo envio. Nunca repita códigos, senhas ou números " +
  "de acesso que apareçam nas fotos.";

const visionLabel = (i: { ref: string | null; at: string | null }) =>
  `mensagem ${i.ref ?? "sem referência"}${i.at ? ` (${i.at})` : ""}`;

export interface CopilotGenerator {
  readonly modelId: string;
  generate(prompt: ComposedPrompt, signal: AbortSignal): Promise<string>;
  telemetry(): CopilotGeneratorTelemetry;
}

export interface CopilotGeneratorDeps {
  modelId: string;
  maxOutputTokens: number;
  /** Esforço de raciocínio enviado ao Gateway (o Copiloto usa `auto`: o modelo dosa sozinho). */
  reasoningEffort: ReasoningEffort;
  /**
   * Recuo do teto de saída: se `maxOutputTokens` não couber no teto de custo do turno, a chamada segue com
   * este teto menor (ainda conferido); ausente ⇒ sem recuo (`maxOutputTokens`).
   */
  minOutputTokens?: number;
  /** Tempo (ms) que resta do prazo global da geração. */
  remainingMs: () => number;
  /** Conferido IMEDIATAMENTE antes da rede: `false` ⇒ a sugestão deixou de ser a vigente (nada é chamado). */
  beforeNetwork: () => Promise<boolean>;
  traceId: string;
  maxTurnCostUsd?: number;
  /** Transporte injetável (testes usam transporte falso; nenhuma chamada externa). */
  provider?: LlmProvider;
  log?: LlmLogger;
  now?: () => number;
  /**
   * Fotos do hóspede para o turno (carregadas sob demanda, dentro do prazo). Ausente ⇒ só texto.
   * Falha ao carregar nunca derruba a geração: segue só com texto e o aviso `[imagem não carregada]`.
   */
  loadVision?: () => Promise<CopilotVisionInput>;
}

/**
 * Anexa as fotos à ÚLTIMA mensagem do usuário como partes multimodais, respeitando o teto de custo do
 * turno: as fotos entram da mais recente para a mais antiga enquanto o pior caso (texto + fotos + saída)
 * couber em `fits(tokens)`; as que não cabem viram o aviso `[imagem não carregada]`.
 * Sem fotos nem falhas ⇒ devolve as mensagens intactas (texto puro).
 */
export function attachVision(
  messages: readonly LlmMessage[],
  vision: CopilotVisionInput,
  baseBound: number,
  fits: (inputTokens: number) => boolean,
): { messages: LlmMessage[]; sent: number; notLoaded: number; bound: number } {
  const plain = messages.map((m) => ({ ...m }));
  if (vision.images.length === 0 && vision.failed.length === 0)
    return { messages: plain, sent: 0, notLoaded: 0, bound: baseBound };
  const enc = new TextEncoder();
  const textCost = (t: string) => enc.encode(t).length + COPILOT_FRAME_TOKENS_PER_MESSAGE;
  const notice = (i: { ref: string | null; at: string | null }) =>
    `${IMAGE_NOT_LOADED} — ${visionLabel(i)}`;
  const parts: LlmContentPart[] = [{ type: "text", text: VISION_HEADER }];
  const failedLines = vision.failed.map(notice);
  let bound =
    baseBound + textCost(VISION_HEADER) + failedLines.reduce((n, l) => n + textCost(l), 0);
  // reserva o aviso de cada foto ainda não decidida: se ela não couber, o aviso cabe
  let reserve = vision.images.reduce((n, i) => n + textCost(notice(i)), 0);
  let sent = 0;
  const skippedLines: string[] = [];
  for (const img of vision.images) {
    reserve -= textCost(notice(img));
    const caption = `Foto ${sent + 1} — ${visionLabel(img)}`;
    const next = bound + textCost(caption) + img.tokenBound;
    if (img.tokenBound > 0 && fits(next + reserve)) {
      parts.push(
        { type: "text", text: caption },
        { type: "image_url", image_url: { url: img.dataUrl } },
      );
      bound = next;
      sent += 1;
    } else {
      skippedLines.push(notice(img));
      bound += textCost(notice(img));
    }
  }
  for (const line of [...skippedLines, ...failedLines]) parts.push({ type: "text", text: line });
  const notLoaded = skippedLines.length + failedLines.length;
  let idx = -1;
  for (let i = plain.length - 1; i >= 0; i--)
    if (plain[i].role === "user") {
      idx = i;
      break;
    }
  if (idx < 0) plain.push({ role: "user", content: parts });
  else {
    const original = plain[idx].content;
    const head: LlmContentPart[] =
      typeof original === "string" ? [{ type: "text", text: original }] : [...original];
    plain[idx] = { role: "user", content: [...head, ...parts] };
  }
  return { messages: plain, sent, notLoaded, bound };
}

/** Moldura por mensagem e por requisição (papéis, separadores): margem SUPERIOR, não estimativa. */
export const COPILOT_FRAME_TOKENS_PER_MESSAGE = 16;
export const COPILOT_FRAME_TOKENS_BASE = 64;

/**
 * Limite SUPERIOR de tokens de entrada: bytes UTF-8 de todo o conteúdo + moldura (em BPE por bytes cada
 * token cobre ≥ 1 byte, logo tokens ≤ bytes). Prompt ilegível ⇒ 0 (o orçamento então bloqueia).
 */
export function copilotInputTokenBound(prompt: ComposedPrompt): number {
  if (!prompt || typeof prompt.system !== "string" || !Array.isArray(prompt.messages)) return 0;
  const enc = new TextEncoder();
  let bytes = enc.encode(prompt.system).length;
  for (const m of prompt.messages) {
    if (!m || typeof m.content !== "string") return 0;
    bytes += enc.encode(m.content).length;
  }
  return (
    bytes +
    COPILOT_FRAME_TOKENS_BASE +
    COPILOT_FRAME_TOKENS_PER_MESSAGE * (prompt.messages.length + 1)
  );
}

export function createCopilotGenerator(deps: CopilotGeneratorDeps): CopilotGenerator {
  const now = deps.now ?? (() => performance.now());
  const ceiling = deps.maxTurnCostUsd ?? COPILOT_MAX_TURN_COST_USD;
  let used = false;
  let t: CopilotGeneratorTelemetry = Object.freeze({
    status: "idle",
    blockCode: null,
    estimatedInputTokens: null,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    error: null,
    imagesSent: 0,
    imagesNotLoaded: 0,
  });
  const block = (code: CopilotGeneratorStopCode): never => {
    t = Object.freeze({ ...t, status: "blocked", blockCode: code });
    throw new CopilotGeneratorStop(code);
  };
  return {
    modelId: deps.modelId,
    async generate(prompt, signal) {
      if (used) block("generator_reused");
      used = true;
      const spec = modelSpec(deps.modelId);
      if (!spec) block("model_unregistered");
      if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");
      const textBound = copilotInputTokenBound(prompt);
      t = Object.freeze({ ...t, estimatedInputTokens: textBound });
      // pior caso do turno: toda a entrada (limite superior) + todo o teto de saída
      const minOut = Math.min(deps.minOutputTokens ?? deps.maxOutputTokens, deps.maxOutputTokens);
      const fitsWith = (inputTokens: number, out: number) => estimateCostUsd(spec!, inputTokens, out) <= ceiling;
      const fits = (inputTokens: number) => fitsWith(inputTokens, minOut);
      if (textBound <= 0 || !fits(textBound)) block("budget_turn_exceeded");

      // visão: fotos do hóspede (falha ao carregar ⇒ só texto + aviso; nunca derruba a geração)
      let vision: CopilotVisionInput = NO_VISION;
      if (deps.loadVision) {
        try {
          vision = await deps.loadVision();
        } catch {
          if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");
          vision = { images: [], failed: [{ ref: null, at: null }] };
        }
      }
      const base: LlmMessage[] = [{ role: "system", content: prompt.system }, ...prompt.messages];
      const attached = attachVision(base, vision, textBound, fits);
      const bound = attached.bound;
      t = Object.freeze({
        ...t,
        estimatedInputTokens: bound,
        imagesSent: attached.sent,
        imagesNotLoaded: attached.notLoaded,
      });
      if (!fits(bound)) block("budget_turn_exceeded");
      // guarda-corpo financeiro externo: teto de saída cheio se couber no teto de custo do turno; senão o recuo
      const outputTokens = fitsWith(bound, deps.maxOutputTokens) ? deps.maxOutputTokens : minOut;
      t = Object.freeze({ ...t, reasoningEffort: deps.reasoningEffort, maxOutputTokens: outputTokens });
      if (!(await deps.beforeNetwork())) block("superseded");
      if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");

      const t0 = now();
      const result = await generateGuestLlm(
        {
          purpose: "guest_reply",
          model: deps.modelId,
          messages: attached.messages,
          maxOutputTokens: outputTokens,
          reasoningEffort: deps.reasoningEffort,
          responseFormat: "json",
          timeoutMs: Math.max(1_000, Math.min(15_000, Math.floor(deps.remainingMs()))),
          signal,
          traceId: deps.traceId,
        },
        { provider: deps.provider, log: deps.log },
      );
      const u = result.telemetry.usage;
      t = Object.freeze({
        ...t,
        status: result.ok ? "called" : "failed",
        model: result.telemetry.model,
        calls: result.telemetry.attempts,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        // uso desconhecido depois de chamar ⇒ custo liquidado pelo pior caso reservado
        costUsd:
          result.telemetry.attempts === 0
            ? 0
            : u.source === "none"
              ? estimateCostUsd(spec!, bound, outputTokens)
              : result.telemetry.costUsd,
        latencyMs: Math.max(0, Math.round(now() - t0)),
        error: result.ok ? null : result.error.code,
      });
      if (!result.ok) throw new CopilotGeneratorStop("gateway_failed");
      return result.text;
    },
    telemetry: () => t,
  };
}
