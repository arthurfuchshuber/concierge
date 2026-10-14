import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { PropertyThumb } from "../property-thumb";

afterEach(cleanup);

describe("PropertyThumb", () => {
  it("sem foto mostra a casinha", () => {
    const { container } = render(<PropertyThumb />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("se a capa falhar (404), tenta a próxima foto da galeria", () => {
    const { container } = render(
      <PropertyThumb
        src="https://x/capa.jpg"
        fallbacks={["https://x/capa.jpg", "https://x/g1.jpg"]}
      />,
    );
    const first = container.querySelector("img") as HTMLImageElement;
    expect(first.getAttribute("src")).toBe("https://x/capa.jpg");
    fireEvent.error(first);
    expect((container.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(
      "https://x/g1.jpg",
    );
  });
  it("só volta para a casinha quando todas as fotos falham", () => {
    const { container } = render(
      <PropertyThumb src="https://x/a.jpg" fallbacks={["https://x/b.jpg"]} />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
