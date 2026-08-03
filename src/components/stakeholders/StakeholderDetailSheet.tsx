import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Plus,
  Pencil,
  CheckCircle2,
  Circle,
  CircleDot,
  Trash2,
  Home,
  Link2,
  Unlink,
  ExternalLink,
  CalendarDays,
  Video,
  Download,
  TrendingUp,
  AlertTriangle,
  Pin,
  Upload,
  Eye,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTaxId, formatIntlPhone, toWhatsappNumber } from "@/lib/masks";
import {
  getStakeholderDetail,
  addStakeholderNote,
  saveStakeholderActivity,
  setStakeholderActivityStatus,
  deleteStakeholderActivity,
  linkPropertyToOwner,
} from "@/lib/stakeholders.functions";
import { getStakeholderIntegrationFeed } from "@/lib/stakeholder-feed.functions";
import type { StakeholderKind } from "./StakeholderDirectory";
import { PROVIDER_CATEGORIES } from "./StakeholderDirectory";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const STATUS_META: Record<string, { label: string; icon: typeof Circle; cls: string }> = {
  todo: { label: "A fazer", icon: Circle, cls: "text-muted-foreground" },
  doing: { label: "Em andamento", icon: CircleDot, cls: "text-amber-500" },
  done: { label: "Concluída", icon: CheckCircle2, cls: "text-emerald-500" },
};

export function StakeholderDetailSheet({
  kind,
  id,
  onEdit,
}: {
  kind: StakeholderKind;
  id: string;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStakeholderDetail);
  const noteFn = useServerFn(addStakeholderNote);
  const actFn = useServerFn(saveStakeholderActivity);
  const actStatusFn = useServerFn(setStakeholderActivityStatus);
  const actDelFn = useServerFn(deleteStakeholderActivity);
  const linkFn = useServerFn(linkPropertyToOwner);

  const [note, setNote] = useState("");
  const [newActivity, setNewActivity] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const queryKey = ["stakeholder-detail", kind, id];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => detailFn({ data: { kind, id } }),
    refetchInterval: 20_000,
  });

  const feedFn = useServerFn(getStakeholderIntegrationFeed);
  const feed = useQuery({
    queryKey: ["stakeholder-feed", kind, id],
    queryFn: () => feedFn({ data: { type: kind, id } }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const row = data?.row as Record<string, any> | null | undefined;

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await noteFn({ data: { kind, id, message: note.trim() } });
      setNote("");
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addActivity() {
    if (!newActivity.trim()) return;
    setBusy(true);
    try {
      await actFn({
        data: { kind, stakeholderId: id, title: newActivity.trim(), status: "todo", priority: "normal" },
      });
      setNewActivity("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cycleStatus(activityId: string, current: string) {
    const next = current === "todo" ? "doing" : current === "doing" ? "done" : "todo";
    await actStatusFn({ data: { id: activityId, status: next as "todo" | "doing" | "done" } });
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
  }

  async function removeActivity(activityId: string) {
    await actDelFn({ data: { id: activityId } });
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
  }

  async function toggleLink(propertyId: string, link: boolean) {
    setBusy(true);
    try {
      await linkFn({ data: { ownerId: id, propertyId, link } });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !row) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Carregando ficha...
      </div>
    );
  }

  const categoryLabel =
    kind === "provider"
      ? PROVIDER_CATEGORIES.find((c) => c.value === row.category)?.label ?? "Outros"
      : null;

  const feedEvents = feed.data?.events ?? [];
  const feedDocs = feed.data?.documents ?? [];
  const activities = data?.activities ?? [];
  const events = data?.events ?? [];
  const properties = data?.properties ?? [];
  const available = data?.availableProperties ?? [];
  const openCount = activities.filter((a: any) => a.status !== "done").length;
  const displayName = row.trade_name || row.name;
  const initial = String(displayName ?? "?").trim().charAt(0).toUpperCase();

  const timeline = [
    ...events.map((ev: any) => ({
      key: `n:${ev.id}`,
      at: ev.created_at as string,
      icon: Pin,
      title: ev.message as string,
      badge: "Registro",
      body: null as React.ReactNode,
    })),
    ...feedEvents.map((ev) => ({
      key: `g:${ev.id}`,
      at: ev.at ?? "",
      icon: CalendarDays,
      title: ev.title,
      badge: ev.calendarName || "Agenda",
      body: (
        <>
          {ev.htmlLink && (
            <a
              href={ev.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir convite <ExternalLink className="size-3" />
            </a>
          )}
          {ev.attendees.length > 0 && (
            <p className="text-xs text-muted-foreground">{ev.attendees.length} participante(s)</p>
          )}
          {ev.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ev.attachments.map((a) => (
                <a
                  key={a.url}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {a.kind === "transcript" ? <FileText className="size-2.5" /> : <Video className="size-2.5" />}
                  {a.kind === "transcript" ? "Transcrição" : a.kind === "recording" ? "Gravação" : a.title}
                </a>
              ))}
            </div>
          )}
        </>
      ),
    })),
    ...feedDocs.map((d) => ({
      key: `d:${d.id}`,
      at: d.at ?? "",
      icon: FileText,
      title: d.name,
      badge: "ClickSign",
      body: (
        <>
          <p className="text-xs text-muted-foreground">
            {d.status ?? "—"}
            {d.signers.length > 0 ? ` · ${d.signers.length} signatário(s)` : ""}
          </p>
          {(d.urlSigned || d.urlOriginal) && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setPreview({ name: d.name, url: (d.urlSigned ?? d.urlOriginal) as string })
                }
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Eye className="size-3" /> Visualizar
              </button>
              <a
                href={(d.urlSigned ?? d.urlOriginal) as string}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Abrir documento <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </>
      ),
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return (
    <div className="flex flex-col gap-5 px-5 py-6 sm:px-6">
      {/* Header card */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/15 font-display text-2xl text-primary">
            {initial}
          </div>
          <div className="min-w-0">
            <h2
              className="font-display text-xl sm:text-2xl leading-tight truncate"
              title={displayName}
            >
              {displayName}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  row.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "border-border text-muted-foreground"
                }`}
              >
                {row.status === "active" ? "Ativo" : "Inativo"}
              </span>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground uppercase">
                {String(row.person_type ?? "pf")}
              </span>
              {categoryLabel && (
                <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  {categoryLabel}
                </span>
              )}
              <Button variant="outline" size="sm" className="rounded-full ml-auto" onClick={onEdit}>
                <Pencil className="size-3.5 mr-1.5" /> Editar
              </Button>
            </div>
          </div>
        </div>

        <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
          <InfoRow label="Nome completo" value={row.name} />
          {row.trade_name && <InfoRow label="Nome fantasia" value={row.trade_name} />}
          {row.doc && (
            <InfoRow label={String(row.doc_type ?? "cpf").toUpperCase()} value={formatTaxId(row.doc)} mono />
          )}
          {(row.email || row.phone) && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              {row.email ? (
                <a
                  href={`mailto:${row.email}`}
                  className="inline-flex min-w-0 items-center gap-2 text-sm text-foreground hover:underline"
                >
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{row.email}</span>
                </a>
              ) : (
                <span />
              )}
              <WhatsAppLink phone={row.phone} country={row.phone_country} />
            </div>
          )}
          {(row.address || row.city || row.state) && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                {[row.address, row.district, [row.city, row.state].filter(Boolean).join(" / ")]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          )}
        </dl>
      </section>

      <Tabs defaultValue="visao">
        <div className="rounded-2xl border border-border bg-card p-2">
          <TabsList className="w-full bg-transparent gap-1">
            <TabsTrigger value="visao">Visão Geral</TabsTrigger>
            {kind === "owner" && <TabsTrigger value="imoveis">Imóveis</TabsTrigger>}
            <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
          </TabsList>
        </div>


        {/* -------------------- Visão Geral -------------------- */}
        <TabsContent value="visao" className="mt-5 space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-muted-foreground" /> Visão Macro
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {kind === "owner" && (
                <li className="flex items-start gap-2">
                  <Home className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                  {properties.length > 0
                    ? `${properties.length} residência(s) vinculada(s).`
                    : "Nenhuma residência vinculada."}
                </li>
              )}
              <li className="flex items-start gap-2">
                {openCount > 0 ? (
                  <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                ) : (
                  <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-500" />
                )}
                {openCount > 0 ? `${openCount} atividade(s) em aberto.` : "Nenhuma atividade em aberto."}
              </li>
              <li className="flex items-start gap-2">
                <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                {timeline.length} registro(s) na linha do tempo.
              </li>
            </ul>
          </section>

          {kind === "provider" && row.hourly_rate_cents ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCard
                label="Valor / hora"
                value={(row.hourly_rate_cents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              />
            </div>
          ) : null}

          {row.notes && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Observações</p>
              <p className="text-sm whitespace-pre-wrap">{row.notes}</p>
            </section>
          )}


          <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <h3 className="text-sm font-semibold truncate">Atividades</h3>
              <span className="text-[11px] text-muted-foreground shrink-0">{openCount} em aberto</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newActivity}
                onChange={(e) => setNewActivity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addActivity()}
                placeholder="Nova atividade..."
                className="rounded-full text-sm"
              />
              <Button size="sm" className="rounded-full shrink-0" onClick={addActivity} disabled={busy}>
                <Plus className="size-4" />
              </Button>
            </div>
            {activities.map((a: any) => {
              const meta = STATUS_META[a.status] ?? STATUS_META.todo;
              const StatusIcon = meta.icon;
              return (
                <div
                  key={a.id}
                  className="group flex items-start gap-2.5 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => cycleStatus(a.id, a.status)}
                    className={`mt-0.5 ${meta.cls}`}
                    title={meta.label}
                  >
                    <StatusIcon className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${a.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {a.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {meta.label}
                      {a.due_date ? ` · vence ${a.due_date.split("-").reverse().join("/")}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeActivity(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma atividade registrada.</p>
            )}
          </section>

          {/* Linha do tempo */}
          <section className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <h3 className="font-display text-xl truncate">Linha do Tempo</h3>
              {feed.isLoading && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                  <Loader2 className="size-3 animate-spin" /> Sincronizando…
                </span>
              )}
            </div>

            <div className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Adicionar nota..."
                className="text-sm"
              />
              <Button size="sm" className="rounded-full shrink-0" onClick={submitNote} disabled={busy}>
                <Plus className="size-4" />
              </Button>
            </div>

            {feed.data?.calendarError && (
              <p className="text-[11px] text-destructive">Google Agenda: {feed.data.calendarError}</p>
            )}

            {timeline.length === 0 ? (
              <Placeholder
                icon={Pin}
                title="Sem registros ainda"
                desc="Notas, convites de agenda e documentos aparecem aqui automaticamente."
              />
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-6">
                {timeline.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key} className="relative">
                      <span className="absolute -left-[29px] top-4 size-2.5 rounded-full bg-primary/70 ring-4 ring-background" />
                      <div className="rounded-2xl border border-border bg-card px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium break-words">{item.title}</p>
                            <p className="text-[11px] text-muted-foreground">{item.badge}</p>
                            {item.body}
                            <p className="text-[11px] text-muted-foreground/80">
                              {item.at ? fmt(item.at) : "Sem data"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </TabsContent>

        {/* -------------------- Imóveis -------------------- */}
        {kind === "owner" && (
          <TabsContent value="imoveis" className="mt-5 space-y-5">
            <section className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <h3 className="font-display text-xl truncate">Imóveis vinculados</h3>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {properties.length} residência(s)
                </span>
              </div>

              {properties.length === 0 ? (
                <Placeholder
                  icon={Home}
                  title="Nenhuma residência vinculada"
                  desc="Vincule uma residência existente abaixo ou crie uma nova para este proprietário."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {properties.map((p: any) => (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-border bg-card p-4 space-y-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <p className="text-sm font-medium break-words">{p.name}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                            p.published
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {p.published ? "Publicado" : "Rascunho"}
                        </span>
                      </div>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        {[p.city, p.state].filter(Boolean).join(" / ") || "Sem localização"}
                      </p>
                      <div className="flex items-center gap-1 pt-1">
                        <Link
                          to="/admin/properties/$id"
                          params={{ id: p.id }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <ExternalLink className="size-3" /> Abrir
                        </Link>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleLink(p.id, false)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Unlink className="size-3" /> Desvincular
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {available.length > 0 && (
              <section className="rounded-2xl border border-dashed border-border p-5 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Vincular residência existente
                </p>
                {available.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleLink(p.id, true)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary transition-colors"
                  >
                    <span className="truncate">{p.name}</span>
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </section>
            )}

            <Link
              to="/admin/properties/$id"
              params={{ id: "new" }}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Criar nova residência
            </Link>
          </TabsContent>
        )}



        {/* -------------------- Financeiro -------------------- */}
        <TabsContent value="financeiro" className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyCard label="A receber" value={0} tone="emerald" />
            <MoneyCard label="Recebido" value={0} tone="primary" />
            <MoneyCard label="A pagar" value={0} tone="amber" />
          </div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-4 gap-3 border-b border-border px-4 py-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Tipo</span>
              <span>Descrição</span>
              <span>Vencimento</span>
              <span className="text-right">Valor</span>
            </div>
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhum lançamento financeiro para este cadastro.
            </p>
          </div>
        </TabsContent>

        {/* -------------------- Documentos -------------------- */}
        <TabsContent value="documentos" className="mt-5 space-y-6">
          <section className="space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <h3 className="font-display text-xl truncate">Contratos e aditivos</h3>
              <span className="text-[11px] text-muted-foreground shrink-0">{feedDocs.length} documento(s)</span>
            </div>
            {feed.isLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Buscando documentos…
              </p>
            ) : feedDocs.length === 0 ? (
              <Placeholder
                icon={Upload}
                title="Nenhum contrato vinculado"
                desc="Contratos importados do ClickSign com este CPF/CNPJ, e-mail ou nome aparecem aqui automaticamente."
              />
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {feedDocs.map((d) => {
                  const url = (d.urlSigned || d.urlOriginal) as string | null;
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.status ?? "—"}
                          {d.at ? ` · ${fmt(d.at)}` : ""}
                          {d.signers.length > 0 ? ` · ${d.signers.length} signatários` : ""}
                        </p>
                      </div>
                      {url && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPreview({ name: d.name, url })}
                            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            title="Visualizar"
                          >
                            <Eye className="size-4" />
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            title="Baixar"
                          >
                            <Download className="size-4" />
                          </a>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DocPreviewDialog({
  doc,
  onClose,
}: {
  doc: { name: string; url: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base truncate pr-8">{doc?.name}</DialogTitle>
        </DialogHeader>
        {doc && (
          <>
            <iframe
              src={doc.url}
              title={doc.name}
              className="h-[70vh] w-full border-t border-border bg-muted"
            />
            <div className="flex justify-end gap-2 px-5 py-3">
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="size-3.5" /> Abrir em nova aba
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] items-baseline gap-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm break-words ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function WhatsAppLink({ phone, country }: { phone?: string | null; country?: string | null }) {
  if (!phone) return null;
  const waNumber = toWhatsappNumber(phone, country);
  if (!waNumber) return null;
  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400 transition"
    >
      <MessageCircle className="size-3" />
      {formatIntlPhone(phone, country)}
    </a>
  );
}


function MoneyCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "primary" | "amber";
}) {
  const toneCls =
    tone === "emerald" ? "text-emerald-500" : tone === "amber" ? "text-amber-500" : "text-primary";
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4">
      <p className={`text-[11px] uppercase tracking-wide ${toneCls}`}>{label}</p>
      <p className="font-display text-2xl tabular-nums mt-1">
        {(value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5 break-words">{value}</p>
    </div>
  );
}

function Placeholder({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Home;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <Icon className="size-5 mx-auto text-muted-foreground" />
      <p className="text-sm mt-3">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{desc}</p>
    </div>
  );
}
