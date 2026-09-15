import { cn } from "@/lib/utils";

/**
 * Moldura de navegador premium para capturas reais do sistema.
 * Borda iluminada roxo→magenta, barra superior e sombra longa.
 */
export function BrowserShot({
  src,
  alt,
  className,
  imgClassName,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-[1.5px] rounded-[20px] opacity-45 blur-[8px]"
        style={{ background: "linear-gradient(120deg,#7c1ad8 0%,#e82dae 100%)" }}
      />
      <div className="relative min-w-0 overflow-hidden rounded-[18px] border border-white/12 bg-[#0d0d14] shadow-[0_40px_90px_-45px_rgba(0,0,0,1)]">
        <div className="flex items-center gap-1.5 border-b border-white/8 bg-white/[0.04] px-3.5 py-2.5">
          <span className="size-2 rounded-full bg-white/25" />
          <span className="size-2 rounded-full bg-white/18" />
          <span className="size-2 rounded-full bg-white/12" />
          <span className="ml-3 hidden min-w-0 truncate rounded-md bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/40 sm:block">
            app.conciergeia.app
          </span>
        </div>
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          className={cn("block w-full", imgClassName)}
        />
      </div>
    </div>
  );
}

/** Moldura de celular. Recebe a tela renderizada em HTML (paleta da landing). */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[44px] opacity-40 blur-[16px]"
        style={{ background: "linear-gradient(140deg,#7c1ad8 0%,#e82dae 100%)" }}
      />
      <div className="relative min-w-0 overflow-hidden rounded-[34px] bg-[#0a0a0f] shadow-[0_40px_80px_-40px_rgba(0,0,0,1)]">
        {children}
      </div>
    </div>
  );
}
