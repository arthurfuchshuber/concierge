import { describe, it, expect } from "vitest";
import { rankByRelevanceAndDistance } from "@/lib/ai/tools.server";

describe("ranking de recomendações", () => {
  it("lugar perto e bem avaliado vem antes de um distante com mais avaliações", () => {
    const out = rankByRelevanceAndDistance(
      [
        { row: { name: "Trentin", rating: 4.7, user_ratings_total: 12000 }, meters: 6300 },
        { row: { name: "Jauense", rating: 4.6, user_ratings_total: 8300 }, meters: 1200 },
      ],
      1,
    );
    expect(out[0].row.name).toBe("Jauense");
  });
  it("resultado final fica do mais perto ao mais longe", () => {
    const out = rankByRelevanceAndDistance(
      [
        { row: { name: "A", rating: 4.8, user_ratings_total: 9000 }, meters: 5000 },
        { row: { name: "B", rating: 4.5, user_ratings_total: 500 }, meters: 800 },
      ],
      2,
    );
    expect(out.map((o) => o.row.name)).toEqual(["B", "A"]);
  });
});
