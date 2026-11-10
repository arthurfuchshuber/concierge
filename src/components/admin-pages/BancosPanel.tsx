import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Clock, Info, Landmark, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  disconnectBank,
  getBankConnectToken,
  listBankConnections,
  syncBankConnection,
} from "@/lib/malvo.functions";
import {
  accountDetail,
  accountTitle,
  asaasItem,
  formatBankAccount,
  onlyBanks,
  pickMainAccount,
  plural,
  summarizeBanks,
  syncedLabel,
} from "@/lib/bank-account-label";
import { cn } from "@/lib/utils";
import { IntegrationShell } from "@/components/admin-pages/integration-window";

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
export function useBankConnections(enabled = true, ownerId: string | null = null) {
  const list = useServerFn(listBankConnections);
  return useQuery({
    queryKey: [...BANK_CONNECTIONS_KEY, ownerId],
    queryFn: () => list({ data: { ownerId } }),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/** Janela "Bancos": conectar, atualizar e desconectar as instituições do Open Finance. */
/** `ownerId`: conta em tela (membro de equipe/admin). O servidor valida o acesso e conecta sempre sob o titular. `readOnly` só esconde as ações. */
export function BancosPanel({ inWindow = false, readOnly = false, ownerId = null }: { inWindow?: boolean; readOnly?: boolean; ownerId?: string | null }) {
  const qc = useQueryClient();
  const tokenFn = useServerFn(getBankConnectToken);
  const syncFn = useServerFn(syncBankConnection);
  const disconnectFn = useServerFn(disconnectBank);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useBankConnections(true, ownerId);

  async function connect(itemId?: string) {
    setBusy(itemId ?? "new");
    try {
      const { connectToken } = await tokenFn({ data: { itemId, ownerId } });
      await loadWidget();
      window.MalvoConnect!.init({
        connectToken,
        onSuccess: async (d: { item?: { id?: string } }) => {
          const id = d?.item?.id;
          if (!id) return;
          toast.success("Banco conectado. Importando os dados…");
          try {
            await syncFn({ data: { itemId: id, ownerId } });
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

  async function disconnect(itemId: string) {
    if (!confirm("Desconectar este banco e revogar o consentimento?")) return;
    setBusy(itemId);
    try {
      await disconnectFn({ data: { itemId, ownerId } });
      qc.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const items = onlyBanks(q.data?.items ?? []);
  const accounts = q.data?.accounts ?? [];
  const bankAccounts = accounts.filter((a) => items.some((it) => it.malvo_item_id === a.malvo_item_id));
  const totals = summarizeBanks(bankAccounts);

  return (
    <IntegrationShell
      inWindow={inWindow}
      icon={<Landmark />}
      title="Bancos"
      subtitle="Open Finance"
      bodyDeps={[items.length, accounts.length]}
      footer={
        readOnly ? undefined : (
          <button
            type="button"
            onClick={() => connect()}
            disabled={busy === "new"}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-foreground text-[13px] font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="size-4" strokeWidth={2.2} />
            Conectar banco
          </button>
        )
      }
    >
      {q.isLoading ? <p className="py-3 text-xs text-muted-foreground">Carregando…</p> : null}
      {!q.isLoading && !items.length ? (
        <p className="py-3 text-xs text-muted-foreground">Nenhum banco conectado ainda.</p>
      ) : null}
      {items.length ? (
        <SummaryCard
          label="Saldo em contas"
          value={brl(totals.saldo)}
          chips={[
            plural(items.length, "instituição", "instituições"),
            plural(totals.contas, "conta", "contas"),
            ...(totals.cartoes ? [plural(totals.cartoes, "cartão", "cartões")] : []),
          ]}
        />
      ) : null}
      {items.map((it) => {
        const mine = accounts.filter((a) => a.malvo_item_id === it.malvo_item_id);
        const synced = syncedLabel(it.last_synced_at);
        return (
          <section
            key={it.malvo_item_id}
            data-clip-row
            className="mt-2.5 rounded-[14px] border border-border/70 bg-background px-3.5 pb-1 pt-3 first-of-type:mt-3"
          >
            <div className="flex items-start gap-2.5 border-b border-border/70 pb-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-extrabold leading-[17px] text-foreground">
                  {it.connector_name ?? "Banco"}
                  {it.environment === "SANDBOX" ? (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">(teste)</span>
                  ) : null}
                </p>
                {synced ? (
                  <p className="mt-px flex items-center gap-[5px] text-[10.5px] leading-[14px] text-muted-foreground">
                    <i aria-hidden className="size-[5px] rounded-full bg-[#7fb79a]" />
                    {synced}
                  </p>
                ) : null}
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label="Desconectar"
                  title="Desconectar"
                  disabled={busy === it.malvo_item_id}
                  onClick={() => disconnect(it.malvo_item_id)}
                  className="grid h-[17px] shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 [&_svg]:size-4"
                >
                  <Trash2 strokeWidth={1.9} />
                </button>
              )}
            </div>
            {mine.map((a, i) => (
              <AccountLine
                key={a.malvo_account_id}
                title={accountTitle(a)}
                detail={accountDetail(a)}
                value={a.balance}
                first={i === 0}
              />
            ))}
          </section>
        );
      })}
    </IntegrationShell>
  );
}

/** Quadro de destaque do topo das janelas (rótulo dourado, valor e chips). */
function SummaryCard({ label, value, chips, negative }: { label: string; value: string; chips: string[]; negative?: boolean }) {
  return (
    <div data-clip-row className="rounded-[14px] border border-border/70 bg-background px-4 py-3.5">
      <p className="text-[9.5px] font-extrabold uppercase leading-[13px] tracking-[0.14em] text-[#a07a1e] dark:text-[#c9a962]">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[22px] font-extrabold leading-7 tracking-[-0.02em] tabular-nums",
          negative ? "text-[#fb2c36] dark:text-[#ff6467]" : "text-foreground",
        )}
      >
        {value}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className="inline-flex h-5 items-center rounded-full bg-foreground/[0.07] px-2 text-[10px] font-bold text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Linha de conta: título + detalhe à esquerda, saldo à direita (zerado fica discreto). */
function AccountLine({ title, detail, value, first }: { title: string; detail: string | null; value: number | string | null; first?: boolean }) {
  const zero = Number(value ?? 0) === 0;
  return (
    <div className={cn("flex items-center justify-between gap-2.5 py-2.5", !first && "border-t border-border/70")}>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold leading-4 text-foreground">{title}</p>
        {detail ? <p className="mt-px truncate text-[10.5px] leading-[14px] tabular-nums text-muted-foreground">{detail}</p> : null}
      </div>
      <span className={cn("shrink-0 text-[13px] tabular-nums", zero ? "font-semibold text-muted-foreground" : "font-extrabold text-foreground")}>
        {brl(value == null ? null : Number(value))}
      </span>
    </div>
  );
}

/** Janela "Asaas PJ": leitura da conta sincronizada pela API (não há o que conectar pelo painel). */
export function AsaasPanel({ inWindow = false, readOnly: _readOnly = false, ownerId = null }: { inWindow?: boolean; readOnly?: boolean; ownerId?: string | null }) {
  const q = useBankConnections(true, ownerId);
  const item = asaasItem(q.data?.items ?? []);
  const accounts = (q.data?.accounts ?? []).filter((a) => a.malvo_item_id === item?.malvo_item_id);
  const saldo = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const when = item?.last_synced_at
    ? new Date(item.last_synced_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <IntegrationShell
      inWindow={inWindow}
      icon={<Wallet />}
      title="Asaas PJ"
      subtitle="Extrato e transações"
      bodyDeps={[accounts.length]}
    >
      {accounts.length ? (
        <>
          <SummaryCard
            label="Saldo da conta"
            value={brl(saldo)}
            negative={saldo < 0}
            chips={[plural(accounts.length, "conta", "contas"), "Via API"]}
          />
          {accounts.map((a) => (
            <div
              key={a.malvo_account_id}
              data-clip-row
              className="mt-3 flex items-center gap-2.5 rounded-[14px] border border-border/70 bg-background px-3.5 py-3"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted text-foreground [&_svg]:size-3.5">
                <Wallet />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-extrabold leading-[17px] text-foreground">
                  {a.marketing_name ?? a.name ?? "Conta Asaas PJ"}
                </p>
                {when ? (
                  <p className="mt-px flex items-center gap-[5px] text-[10.5px] leading-[14px] text-muted-foreground">
                    <Clock className="size-[11px]" strokeWidth={2} />
                    Atualizado em {when}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Ainda sem dados do Asaas PJ nesta conta.</p>
      )}
      <p className="flex items-start gap-2 pb-4 pt-3 text-[11px] leading-4 text-muted-foreground">
        <Info className="mt-px size-[13px] shrink-0" strokeWidth={2} />
        Os dados chegam automaticamente pela API do Asaas — não há nada para conectar por aqui.
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
