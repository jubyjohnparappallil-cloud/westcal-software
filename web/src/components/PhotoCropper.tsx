import { useCallback, useEffect, useRef, useState } from "react";
import "./photo-cropper.css";

export type CropPurpose = "id" | "back" | "photo";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
  fit: number;
  nw: number;
  nh: number;
  box: Box;
  ready: boolean;
}

const EDGES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

const COPY: Record<CropPurpose, { title: string; hint: string; go: string; whole: string }> = {
  id: {
    title: "Zoom in on the Emirates ID",
    hint: "If the customer sent several cards in one photo, zoom in on one card. Drag the frame around that card, tap Crop, then Fetch this card. Use Different card for the next one.",
    go: "Fetch this card",
    whole: "Fetch the whole photo",
  },
  back: {
    title: "Zoom in on the ID back",
    hint: "Zoom in until the Employer line is clear, drag it into the frame, then fetch it.",
    go: "Fetch employer",
    whole: "Fetch the whole photo",
  },
  photo: {
    title: "Zoom and crop the photo",
    hint: "Zoom in and drag the person's photo into the frame.",
    go: "Use this photo",
    whole: "Use the whole photo",
  },
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 12;
const ZOOM_STEP = 1.6;

function clampZoom(n: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

function clampPan(pan: { x: number; y: number }, zoom: number, box: Box, nw: number, nh: number, fit: number) {
  const dw = nw * fit * zoom;
  const dh = nh * fit * zoom;
  const x = dw <= box.w ? box.x + (box.w - dw) / 2 : Math.min(box.x, Math.max(box.x + box.w - dw, pan.x));
  const y = dh <= box.h ? box.y + (box.h - dh) / 2 : Math.min(box.y, Math.max(box.y + box.h - dh, pan.y));
  return { x, y };
}

function applyZoom(v: View, nextZoom: number, originX: number, originY: number): View {
  const z = clampZoom(nextZoom);
  const prevScale = v.fit * v.zoom || 1;
  const nextScale = v.fit * z;
  const ix = (originX - v.panX) / prevScale;
  const iy = (originY - v.panY) / prevScale;
  const pan = clampPan({ x: originX - ix * nextScale, y: originY - iy * nextScale }, z, v.box, v.nw, v.nh, v.fit);
  return { ...v, zoom: z, panX: pan.x, panY: pan.y };
}

const EMPTY: View = { zoom: 1, panX: 0, panY: 0, fit: 1, nw: 1, nh: 1, box: { x: 0, y: 0, w: 10, h: 10 }, ready: false };

export function PhotoCropper({
  file,
  purpose,
  onConfirm,
  onCancel,
  embedded = false,
}: {
  file: File;
  purpose: CropPurpose;
  onConfirm: (file: File) => void;
  onCancel: () => void;
  /** Shown on the page, with Crop and Fetch kept in front of the user. */
  embedded?: boolean;
}) {
  const copy = COPY[purpose];
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState("");
  const [view, setView] = useState<View>(EMPTY);
  const [panning, setPanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState("");
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<
    | { kind: "pan"; px: number; py: number; panX: number; panY: number }
    | { kind: "resize"; edge: string; px: number; py: number; box: Box }
    | { kind: "pinch"; dist: number; zoom: number; panX: number; panY: number; ox: number; oy: number }
    | null
  >(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    setView(EMPTY);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (embedded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [embedded]);

  const layout = useCallback((force = false) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img?.naturalWidth) return;
    if (!force && viewRef.current.ready) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (sw < 20 || sh < 20) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = Math.min(sw / nw, sh / nh);
    const dw = nw * fit;
    const dh = nh * fit;
    const aspect = purpose === "photo" ? 0.78 : 1.62;
    let bw = sw * 0.88;
    let bh = bw / aspect;
    if (bh > sh * 0.82) {
      bh = sh * 0.82;
      bw = bh * aspect;
    }
    if (bw > sw * 0.94) {
      bw = sw * 0.94;
      bh = bw / aspect;
    }
    const box = { x: (sw - bw) / 2, y: (sh - bh) / 2, w: bw, h: bh };
    const pan = clampPan({ x: (sw - dw) / 2, y: (sh - dh) / 2 }, 1, box, nw, nh, fit);
    setView({ zoom: 1, panX: pan.x, panY: pan.y, fit, nw, nh, box, ready: true });
  }, [purpose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!viewRef.current.ready) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => applyZoom(v, v.zoom * factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [url]);

  function zoomBy(factor: number) {
    setView((v) => (v.ready ? applyZoom(v, v.zoom * factor, v.box.x + v.box.w / 2, v.box.y + v.box.h / 2) : v));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!viewRef.current.ready || e.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* The pointer can already be gone. Drag still tracks pointermove on the stage. */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = viewRef.current;
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const rect = stage.getBoundingClientRect();
      dragRef.current = {
        kind: "pinch",
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        zoom: v.zoom,
        panX: v.panX,
        panY: v.panY,
        ox: (pts[0].x + pts[1].x) / 2 - rect.left,
        oy: (pts[0].y + pts[1].y) / 2 - rect.top,
      };
      return;
    }
    const edge = (e.target as HTMLElement).dataset.edge;
    if (edge) {
      dragRef.current = { kind: "resize", edge, px: e.clientX, py: e.clientY, box: { ...v.box } };
      return;
    }
    dragRef.current = { kind: "pan", px: e.clientX, py: e.clientY, panX: v.panX, panY: v.panY };
    setPanning(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    if (drag.kind === "pinch") {
      if (pointers.current.size >= 2) {
        const pts = [...pointers.current.values()];
        const rect = stage.getBoundingClientRect();
        const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const ox = (pts[0].x + pts[1].x) / 2 - rect.left;
        const oy = (pts[0].y + pts[1].y) / 2 - rect.top;
        const next = clampZoom(drag.zoom * (dist / drag.dist));
        setView((v) => {
          const scale0 = v.fit * drag.zoom || 1;
          const scale1 = v.fit * next;
          const ix = (drag.ox - drag.panX) / scale0;
          const iy = (drag.oy - drag.panY) / scale0;
          const pan = clampPan({ x: ox - ix * scale1, y: oy - iy * scale1 }, next, v.box, v.nw, v.nh, v.fit);
          return { ...v, zoom: next, panX: pan.x, panY: pan.y };
        });
      }
      return;
    }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      setView((v) => {
        const pan = clampPan({ x: drag.panX + dx, y: drag.panY + dy }, v.zoom, v.box, v.nw, v.nh, v.fit);
        return { ...v, panX: pan.x, panY: pan.y };
      });
      return;
    }
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    const rect = stage.getBoundingClientRect();
    let { x, y, w, h } = drag.box;
    const edge = drag.edge;
    if (edge.includes("e")) w += dx;
    if (edge.includes("s")) h += dy;
    if (edge.includes("w")) {
      x += dx;
      w -= dx;
    }
    if (edge.includes("n")) {
      y += dy;
      h -= dy;
    }
    const min = 64;
    if (w < min) {
      if (edge.includes("w")) x -= min - w;
      w = min;
    }
    if (h < min) {
      if (edge.includes("n")) y -= min - h;
      h = min;
    }
    if (x < 8) {
      w -= 8 - x;
      x = 8;
    }
    if (y < 8) {
      h -= 8 - y;
      y = 8;
    }
    if (x + w > rect.width - 8) w = rect.width - 8 - x;
    if (y + h > rect.height - 8) h = rect.height - 8 - y;
    if (w < min || h < min) return;
    setView((v) => {
      const box = { x, y, w, h };
      const pan = clampPan({ x: v.panX, y: v.panY }, v.zoom, box, v.nw, v.nh, v.fit);
      return { ...v, box, panX: pan.x, panY: pan.y };
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && dragRef.current?.kind === "pinch") dragRef.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      setPanning(false);
    }
  }

  async function frameFile(): Promise<File> {
    const img = imgRef.current;
    const v = viewRef.current;
    if (!img?.naturalWidth || !v.ready) throw new Error("Wait for the photo, then crop.");
    const scale = v.fit * v.zoom;
    let sx = (v.box.x - v.panX) / scale;
    let sy = (v.box.y - v.panY) / scale;
    let sw = v.box.w / scale;
    let sh = v.box.h / scale;
    if (sx < 0) {
      sw += sx;
      sx = 0;
    }
    if (sy < 0) {
      sh += sy;
      sy = 0;
    }
    if (sx + sw > img.naturalWidth) sw = img.naturalWidth - sx;
    if (sy + sh > img.naturalHeight) sh = img.naturalHeight - sy;
    if (sw < 2 || sh < 2) throw new Error("That frame is empty. Zoom in on one card and try again.");
    const long = Math.max(sw, sh);
    const outScale = long < 1400 ? Math.min(2, 1400 / long) : Math.min(1, 2200 / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * outScale));
    canvas.height = Math.max(1, Math.round(sh * outScale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not crop that photo.");
    ctx.imageSmoothingEnabled = outScale <= 1.2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not crop that photo.");
    const base = file.name.replace(/\.[^.]+$/, "") || "id-card";
    return new File([blob], base + "-crop.jpg", { type: "image/jpeg" });
  }

  async function cropFrame() {
    setErr("");
    setBusy(true);
    try {
      const next = await frameFile();
      const url = URL.createObjectURL(next);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportCrop(whole: boolean) {
    if (whole) {
      onConfirm(file);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await onConfirm(await frameFile());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scale = view.fit * view.zoom;

  return (
    <div
      className={embedded ? "id-crop embedded" : "id-crop"}
      role="dialog"
      aria-modal={embedded ? undefined : true}
      aria-labelledby="id-crop-title"
      onClick={(e) => !embedded && e.target === e.currentTarget && onCancel()}
    >
      <div className="id-crop-card">
        <h3 id="id-crop-title">{copy.title}</h3>
        <p className="id-crop-hint">{copy.hint}</p>
        <div
          className={"id-crop-stage" + (panning ? " panning" : "")}
          ref={stageRef}
          role="application"
          aria-label="Photo"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={() => layout(true)}
              onError={() => setErr("Could not open that photo.")}
              style={
                view.ready
                  ? { width: view.nw * scale, height: view.nh * scale, transform: `translate(${view.panX}px, ${view.panY}px)` }
                  : { visibility: "hidden" }
              }
            />
          )}
          {view.ready && (
            <div className="id-crop-box" style={{ left: view.box.x, top: view.box.y, width: view.box.w, height: view.box.h }}>
              <span className="id-crop-grid" />
              <span className="id-crop-caption">Crop</span>
              {EDGES.map((edge) => (
                <span key={edge} className={"id-crop-handle " + edge} data-edge={edge} />
              ))}
            </div>
          )}
        </div>
        <p className="id-crop-level">{view.ready ? "Zoom " + view.zoom.toFixed(1) + "×" : "Zoom"}</p>
        <div className="id-crop-zoom">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!view.ready || view.zoom <= ZOOM_MIN}>
            − Zoom out
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            aria-label="Zoom"
            value={view.ready ? view.zoom : 1}
            disabled={!view.ready}
            onChange={(e) => {
              const next = Number(e.target.value);
              setView((v) => applyZoom(v, next, v.box.x + v.box.w / 2, v.box.y + v.box.h / 2));
            }}
          />
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={!view.ready || view.zoom >= ZOOM_MAX}>
            + Zoom in
          </button>
        </div>
        <p className="id-crop-hint" style={{ margin: "8px 0 0" }}>
          Zoom in makes the writing bigger. Zoom out shows more of the card. Drag inside the frame to line the text up.
        </p>
        {err && <p className="id-crop-err">{err}</p>}
        {preview && (
          <div className="id-crop-preview">
            <img src={preview} alt="Cropped card" />
            <span>Cropped card. Fetch this card, or move the frame and crop a different card.</span>
          </div>
        )}
        <div className="id-crop-actions">
          <button type="button" className="alt" disabled={!view.ready || busy} onClick={() => void cropFrame()}>
            Crop
          </button>
          <button type="button" className="go" disabled={!view.ready || busy} onClick={() => void exportCrop(false)}>
            {busy ? "Working…" : copy.go}
          </button>
          {!embedded && (
            <button type="button" className="alt" disabled={busy} onClick={() => exportCrop(true)}>
              {copy.whole}
            </button>
          )}
          <button type="button" className="stop" disabled={busy} onClick={() => layout(true)}>
            Reset
          </button>
          {!embedded && (
            <button type="button" className="stop" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface CropJob {
  file: File;
  purpose: CropPurpose;
  resolve: (file: File | null) => void;
}

/** Open the zoom and crop dialog. Resolves with the cropped photo, or null if cancelled. */
export function usePhotoCrop() {
  const [job, setJob] = useState<CropJob | null>(null);
  const jobRef = useRef<CropJob | null>(null);
  jobRef.current = job;

  const crop = useCallback((file: File, purpose: CropPurpose = "id") => {
    return new Promise<File | null>((resolve) => {
      setJob((prev) => {
        prev?.resolve(null);
        return { file, purpose, resolve };
      });
    });
  }, []);

  useEffect(() => () => jobRef.current?.resolve(null), []);

  function finish(file: File | null) {
    setJob((prev) => {
      prev?.resolve(file);
      return null;
    });
  }

  const dialog = job ? (
    <PhotoCropper file={job.file} purpose={job.purpose} onConfirm={(next) => finish(next)} onCancel={() => finish(null)} />
  ) : null;

  return { crop, dialog };
}
