import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getClicksignDocumentFile } from "@/lib/clicksign.functions";
import { getOwnerLooseDocFile } from "@/lib/owner-finance.functions";

/**
 * Leitor de documentos do sistema (contratos do ClickSign e PDFs avulsos). Usado na ficha do
 * cadastro e nas janelas da integração ClickSign (lista de contratos e Novos Cadastros).
 */
export type PreviewTarget = {
  name: string;
  url?: string | null;
  docId?: string;
  looseId?: string;
  /** Linha de apoio sob o nome (ex.: "Assinado · 2 de 2 · 3 ago 2026"). */
  subtitle?: string;
} | null;

export function DocPreviewDialog({ doc, onClose }: { doc: PreviewTarget; onClose: () => void }) {
  const fileFn = useServerFn(getClicksignDocumentFile);
  const looseFn = useServerFn(getOwnerLooseDocFile);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clicksign-doc-file", doc?.docId ?? doc?.looseId],
    queryFn: () =>
      doc!.looseId
        ? looseFn({ data: { id: doc!.looseId } })
        : fileFn({ data: { id: doc!.docId! } }),
    enabled: !!(doc?.docId || doc?.looseId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const externalUrl = doc?.docId ? null : (doc?.url ?? null);

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      {/* Mockup aprovado: janela pequena (com "X"), cabeçalho com ícone, nome em 1 linha e a
          situação do documento; o leitor ocupa a largura toda, com cantos do sistema. */}
      <DialogContent className="max-w-4xl gap-3.5 overflow-hidden p-[18px]">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-12">
          <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-foreground/[0.06] text-muted-foreground">
            <FileText className="size-[18px]" />
          </span>
          <div className="grid min-w-0 gap-1">
            <DialogTitle className="truncate font-display text-lg font-bold tracking-[-0.02em]">
              {doc?.name}
            </DialogTitle>
            {doc?.subtitle ? (
              <p className="truncate text-[12px] text-muted-foreground">{doc.subtitle}</p>
            ) : null}
          </div>
        </DialogHeader>
        {doc && (
          <>
            {isLoading ? (
              <div className="flex h-[70vh] items-center justify-center gap-2 rounded-sm bg-muted text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Gerando link seguro…
              </div>
            ) : data?.base64 ? (
              <PdfPages base64={data.base64} />
            ) : externalUrl ? (
              <iframe
                src={externalUrl}
                title={doc.name}
                className="h-[70vh] w-full rounded-sm bg-muted"
              />
            ) : (
              <div className="flex h-[40vh] items-center justify-center rounded-sm bg-muted px-6 text-center text-sm text-muted-foreground">
                {isError
                  ? "Não foi possível gerar o link do documento."
                  : "Documento sem arquivo disponível."}
              </div>
            )}
            {externalUrl && (
              <div className="flex justify-end gap-2">
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="size-3.5" /> Abrir em nova aba
                </a>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PdfPages({ base64 }: { base64: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function renderPdf() {
      try {
        setError(false);
        setPages([]);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const rendered: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 1100 / baseViewport.width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.92),
          );
          if (!blob) throw new Error("Falha ao renderizar página");
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          rendered.push(objectUrl);
          if (!cancelled) setPages([...rendered]);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [base64]);

  if (error) {
    return (
      <div className="flex h-[40vh] items-center justify-center rounded-sm bg-muted px-6 text-center text-sm text-muted-foreground">
        Não foi possível renderizar este documento.
      </div>
    );
  }

  return (
    <div className="h-[70vh] overflow-y-auto border-t border-border bg-muted p-2 sm:p-4">
      {pages.length === 0 && (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando documento…
        </div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {pages.map((page, index) => (
          <img
            key={page}
            src={page}
            alt={`Página ${index + 1}`}
            className="h-auto w-full bg-background shadow-sm"
          />
        ))}
      </div>
    </div>
  );
}
