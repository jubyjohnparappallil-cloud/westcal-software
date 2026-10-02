/** Downscale a picked photo to a JPEG data URL no wider than maxW. */
export function shrinkImage(file: File, maxW: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/** Cut the holder's portrait out of an Emirates ID card photo. */
export function cropPortrait(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const sx = img.width * 0.045;
      const sy = img.height * 0.3;
      const sw = img.width * 0.255;
      const sh = img.height * 0.6;
      c.width = 240;
      c.height = 300;
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
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
        { x: 0.02, y: 0.55, w: 0.96, h: 0.42 },
        { x: 0.3, y: 0.2, w: 0.68, h: 0.78 },
        { x: 0.02, y: 0.72, w: 0.96, h: 0.26 },
        { x: 0.02, y: 0.02, w: 0.96, h: 0.96 },
      ];
      resolve(
        regions.map((r) => {
          const sx = img.width * r.x;
          const sy = img.height * r.y;
          const sw = img.width * r.w;
          const sh = img.height * r.h;
          const c = document.createElement("canvas");
          c.width = Math.max(900, Math.round(sw * 2));
          c.height = Math.max(220, Math.round(sh * 2));
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          binarize(c);
          return c.toDataURL("image/jpeg", 0.95);
        }),
      );
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

interface TesseractLike {
  recognize(image: string, lang: string, options: Record<string, string>): Promise<{ data?: { text?: string } }>;
}

async function readText(t: TesseractLike, image: string, options?: Record<string, string>): Promise<string> {
  try {
    const r = await t.recognize(image, "eng", options || {});
    return (r && r.data && r.data.text) || "";
  } catch {
    return "";
  }
}

let loading: Promise<TesseractLike> | null = null;
function loadTesseract(): Promise<TesseractLike> {
  const w = window as unknown as { Tesseract?: TesseractLike };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error("no ocr")));
      s.onerror = () => reject(new Error("ocr unavailable"));
      setTimeout(() => reject(new Error("ocr timeout")), 20000);
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Read all text off one or more ID card images (whole card plus number crops). */
export async function ocrEmiratesCard(images: string[]): Promise<string> {
  const t = await loadTesseract();
  const out: string[] = [];
  const digitsOnly = { tessedit_char_whitelist: "0123456789- " };
  for (const img of images) {
    out.push(await readText(t, img));
    out.push(await readText(t, img, digitsOnly));
    for (const crop of await numberRegions(img)) {
      out.push(await readText(t, crop));
      out.push(await readText(t, crop, digitsOnly));
    }
  }
  return out.filter(Boolean).join("\n");
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
