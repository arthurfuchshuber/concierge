import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Landmark, Plus, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import {
  disconnectBank,
  getBankConnectToken,
  listBankConnections,
  syncBankConnection,
} from "@/lib/malvo.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard/bancos")({
  head: () => ({
    meta: [
      { title: "Bancos conectados — ConciergeIA" },
      { name: "description", content: "Contas bancárias da empresa conectadas via Open Finance." },
      { property: "og:title", content: "Bancos conectados — ConciergeIA" },
      { property: "og:description", content: "Contas bancárias da empresa conectadas via Open Finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancosPage,
});

declare global {
  interface Window {
    MalvoConnect?: { init: (o: Record<string, unknown>) => { close: () => void } };
  }
}

function loadWidget(): Promise<void> {
  if (window.MalvoConnect) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://malvo.io/widget.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Não foi possível abrir a conexão com o banco."));
    document.head.appendChild(s);
  });
}

const brl = (v: number | null) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function BancosPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBankConnections);
  const tokenFn = useServerFn(getBankConnectToken);
  const syncFn = useServerFn(syncBankConnection);
  const disconnectFn = useServerFn(disconnectBank);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["bank-connections"], queryFn: () => list() });

  async function connect(itemId?: string) {
    setBusy(itemId ?? "new");
    try {
      const { connectToken } = await tokenFn({ data: { itemId } });
      await loadWidget();
      window.MalvoConnect!.init({
        connectToken,
        onSuccess: async (d: { item?: { id?: string } }) => {
          const id = d?.item?.id;
          if (!id) return;
          toast.success("Banco conectado. Importando os dados…");
          try {
            await syncFn({ data: { itemId: id } });
          } catch {
            /* o aviso automático do banco conclui a importação */
          }
          qc.invalidateQueries({ queryKey: ["bank-connections"] });
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function resync(itemId: string) {
    setBusy(itemId);
    try {
      await syncFn({ data: { itemId } });
      toast.success("Dados atualizados.");
      qc.invalidateQueries({ queryKey: ["bank-connections"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(itemId: string) {
    if (!confirm("Desconectar este banco e revogar o consentimento?")) return;
    setBusy(itemId);
    try {
      await disconnectFn({ data: { itemId } });
      qc.invalidateQueries({ queryKey: ["bank-connections"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const items = q.data?.items ?? [];
  const accounts = q.data?.accounts ?? [];

  return (
    <div className="ds-page ds-stack">
      <div className={`${PANEL_SHELL} flex flex-wrap items-center gap-3 p-4`}>
        <Landmark className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Bancos da empresa</p>
          <p className="text-sm text-muted-foreground">
            {items.length} conexão(ões) · {q.data?.transactions ?? 0} transações importadas
          </p>
        </div>
        <Button onClick={() => connect()} disabled={busy === "new"}>
          <Plus className="h-4 w-4" /> Conectar banco
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!q.isLoading && !items.length && (
        <p className="text-sm text-muted-foreground">Nenhum banco conectado ainda.</p>
      )}

      {items.map((it) => (
        <div key={it.malvo_item_id} className={`${PANEL_SHELL} p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 font-semibold text-foreground">
              {it.connector_name ?? "Banco"}
              {it.environment === "SANDBOX" && <span className="ml-2 text-xs text-muted-foreground">(teste)</span>}
            </p>
            <span className="text-xs text-muted-foreground">{it.status ?? "—"}</span>
            <Button size="icon" variant="ghost" aria-label="Atualizar" disabled={busy === it.malvo_item_id} onClick={() => resync(it.malvo_item_id)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Desconectar" disabled={busy === it.malvo_item_id} onClick={() => disconnect(it.malvo_item_id)}>
              <Unplug className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {accounts
              .filter((a) => a.malvo_item_id === it.malvo_item_id)
              .map((a) => (
                <div key={a.malvo_account_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {a.marketing_name ?? a.name ?? a.subtype ?? "Conta"} {a.number ? `· ${a.number}` : ""}
                  </span>
                  <span className="font-medium text-foreground">{brl(a.balance)}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
