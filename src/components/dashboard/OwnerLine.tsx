import { PhoneActionButton } from "@/components/PhoneActionButton";

/**
 * PADRÃO ÚNICO DO PROPRIETÁRIO (24/10/2026): rótulo "Proprietário(a):" suave,
 * NOME INTEIRO em destaque (cor de texto cheia) e ícone verde de chat colado
 * ao nome. Toda tela que cita o dono de um imóvel usa esta peça.
 */
export function OwnerLine({
  name,
  phone,
  country,
  phonePosition = "end",
  label: labelOverride,
  size = 12,
  className = "",
}: {
  /** Mantido por compatibilidade; o nome é sempre em destaque. */
  variant?: "brand" | "neutral";
  name: string | null;
  phone: string | null;
  country: string | null;
  phonePosition?: "adjacent" | "end";
  /** Rótulo alternativo (ex.: "Proprietária do Imóvel:"); o nome vem depois. */
  label?: string | null;
  size?: number;
  className?: string;
}) {
  const full = name?.trim();
  if (!full) return null;
  const prefix = (labelOverride ?? "Proprietário(a):").replace(/:\s*.*$/, ":");

  return (
    <div className={`flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-xs ${className}`}>
      <span className="shrink-0 text-muted-foreground">{prefix}</span>
      <span
        className={`${phonePosition === "end" ? "flex-1" : "shrink"} min-w-0 truncate font-semibold text-foreground`}
        title={full}
      >
        {full}
      </span>
      <PhoneActionButton
        phone={phone}
        country={country}
        size={size}
        alwaysShow
        className={`-my-1 ${phonePosition === "end" ? "ml-auto" : ""}`}
      />
    </div>
  );
}
