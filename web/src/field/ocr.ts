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
export async function shrinkImage(file: File, maxW: number = FIELD_SIDE, quality?: number): Promise<string> {
  const c = await drawFile(file, maxW);
  return c.toDataURL("image/jpeg", quality ?? jpegQuality(maxW));
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** Grayscale with the darks and lights spread out, so card print is readable without turning the photo into noise. */
function grayStretch(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(16, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = clampByte(((gray[p] - min) * 255) / span);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/** OCR copy. A tight zoom is enlarged (up to 3×) so the name and ID number are large enough to read. */
function canvasForRead(src: HTMLCanvasElement, minSide: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height, 1);
  const scale = Math.min(3, Math.max(1, minSide / long));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = scale <= 1.2;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  grayStretch(c);
  return c;
}

/** One decode: small ID card JPEG plus a face crop. Pass a zoomed crop and `{ clarify: true }` when the photo is not sharp. */
export async function prepareIdPhoto(
  file: File,
  opts?: { ocrSide?: number; clarify?: boolean },
): Promise<{ card: string; portrait: string | null; ocrCard: string }> {
  const ocrSide = opts?.ocrSide ?? 1100;
  const c = await drawFile(file, Math.max(ocrSide, 1100));
  const ocrCard = (opts?.clarify ? canvasForRead(c, ocrSide) : c).toDataURL("image/jpeg", opts?.clarify ? 0.9 : 0.72);
  const small = sizedCanvas(c.width, c.height, FIELD_SIDE);
  small.getContext("2d", { alpha: false })!.drawImage(c, 0, 0, small.width, small.height);
  return {
    card: small.toDataURL("image/jpeg", FIELD_JPEG),
    portrait: portraitFromCanvas(c),
    ocrCard,
  };
}

/** High-contrast image of a zoomed ID crop, for reading the employer on the back. */
export async function imageForRead(file: File): Promise<string> {
  const c = await drawFile(file, 1800);
  return canvasForRead(c, 1600).toDataURL("image/jpeg", 0.9);
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

/** Enlarged crops of the name, ID number and date lines on a full Emirates ID. */
function numberRegions(dataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.width / Math.max(1, img.height);
      const card = aspect > 1.35 && aspect < 2.15;
      const regions = card
        ? [
            { x: 0.26, y: 0.14, w: 0.72, h: 0.16 },
            { x: 0.26, y: 0.3, w: 0.72, h: 0.16 },
            { x: 0.26, y: 0.44, w: 0.72, h: 0.2 },
            { x: 0.02, y: 0.62, w: 0.96, h: 0.34 },
          ]
        : [{ x: 0.02, y: 0.06, w: 0.96, h: 0.88 }];
      resolve(
        regions.map((r) => {
          const sx = img.width * r.x;
          const sy = img.height * r.y;
          const sw = img.width * r.w;
          const sh = img.height * r.h;
          const c = document.createElement("canvas");
          const scale = Math.min(3, Math.max(1, 1100 / Math.max(sw, 1)));
          c.width = Math.max(360, Math.round(sw * scale));
          c.height = Math.max(80, Math.round(sh * scale));
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = scale <= 1.2;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          grayStretch(c);
          return c.toDataURL("image/png");
        }),
      );
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

interface TessWorker {
  recognize(image: string): Promise<{ data?: { text?: string } }>;
  setParameters?(params: Record<string, string>): Promise<void>;
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

async function readText(image: string, mode: "block" | "line" = "block"): Promise<string> {
  try {
    const t = await loadTesseract();
    if (t.createWorker) {
      if (!worker) worker = await t.createWorker("eng");
      if (worker.setParameters) {
        await worker.setParameters({ tessedit_pageseg_mode: mode === "line" ? "7" : "6" });
      }
      const r = await worker.recognize(image);
      return (r && r.data && r.data.text) || "";
    }
    const r = t.recognize ? await t.recognize(image, "eng") : null;
    return (r && r.data && r.data.text) || "";
  } catch {
    return "";
  }
}

/** Read only the area the lens is on. No second crop, so another line cannot replace the name. */
export async function ocrSelection(image: string): Promise<string> {
  const block = await readText(image, "block");
  const line = await readText(image, "line");
  return [block, line].filter(Boolean).join("\n");
}

/** Read the zoomed card and the name / ID lines, and return OCR text for auto-fill. */
export async function ocrEmiratesCard(images: string[]): Promise<string> {
  const out: string[] = [];
  for (const img of images) {
    out.push(await readText(img, "block"));
    const crops = await numberRegions(img);
    for (let i = 0; i < crops.length; i++) out.push(await readText(crops[i], i < 2 ? "line" : "block"));
  }
  return out.filter(Boolean).join("\n");
}

export async function ocrEmiratesCardFast(image: string): Promise<string> {
  return ocrEmiratesCard([image]);
}

function realNameWord(word: string): boolean {
  const s = word.replace(/[^A-Za-z]/g, "");
  if (s.length < 3) return false;
  if (!/[AEIOUaeiou]/.test(s)) return false;
  if ((s.match(/y/gi) || []).length >= 2) return false;
  if (/(.)\1\1/i.test(s)) return false;
  if (/^(.)\1/i.test(s)) return false;
  if (/^(..)\1$/i.test(s)) return false;
  if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(s)) return false;
  if (/^(?:name|date|birth|sex|card|number|nationality|signature|expiry|resident|identity|issuing|male|female|india)$/i.test(s)) return false;
  return true;
}

function tidyName(raw: string): string {
  const words = String(raw || "")
    .replace(/[^A-Za-z' ]/g, " ")
    .split(/\s+/)
    .filter(realNameWord);
  return words.length >= 2 ? words.join(" ") : "";
}

function titleName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Words printed after "Name" on the card, stopping at the next label. A noisy line is skipped. */
function nameAfterLabel(text: string): string {
  const stop = /\b(?:ID\s*Number|Date\s*of\s*Birth|Nationality|Sex|Signature|Card\s*Number|Expiry|Issuing)\b/i;
  const lines = String(text || "").split(/\n/);
  let best: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\bName\b/i.test(lines[i])) continue;
    const same = lines[i].replace(/^.*?\bName\b\s*[:\-]?\s*/i, "");
    const blob = [same, lines[i + 1] || ""].join(" ").split(stop)[0];
    const tokens = blob
      .replace(/[^A-Za-z' ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 2);
    const words = tokens.filter(realNameWord);
    if (!tokens.length || words.length / tokens.length < 0.75) continue;
    if (words.length > best.length) best = words;
  }
  return best.length >= 2 ? best.join(" ") : "";
}

/** Name and Emirates ID number from one card's OCR text. The name is the words after "Name". */
export function fieldsFromCardText(text: string): { name: string; id: string } {
  const id = formatEidLocal(text);
  const labeledName = nameAfterLabel(text);
  const mrz = text.toUpperCase().match(/([A-Z][A-Z<]{2,})<<([A-Z][A-Z<]{2,})/);
  let mrzName = "";
  if (mrz) {
    const surname = mrz[1].replace(/</g, " ");
    const given = mrz[2].replace(/</g, " ");
    mrzName = tidyName(titleName(given + " " + surname));
  }
  return { name: labeledName || mrzName, id };
}

/** Nationality printed after that label. */
export function nationalityFromCardText(text: string): string {
  const m = String(text || "").match(/Nationality\s*[:\-]?\s*([A-Za-z]{3,20})/i);
  return m ? m[1] : "";
}

function cleanEmployer(line: string): string {
  return line
    .replace(/\b(?:Issuing|Occupation|Signature|Place)\b[\s\S]*$/i, "")
    .replace(/[^A-Za-z0-9 .,&'()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCompany(line: string): boolean {
  if (/\b(?:L\s*\.?\s*L\s*\.?\s*C\s*\.?|LLC|Ltd\.?|Limited)\b/i.test(line)) return true;
  const words = line.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w));
  return words.length >= 3 && /\bServices\b/i.test(line);
}

/** Employer printed on the back of the Emirates ID. A clipped "Employer" label still counts. */
export function employerFromCardText(text: string): string {
  const raw = String(text || "");
  const labeled = raw.match(/(?:Employer|Employe\w{0,6}|oyer)\s*[:\-]\s*([^\n\r]+)/i);
  const fromLabel = labeled ? cleanEmployer(labeled[1]) : "";
  if (fromLabel.length >= 3) return fromLabel;
  let best = "";
  for (const line of raw.split(/\n/)) {
    if (!looksLikeCompany(line)) continue;
    const cleaned = cleanEmployer(line.replace(/^.*?(?:Employer|oyer)\s*[:\-]?\s*/i, ""));
    if (cleaned.length > best.length) best = cleaned;
  }
  return best;
}

/** Date of birth printed after that label, as yyyy-mm-dd. Other dates on the card are ignored. */
export function dateFromCardText(text: string): string {
  const m = String(text || "").match(/Date\s*of\s*Birth\s*[:\-]?\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})/i);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1940 || year > 2020) return "";
  return m[3] + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

/** Spread the darks and lights so a soft card photo is easier to read. */
export function enhanceCard(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2, Math.max(1, 1800 / Math.max(img.width, img.height, 1)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.imageSmoothingEnabled = scale <= 1.2;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = frame.data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = Math.max(24, max - min);
      for (let i = 0; i < px.length; i += 4) {
        const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const n = Math.max(0, Math.min(255, ((v - min) * 255) / span));
        px[i] = px[i + 1] = px[i + 2] = n;
      }
      ctx.putImageData(frame, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Name line and ID-number line of one Emirates ID, enlarged and not contrast-crushed. */
export function cardLineImages(dataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.width / Math.max(1, img.height);
      if (aspect < 1.35 || aspect > 2.2) {
        resolve([]);
        return;
      }
      const bands = [
        { x: 0.28, y: 0.2, w: 0.7, h: 0.14 },
        { x: 0.28, y: 0.28, w: 0.7, h: 0.14 },
        { x: 0.28, y: 0.36, w: 0.7, h: 0.14 },
        { x: 0.22, y: 0.08, w: 0.76, h: 0.16 },
      ];
      resolve(
        bands.map((band) => {
          const sw = img.width * band.w;
          const sh = img.height * band.h;
          const scale = Math.min(3, Math.max(1, 160 / Math.max(sh, 1)));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(sw * scale));
          c.height = Math.max(1, Math.round(sh * scale));
          const ctx = c.getContext("2d");
          if (!ctx) return "";
          ctx.imageSmoothingEnabled = scale <= 1.15;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, img.width * band.x, img.height * band.y, sw, sh, 0, 0, c.width, c.height);
          return c.toDataURL("image/png");
        }).filter(Boolean),
      );
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

/** Find a 784-XXXX-XXXXXXX-X Emirates ID number in noisy OCR text. */
function acceptEid(digits: string): string {
  if (!/^784\d{12}$/.test(digits)) return "";
  const year = Number(digits.slice(3, 7));
  if (year < 1940 || year > 2015) return "";
  return digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7, 14) + "-" + digits.slice(14);
}

export function formatEidLocal(text: string): string {
  const raw = String(text || "");
  const direct = raw.match(/784[\s\-–—.]{0,3}\d{4}[\s\-–—.]{0,3}\d{7}[\s\-–—.]{0,3}\d/);
  const fromDirect = acceptEid((direct ? direct[0] : "").replace(/\D/g, ""));
  if (fromDirect) return fromDirect;
  const soft = raw.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  const loose = soft.match(/784[\s\-–—.]{0,3}\d{4}[\s\-–—.]{0,3}\d{7}[\s\-–—.]{0,3}\d/);
  return acceptEid((loose ? loose[0] : "").replace(/\D/g, ""));
}
