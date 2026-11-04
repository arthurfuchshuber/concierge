/**
 * F2-B · B3.3 — PRAZO ABSOLUTO COMPARTILHADO de uma execução Shadow.
 *
 * Uma única origem de tempo (`started`, do relógio injetado) e um único `AbortController` para TODAS
 * as etapas: leituras, coletor, lease, contexto, histórico, dossiê, posse, pausa, orçamento, Gateway,
 * cadeia, pós-processamento e gravação. Nenhuma etapa recebe um prazo "novo": cada uma recebe o mesmo
 * sinal e o tempo que AINDA resta.
 *
 *  - 15.000 ms absolutos desde o início do processamento da conversa (`SHADOW_DEADLINE_MS`).
 *  - 1.500 ms reservados à finalização (registro + lease): o processamento usa no máximo 13.500 ms
 *    (`processingRemainingMs`); a finalização usa o que sobrar até os 15 s (`totalRemainingMs`).
 *  - O sinal dispara em dois momentos: fim do orçamento de processamento (`processing`) e fim absoluto
 *    (`absolute`). A finalização usa `finalizationSignal`, que só dispara no fim absoluto.
 * Relógio inválido ⇒ tratado como prazo esgotado (fail-closed).
 */
import { SHADOW_DEADLINE_MS, SHADOW_FINALIZATION_RESERVE_MS } from "./contracts";

export type DeadlineReason = "processing_deadline" | "absolute_deadline" | "cancelled";

export interface DeadlineDeps {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Cancelamento externo (ex.: desligamento global); propaga para os dois sinais. */
  external?: AbortSignal;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export class ShadowDeadline {
  readonly started: number;
  private readonly processing = new AbortController();
  private readonly absolute = new AbortController();
  private reasonValue: DeadlineReason | null = null;
  private readonly cancels: Array<() => void> = [];
  private readonly clock: () => number;
  private readonly onExternal = () => this.cancel();

  constructor(private readonly deps: DeadlineDeps = {}) {
    this.clock = deps.now ?? (() => performance.now());
    const t0 = this.read();
    this.started = t0;
    const schedule = deps.schedule ?? defaultSchedule;
    if (!Number.isFinite(t0)) {
      this.fire("absolute_deadline");
      return;
    }
    this.cancels.push(schedule(() => this.fire("processing_deadline"), SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS));
    this.cancels.push(schedule(() => this.fire("absolute_deadline"), SHADOW_DEADLINE_MS));
    if (deps.external) {
      if (deps.external.aborted) this.cancel();
      else deps.external.addEventListener("abort", this.onExternal, { once: true });
    }
  }

  private read(): number {
    try {
      const v = this.clock();
      return typeof v === "number" && Number.isFinite(v) ? v : Number.NaN;
    } catch {
      return Number.NaN;
    }
  }

  private fire(reason: DeadlineReason) {
    this.reasonValue ??= reason;
    if (!this.processing.signal.aborted) this.processing.abort(reason);
    if (reason !== "processing_deadline" && !this.absolute.signal.aborted) this.absolute.abort(reason);
  }

  /** Cancelamento explícito (desligamento global, erro de integridade): para tudo, inclusive a finalização. */
  cancel() {
    this.fire("cancelled");
  }

  /** Sinal ÚNICO do processamento (todas as etapas até o pós-processamento). */
  get signal(): AbortSignal {
    return this.processing.signal;
  }
  /** Sinal da finalização (registro + lease): só dispara no fim absoluto ou em cancelamento. */
  get finalizationSignal(): AbortSignal {
    return this.absolute.signal;
  }
  get reason(): DeadlineReason | null {
    return this.reasonValue;
  }
  elapsedMs(): number {
    const t = this.read();
    return Number.isFinite(t) && Number.isFinite(this.started) ? Math.max(0, t - this.started) : Number.POSITIVE_INFINITY;
  }
  /** Tempo que resta para PROCESSAR (até 13.500 ms). Relógio inválido ⇒ 0. */
  processingRemainingMs(): number {
    if (this.processing.signal.aborted) return 0;
    const left = SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS - this.elapsedMs();
    return Number.isFinite(left) ? Math.max(0, Math.floor(left)) : 0;
  }
  /** Tempo que resta até o fim absoluto (inclui a reserva de finalização). */
  totalRemainingMs(): number {
    if (this.absolute.signal.aborted) return 0;
    const left = SHADOW_DEADLINE_MS - this.elapsedMs();
    return Number.isFinite(left) ? Math.max(0, Math.floor(left)) : 0;
  }
  dispose() {
    for (const c of this.cancels.splice(0)) {
      try {
        c();
      } catch {
        /* cancelador nunca derruba a execução */
      }
    }
    this.deps.external?.removeEventListener("abort", this.onExternal);
  }
}
