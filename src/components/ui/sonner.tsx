import { Toaster as Sonner, toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/* TODO AVISO DE ERRO EM PORTUGUÊS CLARO (25/09/2026): qualquer `toast.error`
   ou `toast.warning` do sistema passa pelo tradutor único antes de aparecer. */
type AnyToast = (message: unknown, data?: { description?: unknown } & Record<string, unknown>) => string | number;
const patched = toast as unknown as { __ptPatched?: boolean; error: AnyToast; warning: AnyToast };
if (!patched.__ptPatched) {
  patched.__ptPatched = true;
  for (const kind of ["error", "warning"] as const) {
    const original = patched[kind].bind(toast) as AnyToast;
    patched[kind] = (message, data) => {
      const msg = typeof message === "string" || message instanceof Error ? friendlyErrorMessage(message) : message;
      const next = data && typeof data.description === "string" ? { ...data, description: friendlyErrorMessage(data.description, "") || undefined } : data;
      return original(msg, next);
    };
  }
}

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">✓</span>
        ),
        error: (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">✕</span>
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-full group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:px-4 group-[.toaster]:py-3",
          title: "group-[.toast]:font-semibold group-[.toast]:text-sm",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
