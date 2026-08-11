import { Plus, Camera, Paperclip } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/**
 * Botão "+" padrão dos composers (anfitrião e hóspede), no estilo WhatsApp:
 * fica à esquerda do campo e abre as opções "Câmera" e "Anexo".
 */
export function ComposerPlusMenu({
  onCamera,
  onAttach,
  disabled,
  className = "",
}: {
  onCamera: () => void;
  onAttach: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Adicionar anexo"
          title="Adicionar"
          className={`grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 ${className}`}
        >
          <Plus className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-40">
        <DropdownMenuItem onSelect={() => onCamera()}>
          <Camera className="size-4" /> Câmera
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAttach()}>
          <Paperclip className="size-4" /> Anexo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
