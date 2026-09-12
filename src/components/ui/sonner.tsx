import { Toaster as Sonner } from "sonner";

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
