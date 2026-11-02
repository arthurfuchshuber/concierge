import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Upload, X, Film, Image as ImageIcon, GripVertical } from "lucide-react";
import { toast } from "sonner";

export type MediaItem = { url: string; type: "image" | "video" };

type Props = {
  value: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  folder?: string;
  max?: number;
  className?: string;
};

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 60 * 1024 * 1024;
