import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const ETIQUETA_OPTIONS = [
  "Check-In & Check-Out",
  "Recomendações Locais",
  "Informações do Espaço",
] as const;

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function EtiquetaSelect({ value, onChange }: Props) {
  // If a legacy value exists outside the fixed set, surface it so it isn't silently lost
  const allOptions = value && !ETIQUETA_OPTIONS.includes(value as typeof ETIQUETA_OPTIONS[number])
    ? [value, ...ETIQUETA_OPTIONS]
    : ETIQUETA_OPTIONS;

  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v === "__clear__" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Selecione uma etiqueta" />
      </SelectTrigger>
      <SelectContent>
        {value && <SelectItem value="__clear__">Sem etiqueta</SelectItem>}
        {allOptions.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
