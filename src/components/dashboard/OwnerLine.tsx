import { parsePhoneNumberFromString } from "libphonenumber-js";
import { MessageCircle } from "lucide-react";

/**
 * Nome do proprietário em destaque com o telefone clicável (WhatsApp) à direita.
 */
export function OwnerLine({
  name,
  phone,
  country,
}: {
  name: string | null;
  phone: string | null;
  country: string | null;
}) {
  if (!name) return null;

  const raw = (phone ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  let label = raw;
  if (raw) {
    const parsed = parsePhoneNumberFromString(
      raw.startsWith("+") ? raw : `${country ?? "+55"}${raw}`,
    );
    if (parsed?.isValid()) {
      digits = parsed.number.replace(/\D/g, "");
      label = parsed.formatInternational();
    } else if (!raw.startsWith("+") && country) {
      digits = `${country.replace(/\D/g, "")}${digits}`;
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs font-bold text-primary truncate" title={name}>
        {name}
      </span>
      {digits && (
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Abrir conversa no WhatsApp"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-400 hover:underline shrink-0 tabular-nums"
        >
          <MessageCircle className="size-3" />
          {label}
        </a>
      )}
    </div>
  );
}
