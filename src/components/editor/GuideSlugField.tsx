import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { guideUrl } from "@/lib/site-url";

/**
 * URL PÚBLICA DO GUIA — editável, com "copiar link" (pedido explícito,
 * 05/10/2026: "os guias não estão permitindo alterar a URL personalizada nem
 * copiar o link").
 *
 * Em 01/10/2026 o slug foi travado junto com os campos que vêm do Airbnb,
 * porque o Importar o refazia a partir do título do anúncio. Isso tirou do
 * cliente a URL personalizada. Agora:
 *  · o campo é livre — o texto é normalizado enquanto se digita (minúsculas,
 *    sem acento, espaço vira hífen);
 *  · o Importar nunca mais troca um slug que já existe (ver `importAirbnb` na
 *    tela do imóvel), então a URL escolhida fica;
 *  · o endereço antigo continua funcionando: o banco guarda o histórico de
 *    slugs (`properties_slug_history`) e redireciona;
 *  · o botão copia o link COMPLETO (`guideUrl`), o mesmo que a lista de guias.
 */

/** A mesma regra do servidor (`properties.functions.ts`). */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])?$/;

/** Normaliza enquanto digita: não corta o hífen final (a pessoa ainda está escrevendo). */
export function normalizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 62);
}

export function GuideSlugField({
  value,
  savedSlug,
  onChange,
}: {
  value: string;
  /** O que já está gravado no banco; o link novo só vale depois de salvar. */
  savedSlug?: string | null;
  onChange: (v: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const clean = value.replace(/-+$/, "");
  const valid = SLUG_RE.test(clean);
  const pending = !!savedSlug && savedSlug !== clean;
  const link = valid ? guideUrl(clean) : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link do guia copiado");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
            /g/
          </span>
          <Input
            value={value}
            maxLength={62}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!valid}
            onChange={(e) => onChange(normalizeSlugInput(e.target.value))}
            onBlur={() => value !== clean && onChange(clean)}
            placeholder="nome-do-imovel"
            className="pl-9"
          />
        </div>
        <button
          type="button"
          onClick={copy}
          disabled={!valid}
          aria-label="Copiar link do guia"
          title="Copiar link do guia"
          className="grid size-9 shrink-0 place-items-center rounded-[0.5rem] bg-foreground/[0.04] text-muted-foreground shadow-[inset_0_0_0_1px_var(--input)] transition-colors hover:bg-foreground/[0.08] hover:text-foreground disabled:opacity-40"
        >
          {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {!valid ? (
        <p className="text-[11px] leading-snug text-[#d29a9a]">
          Use de 3 a 62 letras minúsculas, números e hífens.
        </p>
      ) : (
        <p className="min-w-0 truncate text-[11px] leading-snug text-muted-foreground" title={link}>
          {link}
          {pending ? " · vale depois de salvar; o endereço antigo continua funcionando" : ""}
        </p>
      )}
    </div>
  );
}
