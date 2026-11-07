import { it, expect } from "vitest";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
it("emojis com seletor ficam intactos e safe", () => {
  for (const t of ["fim! ☀️", "🗓️ Check-In", "❤️ obrigada"]) {
    const r = SECRET_SCRUBBER.scan(t);
    expect(r.status).toBe("safe"); expect(r.text).toBe(t);
  }
});
