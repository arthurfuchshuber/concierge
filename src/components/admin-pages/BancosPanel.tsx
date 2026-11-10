import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
  disconnectBank,
  getBankConnectToken,
  listBankConnections,
  syncBankConnection,
} from "@/lib/malvo.functions";
import { asaasItem, formatBankAccount, onlyBanks, pickMainAccount } from "@/lib/bank-account-label";
import { ActionSquare, IntegrationShell, PrimaryAction } from "@/components/admin-pages/integration-window";

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

/** Chave única da lista de conexões: Bancos, Asaas PJ e a rota /bancos compartilham o mesmo cache. */
export const BANK_CONNECTIONS_KEY = ["bank-connections"] as const;

/** Conexões e contas (cache compartilhado). Só o dono da conta enxerga; sob personificação fica desligada. */
export function useBankConnections(enabled = true) {
  const list = useServerFn(listBankConnections);
  return useQuery({
    queryKey: BANK_CONNECTIONS_KEY,
    queryFn: () => list(),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/** Janela "Bancos": conectar, atualizar e desconectar as instituições do Open Finance. */
/** `readOnly`: vendo outra conta — não consulta nem conecta bancos da sessão logada. */
export function BancosPanel({ inWindow = false, readOnly = false }: { inWindow?: boolean; readOnly?: boolean }) {
  const qc = useQueryClient();
  const tokenFn = useServerFn(getBankConnectToken);
  const syncFn = useServerFn(syncBankConnection);
  const disconnectFn = useServerFn(disconnectBank);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useBankConnections(!readOnly);

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
          qc.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY });
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
      qc.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY });
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
      qc.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const items = onlyBanks(q.data?.items ?? []);
  const accounts = q.data?.accounts ?? [];

  return (
    <IntegrationShell
      inWindow={inWindow}
      title="Bancos"
      subtitle={`Open Finance · ${items.length} ${items.length === 1 ? "instituição" : "instituições"}`}
      bodyDeps={[items.length, accounts.length]}
      footer={
        readOnly ? undefined : (
          <PrimaryAction icon={<Plus />} onClick={() => connect()} disabled={busy === "new"}>
            Conectar banco
          </PrimaryAction>
        )
      }
    >
      {q.isLoading ? <p className="py-3 text-xs text-muted-foreground">Carregando…</p> : null}
      {!q.isLoading && !items.length ? (
        <p className="py-3 text-xs text-muted-foreground">Nenhum banco conectado ainda.</p>
      ) : null}
      {items.map((it) => (
        <div key={it.malvo_item_id} data-clip-row className="border-b border-border/60 py-2.5 last:border-b-0">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
              {it.connector_name ?? "Banco"}
              {it.environment === "SANDBOX" ? (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">(teste)</span>
              ) : null}
            </p>
            <ActionSquare label="Atualizar" disabled={busy === it.malvo_item_id} onClick={() => resync(it.malvo_item_id)}>
              <RefreshCw />
            </ActionSquare>
            <ActionSquare label="Desconectar" disabled={busy === it.malvo_item_id} onClick={() => disconnect(it.malvo_item_id)}>
              <Unplug />
            </ActionSquare>
          </div>
          <div className="mt-1.5 space-y-1">
            {accounts
              .filter((a) => a.malvo_item_id === it.malvo_item_id)
              .map((a) => (
                <div key={a.malvo_account_id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {a.marketing_name ?? a.name ?? a.subtype ?? "Conta"}
                    {a.number ? ` · ${a.number}` : ""}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">{brl(a.balance)}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </IntegrationShell>
  );
}

/** Janela "Asaas PJ": leitura da conta sincronizada pela API (não há o que conectar pelo painel). */
export function AsaasPanel({ inWindow = false, readOnly = false }: { inWindow?: boolean; readOnly?: boolean }) {
  const q = useBankConnections(!readOnly);
  const item = asaasItem(q.data?.items ?? []);
  const accounts = (q.data?.accounts ?? []).filter((a) => a.malvo_item_id === item?.malvo_item_id);
  const when = item?.last_synced_at
    ? new Date(item.last_synced_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <IntegrationShell
      inWindow={inWindow}
      title="Asaas PJ"
      subtitle="Extrato e transações"
      bodyDeps={[accounts.length]}
    >
      {accounts.length ? (
        accounts.map((a) => (
          <div key={a.malvo_account_id} data-clip-row className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">{a.marketing_name ?? a.name ?? "Conta digital"}</span>
            <span className="shrink-0 font-medium text-foreground">{brl(a.balance)}</span>
          </div>
        ))
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Ainda sem dados do Asaas PJ nesta conta.</p>
      )}
      <p className="pb-3 pt-1 text-[11px] text-muted-foreground">
        {when ? `Última atualização: ${when}. ` : ""}Os dados chegam automaticamente pela API do Asaas.
      </p>
    </IntegrationShell>
  );
}

/** Linhas curtas "Banco · Ag. X · Conta" para os cards (celular e computador). */
export function bankSummaryRows(
  items: Array<{ malvo_item_id: string; connector_name?: string | null }>,
  accounts: Parameters<typeof pickMainAccount>[0],
) {
  return onlyBanks(items).map((it) => {
    const main = pickMainAccount(accounts, it.malvo_item_id);
    return {
      id: it.malvo_item_id,
      name: it.connector_name ?? "Banco",
      account: main ? formatBankAccount(main) : null,
    };
  });
}
