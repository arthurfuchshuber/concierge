import { createFileRoute } from "@tanstack/react-router";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { BancosPanel } from "@/components/admin-pages/BancosPanel";

export const Route = createFileRoute("/_authenticated/admin/dashboard/bancos")({
  head: () => ({
    meta: [
      { title: "Bancos conectados — ConciergeIA" },
      { name: "description", content: "Contas bancárias da empresa conectadas via Open Finance." },
      { property: "og:title", content: "Bancos conectados — ConciergeIA" },
      { property: "og:description", content: "Contas bancárias da empresa conectadas via Open Finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancosPage,
});

function BancosPage() {
  return (
    <div className="ds-page ds-stack">
      <div className={`${PANEL_SHELL} p-4`}>
        <BancosPanel />
      </div>
    </div>
  );
}
