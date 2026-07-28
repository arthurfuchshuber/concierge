import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendWhatsappFromConversation } from "@/lib/whatsapp.functions";
import { getTagItemsForConversation } from "@/lib/guide-tag-items.functions";
import { TagMentionTextarea, type TagMentionItem } from "@/components/tags/TagMentionTextarea";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string;
  guestName?: string | null;
  suggestedText?: string;
};

const QUICK_TEMPLATES: Array<{ label: string; text: (name: string) => string }> = [
  { label: "Boas-vindas", text: (n) => `Olá ${n || "!"} Aqui é o anfitrião. Estou passando para desejar uma ótima estadia. Qualquer coisa que precisar, é só me chamar por aqui. Se quiser conferir o Wi-Fi e as senhas, é só abrir: [[tag:senhas-acesso]].` },
  { label: "Lembrete de check-in", text: (n) => `Oi ${n || ""}! Só passando para confirmar sua chegada. Passo a passo completo aqui: [[tag:checkin-instrucoes]].` },
  { label: "Instruções de saída", text: (n) => `Oi ${n || ""}! Amanhã é o dia do seu check-out. Deixei o passo a passo aqui: [[tag:checkout-instrucoes]]. Muito obrigado pela estadia!` },
];

export function WhatsappComposerDialog({ open, onOpenChange, conversationId, guestName, suggestedText }: Props) {
  const [text, setText] = useState(suggestedText ?? "");
  const sendFn = useServerFn(sendWhatsappFromConversation);
  const fetchItems = useServerFn(getTagItemsForConversation);

  const { data: itemsData } = useQuery({
    queryKey: ["tag-items", "conv", conversationId],
    queryFn: () => fetchItems({ data: { conversationId } }),
    enabled: open,
    staleTime: 60_000,
  });
  const items = useMemo<TagMentionItem[]>(() => (itemsData?.items ?? []).map((i) => ({
    key: i.key, param: i.param, label: i.label, hint: i.hint,
  })), [itemsData]);

  const m = useMutation({
    mutationFn: async () => sendFn({ data: { conversationId, text: text.trim() } }),
    onSuccess: () => {
      toast.success("Mensagem enviada por WhatsApp.");
      setText("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5 text-emerald-600" />
            Enviar mensagem por WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_TEMPLATES.map((t) => (
              <Button key={t.label} variant="outline" size="sm" onClick={() => setText(t.text(guestName?.split(" ")[0] ?? ""))}>
                {t.label}
              </Button>
            ))}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Mensagem</Label>
            <TagMentionTextarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite sua mensagem… Use @ para linkar uma seção do guia (Wi-Fi, senhas, chegada) ou um item específico (FAQ, recomendação)."
              maxLength={4000}
              items={items}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Tags como <code className="text-[10px]">[[tag:senhas-acesso]]</code> viram links do guia no envio. Fora da janela de 24h desde a última resposta do hóspede, só templates HSM aprovados são entregues pela Meta.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={!text.trim() || m.isPending}>
            {m.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
