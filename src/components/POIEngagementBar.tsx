import { useEffect, useRef, useState } from "react";
import { Eye, Share2, Heart, ThumbsDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { recordPoiEngagement } from "@/lib/poi-engagement.functions";

type PoiType = "city_reference" | "recommendation" | "sigma_city_reference" | "marketplace_link";

function getAnonId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "sg-anon-id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export type EngagementCounts = {
  views: number;
  likes: number;
  dislikes: number;
  shares: number;
};

type Props = {
  slug: string;
  poiKey: string;
  poiType: PoiType;
  shareUrl?: string | null;
  shareTitle?: string;
  initialCounts?: EngagementCounts;
  initialReaction?: "like" | "dislike" | null;
  /** Hide everything except the eye (used for marketplace items in admin view). */
  viewsOnly?: boolean;
  /** Render in light pill instead of glassy dark — use over photos. */
  variant?: "glass" | "solid";
  /** Force the bar to track view-on-click only (no IntersectionObserver). */
  noAutoView?: boolean;
};

export function POIEngagementBar({
  slug,
  poiKey,
  poiType,
  shareUrl,
  shareTitle,
  initialCounts,
  initialReaction = null,
  viewsOnly = false,
  variant = "glass",
  noAutoView = false,
}: Props) {
  const record = useServerFn(recordPoiEngagement);
  const [counts, setCounts] = useState<EngagementCounts>(
    initialCounts ?? { views: 0, likes: 0, dislikes: 0, shares: 0 },
  );
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(initialReaction);
  const ref = useRef<HTMLDivElement>(null);
  const viewedRef = useRef(false);

  useEffect(() => {
    setCounts(initialCounts ?? { views: 0, likes: 0, dislikes: 0, shares: 0 });
  }, [initialCounts]);
  useEffect(() => {
    setReaction(initialReaction);
  }, [initialReaction]);

  // Auto-view after 5 seconds in viewport
  useEffect(() => {
    if (viewsOnly || noAutoView) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.5) {
            if (!timer && !viewedRef.current) {
              timer = setTimeout(() => fireView(), 5000);
            }
          } else if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    obs.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiKey, slug]);

  async function fireView() {
    if (viewedRef.current) return;
    viewedRef.current = true;
    setCounts((c) => ({ ...c, views: c.views + 1 }));
    try {
      await record({
        data: { slug, poi_key: poiKey, poi_type: poiType, event_type: "view", anon_id: getAnonId() },
      });
    } catch {
      // silencioso — não atrapalha o hóspede
    }
  }

  async function fireReaction(kind: "like" | "dislike") {
    const prev = reaction;
    const next = prev === kind ? null : kind;
    // Optimistic counters
    setCounts((c) => {
      const nc = { ...c };
      if (prev === "like") nc.likes = Math.max(0, nc.likes - 1);
      if (prev === "dislike") nc.dislikes = Math.max(0, nc.dislikes - 1);
      if (next === "like") nc.likes += 1;
      if (next === "dislike") nc.dislikes += 1;
      return nc;
    });
    setReaction(next);
    try {
      await record({
        data: { slug, poi_key: poiKey, poi_type: poiType, event_type: kind, anon_id: getAnonId() },
      });
    } catch {
      toast.error("Não foi possível registrar sua reação agora.");
    }
  }

  async function fireShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    const title = shareTitle || "Confira este lugar";
    setCounts((c) => ({ ...c, shares: c.shares + 1 }));
    try {
      if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share) {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({ title, url });
      } else if (navigator?.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado!");
      }
      await record({
        data: { slug, poi_key: poiKey, poi_type: poiType, event_type: "share", anon_id: getAnonId() },
      });
    } catch {
      // user canceled share — undo optimistic share count
      setCounts((c) => ({ ...c, shares: Math.max(0, c.shares - 1) }));
    }
  }

  function onClickView(e: React.MouseEvent) {
    // Card-level click counts as a view too (when used with a parent link).
    e.stopPropagation();
    fireView();
  }

  const wrapBase =
    variant === "glass"
      ? "bg-black/25 backdrop-blur-md text-white/70 border border-white/5"
      : "bg-background/60 backdrop-blur text-foreground/60 border border-border/60";
  const btnBase =
    "inline-flex flex-col items-center justify-center gap-1 px-1.5 py-1.5 rounded-full text-[10px] font-medium tabular-nums transition-all opacity-60 hover:opacity-100 hover:scale-105";

  // viewsOnly = admin marketplace badge: ainda mostra olhinho.
  // No guia público: nunca exibimos olhinho — métrica fica só no admin.
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className={`pointer-events-auto absolute top-1/2 -translate-y-1/2 right-2 z-10 flex flex-col items-center gap-2 rounded-full px-1.5 py-2.5 shadow-sm ${wrapBase}`}
    >
      {viewsOnly ? (
        <button
          type="button"
          aria-label="Visualizações"
          onClick={onClickView}
          className={btnBase}
        >
          <Eye className="size-3.5" strokeWidth={1.75} />
          <span className="leading-none">{counts.views}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-label="Compartilhar"
            onClick={fireShare}
            className={btnBase}
          >
            <Share2 className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Curtir"
            onClick={(e) => { e.stopPropagation(); fireReaction("like"); }}
            className={`${btnBase} ${reaction === "like" ? "text-rose-300 opacity-100" : ""}`}
          >
            <Heart className={`size-3.5 ${reaction === "like" ? "fill-current" : ""}`} strokeWidth={1.75} />
            <span className="leading-none">{counts.likes}</span>
          </button>
          <button
            type="button"
            aria-label="Descurtir"
            onClick={(e) => { e.stopPropagation(); fireReaction("dislike"); }}
            className={`${btnBase} ${reaction === "dislike" ? "text-sky-300 opacity-100" : ""}`}
          >
            <ThumbsDown className={`size-3.5 ${reaction === "dislike" ? "fill-current" : ""}`} strokeWidth={1.75} />
            <span className="leading-none">{counts.dislikes}</span>
          </button>
        </>
      )}
    </div>
  );
}


