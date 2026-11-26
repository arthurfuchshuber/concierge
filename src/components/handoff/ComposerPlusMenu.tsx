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
  attachLabel = "Anexo",
  iconClassName = "size-4",
  menuClassName = "w-40",
}: {
  /** Atendimento (mockup ATD-D10/M11): "Anexar Arquivo", "+" de 18px e menu de 180px sem borda. */
  attachLabel?: string;
  iconClassName?: string;
  menuClassName?: string;
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
          <Plus className={iconClassName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className={menuClassName}>
        <DropdownMenuItem onSelect={() => onCamera()}>
          <Camera className="size-4" /> Câmera
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAttach()}>
          <Paperclip className="size-4" /> {attachLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
