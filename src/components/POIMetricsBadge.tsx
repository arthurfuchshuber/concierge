import { Eye, Heart, ThumbsDown, Share2 } from "lucide-react";

type Counts = { views: number; likes: number; dislikes: number; shares: number };

/**
 * Read-only metrics chip for admin views. Mirrors the public `POIEngagementBar`
 * layout (bottom-right pill) but only displays counters — no interactions.
 */
export function POIMetricsBadge({
  counts,
  viewsOnly = false,
  position = "absolute",
}: {
  counts?: Counts | null;
  viewsOnly?: boolean;
  position?: "absolute" | "inline";
}) {
  const c: Counts = counts ?? { views: 0, likes: 0, dislikes: 0, shares: 0 };
  const wrap =
    position === "absolute"
      ? "absolute bottom-2 right-2 z-10"
      : "inline-flex";
  return (
    <div
      className={`${wrap} pointer-events-none inline-flex items-center gap-1.5 rounded-full bg-background/90 backdrop-blur border border-border px-2 py-1 text-[10.5px] font-medium tabular-nums text-foreground/80 shadow-sm`}
      title="Métricas de engajamento (somente leitura)"
    >
      <span className="inline-flex items-center gap-0.5">
        <Eye className="size-3.5" strokeWidth={2} />
        {c.views}
      </span>
      {!viewsOnly && (
        <>
          <span className="inline-flex items-center gap-0.5">
            <Share2 className="size-3.5" strokeWidth={2} />
            {c.shares}
          </span>
          <span className="inline-flex items-center gap-0.5 text-rose-500">
            <Heart className="size-3.5" strokeWidth={2} />
            {c.likes}
          </span>
          <span className="inline-flex items-center gap-0.5 text-sky-500">
            <ThumbsDown className="size-3.5" strokeWidth={2} />
            {c.dislikes}
          </span>
        </>
      )}
    </div>
  );
}
