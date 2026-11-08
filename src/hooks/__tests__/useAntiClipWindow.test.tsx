// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useAntiClipWindow } from "../useAntiClipWindow";

afterEach(() => cleanup());

function Janela({ managed }: { managed: boolean }) {
  const ref = useAntiClipWindow<HTMLDivElement>();
  return (
    <div ref={ref}>
      <div
        data-testid="lista"
        {...(managed ? { "data-whole-cards-list": "" } : {})}
        style={{ overflowY: "auto", height: "321px", flex: "none" }}
      >
        <div data-clip-row />
      </div>
    </div>
  );
}

describe("useAntiClipWindow — listas com dono da altura", () => {
  it("não deixa height/flex fixos numa lista marcada (useWholeCardsMaxHeight manda)", async () => {
    const { getByTestId } = render(<Janela managed />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const el = getByTestId("lista");
    expect(el.style.height).toBe("");
    expect(el.style.flex).toBe("");
  });
});
