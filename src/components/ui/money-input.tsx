import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Campo de dinheiro (R$) que aceita digitação livre.
 *
 * Por que não um <Input type="number"> controlado direto pelos centavos?
 * Porque reformatar o valor a cada tecla (ex.: "1" -> grava 100 centavos ->
 * repinta "1,00") empurra o cursor pro fim e trava a digitação no meio do
 * número — o usuário não consegue completar "1,50" porque, ao digitar o
 * "5", o campo já virou "1,00" e o "5" cai fora do lugar.
 *
 * Aqui o campo guarda seu PRÓPRIO texto (livre, sem reformatar a cada
 * tecla) e só chama onChange com os centavos já convertidos. A formatação
 * "bonita" (2 casas decimais) só é reaplicada ao perder o foco.
 */

export function centsToReaisInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function parseReaisInputToCents(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function MoneyInput({
  cents,
  onChange,
  placeholder,
  disabled,
}: {
  cents: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => centsToReaisInput(cents));
  // Só resincroniza o texto exibido quando o valor muda por FORA deste
  // campo (ex.: carregamento inicial, reset do formulário) — nunca por
  // causa da própria digitação, senão volta a travar o cursor.
  const lastEmittedCents = useRef(cents);
  useEffect(() => {
    if (cents !== lastEmittedCents.current) {
      lastEmittedCents.current = cents;
      setText(centsToReaisInput(cents));
    }
  }, [cents]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={placeholder ?? "0,00"}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parseReaisInputToCents(raw);
        lastEmittedCents.current = parsed;
        onChange(parsed);
      }}
      onBlur={() => {
        // Normaliza a exibição ("1" -> "1,00") só ao sair do campo.
        setText(centsToReaisInput(lastEmittedCents.current));
      }}
    />
  );
}
