import { Fragment, useCallback } from "react";
import { tokenizeTags, type GuideTagKey } from "@/lib/guide-tags";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  className?: string;
  /**
   * Handler chamado ao clicar num link de tag.
   * Recebe a chave da seção (ex.: "senhas-acesso", "wifi", "faq") e o param opcional.
   * O consumidor decide se troca de aba, faz scroll ou navega.
   */
  onNavigate?: (key: GuideTagKey, param: string | null) => void;
};

/** Renderiza texto com `[[tag:...]]` transformando as tags em botões-link inline. */
export function InlineTagText({ text, className, onNavigate }: Props) {
  const tokens = tokenizeTags(text ?? "");
  const handle = useCallback(
    (key: GuideTagKey, param: string | null) => (e: React.MouseEvent) => {
      e.preventDefault();
      onNavigate?.(key, param);
    },
    [onNavigate],
  );
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {tokens.map((t, i) => {
        if (t.kind === "text") return <Fragment key={i}>{t.value}</Fragment>;
        return (
          <a
            key={i}
            href="#"
            onClick={handle(t.key, t.param)}
            className="inline-flex items-baseline gap-0.5 rounded-md px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 font-medium no-underline"
          >
            {t.label}
          </a>
        );
      })}
    </span>
  );
}
