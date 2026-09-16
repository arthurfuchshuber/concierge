import { Badge } from "@/components/ui/badge";
import { Eye, Pencil, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccessLevelValue = "NONE" | "READ" | "WRITE";

const META: Record<AccessLevelValue, { label: string; icon: typeof Eye; className: string }> = {
  NONE: { label: "Sem acesso", icon: ShieldOff, className: "bg-muted text-muted-foreground" },
  READ: {
    label: "Visualizar",
    icon: Eye,
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/20",
  },
  WRITE: {
    label: "Editar",
    icon: Pencil,
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  },
};

/** Badge padrão de nível de acesso — reutilizável em todo o Permission Center. */
export function AccessBadge({
  level,
  className,
  showIcon = true,
}: {
  level: AccessLevelValue | string;
  className?: string;
  showIcon?: boolean;
}) {
  const meta = META[(level as AccessLevelValue) in META ? (level as AccessLevelValue) : "NONE"];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", meta.className, className)}>
      {showIcon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}
