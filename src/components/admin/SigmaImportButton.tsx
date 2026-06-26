import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getMyPropertySigmaState, activateSigmaPackOnProperty, deactivateSigmaPackOnProperty,
  saveGuideAsSigmaPack,
} from "@/lib/sigma-recommendations.functions";
import { Star, Loader2, Lock, Check, Save } from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/useIsAdmin";


export function SigmaImportButton({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const stateFn = useServerFn(getMyPropertySigmaState);
  const activateFn = useServerFn(activateSigmaPackOnProperty);
  const deactivateFn = useServerFn(deactivateSigmaPackOnProperty);

  const [open, setOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["sigma-pack-state", propertyId],
    queryFn: () => stateFn({ data: { property_id: propertyId } }),
  });

  const state = q.data;
  const isActive = !!state?.active_city_key;
  const hasAvailable = !!state?.available_pack;

  async function doActivate() {
    if (!state?.available_pack) return;
    setBusy(true);
    try {
      await activateFn({
        data: { property_id: propertyId, city_key: state.available_pack.city_key },
      });
      toast.success("Recomendação SigmaGuide ativada");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["sigma-pack-state", propertyId] });
      qc.invalidateQueries({ queryKey: ["property"] });
      qc.invalidateQueries({ queryKey: ["recs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ativar");
    } finally { setBusy(false); }
  }

  async function doDeactivate() {
    setBusy(true);
    try {
      await deactivateFn({ data: { property_id: propertyId } });
      toast.success("Recomendação SigmaGuide desativada");
      setConfirmOff(false);
      qc.invalidateQueries({ queryKey: ["sigma-pack-state", propertyId] });
      qc.invalidateQueries({ queryKey: ["property"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao desativar");
    } finally { setBusy(false); }
  }

  if (!hasAvailable && !isActive) return null;

  if (isActive) {
    return (
      <>
        <Button
          size="sm" variant="outline"
          onClick={() => setConfirmOff(true)}
          className="shrink-0 h-8 rounded-full text-xs bg-amber-500/10 border-amber-400/40 text-amber-200 hover:bg-amber-500/20"
          title="SigmaGuide ativo — clique para desativar"
        >
          <Lock className="size-3.5" /> <span className="hidden sm:inline">SigmaGuide ativo</span>
        </Button>
        <AlertDialog open={confirmOff} onOpenChange={(o) => { if (!o) setConfirmOff(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desativar recomendação SigmaGuide?</AlertDialogTitle>
              <AlertDialogDescription>
                Você voltará a editar livremente os pontos da cidade e os links de reservas. Suas configurações anteriores serão restauradas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Manter ativo</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={doDeactivate}>
                {busy && <Loader2 className="size-3.5 animate-spin" />} Desativar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <Button
        size="sm" variant="outline"
        onClick={() => setOpen(true)}
        className="shrink-0 h-8 rounded-full text-xs border-amber-400/40 text-amber-200 hover:bg-amber-500/10"
        title="Importar do SigmaGuide"
      >
        <Star className="size-3.5" /> <span className="hidden sm:inline">Importar do SigmaGuide</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="size-5 text-amber-400" /> Recomendação SigmaGuide
            </DialogTitle>
            <DialogDescription>
              Em 1 clique, importe a curadoria oficial para <strong>{state?.available_pack?.city_label}</strong>: pontos, reservas e perguntas frequentes — tudo testado pela nossa equipe.
            </DialogDescription>
          </DialogHeader>
          {state?.counts && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/40 py-2">
                <div className="text-lg font-display">{state.counts.recs}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pontos</div>
              </div>
              <div className="rounded-lg bg-muted/40 py-2">
                <div className="text-lg font-display">{state.counts.marketplace}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reservas</div>
              </div>
              <div className="rounded-lg bg-muted/40 py-2">
                <div className="text-lg font-display">{state.counts.faqs}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">FAQs</div>
              </div>
            </div>
          )}
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex gap-2"><Check className="size-3.5 text-emerald-400 mt-0.5 shrink-0" /> Conteúdo curado e atualizado pela equipe SigmaGuide.</li>
            <li className="flex gap-2"><Check className="size-3.5 text-emerald-400 mt-0.5 shrink-0" /> Suas edições atuais são salvas e restauradas se desativar.</li>
            <li className="flex gap-2"><Lock className="size-3.5 text-amber-300 mt-0.5 shrink-0" /> Enquanto ativo, esses campos ficam bloqueados para edição.</li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={doActivate} disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Ativar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SigmaActiveBanner({ propertyId }: { propertyId: string }) {
  const stateFn = useServerFn(getMyPropertySigmaState);
  const q = useQuery({
    queryKey: ["sigma-pack-state", propertyId],
    queryFn: () => stateFn({ data: { property_id: propertyId } }),
  });
  if (!q.data?.active_city_key) return null;
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 flex items-center gap-2 text-xs text-amber-100">
      <Lock className="size-4 text-amber-300 shrink-0" />
      <span>
        <strong>Recomendação SigmaGuide ativa.</strong> Pontos da cidade e reservas estão bloqueados para edição enquanto você usar esta curadoria.
      </span>
    </div>
  );
}

// Admin-only: snapshot the current guide into a Sigma pack for its city.
export function SaveAsSigmaPackButton({ propertyId }: { propertyId: string }) {
  const { isAdmin } = useIsAdmin();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveGuideAsSigmaPack);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;

  async function doSave() {
    setBusy(true);
    try {
      const r = await saveFn({ data: { property_id: propertyId } });
      toast.success(
        `Salvo em "${r.city_label}": ${r.counts.recs} pontos, ${r.counts.marketplace} marketplace, ${r.counts.faqs} FAQs.`,
      );
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["sigma-packs"] });
      qc.invalidateQueries({ queryKey: ["sigma-pack"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button
        size="sm" variant="outline"
        onClick={() => setConfirm(true)}
        className="shrink-0 h-8 w-8 p-0 rounded-full text-xs border-fuchsia-400/40 text-fuchsia-200 hover:bg-fuchsia-500/10"
        title="Salvar este guia como recomendação SigmaGuide oficial para a cidade"
        aria-label="Salvar Recomendações SigmaGuide"
      >
        <Save className="size-3.5" />
      </Button>
      <AlertDialog open={confirm} onOpenChange={(o) => { if (!o) setConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar como recomendação SigmaGuide?</AlertDialogTitle>
            <AlertDialogDescription>
              Os pontos da cidade, links de marketplace e FAQs deste guia serão copiados como a recomendação oficial SigmaGuide para a cidade. Se já existir uma recomendação para esta cidade, ela será <strong>substituída</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={doSave}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

