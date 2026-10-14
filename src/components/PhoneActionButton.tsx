import { MessageCircle, Copy, MessageSquare, Phone, Mail } from "lucide-react";
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
  /** exibe o número por extenso ao lado do ícone (fichas/detalhes) */
  showNumber?: boolean;
  /** sem telefone: mostra o ícone apagado em vez de sumir */
  alwaysShow?: boolean;
  /** Menu "rico" da ficha do proprietário (mockup C1): WhatsApp, Ligar e E-mail, cada um com o contato embaixo. */
  rich?: boolean;
  email?: string | null;
};

/**
 * Botão único e padronizado para telefones em todo o app: ícone verde de
 * mensagem que abre as opções "WhatsApp" e "Copiar". Nunca exibe o número.
 */
export function PhoneActionButton({
  phone,
  country,
  className,
  size = 14,
  showNumber = false,
  alwaysShow = false,
  rich = false,
  email = null,
}: Props) {
  if (!phone && !(rich && email)) {
    if (!alwaysShow) return null;
    return (
      <span
        title="Sem telefone cadastrado"
        aria-label="Sem telefone cadastrado"
        className={cn(
          "inline-flex shrink-0 items-center justify-center p-1.5 text-muted-foreground/40",
          className,
        )}
      >
        <MessageCircle style={{ width: size, height: size }} />
      </span>
    );
  }
  const waNumber = phone ? toWhatsappNumber(phone, country) : "";
  const label = (phone ? formatIntlPhone(phone, country) || phone : email) ?? "";

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
            // Pedido explícito: sem fundo — só o ícone em verde.
            "inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
            showNumber && "gap-2 justify-start px-0",
            className,
          )}
        >
          {/* Com o número visível, o ícone fica à DIREITA do número. */}
          {showNumber && <span className="text-sm text-foreground">{label}</span>}
          <MessageCircle style={{ width: size, height: size }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={rich ? "w-[236px] p-1.5" : "min-w-40"}
        onClick={(e) => e.stopPropagation()}
      >
        {rich ? (
          <>
            {waNumber && (
              <RichItem
                icon={<MessageSquare className="size-[15px]" />}
                tone="wa"
                title="WhatsApp"
                sub={label}
                onSelect={() =>
                  window.open(`https://wa.me/${waNumber}`, "_blank", "noopener,noreferrer")
                }
              />
            )}
            {phone && (
              <RichItem
                icon={<Phone className="size-[15px]" />}
                title="Ligar"
                sub={label}
                onSelect={() => {
                  window.location.href = `tel:+${waNumber || String(phone).replace(/\D/g, "")}`;
                }}
              />
            )}
            {email && (
              <RichItem
                icon={<Mail className="size-[15px]" />}
                title="E-mail"
                sub={email}
                onSelect={() => {
                  window.location.href = `mailto:${email}`;
                }}
              />
            )}
          </>
        ) : null}
        {!rich && waNumber && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://wa.me/${waNumber}`, "_blank", "noopener,noreferrer");
            }}
          >
            <MessageSquare className="size-3.5 text-emerald-500" /> WhatsApp
          </DropdownMenuItem>
        )}
        {!rich && (
          <DropdownMenuItem onClick={copy}>
            <Copy className="size-3.5" /> Copiar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RichItem({
  icon,
  tone,
  title,
  sub,
  onSelect,
}: {
  icon: React.ReactNode;
  tone?: "wa";
  title: string;
  sub: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="min-h-[50px] gap-[11px] rounded-[10px] px-2.5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[10px]",
          tone === "wa"
            ? "bg-emerald-400/[0.12] text-emerald-500 dark:text-emerald-400"
            : "bg-foreground/[0.05] text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="grid min-w-0 gap-px">
        <b className="text-[13px] font-semibold">{title}</b>
        <small className="truncate text-[11px] font-normal text-[color:var(--faint)]">{sub}</small>
      </span>
    </DropdownMenuItem>
  );
}
