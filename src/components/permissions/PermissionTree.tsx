import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AccessBadge, type AccessLevelValue } from "./AccessBadge";
import { cn } from "@/lib/utils";

export type PermissionTreeItem = {
  namespace: string;
  label: string;
  description?: string | null;
  level?: AccessLevelValue | string;
  /** "direct" quando o nível veio de uma atribuição explícita. */
  origin?: "direct" | "inherited";
  type?: string;
};

type TreeNode = PermissionTreeItem & { children: TreeNode[] };

function buildTree(items: PermissionTreeItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const item of items) map.set(item.namespace, { ...item, children: [] });
  // Garante ancestrais implícitos para não quebrar a hierarquia visual.
  for (const item of items) {
    const parts = item.namespace.split(".");
    for (let i = 1; i < parts.length; i++) {
      const slug = parts.slice(0, i).join(".");
      if (!map.has(slug)) map.set(slug, { namespace: slug, label: slug, children: [] });
    }
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parts = node.namespace.split(".");
    const parentSlug = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
    const parent = parentSlug ? map.get(parentSlug) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.namespace.localeCompare(b.namespace));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? "Recolher" : "Expandir"}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{node.label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{node.namespace}</p>
        </div>
        {node.origin === "inherited" && (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">Herdada</span>
        )}
        {node.level && <AccessBadge level={node.level} />}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <Row key={child.namespace} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Árvore hierárquica de permissões (somente leitura). */
export function PermissionTree({
  items,
  searchable = true,
  emptyLabel = "Nenhuma permissão para exibir.",
}: {
  items: PermissionTreeItem[];
  searchable?: boolean;
  emptyLabel?: string;
}) {
  const [term, setTerm] = useState("");
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.namespace.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q),
    );
  }, [items, term]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar permissão ou namespace…"
            className="pl-9"
          />
        </div>
      )}
      {tree.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="rounded-lg border">
          {tree.map((node) => (
            <Row key={node.namespace} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}
