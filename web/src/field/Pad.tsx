import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface PadHandle {
  clear: () => void;
  dataUrl: () => string;
}

interface PadProps {
  className?: string;
  initial?: string;
  onDone?: (dataUrl: string) => void;
  label?: string;
}

export const Pad = forwardRef<PadHandle, PadProps>(function Pad({ className, initial, onDone, label }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useImperativeHandle(ref, () => ({
    clear: () => {
      const c = canvasRef.current;
      if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    },
    dataUrl: () => canvasRef.current?.toDataURL("image/png") || "",
  }));

  useEffect(() => {
    const c = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const box = c.getBoundingClientRect();
    c.width = Math.round(box.width * ratio);
    c.height = Math.round(box.height * ratio);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#12203a";
    if (initial) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, box.width, box.height);
      img.src = initial;
    }
    let drawing = false;
    let drawn = false;
    const point = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.onpointerdown = (e) => {
      drawing = true;
      drawn = true;
      c.setPointerCapture(e.pointerId);
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    c.onpointermove = (e) => {
      if (!drawing) return;
      const p = point(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    c.onpointerup = () => {
      drawing = false;
      if (drawn) onDoneRef.current?.(c.toDataURL("image/png"));
    };
    c.onpointercancel = () => {
      drawing = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={className} role={label ? "img" : undefined} aria-label={label} />;
});
