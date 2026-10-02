import { useState, type DragEvent } from "react";

/** Drag-and-drop for one image file. Spread `dropProps` on the drop area; `dragging` is true while a file hovers it. */
export function useDropImage(onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (file) onFile(file);
    },
  };
  return { dragging, dropProps };
}
