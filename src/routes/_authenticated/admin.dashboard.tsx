import { useEffect } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SyncAlertBanner } from "@/components/stakeholders/SyncAlertBanner";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: OperationLayout,
});

function OperationLayout() {
  // Retorno da autorização do Airbnb: avisa a janela de conexão (outra aba) e limpa o endereço.
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
  }, []);

  return (
    <>
      <SyncAlertBanner />
      <Outlet />
    </>
  );
}
