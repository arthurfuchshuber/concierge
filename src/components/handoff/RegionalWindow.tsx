/**
 * SITUAÇÃO REGIONAL (mockups REG-D02/D03 e M02/M03, aprovados em 23–26/11/2026).
 *  - `RegionalWindow`: "Marcar Situação Regional" (Tipo, Cidade travada = a do imóvel, Bairros, Texto Para a IA,
 *    Vale Por 3 h · 6 h · 12 h · 24 h) e a edição da situação ativa (mesma janela).
 *  - `RegionalBanner`: faixa da situação ativa acima da lista (desde · expira · usada em N conversas, lápis e
 *    Encerrar).
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { AtdWindow, BTN_BRAND, BTN_SOFT, Seg, WinLabel } from "./atd-window";
import { closeRegionalSituation, saveRegionalSituation, type RegionalSituation } from "@/lib/atendimento.functions";
import {
  REGIONAL_DEFAULT_NEIGHBORHOODS,
  conversationsLabel,
  regionalTitle,
  regionalValidityOf,
  type RegionalValidity,
} from "@/lib/regional-situation";
import { friendlyErrorMessage } from "@/lib/friendly-error";

const FIELD = "w-full rounded-[9px] bg-[var(--panel-well)] px-2.5 py-[9px] text-[12.5px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none";

export function RegionalWindow({
  open,
  onOpenChange,
  conversationId,
  city,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Conversa de origem (situação nova); sem ela, só edição. */
  conversationId: string | null;
  city: string;
  /** Situação ativa (editar) ou sugestão (preenche Tipo e Texto). */
  initial: (Partial<RegionalSituation> & { kind?: string; aiText?: string }) | null;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(saveRegionalSituation);
  const editing = !!initial?.id;
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [neighborhoods, setNeighborhoods] = useState(initial?.neighborhoods ?? REGIONAL_DEFAULT_NEIGHBORHOODS);
  const [aiText, setAiText] = useState(initial?.aiText ?? "");
  const [hours, setHours] = useState<RegionalValidity>(
    initial?.startsAt ? regionalValidityOf(initial.startsAt, initial.expiresAt ?? null) : 6,
  );
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: initial?.id ?? null,
          conversationId: editing ? null : conversationId,
          kind: kind.trim(),
          neighborhoods: neighborhoods.trim() || REGIONAL_DEFAULT_NEIGHBORHOODS,
          aiText: aiText.trim(),
          hours,
        },
      }),
    onSuccess: () => {
      toast(editing ? "Situação regional atualizada." : "Situação regional marcada.");
      onSaved();
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível salvar a situação.")),
  });
  return (
    <AtdWindow
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Editar Situação Regional" : "Marcar Situação Regional"}
      subtitle="Vale para hóspedes da mesma cidade"
      width={340}
    >
      <div className="flex flex-col gap-3.5 px-4 pt-3.5">
        <label className="block">
          <WinLabel>Tipo</WinLabel>
          <input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Ex.: Falta de energia" className={FIELD} maxLength={80} />
        </label>
        <div className="block">
          <WinLabel>Cidade</WinLabel>
          <div className={`${FIELD} flex items-center gap-2`}>
            <span className="min-w-0 flex-1 truncate">{initial?.city ?? city}</span>
            <Lock className="size-3 shrink-0 text-muted-foreground" />
          </div>
        </div>
        <label className="block">
          <WinLabel>Bairros</WinLabel>
          <input value={neighborhoods} onChange={(e) => setNeighborhoods(e.target.value)} className={FIELD} maxLength={200} />
        </label>
        <label className="block">
          <WinLabel>Texto Para a IA</WinLabel>
          <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={4} maxLength={600} className={`${FIELD} min-h-[78px] resize-none leading-[1.45]`} />
        </label>
        <div>
          <WinLabel>Vale Por</WinLabel>
          <Seg
            options={[
              { value: "3", label: "3 h" },
              { value: "6", label: "6 h" },
              { value: "12", label: "12 h" },
              { value: "24", label: "24 h" },
            ]}
            value={String(hours)}
            onChange={(v) => setHours(Number(v) as RegionalValidity)}
          />
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          A IA nunca cita outros hóspedes ou imóveis e, se o hóspede disser que é só no imóvel dele, trata como problema da casa.
        </p>
      </div>
      <div className="flex gap-2 px-4 pb-4 pt-3.5">
        <button type="button" className={BTN_SOFT} onClick={() => onOpenChange(false)}>
          Cancelar
        </button>
        <button type="button" disabled={!kind.trim() || !aiText.trim() || save.isPending} onClick={() => save.mutate()} className={BTN_BRAND}>
          {editing ? "Salvar" : "Marcar Situação"}
        </button>
      </div>
    </AtdWindow>
  );
}

export function RegionalBanner({ situation }: { situation: RegionalSituation }) {
  const qc = useQueryClient();
  const closeFn = useServerFn(closeRegionalSituation);
  const [editOpen, setEditOpen] = useState(false);
  const end = useMutation({
    mutationFn: () => closeFn({ data: { id: situation.id, action: "end" } }),
    onSuccess: () => {
      toast("Situação regional encerrada.");
      void qc.invalidateQueries({ queryKey: ["regional-situations"] });
      void qc.invalidateQueries({ queryKey: ["conv-regional"] });
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível encerrar.")),
  });
  const since = format(new Date(situation.startsAt), "HH:mm");
  const until = situation.expiresAt ? format(new Date(situation.expiresAt), "HH:mm") : null;
  return (
    <div className="ds-3d relative shrink-0 overflow-hidden rounded-[14px] bg-card px-3.5 py-3">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-[#c9a962]" />
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-[5px] bg-[#c9a962]/16 px-2 py-[3px] text-[10.5px] font-bold text-[#8a6a1a]">Situação Regional Ativa</span>
        <span className="min-w-0 truncate text-[13px] font-semibold">{regionalTitle(situation)}</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-[1.45] text-muted-foreground">{situation.aiText}</p>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
          Desde {since}
          {until ? ` · expira às ${until}` : ""} · usada em {conversationsLabel(situation.usedIn)}
        </span>
        <button
          type="button"
          aria-label="Editar situação regional"
          onClick={() => setEditOpen(true)}
          className="grid size-7 place-items-center rounded-[7px] bg-[var(--action-sq-bg)] text-muted-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={end.isPending}
          onClick={() => end.mutate()}
          className="inline-flex h-7 items-center rounded-[7px] bg-foreground/[0.07] px-2.5 text-[11px] font-semibold disabled:opacity-50"
        >
          Encerrar
        </button>
      </div>
      {editOpen ? (
        <RegionalWindow
          open
          onOpenChange={(v) => !v && setEditOpen(false)}
          conversationId={null}
          city={situation.city}
          initial={situation}
          onSaved={() => {
            setEditOpen(false);
            void qc.invalidateQueries({ queryKey: ["regional-situations"] });
            void qc.invalidateQueries({ queryKey: ["conv-regional"] });
          }}
        />
      ) : null}
    </div>
  );
}
