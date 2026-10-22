import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import "./id-workbench.css";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Readout {
  name?: string;
  idOrVisaNo?: string;
  nationality?: string;
  dateOfBirth?: string;
  company?: string;
}

const HANDLES = ["nw", "ne", "se", "sw"] as const;
const FRONT_LENS: Box = { x: 0.22, y: 0.12, w: 0.74, h: 0.5 };
const BACK_LENS: Box = { x: 0.08, y: 0.22, w: 0.84, h: 0.42 };
const FACE: Box = { x: 0.03, y: 0.12, w: 0.3, h: 0.7 };

function clampBox(b: Box): Box {
  const w = Math.max(0.08, Math.min(1, b.w));
  const h = Math.max(0.08, Math.min(1, b.h));
  return {
    x: Math.max(0, Math.min(1 - w, b.x)),
    y: Math.max(0, Math.min(1 - h, b.y)),
    w,
    h,
  };
}

function clampLens(b: Box): Box {
  const w = Math.max(0.12, Math.min(1, b.w));
  const h = Math.max(0.06, Math.min(1, b.h));
  return {
    x: Math.max(0, Math.min(1 - w, b.x)),
    y: Math.max(0, Math.min(1 - h, b.y)),
    w,
    h,
  };
}

function oneCard(nw: number, nh: number): Box {
  const aspect = nw / Math.max(1, nh);
  if (aspect < 0.95) return clampBox({ x: 0.06, y: 0.52, w: 0.88, h: 0.4 });
  return clampBox({ x: 0.5, y: 0.5, w: 0.46, h: 0.42 });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not open that photo."));
    };
    img.src = url;
  });
}

async function cutFile(file: File, box: Box, minHeight = 0): Promise<File> {
  const img = await loadImage(file);
  const sx = box.x * img.naturalWidth;
  const sy = box.y * img.naturalHeight;
  const sw = Math.max(1, box.w * img.naturalWidth);
  const sh = Math.max(1, box.h * img.naturalHeight);
  let scale = Math.min(1, 2400 / Math.max(sw, sh));
  if (minHeight > 0 && sh * scale < minHeight) scale = Math.min(4, minHeight / sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop that photo.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("Could not crop that photo."))), "image/jpeg", 0.92);
  });
  return new File([blob], "id-crop.jpg", { type: "image/jpeg" });
}

function pct(box: Box): { left: string; top: string; width: string; height: string } {
  return {
    left: box.x * 100 + "%",
    top: box.y * 100 + "%",
    width: box.w * 100 + "%",
    height: box.h * 100 + "%",
  };
}

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

/** One person. Crop the front or the back from the photo, then zoom and the lens apply only to that crop. */
export function IdWorkbench({
  file,
  read,
  busy,
  onCard,
  onPhoto,
  onRead,
  onReadBack,
  onEdit,
  onClearCard,
  onReplace,
  onRemovePhoto,
  savedFront = null,
  savedBack = null,
  onSavedFront,
  onSavedBack,
}: {
  file: File;
  read: Readout | null;
  busy: boolean;
  onCard: (file: File) => void;
  onPhoto: (file: File) => void;
  onRead: (file: File) => void | Promise<void>;
  onReadBack: (file: File) => void | Promise<void>;
  onEdit?: (patch: Readout) => void;
  /** Clear the saved front card when the Front crop is removed. */
  onClearCard?: () => void;
  /** Pick a new photo (or a second photo) to replace the sheet. */
  onReplace?: (files: File[]) => void;
  /** Remove the uploaded sheet photo and return to the upload screen. */
  onRemovePhoto?: () => void;
  /** Parent-kept front crop so Crop back never loses Front. */
  savedFront?: File | null;
  savedBack?: File | null;
  onSavedFront?: (file: File | null) => void;
  onSavedBack?: (file: File | null) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cropRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ which: "card" | "photo" | "lens"; edge: string; x: number; y: number; box: Box; root: HTMLDivElement | null } | null>(null);
  const placed = useRef(false);
  const sheetId = useRef(fileKey(file));
  const [url, setUrl] = useState("");
  const [baseW, setBaseW] = useState(480);
  const [portionZoom, setPortionZoom] = useState(1);
  const [frontPortion, setFrontPortion] = useState("");
  const [backPortion, setBackPortion] = useState("");
  const [frontPiece, setFrontPiece] = useState<File | null>(null);
  const [backPiece, setBackPiece] = useState<File | null>(null);
  const [view, setView] = useState<"front" | "back">("front");
  const [face, setFace] = useState(false);
  const [card, setCard] = useState<Box>({ x: 0.5, y: 0.5, w: 0.46, h: 0.42 });
  const [photo, setPhoto] = useState<Box>(FACE);
  const [frontLens, setFrontLens] = useState<Box>(FRONT_LENS);
  const [backLens, setBackLens] = useState<Box>(BACK_LENS);
  const [frontFile, setFrontFile] = useState<File | null>(savedFront);
  const [frontUrl, setFrontUrl] = useState("");
  const [backFile, setBackFile] = useState<File | null>(savedBack);
  const [backUrl, setBackUrl] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [err, setErr] = useState("");
  const frontRef = useRef<File | null>(savedFront);
  const backRef = useRef<File | null>(savedBack);
  const lens = view === "back" ? backLens : frontLens;
  const boxes = useRef({ card, photo, lens });
  boxes.current = { card, photo, lens };

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    placed.current = false;
    const id = fileKey(file);
    if (sheetId.current !== id) {
      sheetId.current = id;
      // New sheet for cropping only — do not clear Front / Back (parent keeps those).
      setPortionZoom(1);
      setFace(false);
      setFrontPiece(null);
      setBackPiece(null);
      setFrontPortion((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setBackPortion((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setPhotoPreview("");
      setErr("");
      setView(frontRef.current ? "front" : backRef.current ? "back" : "front");
    }
    return () => URL.revokeObjectURL(next);
  }, [file]);

  useEffect(() => {
    if (!savedFront) {
      if (frontRef.current || frontUrl) {
        frontRef.current = null;
        setFrontFile(null);
        setFrontUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return "";
        });
      }
      return;
    }
    if (frontRef.current === savedFront && frontUrl) return;
    frontRef.current = savedFront;
    setFrontFile(savedFront);
    const next = URL.createObjectURL(savedFront);
    setFrontUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
  }, [savedFront, frontUrl]);

  useEffect(() => {
    if (!savedBack) {
      if (backRef.current || backUrl) {
        backRef.current = null;
        setBackFile(null);
        setBackUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return "";
        });
      }
      return;
    }
    if (backRef.current === savedBack && backUrl) return;
    backRef.current = savedBack;
    setBackFile(savedBack);
    const next = URL.createObjectURL(savedBack);
    setBackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
  }, [savedBack, backUrl]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const apply = () => setBaseW(Math.max(280, el.clientWidth));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [url, view]);

  function placeFromImage(img: HTMLImageElement) {
    if (placed.current || !img.naturalWidth) return;
    placed.current = true;
    setCard(oneCard(img.naturalWidth, img.naturalHeight));
  }

  function point(e: ReactPointerEvent, root: HTMLDivElement | null): { x: number; y: number } | null {
    const img = root?.querySelector("img");
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function setLensBox(next: Box) {
    const boxed = clampLens(next);
    if (view === "back") setBackLens(boxed);
    else setFrontLens(boxed);
    boxes.current.lens = boxed;
  }

  function onDown(e: ReactPointerEvent, which: "card" | "photo" | "lens", edge: string, root: HTMLDivElement | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const at = point(e, root);
    if (!at) return;
    drag.current = { which, edge, x: at.x, y: at.y, box: { ...boxes.current[which] }, root };
    root?.setPointerCapture(e.pointerId);
  }

  function onMove(e: ReactPointerEvent) {
    const held = drag.current;
    const at = held ? point(e, held.root) : null;
    if (!held || !at) return;
    const dx = at.x - held.x;
    const dy = at.y - held.y;
    let next = { ...held.box };
    if (!held.edge) next = { ...next, x: held.box.x + dx, y: held.box.y + dy };
    else {
      if (held.edge.includes("e")) next.w = held.box.w + dx;
      if (held.edge.includes("s")) next.h = held.box.h + dy;
      if (held.edge.includes("w")) {
        next.x = held.box.x + dx;
        next.w = held.box.w - dx;
      }
      if (held.edge.includes("n")) {
        next.y = held.box.y + dy;
        next.h = held.box.h - dy;
      }
    }
    if (held.which === "lens") setLensBox(next);
    else if (held.which === "card") setCard(clampBox(next));
    else setPhoto(clampBox(next));
  }

  function onUp() {
    drag.current = null;
  }

  function clearSide(side: "front" | "back") {
    setErr("");
    setFace(false);
    if (side === "front") {
      setFrontFile(null);
      frontRef.current = null;
      onSavedFront?.(null);
      setFrontPiece(null);
      setFrontUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setFrontPortion((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setFrontLens(FRONT_LENS);
      setPhoto(FACE);
      onClearCard?.();
      setView(backRef.current || backUrl ? "back" : "front");
    } else {
      setBackFile(null);
      backRef.current = null;
      onSavedBack?.(null);
      setBackPiece(null);
      setBackUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setBackPortion((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      setBackLens(BACK_LENS);
      setView(frontRef.current || frontUrl ? "front" : "back");
    }
  }

  function moveBackToFront() {
    const piece = backRef.current || backFile;
    const pieceUrl = backUrl;
    if (!piece || !pieceUrl) return;
    setErr("");
    setFrontFile(piece);
    frontRef.current = piece;
    onSavedFront?.(piece);
    setFrontUrl((prev) => {
      if (prev && prev !== pieceUrl) URL.revokeObjectURL(prev);
      return pieceUrl;
    });
    setFrontLens(FRONT_LENS);
    setBackFile(null);
    backRef.current = null;
    onSavedBack?.(null);
    setBackUrl("");
    setBackPiece(null);
    setBackPortion((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setBackLens(BACK_LENS);
    onCard(piece);
    setFace(false);
    setView("front");
  }

  async function cropSide(side: "front" | "back") {
    setErr("");
    try {
      // First cut always fills Front if Front is still empty — Crop back must not wipe Front.
      const target: "front" | "back" = side === "back" && !frontRef.current ? "front" : side;
      const lensBox = target === "front" ? FRONT_LENS : BACK_LENS;
      const cropped = await cutFile(file, card);
      const nextUrl = URL.createObjectURL(cropped);
      if (target === "front") {
        const prevFront = frontRef.current;
        setFrontFile(cropped);
        frontRef.current = cropped;
        onSavedFront?.(cropped);
        setFrontLens(lensBox);
        setFrontUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
        onCard(cropped);
        // Keep Back untouched when (re)cropping Front.
        void prevFront;
      } else {
        setBackFile(cropped);
        backRef.current = cropped;
        onSavedBack?.(cropped);
        setBackLens(lensBox);
        setBackUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
        // Front stays in frontRef / frontUrl — never cleared here.
      }
      setFace(false);
      setView(target);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function cropFace() {
    if (!frontFile) return;
    setErr("");
    try {
      const cropped = await cutFile(frontFile, photo);
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(cropped);
      });
      onPhoto(cropped);
      setFace(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function cutPortion() {
    setErr("");
    try {
      const source = view === "back" ? backFile : frontFile;
      if (!source) return;
      const writing = await cutFile(source, boxes.current.lens, 520);
      const portion = URL.createObjectURL(writing);
      setPortionZoom(1);
      if (view === "back") {
        setBackPiece(writing);
        setBackPortion((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return portion;
        });
        await onReadBack(writing);
      } else {
        setFrontPiece(writing);
        setFrontPortion((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return portion;
        });
        await onRead(writing);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function readPortion() {
    setErr("");
    try {
      const piece = view === "back" ? backPiece : frontPiece;
      if (!piece) return;
      if (view === "back") await onReadBack(piece);
      else await onRead(piece);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const cropUrl = view === "back" ? backUrl : frontUrl;
  const pictureWidth = baseW;
  const portionUrl = view === "back" ? backPortion : frontPortion;

  return (
    <div className="idw">
      <section className="idw-panel">
        <div className="idw-frame" ref={frameRef}>
          <div className="idw-sheetwrap">
            <div className="idw-view" ref={viewRef}>
              {onRemovePhoto && url ? (
                <div className="idw-clear-bar">
                  <button
                    type="button"
                    className="idw-clear idw-clear-sheet"
                    aria-label="Remove photo"
                    title="Remove photo — upload again"
                    disabled={busy}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemovePhoto();
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {url && (
                <div
                  ref={sheetRef}
                  className="idw-canvas"
                  style={{ width: pictureWidth + "px" }}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  <img
                    ref={imgRef}
                    src={url}
                    alt="Uploaded photo"
                    draggable={false}
                    style={{ width: pictureWidth + "px", maxWidth: "none", height: "auto" }}
                    onLoad={(e) => placeFromImage(e.currentTarget)}
                  />
                  <div className="idw-box idw-cardbox on" style={pct(card)} onPointerDown={(e) => onDown(e, "card", "", sheetRef.current)}>
                    <em className="idw-tag">
                      <i>Card</i>
                    </em>
                    {HANDLES.map((edge) => (
                      <span key={edge} className={edge} onPointerDown={(e) => onDown(e, "card", edge, sheetRef.current)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="idw-bar">
          <button type="button" className="btn" disabled={busy} onClick={() => void cropSide("front")}>
            Crop front
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void cropSide("back")}>
            Crop back
          </button>
        </div>
        <p className="idw-hint">Crop front → Front stays. Crop back → Back stays. Upload again only changes the top photo — Front / Back cuts are kept.</p>
        <div className="idw-pair idw-pair-always">
          <div className={"idw-slot" + (view === "front" && frontUrl ? " on" : "")}>
            <button
              type="button"
              className={"idw-pick" + (view === "front" && frontUrl ? " on" : "")}
              disabled={!frontUrl}
              onClick={() => {
                if (!frontUrl) return;
                setView("front");
                setFace(false);
              }}
            >
              {frontUrl ? <img src={frontUrl} alt="Front of the ID" /> : <em>Front</em>}
              <span>Front{frontUrl ? " · kept" : ""}</span>
            </button>
            {frontUrl ? (
              <button
                type="button"
                className="idw-clear"
                aria-label="Clear front crop"
                title="Clear front — crop again"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearSide("front");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <div className={"idw-slot" + (view === "back" && backUrl ? " on" : "")}>
            <button
              type="button"
              className={"idw-pick" + (view === "back" && backUrl ? " on" : "")}
              disabled={!backUrl}
              onClick={() => {
                if (!backUrl) return;
                setView("back");
                setFace(false);
              }}
            >
              {backUrl ? <img src={backUrl} alt="Back of the ID" /> : <em>Back</em>}
              <span>Back{backUrl ? " · kept" : ""}</span>
            </button>
            {backUrl ? (
              <button
                type="button"
                className="idw-clear"
                aria-label="Clear back crop"
                title="Clear back — crop again"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearSide("back");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        {backUrl && !frontUrl ? (
          <div className="idw-bar">
            <button type="button" className="btn" disabled={busy} onClick={moveBackToFront}>
              Move to Front
            </button>
            <span className="idw-hint" style={{ margin: 0 }}>
              Front is empty — this cut stays in Front so Crop back will not remove it.
            </span>
          </div>
        ) : null}
        {onReplace && (
          <div className="idw-bar idw-bar-again">
            <button type="button" className="btn sec" disabled={busy} onClick={() => replaceRef.current?.click()}>
              Upload again
            </button>
            <input
              ref={replaceRef}
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const list = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
                e.target.value = "";
                if (list.length) onReplace(list);
              }}
            />
            {onRemovePhoto && (
              <button type="button" className="btn ghost" disabled={busy} onClick={() => onRemovePhoto()}>
                Remove photo
              </button>
            )}
          </div>
        )}
        {(frontUrl || backUrl) && (
          <div className="idw-work">
            <div>
              {cropUrl && (
                <div className="idw-view">
                  <div
                    ref={cropRef}
                    className="idw-canvas"
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  >
                    <img src={cropUrl} alt={view === "back" ? "Cropped back" : "Cropped front"} draggable={false} />
                    {!face && (
                      <div className="idw-box idw-lensbox on" style={pct(lens)} onPointerDown={(e) => onDown(e, "lens", "", cropRef.current)}>
                        <em className="idw-tag">
                          <i>Lens</i>
                        </em>
                        {HANDLES.map((edge) => (
                          <span key={edge} className={edge} onPointerDown={(e) => onDown(e, "lens", edge, cropRef.current)} />
                        ))}
                      </div>
                    )}
                    {view === "front" && face && (
                      <div className="idw-box idw-photobox on" style={pct(photo)} onPointerDown={(e) => onDown(e, "photo", "", cropRef.current)}>
                        <em className="idw-tag">
                          <i>Face</i>
                        </em>
                        {HANDLES.map((edge) => (
                          <span key={edge} className={edge} onPointerDown={(e) => onDown(e, "photo", edge, cropRef.current)} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="idw-bar">
                {!face && (
                  <button type="button" className="btn" disabled={busy || !cropUrl} onClick={() => void cutPortion()}>
                    {busy ? "Reading…" : "Cut portion"}
                  </button>
                )}
                {view === "front" && !face && (
                  <button type="button" className="btn sec" disabled={!frontUrl} onClick={() => setFace(true)}>
                    Crop face
                  </button>
                )}
                {face && (
                  <>
                    <button type="button" className="btn" disabled={busy} onClick={() => void cropFace()}>
                      Save face
                    </button>
                    <button type="button" className="btn sec" onClick={() => setFace(false)}>
                      Back
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="idw-down">
              {portionUrl ? (
                <>
                  <div className="idw-view">
                    <img className="idw-zoompic" src={portionUrl} alt="Cut portion" style={{ width: portionZoom * 100 + "%" }} />
                  </div>
                  <div className="idw-bar">
                    <button type="button" className="btn" disabled={busy} onClick={() => void readPortion()}>
                      {busy ? "Reading…" : "Read"}
                    </button>
                    <button type="button" className="btn sec" disabled={portionZoom >= 8} onClick={() => setPortionZoom((z) => Math.min(8, Math.round((z + 0.5) * 10) / 10))}>
                      Zoom in
                    </button>
                    <button type="button" className="btn sec" disabled={portionZoom <= 1} onClick={() => setPortionZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))}>
                      Zoom out
                    </button>
                    <span className="idw-zoomlabel">Zoom {portionZoom.toFixed(1)}×</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
        <label className="idw-field">
          Name
          <input value={read?.name || ""} onChange={(e) => onEdit?.({ name: e.target.value })} />
        </label>
        <label className="idw-field">
          ID number
          <input value={read?.idOrVisaNo || ""} onChange={(e) => onEdit?.({ idOrVisaNo: e.target.value })} />
        </label>
        <label className="idw-field">
          Nationality
          <input value={read?.nationality || ""} onChange={(e) => onEdit?.({ nationality: e.target.value })} />
        </label>
        <label className="idw-field">
          Employer from the back
          <input value={read?.company || ""} onChange={(e) => onEdit?.({ company: e.target.value })} />
        </label>
        {photoPreview && (
          <figure className="idw-face">
            <img src={photoPreview} alt="Face photo" />
            <figcaption>Face photo</figcaption>
          </figure>
        )}
        {err && <p className="err">{err}</p>}
      </section>
    </div>
  );
}
