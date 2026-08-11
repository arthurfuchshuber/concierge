import { PhoneActionButton } from "@/components/PhoneActionButton";

/**
 * Nome do proprietário em destaque com o botão de contato (ícone) à direita.
 */
export function OwnerLine({
  name,
  phone,
  country,
  phonePosition = "end",
}: {
  name: string | null;
  phone: string | null;
  country: string | null;
  phonePosition?: "adjacent" | "end";
}) {
  if (!name) return null;

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
      <span
        className={`${phonePosition === "end" ? "flex-1" : "shrink"} min-w-0 truncate text-xs font-bold text-primary`}
        title={name}
      >
        {name}
      </span>

      <PhoneActionButton
        phone={phone}
        country={country}
        size={12}
        className={phonePosition === "end" ? "ml-auto" : ""}
      />
    </div>
  );
}
