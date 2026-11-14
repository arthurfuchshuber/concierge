import { createFileRoute } from "@tanstack/react-router";
import { FiscalPage } from "@/components/fiscal/FiscalPage";

export const Route = createFileRoute("/_authenticated/admin/fiscal")({
  head: () => ({
    meta: [
      { title: "Fiscal — ConciergeIA" },
      { name: "description", content: "Empresas emitentes, documentos fiscais e provedor fiscal." },
      { property: "og:title", content: "Fiscal — ConciergeIA" },
    ],
  }),
  component: FiscalPage,
});
