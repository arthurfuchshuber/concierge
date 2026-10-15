import { useEffect, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SyncAlertBanner } from "@/components/stakeholders/SyncAlertBanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: OperationLayout,
});

function OperationLayout() {
  const [returned, setReturned] = useState<null | string>(null);
  // Retorno da autorização do Airbnb: avisa a janela de conexão (outra aba), explica e limpa o endereço.
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("airbnb");
    if (!status) return;
    try {
      localStorage.setItem("airbnb-oauth-return", JSON.stringify({ status, at: Date.now() }));
    } catch {
      /* sem armazenamento: a janela segue pelo tempo limite */
    }
    url.searchParams.delete("airbnb");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    setReturned(status);
  }, []);

  return (
    <>
      <SyncAlertBanner />
      <Outlet />
      <Dialog open={!!returned} onOpenChange={(o) => !o && setReturned(null)}>
        <DialogContent className="max-w-[380px]">
          <DialogTitle>Você voltou do Airbnb</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-2 text-[13px] leading-relaxed">
              {returned === "falhou" ? (
                <p>A autorização não foi concluída no Airbnb. Nenhum anúncio foi importado.</p>
              ) : (
                <p>
                  O Airbnb devolveu você ao ConciergeIA automaticamente. Se a sua conta já estava
                  aberta no Airbnb e já tinha autorizado antes, ele não pede login de novo.
                </p>
              )}
              <p>
                Volte para a aba anterior: a janela de conexão confere sozinha se uma conta nova
                entrou.
              </p>
              <p>
                <b className="text-foreground">Queria conectar outra conta?</b> Na janela de
                conexão, toque em “Copiar link de conexão”, abra numa janela anônima e entre com a
                conta certa.
              </p>
            </div>
          </DialogDescription>
          <div className="grid gap-2">
            <Button onClick={() => window.close()}>Fechar esta aba</Button>
            <Button variant="outline" onClick={() => setReturned(null)}>
              Continuar aqui
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
