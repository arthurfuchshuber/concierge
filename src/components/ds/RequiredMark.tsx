/** "(obrigatório)" em letra pequena vermelha, à direita do rótulo de um campo obrigatório. */
export function RequiredMark() {
  return (
    <span className="ml-1 align-baseline text-[9px] font-semibold normal-case tracking-normal text-destructive">
      (obrigatório)
    </span>
  );
}
