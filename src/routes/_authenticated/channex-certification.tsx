import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  flushAriQueue,
  getAriTargets,
  getCertDashboard,
  pullBookingFeed,
  registerManualBooking,
  runAriFullSync,
  saveAriChanges,
} from "@/lib/channex-cert.functions";

export const Route = createFileRoute("/_authenticated/channex-certification")({
  head: () => ({
    meta: [
      { title: "Console Channex — ConciergeIA" },
      { name: "description", content: "Ferramenta interna de integração ARI com a Channex." },
      { property: "og:title", content: "Console Channex — ConciergeIA" },
      { property: "og:description", content: "Ferramenta interna de integração ARI com a Channex." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ChannexConsole,
});

type Tri = "" | "true" | "false";
type Line = {
  dateFrom: string;
  dateTo: string;
  availability: string;
  rate: string;
  min_stay: string;
  max_stay: string;
  stop_sell: Tri;
  closed_to_arrival: Tri;
  closed_to_departure: Tri;
};
const emptyLine = (): Line => ({
  dateFrom: "",
  dateTo: "",
  availability: "",
  rate: "",
  min_stay: "",
  max_stay: "",
  stop_sell: "",
  closed_to_arrival: "",
  closed_to_departure: "",
});

const selectCls = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

function ChannexConsole() {
  const qc = useQueryClient();
  const targetsFn = useServerFn(getAriTargets);
  const dashFn = useServerFn(getCertDashboard);
  const saveFn = useServerFn(saveAriChanges);
  const fullFn = useServerFn(runAriFullSync);
  const bookFn = useServerFn(registerManualBooking);
  const flushFn = useServerFn(flushAriQueue);
  const feedFn = useServerFn(pullBookingFeed);

  const targets = useQuery({ queryKey: ["channex-targets"], queryFn: () => targetsFn(), retry: false });
  const dash = useQuery({ queryKey: ["channex-dash"], queryFn: () => dashFn(), refetchInterval: 5000 });

  const [propertyId, setPropertyId] = useState("");
  const [ratePlanId, setRatePlanId] = useState("");
  const property = targets.data?.find((p) => p.propertyId === propertyId);
  const ratePlan = property?.ratePlans.find((r) => r.id === ratePlanId);
  const roomType = property?.roomTypes.find((r) => r.id === ratePlan?.roomTypeId);

  useEffect(() => {
    const p = targets.data?.[0];
    if (p && !propertyId) {
      setPropertyId(p.propertyId);
      setRatePlanId(p.ratePlans[0]?.id ?? "");
    }
  }, [targets.data, propertyId]);

  const base = useMemo(
    () => (property && ratePlan && roomType ? { propertyId: property.propertyId, ratePlanId: ratePlan.id, roomTypeId: roomType.id } : null),
    [property, ratePlan, roomType],
  );

  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [full, setFull] = useState({ baseRate: "480", weekendRate: "620", defaultMinStay: "2" });
  const [booking, setBooking] = useState({ checkin: "", checkout: "" });

  const done = (label: string) => (r: any) => {
    const tasks = (r?.batches ?? []).map((b: any) => `${b.kind}: ${b.ok ? b.taskId : b.error}`).join(" · ");
    toast.success(`${label}${tasks ? ` — ${tasks}` : ""}`);
    qc.invalidateQueries({ queryKey: ["channex-dash"] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falhou.");

  const save = useMutation({
    mutationFn: () => {
      if (!base) throw new Error("Selecione a tarifa.");
      const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
      const tri = (v: Tri) => (v === "" ? undefined : v === "true");
      const changes = lines
        .filter((l) => l.dateFrom)
        .map((l) => ({
          ...base,
          dateFrom: l.dateFrom,
          dateTo: l.dateTo || l.dateFrom,
          fields: {
            availability: num(l.availability),
            rate: num(l.rate),
            min_stay: num(l.min_stay),
            max_stay: num(l.max_stay),
            stop_sell: tri(l.stop_sell),
            closed_to_arrival: tri(l.closed_to_arrival),
            closed_to_departure: tri(l.closed_to_departure),
          },
        }));
      if (!changes.length) throw new Error("Preencha ao menos uma data.");
      return saveFn({ data: { changes } });
    },
    onSuccess: done("Alterações salvas"),
    onError: fail,
  });
  const fullSync = useMutation({
    mutationFn: () => {
      if (!base || !roomType) throw new Error("Selecione a tarifa.");
      return fullFn({
        data: {
          ...base,
          countOfRooms: roomType.countOfRooms,
          baseRate: Number(full.baseRate),
          weekendRate: Number(full.weekendRate),
          defaultMinStay: Number(full.defaultMinStay),
        },
      });
    },
    onSuccess: done("Full sync enviado"),
    onError: fail,
  });
  const manual = useMutation({
    mutationFn: () => {
      if (!base) throw new Error("Selecione a tarifa.");
      return bookFn({ data: { ...base, ...booking } });
    },
    onSuccess: done("Reserva registrada"),
    onError: fail,
  });
  const flush = useMutation({ mutationFn: () => flushFn(), onSuccess: done("Fila processada"), onError: fail });
  const feed = useMutation({
    mutationFn: () => feedFn(),
    onSuccess: (r) => {
      toast.success(`Feed: ${r.feed.recebidas} revisão(ões), ${r.feed.processadas} processada(s) e confirmada(s).`);
      qc.invalidateQueries({ queryKey: ["channex-dash"] });
    },
    onError: fail,
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Console Channex (interno)</h1>
        <p className="text-sm text-muted-foreground">
          Calendário interno → apenas o que mudou → fila → lote → limite de 20 chamadas/min → Channex.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">Imóvel e tarifa</h2>
        {targets.isLoading && <Loader2 className="size-4 animate-spin" />}
        {targets.error && <p className="text-sm text-destructive">{String((targets.error as Error).message)}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <select className={selectCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            {targets.data?.map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.propertyTitle} ({p.currency})
              </option>
            ))}
          </select>
          <select className={selectCls} value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)}>
            {property?.ratePlans.map((r) => (
              <option key={r.id} value={r.id}>
                {property.roomTypes.find((t) => t.id === r.roomTypeId)?.title} · {r.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">Alterar calendário</h2>
        <p className="text-xs text-muted-foreground">Campos vazios não são alterados. Todas as linhas saem juntas em uma única chamada por tipo.</p>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-5">
            <label className="text-xs">De<Input type="date" value={l.dateFrom} onChange={(e) => setLine(i, { dateFrom: e.target.value })} /></label>
            <label className="text-xs">Até<Input type="date" value={l.dateTo} onChange={(e) => setLine(i, { dateTo: e.target.value })} /></label>
            <label className="text-xs">Disponib.<Input inputMode="numeric" value={l.availability} onChange={(e) => setLine(i, { availability: e.target.value })} /></label>
            <label className="text-xs">Preço<Input inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></label>
            <label className="text-xs">Estadia mín.<Input inputMode="numeric" value={l.min_stay} onChange={(e) => setLine(i, { min_stay: e.target.value })} /></label>
            <label className="text-xs">Estadia máx.<Input inputMode="numeric" value={l.max_stay} onChange={(e) => setLine(i, { max_stay: e.target.value })} /></label>
            {(["stop_sell", "closed_to_arrival", "closed_to_departure"] as const).map((f) => (
              <label key={f} className="text-xs">
                {f === "stop_sell" ? "Venda fechada" : f === "closed_to_arrival" ? "Fechado p/ chegada" : "Fechado p/ saída"}
                <select className={selectCls} value={l[f]} onChange={(e) => setLine(i, { [f]: e.target.value as Tri })}>
                  <option value="">—</option>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </label>
            ))}
            <div className="flex items-end">
              <Button variant="ghost" size="icon" aria-label="Remover linha" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [emptyLine()]))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="mr-1 size-4" /> Linha
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1 size-4 animate-spin" />} Salvar alterações
          </Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-medium">Sincronização completa (500 dias)</h2>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">Preço base<Input value={full.baseRate} onChange={(e) => setFull({ ...full, baseRate: e.target.value })} /></label>
            <label className="text-xs">Sex/Sáb<Input value={full.weekendRate} onChange={(e) => setFull({ ...full, weekendRate: e.target.value })} /></label>
            <label className="text-xs">Estadia mín.<Input value={full.defaultMinStay} onChange={(e) => setFull({ ...full, defaultMinStay: e.target.value })} /></label>
          </div>
          <Button size="sm" disabled={fullSync.isPending} onClick={() => fullSync.mutate()}>
            {fullSync.isPending && <Loader2 className="mr-1 size-4 animate-spin" />} Enviar sincronização completa
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-medium">Reserva manual (reduz disponibilidade)</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Checkin<Input type="date" value={booking.checkin} onChange={(e) => setBooking({ ...booking, checkin: e.target.value })} /></label>
            <label className="text-xs">Checkout<Input type="date" value={booking.checkout} onChange={(e) => setBooking({ ...booking, checkout: e.target.value })} /></label>
          </div>
          <Button size="sm" disabled={manual.isPending} onClick={() => manual.mutate()}>
            {manual.isPending && <Loader2 className="mr-1 size-4 animate-spin" />} Registrar reserva
          </Button>
        </section>
      </div>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">Fila e reservas</h2>
        <p className="text-sm text-muted-foreground">
          Chamadas ARI no último minuto: <b>{dash.data?.ariLastMinute ?? 0}/20</b> · Fila:{" "}
          {Object.entries(dash.data?.outbox ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "vazia"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={flush.isPending} onClick={() => flush.mutate()}>Processar fila</Button>
          <Button variant="outline" size="sm" disabled={feed.isPending} onClick={() => feed.mutate()}>Buscar reservas e confirmar (ACK)</Button>
        </div>
        <div className="space-y-1 text-xs">
          {dash.data?.reservas.map((r: any) => {
            const ack = dash.data?.acks.find((a: any) => a.revision_id === r.channex_revision_id);
            return (
              <div key={r.codigo_reserva_channex} className="break-words rounded bg-muted/40 p-2">
                {r.nome_hospede ?? "Hóspede"} · {r.data_checkin} → {r.data_checkout} · {r.status} · {r.ota_name} · reserva {r.channex_booking_id} · ACK {ack?.status ?? "—"}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="font-medium">Registro de chamadas</h2>
        {dash.data?.logs.map((l: any) => (
          <details key={l.id} className="rounded bg-muted/40 p-2 text-xs">
            <summary className="cursor-pointer break-words">
              {new Date(l.created_at).toLocaleTimeString()} · {l.operation} · {l.method} {l.endpoint} · HTTP {l.http_status ?? "—"} · tentativa {l.attempt}
              {l.task_id ? ` · task ${l.task_id}` : ""} {l.error ? ` · ${l.error}` : ""}
            </summary>
            {l.request && <pre className="mt-2 whitespace-pre-wrap break-all">{l.request}</pre>}
            {l.response && <pre className="mt-2 whitespace-pre-wrap break-all text-muted-foreground">{l.response}</pre>}
          </details>
        ))}
      </section>
    </div>
  );
}
