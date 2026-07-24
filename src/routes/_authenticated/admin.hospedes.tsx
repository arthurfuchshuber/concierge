import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, Mail, Search, Users, FileText, Car, Clock, Phone } from "lucide-react";
import { listOwnerGuestForms, savePortariaEmail } from "@/lib/guide-access-admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/hospedes")({
  component: HospedesPage,
});

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}
function fmtDate(d: string) {
  try { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; } catch { return d; }
}

type Vehicle = { plate?: string | null; model?: string | null; color?: string | null };
type Document = { guest_name?: string | null; file_url?: string | null; doc_type?: string | null; doc_number?: string | null };
type Row = {
  id: string;
  guest_name: string;
  reservation_code: string | null;
  checkin_date: string;
  guest_phone: string | null;
  guest_phone_country: string | null;
  guest_arrival_time: string | null;
  guest_vehicles: Vehicle[] | null;
  guest_documents: Document[] | null;
  created_at: string;
  property_id: string;
  property_name: string | null;
  portaria_email: string | null;
};

function buildEmailBody(r: Row) {
  const lines: string[] = [];
  lines.push(`Olá, seguem os dados do hóspede para o check-in em ${r.property_name ?? "nossa unidade"}.`);
  lines.push("");
  lines.push(`• Nome: ${r.guest_name}`);
  lines.push(`• Data de check-in: ${fmtDate(r.checkin_date)}`);
  if (r.guest_arrival_time) lines.push(`• Chegada prevista: ${r.guest_arrival_time}`);
  if (r.guest_phone) lines.push(`• Telefone: ${r.guest_phone_country ?? ""} ${r.guest_phone}`.trim());
  if (r.reservation_code) lines.push(`• Reserva: ${r.reservation_code}`);
  if (r.guest_vehicles && r.guest_vehicles.length > 0) {
    lines.push("");
    lines.push("Veículos:");
    r.guest_vehicles.forEach((v, i) => {
      const parts = [v.plate, v.model, v.color].filter(Boolean).join(" · ");
      lines.push(`  ${i + 1}. ${parts || "(sem detalhes)"}`);
    });
  }
  if (r.guest_documents && r.guest_documents.length > 0) {
    lines.push("");
    lines.push("Documentos:");
    r.guest_documents.forEach((d, i) => {
      lines.push(`  ${i + 1}. ${d.guest_name ?? r.guest_name}${d.doc_type ? ` (${d.doc_type})` : ""}${d.doc_number ? ` — ${d.doc_number}` : ""}`);
      if (d.file_url) lines.push(`     Arquivo: ${d.file_url}`);
    });
  }
  lines.push("");
  lines.push("Qualquer dúvida, estou à disposição.");
  return lines.join("\n");
}

function HospedesPage() {
  const listFn = useServerFn(listOwnerGuestForms);
  const saveFn = useServerFn(savePortariaEmail);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["owner-guest-forms"],
    queryFn: () => listFn(),
  });

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState<Row | null>(null);
  const [emailField, setEmailField] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);

  const rows: Row[] = useMemo(() => (data?.logs ?? []) as Row[], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.guest_name, r.property_name ?? "", r.reservation_code ?? "",
        r.guest_phone ?? "", r.checkin_date, r.guest_arrival_time ?? "",
        ...(r.guest_vehicles ?? []).flatMap((v) => [v.plate, v.model, v.color]).filter(Boolean) as string[],
        ...(r.guest_documents ?? []).flatMap((d) => [d.guest_name, d.doc_type, d.doc_number]).filter(Boolean) as string[],
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  function openSend(r: Row) {
    setSendOpen(r);
    setEmailField(r.portaria_email ?? "");
    setSaveDefault(false);
  }

  async function confirmSend() {
    if (!sendOpen) return;
    const to = emailField.trim();
    if (!to) { toast.error("Informe um email de destino."); return; }
    if (saveDefault && to !== (sendOpen.portaria_email ?? "")) {
      try {
        await saveFn({ data: { propertyId: sendOpen.property_id, email: to } });
        toast.success("Email da portaria salvo para este imóvel.");
        refetch();
      } catch { toast.error("Não foi possível salvar o email padrão."); }
    }
    const subject = `Hóspede ${sendOpen.guest_name} — Check-in ${fmtDate(sendOpen.checkin_date)}`;
    const body = buildEmailBody(sendOpen);
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setSendOpen(null);
  }

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <div className="mb-6 pb-5 border-b border-border/60">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">
          Formulários de primeiro acesso
        </p>
        <h1 className="font-display text-2xl sm:text-3xl">Hóspedes</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Todos os dados enviados pelos hóspedes ao abrirem o guia. Baixe documentos e envie tudo para a portaria em 1 clique.
        </p>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, guia, telefone, placa, documento…"
          className="w-full pl-9 pr-3 h-10 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <Users className="size-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "Nenhum hóspede preencheu o formulário ainda." : "Nenhum resultado para a busca."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "registro" : "registros"}
          </div>
          <div className="divide-y divide-border/60">
            {filtered.map((r) => {
              const isOpen = expanded === r.id;
              const hasExtras = (r.guest_vehicles && r.guest_vehicles.length > 0) || (r.guest_documents && r.guest_documents.length > 0) || r.guest_arrival_time;
              return (
                <div key={r.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1 grid sm:grid-cols-[1.2fr_1fr_.8fr_.6fr] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{r.guest_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
                          <span className="truncate">{r.property_name ?? "—"}</span>
                          {r.reservation_code && (
                            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-muted/60 border border-border/60 shrink-0">
                              {r.reservation_code}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate hidden sm:block">
                        {r.guest_phone ? `${r.guest_phone_country ?? ""} ${r.guest_phone}` : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground hidden sm:block">Check-in {fmtDate(r.checkin_date)}</div>
                      <div className="text-[11px] text-muted-foreground text-right whitespace-nowrap">{fmt(r.created_at)}</div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-muted/10 space-y-3">
                      <div className="grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                        {r.guest_arrival_time && (
                          <div className="flex items-center gap-2"><Clock className="size-3.5" /> Chegada prevista: <span className="text-foreground">{r.guest_arrival_time}</span></div>
                        )}
                        {r.guest_phone && (
                          <div className="flex items-center gap-2"><Phone className="size-3.5" /> Telefone: <span className="text-foreground">{r.guest_phone_country ?? ""} {r.guest_phone}</span></div>
                        )}
                        {r.reservation_code && (
                          <div>Reserva: <span className="text-foreground">{r.reservation_code}</span></div>
                        )}
                      </div>

                      {r.guest_vehicles && r.guest_vehicles.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1"><Car className="size-3.5" /> Veículos</div>
                          <ul className="text-xs space-y-1">
                            {r.guest_vehicles.map((v, i) => (
                              <li key={i} className="text-foreground">
                                {[v.plate, v.model, v.color].filter(Boolean).join(" · ") || "(sem detalhes)"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {r.guest_documents && r.guest_documents.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1"><FileText className="size-3.5" /> Documentos</div>
                          <ul className="text-xs space-y-1">
                            {r.guest_documents.map((d, i) => (
                              <li key={i} className="flex items-center gap-2 flex-wrap">
                                <span className="text-foreground">{d.guest_name ?? r.guest_name}</span>
                                {d.doc_type && <span className="text-muted-foreground">· {d.doc_type}</span>}
                                {d.doc_number && <span className="text-muted-foreground">· {d.doc_number}</span>}
                                {d.file_url && (
                                  <a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline ml-1">
                                    <Download className="size-3.5" /> baixar
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {!hasExtras && (
                        <div className="text-xs text-muted-foreground italic">Nenhum dado opcional coletado.</div>
                      )}

                      <div className="pt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openSend(r)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                        >
                          <Mail className="size-3.5" /> Enviar para portaria
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sendOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm grid place-items-center p-4" onClick={() => setSendOpen(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg mb-1">Enviar para portaria</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Hóspede <span className="text-foreground font-medium">{sendOpen.guest_name}</span> · Check-in {fmtDate(sendOpen.checkin_date)}
            </p>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Destinatário</label>
            <input
              type="email"
              value={emailField}
              onChange={(e) => setEmailField(e.target.value)}
              placeholder="portaria@edificio.com"
              className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
              Salvar como email padrão da portaria deste imóvel
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSendOpen(null)}
                className="h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground"
              >Cancelar</button>
              <button
                type="button"
                onClick={confirmSend}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 inline-flex items-center gap-1.5"
              ><Mail className="size-3.5" /> Abrir email</button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              Abriremos seu programa de email com todos os dados já preenchidos. Anexe os documentos baixados, se necessário, antes de enviar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
