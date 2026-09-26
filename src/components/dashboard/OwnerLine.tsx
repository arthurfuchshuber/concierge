import { PhoneActionButton } from "@/components/PhoneActionButton";
import { CARD_OWNER, ownerLabel } from "@/components/dashboard/card-colors";

/**
 * Nome do proprietário em destaque com o botão de contato (ícone) à direita.
 *
 * Rótulo "Proprietário: " + só o primeiro nome — pedido explícito
 * (25/09/2026), ver `ownerLabel` em `card-colors.ts`.
 */
export function OwnerLine({
  name,
  phone,
  country,
  phonePosition = "end",
  variant = "brand",
}: {
  variant?: "brand" | "neutral";
  name: string | null;
  phone: string | null;
  country: string | null;
  phonePosition?: "adjacent" | "end";
}) {
  const label = ownerLabel(name);
  if (!label) return null;

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
      <span
        className={`${phonePosition === "end" ? "flex-1" : "shrink"} min-w-0 truncate text-xs ${variant === "neutral" ? "text-muted-foreground" : CARD_OWNER}`}
        title={name ?? undefined}
      >
        {label}
      </span>

      <PhoneActionButton
        phone={phone}
        country={country}
        size={12}
        alwaysShow
        className={phonePosition === "end" ? "ml-auto" : ""}
      />
    </div>
  );
}
