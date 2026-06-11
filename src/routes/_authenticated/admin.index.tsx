import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyProperties, deleteProperty } from "@/lib/properties.functions";
import { Button } from "@/components/ui/button";
import { Plus, ExternalLink, Pencil, Trash2, Lock, Globe } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const list = useServerFn(listMyProperties);
  const del = useServerFn(deleteProperty);
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-properties"],
    queryFn: () => list(),
  });

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await del({ data: { id } });
      toast.success("Guia excluído");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Seus guias</p>
          <h1 className="font-serif text-4xl">Meus imóveis</h1>
        </div>
        <Button onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })} className="rounded-full">
          <Plus className="size-4 mr-1.5" /> Novo guia
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !data?.length ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center">
          <h3 className="font-serif text-2xl mb-2">Crie seu primeiro guia</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Você só precisa do nome do imóvel e do link do Google Maps. Cuidamos do resto.
          </p>
          <Button onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })} className="rounded-full">
            <Plus className="size-4 mr-1.5" /> Criar guia
          </Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
              <div className="aspect-[16/10] bg-secondary relative">
                {p.hero_image_url ? (
                  <img src={p.hero_image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">Sem imagem</div>
                )}
                <span className="absolute top-3 left-3 glass rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold inline-flex items-center gap-1">
                  {p.access_mode === "pin" ? <><Lock className="size-2.5" /> PIN</> : <><Globe className="size-2.5" /> Público</>}
                </span>
                {!p.published && (
                  <span className="absolute top-3 right-3 bg-yellow-500/90 text-black rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold">Rascunho</span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold leading-tight truncate">{p.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 truncate">{p.tagline || `${p.city ?? ""}${p.country ? `, ${p.country}` : ""}`}</p>
                <div className="flex items-center gap-2 mt-4">
                  <Link
                    to="/admin/properties/$id"
                    params={{ id: p.id }}
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium bg-secondary rounded-full py-2 hover:bg-secondary/70"
                  >
                    <Pencil className="size-3" /> Editar
                  </Link>
                  <a
                    href={`/g/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium bg-secondary rounded-full py-2 hover:bg-secondary/70"
                  >
                    <ExternalLink className="size-3" /> Ver
                  </a>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    aria-label="Excluir"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
