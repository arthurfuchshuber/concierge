import { Plus, Camera, Paperclip } from "lucide-react";
import { COMPOSER_ICON_BTN } from "@/components/chat/composer-styles";
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
          className={`${COMPOSER_ICON_BTN} ${className}`}
        >
          <Plus className="size-4" />
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
