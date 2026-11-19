// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaLightbox } from "../MediaLightbox";

const foto = (id: string) => ({ id, kind: "photo" as const, url: `https://x/${id}.jpg`, createdAt: "2026-11-18T15:58:00" });

describe("visualizador de mídia (mockup Fin-23)", () => {
  it("uma mídia só: sem miniaturas, sem setas e sem contador", () => {
    render(<MediaLightbox media={[foto("a")]} title="Fotos da Conferência" subtitle="Studio 105" author="Esther" onClose={() => {}} />);
    expect(screen.getByText("Fotos da Conferência")).toBeTruthy();
    expect(screen.getByText("Studio 105")).toBeTruthy();
    expect(screen.getByText("Enviado por Esther")).toBeTruthy();
    expect(screen.getByText("18/11/2026 · 15:58")).toBeTruthy();
    expect(screen.queryByText(/de 1/)).toBeNull();
    expect(screen.queryByLabelText("Próxima")).toBeNull();
    expect(screen.queryByLabelText(/Mídia 1 de/)).toBeNull();
  });

  it("várias: miniaturas, contador e setas trocam a mídia", () => {
    render(<MediaLightbox media={[foto("a"), foto("b"), foto("c")]} startIndex={1} title="T" onClose={() => {}} />);
    expect(screen.getByText("2 de 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Próxima"));
    expect(screen.getByText("3 de 3")).toBeTruthy();
    expect(screen.queryByLabelText("Próxima")).toBeNull();
    fireEvent.click(screen.getByLabelText("Mídia 1 de 3"));
    expect(screen.getByText("1 de 3")).toBeTruthy();
    expect(screen.queryByLabelText("Anterior")).toBeNull();
  });

  it("Esc e o X fecham", () => {
    const onClose = vi.fn();
    render(<MediaLightbox media={[foto("a")]} title="T" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Fechar"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
