import { MessageCircle, Copy, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toWhatsappNumber, formatIntlPhone } from "@/lib/masks";
import { cn } from "@/lib/utils";

type Props = {
  phone?: string | null;
  country?: string | null;
  className?: string;
  /** tamanho do ícone em px */
  size?: number;
};

/**
 * Botão único e padronizado para telefones em todo o app: ícone verde de
 * mensagem que abre as opções "WhatsApp" e "Copiar". Nunca exibe o número.
 */
export function PhoneActionButton({ phone, country, className, size = 14 }: Props) {
  if (!phone) return null;
  const waNumber = toWhatsappNumber(phone, country);
  const label = formatIntlPhone(phone, country) || phone;

  async function copy(e: Event | React.MouseEvent) {
    (e as any).stopPropagation?.();
    try {
      await navigator.clipboard.writeText(label);
      toast.success("Telefone copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={label}
          aria-label={`Contato ${label}`}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-500/12 p-1.5 text-emerald-600 transition hover:bg-emerald-500/25 dark:text-emerald-400",
            className,
          )}
        >
          <MessageCircle style={{ width: size, height: size }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40" onClick={(e) => e.stopPropagation()}>
        {waNumber && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://wa.me/${waNumber}`, "_blank", "noopener,noreferrer");
            }}
          >
            <MessageSquare className="size-3.5 text-emerald-500" /> WhatsApp
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={copy}>
          <Copy className="size-3.5" /> Copiar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
