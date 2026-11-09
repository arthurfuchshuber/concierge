/**
 * Campo único do modal "Registros da reserva" e player compacto (board de 08/11/2026).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordComposer } from "@/components/records/RecordComposer";
import { AudioPill } from "@/components/records/AudioPill";

describe("RecordComposer", () => {
  it("um campo só (textarea), sem ícone de documento; Enter envia e Shift+Enter não", () => {
    const onText = vi.fn();
    render(<RecordComposer onSubmitText={onText} onSubmitAudio={() => {}} />);
    const ta = screen.getByPlaceholderText("Descrever situação, problema ou auditoria…");
    expect(ta.tagName).toBe("TEXTAREA");
    fireEvent.change(ta, { target: { value: "Ar-condicionado não gela" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onText).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onText).toHaveBeenCalledWith("Ar-condicionado não gela");
  });

  it("o texto só some quando o pai consome (categoria escolhida); cancelar mantém o texto", () => {
    const { rerender } = render(<RecordComposer onSubmitText={() => {}} onSubmitAudio={() => {}} clearToken={0} />);
    const ta = screen.getByPlaceholderText("Descrever situação, problema ou auditoria…") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "texto" } });
    fireEvent.click(screen.getByLabelText("Enviar"));
    expect(ta.value).toBe("texto");
    rerender(<RecordComposer onSubmitText={() => {}} onSubmitAudio={() => {}} clearToken={1} />);
    expect((screen.getByPlaceholderText("Descrever situação, problema ou auditoria…") as HTMLTextAreaElement).value).toBe("");
  });

  it("microfone dentro do campo e enviar desabilitado sem conteúdo", () => {
    render(<RecordComposer onSubmitText={() => {}} onSubmitAudio={() => {}} />);
    expect(screen.getByLabelText("Segure para gravar áudio")).toBeTruthy();
    expect((screen.getByLabelText("Enviar") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AudioPill", () => {
  it("mostra play, duração e lixeira opcional", () => {
    if (!("createObjectURL" in URL)) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const onDelete = vi.fn();
    render(<AudioPill blob={new Blob(["a"], { type: "audio/webm" })} durationMs={14_000} onDelete={onDelete} />);
    expect(screen.getByLabelText("Ouvir áudio")).toBeTruthy();
    expect(screen.getByText("0:14")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Apagar áudio"));
    expect(onDelete).toHaveBeenCalled();
  });
});
