import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sparkles, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/admin" className="inline-flex items-center gap-2">
            <div className="size-8 rounded-xl bg-primary grid place-items-center">
              <Sparkles className="size-4 text-primary-foreground" strokeWidth={2} />
            </div>
            <span className="font-serif text-xl">SigmaGuide</span>
            <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">Admin</span>
          </Link>
          <div className="flex items-center gap-2">
            {pathname !== "/admin" && (
              <Link to="/admin" className="text-sm px-3 py-1.5 rounded-full hover:bg-secondary">Meus guias</Link>
            )}
            <button onClick={signOut} className="text-sm px-3 py-1.5 rounded-full hover:bg-secondary inline-flex items-center gap-1.5">
              <LogOut className="size-3.5" /> Sair
            </button>
          </div>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
