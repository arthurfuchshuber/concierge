import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { teachAiFromMessage } from "@/lib/chat-feedback.functions";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  messageId: string | null;
  userQuestion: string;
  aiAnswer: string;
  onTaught?: () => void;
};

export function TeachAiDialog({ open, onOpenChange, messageId, userQuestion, aiAnswer, onTaught }: Props) {
  const teach = useServerFn(teachAiFromMessage);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  /** G = Hóspede Ativo · I = Equipe Interna (a IA nunca repassa ao hóspede). */
  const [aud, setAud] = useState<"G" | "I">("G");

  useEffect(() => {
    if (open) {
      const auto = userQuestion.trim().slice(0, 60);
      setTitle(auto ? `Aprendizado: ${auto}` : "Novo aprendizado de comportamento");
      setBody("");
      setAud("G");
    }
  }, [open, userQuestion]);

  async function handleSave() {
    if (!messageId) return;
    if (title.trim().length < 3 || body.trim().length < 3) {
      toast.error("Preencha título e instrução.");
      return;
    }
    setSaving(true);
    try {
      await teach({ data: { messageId, title: title.trim(), body: body.trim(), audience: aud } });
      toast.success("IA atualizada — esse aprendizado entrou no comportamento.");
      onOpenChange(false);
      onTaught?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ensinar a IA");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Ensinar IA
          </DialogTitle>
          <DialogDescription>
            Esse aprendizado vai para a base de <strong>Comportamento da IA</strong> e passará a guiar
            as respostas em todos os seus imóveis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Pergunta do hóspede</p>
              <p className="mt-0.5 text-sm">{userQuestion || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Resposta atual da IA</p>
              <p className="mt-0.5 text-sm text-muted-foreground line-clamp-4">{aiAnswer || "—"}</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Título do aprendizado</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium">Como a IA deveria responder / se comportar</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={6}
              placeholder="Ex.: Quando o hóspede perguntar sobre estacionamento, sempre comece confirmando que o prédio tem vaga e oriente o uso do controle entregue no check-in."
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Quem pode receber esta informação</label>
            <div className="mt-1 space-y-1.5">
              {(
                [
                  ["G", "Hóspede Ativo", "A IA pode informar ao hóspede."],
                  ["I", "Equipe Interna", "A IA usa só com a equipe e nunca repassa ao hóspede."],
                ] as const
              ).map(([k, t, s]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAud(k)}
                  className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                    aud === k ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"
                  }`}
                >
                  <div className="font-medium">{t}</div>
                  <div className="text-[11px] text-muted-foreground">{s}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Sparkles className="size-4 mr-1.5" />}
            Salvar aprendizado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
