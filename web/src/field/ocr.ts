const FIELD_SIDE = 640;
const FIELD_JPEG = 0.5;

function jpegQuality(maxSide: number): number {
  return maxSide <= 800 ? FIELD_JPEG : 0.7;
}

function sizedCanvas(srcW: number, srcH: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(srcW * scale));
  c.height = Math.max(1, Math.round(srcH * scale));
  return c;
}

function portraitFromCanvas(src: HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  let sx = 0;
  let sy = 0;
  let sw = src.width;
  let sh = src.height;
  // Emirates ID is a wide card. The portrait sits on the left and continues
  // down to the shoulders. A short square crop was cutting that lower part off.
  if (src.width > src.height * 1.15) {
    sx = src.width * 0.086;
    sy = src.height * 0.335;
    sw = src.width * 0.184;
    sh = src.height * 0.348;
    if (sx + sw > src.width) sw = src.width - sx;
    if (sy + sh > src.height) sh = src.height - sy;
  }
  const outW = 480;
  const outH = Math.max(1, Math.round(outW * (sh / sw)));
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
  return c.toDataURL("image/jpeg", 0.92);
}

async function drawFile(file: File, maxSide: number): Promise<HTMLCanvasElement> {
  try {
    if (typeof createImageBitmap === "function") {
      let bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      if (scale < 1) {
        try {
          const small = await createImageBitmap(bmp, {
            resizeWidth: Math.max(1, Math.round(bmp.width * scale)),
            resizeHeight: Math.max(1, Math.round(bmp.height * scale)),
            resizeQuality: "high",
          });
          bmp.close();
          bmp = small;
        } catch {
          /* draw scaled below */
        }
      }
      const c = sizedCanvas(bmp.width, bmp.height, maxSide);
      c.getContext("2d", { alpha: false })!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c;
    }
  } catch {
    /* Image() fallback */
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = sizedCanvas(img.width, img.height, maxSide);
      c.getContext("2d", { alpha: false })!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/** Downscale a picked photo to a JPEG data URL. maxW is the longest side. */
export async function shrinkImage(file: File, maxW: number = FIELD_SIDE): Promise<string> {
  const c = await drawFile(file, maxW);
  return c.toDataURL("image/jpeg", jpegQuality(maxW));
}

/** One decode: small ID card JPEG plus a tiny face crop — for phone upload. */
export async function prepareIdPhoto(file: File): Promise<{ card: string; portrait: string | null; ocrCard: string }> {
  const c = await drawFile(file, 1100);
  const ocrCard = c.toDataURL("image/jpeg", 0.72);
  const small = sizedCanvas(c.width, c.height, FIELD_SIDE);
  small.getContext("2d", { alpha: false })!.drawImage(c, 0, 0, small.width, small.height);
  return {
    card: small.toDataURL("image/jpeg", FIELD_JPEG),
    portrait: portraitFromCanvas(c),
    ocrCard,
  };
}

/** Cut the holder's portrait out of an Emirates ID card photo. */
export function cropPortrait(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const src = document.createElement("canvas");
      src.width = img.width;
      src.height = img.height;
      src.getContext("2d")!.drawImage(img, 0, 0);
      resolve(portraitFromCanvas(src));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function binarize(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/** Enlarged, high-contrast crops of the areas where the ID number usually sits. */
function numberRegions(dataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const regions = [
        { x: 0.02, y: 0.52, w: 0.96, h: 0.46 },
        { x: 0.28, y: 0.18, w: 0.7, h: 0.55 },
      ];
      resolve(
        regions.map((r) => {
          const sx = img.width * r.x;
          const sy = img.height * r.y;
          const sw = img.width * r.w;
          const sh = img.height * r.h;
          const c = document.createElement("canvas");
          const scale = Math.min(1.6, 720 / Math.max(sw, 1));
          c.width = Math.max(320, Math.round(sw * scale));
          c.height = Math.max(120, Math.round(sh * scale));
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          binarize(c);
          return c.toDataURL("image/jpeg", 0.85);
        }),
      );
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

interface TessWorker {
  recognize(image: string): Promise<{ data?: { text?: string } }>;
}

interface TesseractLike {
  createWorker?(lang: string): Promise<TessWorker>;
  recognize?(image: string, lang: string): Promise<{ data?: { text?: string } }>;
}

let loading: Promise<TesseractLike> | null = null;
let worker: TessWorker | null = null;

function loadTesseract(): Promise<TesseractLike> {
  const w = window as unknown as { Tesseract?: TesseractLike };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (!loading) {
    loading = new Promise<TesseractLike>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error("no ocr")));
      s.onerror = () => reject(new Error("ocr unavailable"));
      setTimeout(() => reject(new Error("ocr timeout")), 25000);
      document.head.appendChild(s);
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

async function readText(image: string): Promise<string> {
  try {
    const t = await loadTesseract();
    if (t.createWorker) {
      if (!worker) worker = await t.createWorker("eng");
      const r = await worker.recognize(image);
      return (r && r.data && r.data.text) || "";
    }
    const r = t.recognize ? await t.recognize(image, "eng") : null;
    return (r && r.data && r.data.text) || "";
  } catch {
    return "";
  }
}

/** Read the card (full image + ID-number strip) and return OCR text for auto-fill. */
export async function ocrEmiratesCard(images: string[]): Promise<string> {
  const out: string[] = [];
  for (const img of images) {
    out.push(await readText(img));
    for (const crop of await numberRegions(img)) out.push(await readText(crop));
  }
  return out.filter(Boolean).join("\n");
}

export async function ocrEmiratesCardFast(image: string): Promise<string> {
  return ocrEmiratesCard([image]);
}

/** Find a 784-XXXX-XXXXXXX-X Emirates ID number in noisy OCR text. */
export function formatEidLocal(text: string): string {
  const s = String(text || "")
    .replace(/[OoDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Zz]/g, "2")
    .replace(/B/g, "8");
  const m = s.match(/784[\s\-–—.]{0,3}\d{4}[\s\-–—.]{0,3}\d{7}[\s\-–—.]{0,3}\d/);
  let digits = (m ? m[0] : "").replace(/\D/g, "");
  if (!/^784\d{12}$/.test(digits)) {
    const all = s.replace(/\D/g, "");
    const at = all.indexOf("784");
    if (at >= 0) digits = all.slice(at, at + 15);
  }
  return /^784\d{12}$/.test(digits)
    ? digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7, 14) + "-" + digits.slice(14)
    : "";
}
