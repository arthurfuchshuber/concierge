import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { suggestKnowledgeFill, applyKnowledgeFill } from "@/lib/knowledge-fill.functions";

type Props = {
  conversationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApplied?: () => void;
};

/**
 * Fluxo "completar informação": a IA sugere onde guardar o dado faltante,
 * o usuário revisa/edita, salva — e a IA responde ao hóspede na sequência.
 */
export function KnowledgeFillDialog({ conversationId, open, onOpenChange, onApplied }: Props) {
  const suggestFn = useServerFn(suggestKnowledgeFill);
  const applyFn = useServerFn(applyKnowledgeFill);
  const [target, setTarget] = useState<string>("property_detail");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");

  const { data: suggestion, isLoading } = useQuery({
    queryKey: ["knowledge-fill", conversationId],
    enabled: open,
    staleTime: 0,
    queryFn: () => suggestFn({ data: { conversationId } }),
  });

  useEffect(() => {
    if (!suggestion) return;
    setTarget(suggestion.target);
    setTitle(suggestion.title ?? "");
    setContent(suggestion.content ?? "");
  }, [suggestion]);

  const apply = useMutation({
    mutationFn: () =>
      applyFn({
        data: { conversationId, target: target as never, title: title || null, content, mode },
      }),
    onSuccess: (res) => {
      toast.success(
        res.reply ? "Informação salva — a IA já respondeu ao hóspede." : "Informação salva e aprendida pela IA.",
      );
      onOpenChange(false);
      onApplied?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isField = ["checkin_instructions", "checkout_instructions", "house_rules", "address_note"].includes(target);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg z-[2147483600]">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Completar informação
          </DialogTitle>
        </DialogHeader>

        {isLoading || !suggestion ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="size-4 animate-spin" /> A IA está analisando onde guardar essa informação…
          </div>
        ) : (
          <div className="space-y-3">
            {suggestion.question && (
              <p className="text-xs text-muted-foreground">
                Pergunta do hóspede: <span className="text-foreground">“{suggestion.question}”</span>
              </p>
            )}
            {suggestion.rationale && (
              <p className="text-[11px] rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-foreground/80">
                {suggestion.rationale}
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Onde salvar</Label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {suggestion.targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {!isField && (
              <div className="space-y-1.5">
                <Label className="text-xs">Título</Label>
                <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Opcional" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Informação</Label>
              <Textarea rows={6} value={content} maxLength={8000} onChange={(e) => setContent(e.target.value)} />
            </div>

            {isField && suggestion.currentValue && (
              <div className="flex items-center gap-3 text-[11px]">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> Adicionar ao final
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Substituir tudo
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button size="sm" disabled={apply.isPending || content.trim().length < 3} onClick={() => apply.mutate()}>
                {apply.isPending ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Check className="size-3.5 mr-1.5" />}
                Salvar e responder
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
