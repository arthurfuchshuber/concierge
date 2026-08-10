/**
 * Rastro de uso no cliente.
 *
 * Captura absolutamente tudo o que a pessoa faz na interface (navegação,
 * cliques, campos, envios, cópias, rolagem, foco de aba, erros) e envia em
 * lotes para o Enterprise Audit Trail.
 *
 * Privacidade: registramos O QUE foi tocado (rótulo do botão, nome do campo),
 * nunca o conteúdo digitado. Campos de senha são totalmente ignorados.
 */
import { ingestTrail, type TrailEventInput } from "./trail.functions";

const DEVICE_KEY = "cia-device-id";
const FLUSH_MS = 6000;
const MAX_BUFFER = 40;

let buffer: TrailEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let sessionId = "";
let guideSlug: string | undefined;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/** Nome informado pelo hóspede no formulário de acesso (quando existir). */
function guestName(): string | undefined {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sg-access-")) continue;
      const rec = JSON.parse(localStorage.getItem(k) || "{}") as { name?: string };
      if (rec?.name) return rec.name;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function flush(): Promise<void> {
  if (!buffer.length) return;
  const events = buffer;
  buffer = [];
  try {
    await ingestTrail({
      data: { events, deviceId: deviceId(), sessionId, guideSlug, actorName: guestName() },
    });
  } catch {
    /* rastro nunca pode atrapalhar o uso do app */
  }
}


function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_MS);
}

/** Registra um evento de rastro. Seguro para chamar de qualquer lugar. */
export function track(event: TrailEventInput): void {
  if (typeof window === "undefined") return;
  buffer.push({
    ...event,
    path: event.path ?? window.location.pathname + window.location.search,
    at: event.at ?? new Date().toISOString(),
  });
  if (buffer.length >= MAX_BUFFER) void flush();
  else schedule();
}

/** Título/identificação do bloco (card, linha da tabela, diálogo) onde o clique ocorreu. */
function contextOf(node: HTMLElement): string | null {
  const explicit = node.closest("[data-track-context]") as HTMLElement | null;
  if (explicit) return (explicit.getAttribute("data-track-context") || "").slice(0, 120) || null;

  const box = node.closest(
    "[data-card], [role='dialog'], [role='row'], tr, li, article, [data-slot='card']",
  ) as HTMLElement | null;
  if (!box) return null;

  const heading = box.querySelector(
    "[data-track-title], h1, h2, h3, h4, [role='heading'], strong, th, td:first-child",
  ) as HTMLElement | null;
  const text = (heading?.textContent ?? box.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

function describe(
  el: Element | null,
): { label: string; target: string; kind: string; context: string | null } | null {
  if (!el) return null;
  const node = el.closest(
    "button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], input, select, textarea, summary, label, [data-track]",
  ) as HTMLElement | null;
  if (!node) return null;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" && (node as HTMLInputElement).type === "password") return null;
  const label =
    node.getAttribute("data-track") ||
    node.getAttribute("aria-label") ||
    (node as HTMLInputElement).name ||
    node.getAttribute("title") ||
    (node.textContent ?? "").trim().slice(0, 80) ||
    node.getAttribute("href") ||
    tag;
  const target =
    node.getAttribute("data-track") ||
    node.id ||
    (node as HTMLInputElement).name ||
    node.getAttribute("href") ||
    `${tag}${node.className && typeof node.className === "string" ? `.${node.className.split(" ")[0]}` : ""}`;
  return {
    label: String(label),
    target: String(target).slice(0, 160),
    kind: tag,
    context: contextOf(node),
  };
}


/** Inicia a captura global. Idempotente. */
export function startTrail(slug?: string): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;
  sessionId = uid();
  guideSlug = slug;

  track({
    type: "session_start",
    label: "Sessão iniciada",
    metadata: {
      referrer: document.referrer || null,
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  const where = () => `na página "${document.title || window.location.pathname}"`;
  const KIND_PT: Record<string, string> = {
    button: "botão",
    a: "link",
    input: "campo",
    select: "seletor",
    textarea: "campo de texto",
    label: "rótulo",
    summary: "seção",
  };

  const onClick = (e: MouseEvent) => {
    const info = describe(e.target as Element);
    if (!info) return;
    track({
      type: "click",
      label: `Clicou ${KIND_PT[info.kind] ? `no ${KIND_PT[info.kind]}` : "em"} "${info.label}" ${where()}`,
      target: info.target,
      metadata: { element: info.kind, element_label: info.label, page_title: document.title },
    });
  };

  const onChange = (e: Event) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.type === "password") return;
    const info = describe(el);
    if (!info) return;
    const filled = Boolean(el.value);
    track({
      type: "field_changed",
      label: `${filled ? "Preencheu" : "Limpou"} o campo "${info.label}" ${where()}`,
      target: info.target,
      metadata: {
        element: info.kind,
        element_label: info.label,
        input_type: el.type ?? null,
        filled,
        length: typeof el.value === "string" ? el.value.length : null,
        page_title: document.title,
      },
    });
  };

  const onSubmit = (e: Event) => {
    const form = e.target as HTMLFormElement | null;
    const fields = form
      ? Array.from(form.elements)
          .map((f) => (f as HTMLInputElement).name)
          .filter(Boolean)
      : [];
    const formName = form?.getAttribute("aria-label") || form?.id || "sem nome";
    track({
      type: "form_submit",
      label: `Enviou o formulário "${formName}" ${where()}${fields.length ? ` com os campos: ${fields.slice(0, 12).join(", ")}` : ""}`,
      target: form?.id || "form",
      metadata: { fields, page_title: document.title },
    });
  };

  const onCopy = () => track({ type: "copy", label: `Copiou conteúdo ${where()}` });


  const onVisibility = () =>
    track({
      type: document.hidden ? "tab_hidden" : "tab_visible",
      label: document.hidden ? "Saiu da aba" : "Voltou para a aba",
    });

  const onError = (e: ErrorEvent) =>
    track({
      type: "client_error",
      category: "ERROR",
      severity: "error",
      label: e.message?.slice(0, 200) || "Erro no navegador",
      metadata: { source: e.filename ?? null, line: e.lineno ?? null },
    });

  const onRejection = (e: PromiseRejectionEvent) =>
    track({
      type: "unhandled_rejection",
      category: "ERROR",
      severity: "error",
      label: String((e.reason as { message?: string })?.message ?? e.reason).slice(0, 200),
    });

  let maxDepth = 0;
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    const pct = Math.min(100, Math.round(((window.scrollY || 0) / h) * 100));
    const bucket = Math.floor(pct / 25) * 25;
    if (bucket > maxDepth && bucket > 0) {
      maxDepth = bucket;
      track({ type: "scroll_depth", label: `Rolou ${bucket}% da página`, metadata: { depth: bucket } });
    }
  };

  const onHide = () => {
    track({ type: "session_end", label: "Sessão encerrada" });
    void flush();
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("copy", onCopy, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", onHide);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", onHide);
    started = false;
    void flush();
  };
}

/** Registra visualização de página (chamado a cada navegação). */
export function trackPageView(path: string, title?: string): void {
  const t = title ?? document.title;
  track({
    type: "page_view",
    label: `Abriu a página "${t}" (${path})`,
    target: path,
    path,
    metadata: { page_title: t },
  });
}

