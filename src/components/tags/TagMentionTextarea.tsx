import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { GUIDE_TAGS, type GuideTagKey } from "@/lib/guide-tags";
import { cn } from "@/lib/utils";
import { Tag as TagIcon } from "lucide-react";

/** Item específico (ex.: uma FAQ, uma recomendação) exposto no picker. */
export type TagMentionItem = {
  /** Chave-base (ex.: "faq", "local"). */
  key: GuideTagKey;
  /** Slug do item (usado como parâmetro na tag). */
  param: string;
  /** Rótulo mostrado no picker e (por padrão) no envio. */
  label: string;
  /** Descrição opcional exibida abaixo do rótulo. */
  hint?: string;
};

export type TagMentionTextareaHandle = { focus: () => void };

type Props = React.ComponentProps<typeof Textarea> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Itens específicos (FAQs, recomendações) que aparecem junto das seções fixas. */
  items?: TagMentionItem[];
};

type Option = {
  kind: "section" | "item";
  key: GuideTagKey;
  param: string | null;
  label: string;
  hint: string;
  /** Texto usado para inserção na tag. */
  snippet: string;
  /** Texto de busca. */
  search: string;
};

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export const TagMentionTextarea = forwardRef<TagMentionTextareaHandle, Props>(function TagMentionTextarea(
  { value, onChange, items = [], className, ...rest },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);

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
    const itemOpts: Option[] = items.map((it) => ({
      kind: "item" as const,
      key: it.key,
      param: it.param,
      label: it.label,
      hint: it.hint ?? (it.key === "faq" ? "Pergunta específica" : "Item específico"),
      snippet: `[[tag:${it.key}:${it.param}]]`,
      search: normalize(`${it.label} ${it.key} ${it.hint ?? ""}`),
    }));
    return [...sections, ...itemOpts];
  }, [items]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options.slice(0, 12);
    return options.filter((o) => o.search.includes(q)).slice(0, 12);
  }, [options, query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered, highlight]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    onChange(e);
    const caret = el.selectionStart ?? el.value.length;
    // Procura o "@" mais próximo antes do cursor (sem espaço/quebra no meio)
    const upToCaret = el.value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at < 0) {
      setOpen(false);
      return;
    }
    const after = upToCaret.slice(at + 1);
    // Cancela se houver espaço/quebra entre @ e o cursor, ou se @ estiver colado num caractere alfanumérico anterior
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
    // Dispara onChange sintético reutilizando o mesmo event target
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
    if (!open || filtered.length === 0) return;
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

  return (
    <div className="relative">
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
          className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="px-3 py-1.5 border-b flex items-center gap-2 text-[11px] text-muted-foreground">
            <TagIcon className="size-3.5" />
            Digite @ para linkar uma seção ou item · ↑↓ navegar · Enter inserir
          </div>
          {filtered.map((o, i) => (
            <button
              key={`${o.key}:${o.param ?? ""}:${i}`}
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
                  o.kind === "section" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                )}
              >
                {o.kind === "section" ? "seção" : "item"}
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
