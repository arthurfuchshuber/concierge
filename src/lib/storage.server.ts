import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "property-images";
const TTL_SECONDS = 60 * 60; // 1h

function extractPath(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  // Matches public, sign, or authenticated storage URLs for our bucket
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/property-images\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Replace any property-images URLs in the input with short-lived signed URLs.
 * Non-bucket URLs (e.g. Google Maps photo URLs) pass through unchanged.
 * Accepts string, string[], or plain object whose string leaves may be image URLs.
 */
export async function signPropertyImages<T>(
  supabase: SupabaseClient,
  value: T,
): Promise<T> {
  const paths: string[] = [];
  const collect = (v: unknown): void => {
    if (!v) return;
    if (typeof v === "string") {
      const p = extractPath(v);
      if (p && !paths.includes(p)) paths.push(p);
    } else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(collect);
  };
  collect(value);
  if (paths.length === 0) return value;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS);
  if (error || !data) return value;
  const map = new Map<string, string>();
  data.forEach((d) => {
    if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  });

  const replace = (v: unknown): unknown => {
    if (!v) return v;
    if (typeof v === "string") {
      const p = extractPath(v);
      return p && map.has(p) ? map.get(p)! : v;
    }
    if (Array.isArray(v)) return v.map(replace);
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = replace(val);
      return out;
    }
    return v;
  };
  return replace(value) as T;
}
