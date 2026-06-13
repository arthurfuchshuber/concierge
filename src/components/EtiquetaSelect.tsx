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
  const knownValue = ETIQUETA_OPTIONS.includes(value as typeof ETIQUETA_OPTIONS[number]) ? value : undefined;

  return (
    <Select value={knownValue} onValueChange={(v) => onChange(v === "__clear__" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Selecione uma etiqueta" />
      </SelectTrigger>
      <SelectContent>
        {knownValue && <SelectItem value="__clear__">Sem etiqueta</SelectItem>}
        {ETIQUETA_OPTIONS.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
