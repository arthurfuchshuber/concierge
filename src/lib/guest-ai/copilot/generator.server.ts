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
import {
  llmMessageText,
  type LlmContentPart,
  type LlmErrorCode,
  type LlmMessage,
  type LlmToolSpec,
  type LlmUsage,
  type ReasoningEffort,
} from "@/lib/guest-ai/llm/contracts";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import { COPILOT_MAX_TURN_COST_USD } from "./contracts";
import type { GuestToolContext, MapsHttp } from "@/lib/guest-ai/tools/contracts";
import { executeToolCalls, type ToolCallOutcome } from "@/lib/guest-ai/tools/executor";
import { toolSpecsFor } from "@/lib/guest-ai/tools/registry";
import { productionMapsHttp } from "@/lib/guest-ai/tools/google-maps.server";
import { VISION_LOAD_TIMEOUT_MS } from "@/lib/guest-ai/vision/analyzer";

/** Corrida contra o prazo (rejeita em `ms`); o timer é sempre limpo. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("vision_timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

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
  /** Ferramentas de consulta oferecidas ao modelo neste turno (nomes). */
  readonly toolsOffered?: readonly string[];
  /** Rodadas de ferramenta executadas (0 ou 1). */
  readonly toolRounds?: number;
  /** Chamadas de ferramenta executadas e quantas falharam (prazo, rede, argumento inválido…). */
  readonly toolCalls?: number;
  readonly toolFailures?: number;
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
  /**
   * Origem e localidade do imóvel do turno para as ferramentas de consulta (Google Places e rotas).
   * Ausente, `null` ou com falha ⇒ o turno segue sem ferramentas (exatamente como antes).
   */
  loadToolContext?: () => Promise<GuestToolContext | null>;
  /** Transporte do Google Maps (testes injetam um falso; produção usa o conector do Maps). */
  toolHttp?: MapsHttp;
}

/**
 * Reserva de tokens de entrada para a 2ª chamada (pedido de ferramenta + resultados), usada só na decisão
 * PRÉVIA de oferecer ferramentas. Antes da 2ª chamada o custo é recalculado EXATO; se não couber, os
 * resultados viram `indisponivel` (a IA responde sem números) e o teto do turno nunca é ultrapassado.
 */
export const COPILOT_TOOL_ROUND_RESERVE_TOKENS = 8_000;
/** Tempo do prazo do turno guardado para a 2ª chamada (resposta final) enquanto as ferramentas rodam. */
export const COPILOT_FINAL_CALL_RESERVE_MS = 6_000;

/** Limite SUPERIOR de tokens de entrada de mensagens já montadas (texto, chamadas e resultados de ferramenta). */
export function messagesTokenBound(messages: readonly LlmMessage[]): number {
  const enc = new TextEncoder();
  let bytes = 0;
  for (const m of messages) {
    bytes += enc.encode(llmMessageText(m.content)).length;
    for (const c of m.toolCalls ?? []) bytes += enc.encode(c.name).length + enc.encode(c.arguments).length + enc.encode(c.id).length;
    if (m.toolCallId) bytes += enc.encode(m.toolCallId).length;
  }
  return bytes + COPILOT_FRAME_TOKENS_BASE + COPILOT_FRAME_TOKENS_PER_MESSAGE * (messages.length + 1);
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
          // leitura das fotos com prazo próprio (8 s): estourou ⇒ segue só com texto e o aviso
          vision = await withTimeout(deps.loadVision(), VISION_LOAD_TIMEOUT_MS);
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
      let outputTokens = fitsWith(bound, deps.maxOutputTokens) ? deps.maxOutputTokens : minOut;

      // ferramentas de consulta (Google Places / rotas): só se as DUAS chamadas couberem no teto do turno
      let toolCtx: GuestToolContext | null = null;
      if (deps.loadToolContext) {
        try {
          toolCtx = await deps.loadToolContext();
        } catch {
          if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");
          toolCtx = null;
        }
      }
      let tools: LlmToolSpec[] = toolSpecsFor(toolCtx);
      if (tools.length > 0) {
        const twoCalls = (out: number) =>
          estimateCostUsd(spec!, bound, out) + estimateCostUsd(spec!, bound + COPILOT_TOOL_ROUND_RESERVE_TOKENS, out) <= ceiling;
        if (twoCalls(deps.maxOutputTokens)) outputTokens = deps.maxOutputTokens;
        else if (twoCalls(minOut)) outputTokens = minOut;
        else tools = []; // não cabe: segue sem ferramentas, como antes
      }
      t = Object.freeze({
        ...t,
        reasoningEffort: deps.reasoningEffort,
        maxOutputTokens: outputTokens,
        toolsOffered: tools.map((x) => x.name),
        toolRounds: 0,
        toolCalls: 0,
        toolFailures: 0,
      });
      if (!(await deps.beforeNetwork())) block("superseded");
      if (signal.aborted || deps.remainingMs() <= 0) block("deadline_expired");

      const t0 = now();
      let calls = 0;
      let usage: LlmUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, source: "none" };
      let cost = 0;
      let lastModel: string | undefined;
      const account = (r: Awaited<ReturnType<typeof generateGuestLlm>>, inBound: number) => {
        const u = r.telemetry.usage;
        calls += r.telemetry.attempts;
        lastModel = r.telemetry.model;
        if (u.source !== "none") {
          usage = {
            inputTokens: usage.inputTokens + u.inputTokens,
            outputTokens: usage.outputTokens + u.outputTokens,
            reasoningTokens: usage.reasoningTokens + u.reasoningTokens,
            totalTokens: usage.totalTokens + u.totalTokens,
            source: u.source,
          };
        }
        // uso desconhecido depois de chamar ⇒ custo liquidado pelo pior caso reservado
        cost += r.telemetry.attempts === 0 ? 0 : u.source === "none" ? estimateCostUsd(spec!, inBound, outputTokens) : r.telemetry.costUsd;
      };
      const settle = (status: "called" | "failed", error: LlmErrorCode | null) => {
        t = Object.freeze({
          ...t,
          status,
          model: lastModel,
          calls,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: Math.round(cost * 1e8) / 1e8,
          latencyMs: Math.max(0, Math.round(now() - t0)),
          error,
        });
      };
      const call = (messages: LlmMessage[], toolChoice: "auto" | "none" | null) =>
        generateGuestLlm(
          {
            purpose: "guest_reply",
            model: deps.modelId,
            messages,
            maxOutputTokens: outputTokens,
            reasoningEffort: deps.reasoningEffort,
            responseFormat: "json",
            timeoutMs: Math.max(1_000, Math.min(15_000, Math.floor(deps.remainingMs()))),
            signal,
            traceId: deps.traceId,
            ...(tools.length > 0 && toolChoice ? { tools, toolChoice } : {}),
          },
          { provider: deps.provider, log: deps.log },
        );

      // 1ª chamada: o modelo responde direto ou pede consultas
      const first = await call(attached.messages, "auto");
      account(first, bound);
      if (!first.ok) {
        settle("failed", first.error.code);
        throw new CopilotGeneratorStop("gateway_failed");
      }
      if (first.finishReason !== "tool_calls" || !first.toolCalls || first.toolCalls.length === 0) {
        settle("called", null);
        return first.text;
      }

      // ferramentas: executadas com prazo de 6 s cada, falha nunca derruba o turno
      // as ferramentas nunca comem o tempo da resposta final: sobra sempre `COPILOT_FINAL_CALL_RESERVE_MS`
      const outcomes: ToolCallOutcome[] = await executeToolCalls(first.toolCalls, toolCtx!, {
        http: deps.toolHttp ?? productionMapsHttp,
        signal,
        remainingMs: () => deps.remainingMs() - COPILOT_FINAL_CALL_RESERVE_MS,
      });
      t = Object.freeze({
        ...t,
        toolRounds: 1,
        toolCalls: outcomes.length,
        toolFailures: outcomes.filter((o) => !o.ok).length,
      });
      if (signal.aborted || deps.remainingMs() <= 0) {
        settle("failed", null);
        block("deadline_expired");
      }
      const assistant: LlmMessage = { role: "assistant", content: first.text, toolCalls: first.toolCalls };
      const withResults = (contentOf: (o: ToolCallOutcome) => string): LlmMessage[] => [
        ...attached.messages,
        assistant,
        ...outcomes.map((o): LlmMessage => ({ role: "tool", toolCallId: o.callId, content: contentOf(o) })),
      ];
      let second = withResults((o) => o.content);
      // custo EXATO da 2ª chamada; se não couber no que resta do teto, os resultados viram `indisponivel`
      const fitsRest = (msgs: LlmMessage[]) => cost + estimateCostUsd(spec!, messagesTokenBound(msgs), outputTokens) <= ceiling;
      if (!fitsRest(second)) {
        second = withResults(() => JSON.stringify({ ok: false, erro: "indisponivel" }));
        if (!fitsRest(second)) {
          settle("failed", null);
          block("budget_turn_exceeded");
        }
      }
      if (!(await deps.beforeNetwork())) {
        settle("failed", null);
        block("superseded");
      }
      // 2ª chamada: só a resposta final (ferramentas proibidas), com os dados reais consultados
      const final = await call(second, "none");
      account(final, messagesTokenBound(second));
      if (!final.ok || final.finishReason !== "stop") {
        settle("failed", final.ok ? "invalid_response" : final.error.code);
        throw new CopilotGeneratorStop("gateway_failed");
      }
      settle("called", null);
      return final.text;
    },
    telemetry: () => t,
  };
}
