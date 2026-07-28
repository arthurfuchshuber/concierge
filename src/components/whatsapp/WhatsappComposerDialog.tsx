import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendWhatsappFromConversation } from "@/lib/whatsapp.functions";
import { GUIDE_TAGS, type GuideTagKey } from "@/lib/guide-tags";
import { Loader2, MessageCircle, Tag as TagIcon } from "lucide-react";
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
  const [tagOpen, setTagOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sendFn = useServerFn(sendWhatsappFromConversation);

  function insertTag(key: GuideTagKey) {
    const snippet = `[[tag:${key}]]`;
    const el = taRef.current;
    if (!el) {
      setText((t) => (t ? `${t} ${snippet}` : snippet));
    } else {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = text.slice(0, start) + snippet + text.slice(end);
      setText(next);
      // Restaura o cursor após a tag inserida
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
    }
    setTagOpen(false);
  }

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
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Mensagem</Label>
              <Popover open={tagOpen} onOpenChange={setTagOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                    <TagIcon className="size-3.5" />
                    Inserir tag
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="p-0 w-72">
                  <div className="p-2 border-b">
                    <p className="text-xs font-medium">Atalhos para seções do guia</p>
                    <p className="text-[11px] text-muted-foreground">O hóspede recebe o link e vai direto ao local.</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {GUIDE_TAGS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => insertTag(t.key)}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                      >
                        <div className="text-sm font-medium leading-tight">{t.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight">{t.description}</div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Textarea
              ref={taRef}
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite sua mensagem… Use ‘Inserir tag’ para linkar direto uma seção do guia."
              maxLength={4000}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Tags como <code className="text-[10px]">[[tag:senhas-acesso]]</code> são substituídas pelo link do guia no envio. Fora da janela de 24h desde a última resposta do hóspede, apenas templates HSM aprovados serão entregues pela Meta.
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
