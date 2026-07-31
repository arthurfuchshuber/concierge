import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  GUIDE_TAGS,
  GUIDE_INFOS,
  type GuideTagKey,
  type GuideInfoKey,
} from "@/lib/guide-tags";
import { cn } from "@/lib/utils";
import { Tag as TagIcon } from "lucide-react";

/** Item específico (ex.: uma FAQ, uma recomendação, um marketplace) exposto no picker. */
export type TagMentionItem = {
  /** Chave-base (ex.: "faq", "local", "marketplace"). */
  key: GuideTagKey | GuideInfoKey;
  /** Slug/param do item. */
  param: string;
  /** Rótulo mostrado no picker. */
  label: string;
  /** Descrição opcional. */
  hint?: string;
  /** "tag" (link para seção) ou "info" (valor concreto). Default "tag". */
  kind?: "tag" | "info";
};

export type TagMentionTextareaHandle = { focus: () => void };

type Props = React.ComponentProps<typeof Textarea> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Itens específicos (FAQs, recomendações, marketplaces) que aparecem junto das seções fixas. */
  items?: TagMentionItem[];
  /** Classe do wrapper posicional (o popup é ancorado nele). */
  containerClassName?: string;
};

type OptionKind = "section" | "item" | "info";

type Option = {
  kind: OptionKind;
  key: string;
  param: string | null;
  label: string;
  hint: string;
  /** Texto usado para inserção. */
  snippet: string;
  /** Texto de busca (normalizado). */
  search: string;
};

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const POPUP_MAX_HEIGHT = 288; // ≈ max-h-72

export const TagMentionTextarea = forwardRef<TagMentionTextareaHandle, Props>(function TagMentionTextarea(
  { value, onChange, items = [], className, containerClassName, onKeyDown: onKeyDownProp, ...rest },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");

  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);

  const options = useMemo<Option[]>(() => {
    const sections: Option[] = GUIDE_TAGS.filter((t) => !t.parameterized || t.key === "faq" || t.key === "explorar")
      .map((t) => ({
        kind: "section" as const,
        key: t.key,
        param: null,
        label: t.label,
        hint: t.description,
        snippet: `[[tag:${t.key}]]`,
        search: normalize(`${t.label} ${t.key} ${t.description}`),
      }));
    const infos: Option[] = GUIDE_INFOS.filter((i) => !i.parameterized).map((i) => ({
      kind: "info" as const,
      key: i.key,
      param: null,
      label: i.label,
      hint: i.description,
      snippet: `[[info:${i.key}]]`,
      search: normalize(`${i.label} ${i.key} ${i.description} info valor dado`),
    }));
    const itemOpts: Option[] = items.map((it) => ({
      kind: (it.kind === "info" ? "info" : "item") as OptionKind,
      key: it.key,
      param: it.param,
      label: it.label,
      hint: it.hint ?? (it.key === "faq" ? "Pergunta específica" : it.kind === "info" ? "Valor específico" : "Item específico"),
      snippet: it.kind === "info" ? `[[info:${it.key}:${it.param}]]` : `[[tag:${it.key}:${it.param}]]`,
      search: normalize(`${it.label} ${it.key} ${it.hint ?? ""}`),
    }));
    return [...sections, ...infos, ...itemOpts];
  }, [items]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options.slice(0, 20);
    return options.filter((o) => o.search.includes(q)).slice(0, 20);
  }, [options, query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered, highlight]);

  // Flip placement (open upward if not enough room below).
  useLayoutEffect(() => {
    if (!open) return;
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const need = Math.min(POPUP_MAX_HEIGHT, Math.max(120, filtered.length * 44 + 32));
      if (spaceBelow < need && spaceAbove > spaceBelow) setPlacement("top");
      else setPlacement("bottom");
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, filtered.length]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    onChange(e);
    const caret = el.selectionStart ?? el.value.length;
    const upToCaret = el.value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at < 0) {
      setOpen(false);
      return;
    }
    const after = upToCaret.slice(at + 1);
    const prevChar = at > 0 ? upToCaret[at - 1] : " ";
    const isBoundary = /\s|^$|[([{>.,;:!?\-]/.test(prevChar) || at === 0;
    if (!isBoundary || /[\s\n]/.test(after)) {
      setOpen(false);
      return;
    }
    if (after.length > 30) {
      setOpen(false);
      return;
    }
    setTriggerStart(at);
    setQuery(after);
    setOpen(true);
    setHighlight(0);
  }

  function insertOption(opt: Option) {
    const el = taRef.current;
    if (!el || triggerStart === null) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = value.slice(0, triggerStart);
    const after = value.slice(caret);
    const inserted = opt.snippet + " ";
    const next = before + inserted + after;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    nativeSetter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setOpen(false);
    setQuery("");
    setTriggerStart(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || filtered.length === 0) {
      onKeyDownProp?.(e);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertOption(filtered[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const badgeClass = (k: OptionKind) =>
    k === "section"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : k === "info"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";

  return (
    <div ref={wrapperRef} className={cn("relative", containerClassName)}>
      <Textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={cn(className)}
        {...rest}
      />
      {open && filtered.length > 0 && (
        <div
          role="listbox"
          className={cn(
            "absolute z-50 left-0 right-0 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg",
            placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
          )}
        >
          <div className="px-3 py-1.5 border-b flex items-center gap-2 text-[11px] text-muted-foreground">
            <TagIcon className="size-3.5" />
            @ para linkar seção, inserir valor (Wi-Fi, horários…) ou item · ↑↓ · Enter
          </div>
          {filtered.map((o, i) => (
            <button
              key={`${o.kind}:${o.key}:${o.param ?? ""}:${i}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => insertOption(o)}
              className={cn(
                "w-full text-left px-3 py-1.5 focus:outline-none flex items-start gap-2",
                i === highlight ? "bg-muted/70" : "hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium",
                  badgeClass(o.kind),
                )}
              >
                {o.kind === "section" ? "seção" : o.kind === "info" ? "valor" : "item"}
              </span>
              <span className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight truncate">{o.label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight truncate">{o.hint}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
