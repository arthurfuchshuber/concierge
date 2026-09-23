import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  value: string;
  label?: string;
  className?: string;
  size?: number;
};

export function CopyButton({ value, label = "Código copiado", className = "", size = 12 }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copiar"
      title="Copiar"
      className={`inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 ${className}`}
    >
      {copied ? <Check size={size} className="text-emerald-500" /> : <Copy size={size} />}
    </button>
  );
}
