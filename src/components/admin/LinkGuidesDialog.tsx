import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getPropertyGroup,
  listLinkableProperties,
  linkPropertiesToGroup,
  unlinkPropertyFromGroup,
  renameCityGroup,
} from "@/lib/city-reference-groups.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Link as LinkIcon, Loader2, Unlink, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * Botão + dialog para vincular outros guias da mesma cidade ao mesmo grupo de
 * "Referências na Cidade". Membros de um grupo compartilham as referências.
 */
export function LinkGuidesButton({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  const groupFn = useServerFn(getPropertyGroup);
  const groupQ = useQuery({
    queryKey: ["city-ref-group", propertyId],
    queryFn: () => groupFn({ data: { propertyId } }),
    enabled: !!propertyId,
  });
  const memberCount = groupQ.data?.member_count ?? 0;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5 shrink-0 h-8 rounded-full text-xs" title="Vincular guias">
        <LinkIcon className="size-3.5" />
        {memberCount > 0 && <Badge variant="secondary" className="ml-1">{memberCount}</Badge>}
      </Button>
      {open && (
        <LinkGuidesDialog
          propertyId={propertyId}
          onClose={() => setOpen(false)}
          onChanged={() => groupQ.refetch()}
        />
      )}
    </>
  );
}

function LinkGuidesDialog({
  propertyId, onClose, onChanged,
}: { propertyId: string; onClose: () => void; onChanged: () => void }) {
  const groupFn = useServerFn(getPropertyGroup);
  const listFn = useServerFn(listLinkableProperties);
  const linkFn = useServerFn(linkPropertiesToGroup);
  const unlinkFn = useServerFn(unlinkPropertyFromGroup);
  const renameFn = useServerFn(renameCityGroup);

  const groupQ = useQuery({
    queryKey: ["city-ref-group", propertyId],
    queryFn: () => groupFn({ data: { propertyId } }),
  });
  const linkableQ = useQuery({
    queryKey: ["city-ref-linkable", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [saving, setSaving] = useState(false);

  const group = groupQ.data;
  const linkable = linkableQ.data ?? [];
  const currentName = useMemo(() => group?.name ?? "", [group]);

  async function handleLink() {
    setSaving(true);
    try {
      await linkFn({
        data: {
          propertyId,
          addPropertyIds: Array.from(selected),
          groupName: groupName.trim() || undefined,
        },
      });
      toast.success("Guias vinculados");
      setSelected(new Set());
      setGroupName("");
      await Promise.all([groupQ.refetch(), linkableQ.refetch()]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao vincular");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink(id: string) {
    try {
      await unlinkFn({ data: { propertyId: id } });
      toast.success("Desvinculado");
      await Promise.all([groupQ.refetch(), linkableQ.refetch()]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function handleRename() {
    if (!group) return;
    try {
      await renameFn({ data: { groupId: group.id, name: currentName } });
      toast.success("Renomeado");
      groupQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular guias da mesma cidade</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Guias vinculados compartilham automaticamente as "Referências na Cidade".
          Alterações em um aparecem em todos.
        </p>

        {group && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Grupo atual
            </div>
            <div className="flex gap-2">
              <Input
                defaultValue={currentName}
                onBlur={(e) => { if (e.target.value !== currentName) { (group as { name: string }).name = e.target.value; handleRename(); } }}
                placeholder="Nome do grupo"
              />
              <Button variant="ghost" size="icon" onClick={handleRename}><Save className="size-3.5" /></Button>
            </div>
            <ul className="space-y-1">
              {group.members.map((m) => (
                <li key={m.property_id} className="flex items-center justify-between text-sm py-1">
                  <span className="truncate">
                    {m.property_name}
                    {m.property_id === propertyId && <Badge variant="outline" className="ml-2 text-[10px]">este</Badge>}
                  </span>
                  {m.property_id !== propertyId && (
                    <Button variant="ghost" size="icon" onClick={() => handleUnlink(m.property_id)}>
                      <Unlink className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            Adicionar guias disponíveis
          </div>
          {!group && (
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nome do grupo (opcional)"
            />
          )}
          {linkableQ.isLoading ? (
            <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Carregando…
            </div>
          ) : linkable.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">
              Nenhum outro guia disponível nesta cidade.
            </p>
          ) : (
            <ul className="max-h-56 overflow-auto rounded-md border border-border divide-y divide-border">
              {linkable.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 p-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v) n.add(p.id); else n.delete(p.id);
                          return n;
                        });
                      }}
                    />
                    <span className="text-sm truncate">{p.name}</span>
                    {p.city && <span className="text-[11px] text-muted-foreground ml-auto">{p.city}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Fechar</Button>
          <Button onClick={handleLink} disabled={saving || selected.size === 0}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Vincular {selected.size > 0 && `(${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
