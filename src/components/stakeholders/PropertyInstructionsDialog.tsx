import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CoverImage } from "@/components/ui/cover-image";
import type { PropertyListItem } from "./property-actions";

/**
 * "Instruções de Check-In" / "Instruções de Checkout" do imóvel, só leitura
 * (o texto é o mesmo que o hóspede vê no Guia Digital). Para alterar, o
 * caminho é o editor do imóvel.
 */
export type InstructionsKind = "checkin" | "checkout";

export function PropertyInstructionsDialog({
  property,
  kind,
  onOpenChange,
}: {
  property: PropertyListItem | null;
  kind: InstructionsKind;
  onOpenChange: (open: boolean) => void;
}) {
  const p = property;
  const isIn = kind === "checkin";
  const title = isIn ? "Instruções de Check-In" : "Instruções de Checkout";
  const time = (isIn ? p?.checkin_time : p?.checkout_time)?.slice(0, 5) || "";
  const note = ((isIn ? p?.checkin_note : p?.checkout_note) ?? "").trim();
  const text = ((isIn ? p?.checkin_instructions : p?.checkout_instructions) ?? "").trim();
  const empty = !note && !text;
  const full = [note, text].filter(Boolean).join("\n\n");
  return (
    <Dialog open={!!p} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[75dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        {p && (
          <>
            <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4 pr-14">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-[10px] bg-secondary">
                <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} empty={false} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {title}
                </div>
                <DialogTitle
                  className="mt-0.5 block truncate text-[14px] font-bold leading-tight"
                  title={p.name}
                >
                  {p.name}
                </DialogTitle>
                {time && (
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {isIn ? "Entrada" : "Saída"} a partir das{" "}
                    <b className="font-bold text-foreground">{time}</b>
                  </div>
                )}
              </div>
            </div>
            <DialogDescription className="sr-only">{title} deste imóvel.</DialogDescription>
            <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              {empty ? (
                <p className="rounded-[var(--win-radius)] bg-foreground/[0.04] px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                  Nenhuma instrução cadastrada para este imóvel.
                </p>
              ) : (
                <div className="grid gap-2 rounded-[var(--win-radius)] bg-foreground/[0.04] px-3 py-3 text-[13px] leading-relaxed">
                  {note && <p className="whitespace-pre-wrap font-semibold">{note}</p>}
                  {text && <p className="whitespace-pre-wrap">{text}</p>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2 px-4 pb-4 pt-1">
              {!empty && (
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(full)
                      .then(() => toast.success("Instruções copiadas"))
                      .catch(() => toast.error("Não foi possível copiar"))
                  }
                >
                  <Copy className="size-3.5" /> Copiar
                </Button>
              )}
              <Button variant="outline" asChild className="flex-1">
                <Link to="/admin/properties/$id" params={{ id: p.id }}>
                  {empty ? "Cadastrar no imóvel" : "Editar no imóvel"}
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
