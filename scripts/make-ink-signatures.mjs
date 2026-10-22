import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");
const SCALE = 3; // sharp pixels for Word / print

function toInkPng(jpgPath, pngPath) {
  const raw = jpeg.decode(readFileSync(jpgPath), { useTArray: true, formatAsRGBA: true });
  const { width: w, height: h, data } = raw;
  const bright = new Float32Array(w * h);
  const order = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // Blue pen is darker on the blue channel too.
    bright[i] = data[o] * 0.28 + data[o + 1] * 0.28 + data[o + 2] * 0.44;
    order[i] = i;
  }
  order.sort((a, b) => bright[a] - bright[b]);
  const inkCount = Math.max(160, Math.floor(w * h * 0.018));
  const seeds = order.slice(0, inkCount);
  const marginX = Math.floor(w * 0.07);
  const usable = seeds.filter((i) => {
    const x = i % w;
    return x > marginX && x < w - marginX;
  });
  const use = usable.length > 50 ? usable : seeds;
  let sumX = 0;
  let sumY = 0;
  for (const i of use) {
    sumX += i % w;
    sumY += Math.floor(i / w);
  }
  const cx = sumX / use.length;
  const cy = sumY / use.length;
  const winW = Math.min(w - 2 * marginX, Math.max(260, Math.round(w * 0.5)));
  const winH = Math.min(h, Math.max(80, Math.round(winW * 0.42)));
  let minX = Math.round(cx - winW / 2);
  let minY = Math.round(cy - winH / 2);
  minX = Math.max(marginX, Math.min(w - winW - marginX, minX));
  minY = Math.max(0, Math.min(h - winH, minY));
  let maxX = Math.min(w - 1, minX + winW - 1);
  let maxY = Math.min(h - 1, minY + winH - 1);

  const cut = bright[order[Math.floor(w * h * 0.07)]];
  const soft = bright[order[Math.floor(w * h * 0.11)]];
  let inkMinX = maxX;
  let inkMinY = maxY;
  let inkMaxX = minX;
  let inkMaxY = minY;
  const mask = Buffer.alloc(w * h);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      const v = bright[i];
      if (v > soft) continue;
      // Hard ink for a clean edge (no speckled blur).
      mask[i] = v <= cut + (soft - cut) * 0.55 ? 1 : 0;
      if (!mask[i]) continue;
      if (x < inkMinX) inkMinX = x;
      if (y < inkMinY) inkMinY = y;
      if (x > inkMaxX) inkMaxX = x;
      if (y > inkMaxY) inkMaxY = y;
    }
  }
  if (inkMaxX <= inkMinX) throw new Error(`no ink in ${jpgPath}`);
  // Drop thin edge dirt with a simple neighbour check.
  const clean = Buffer.alloc(w * h);
  for (let y = inkMinY; y <= inkMaxY; y++) {
    for (let x = inkMinX; x <= inkMaxX; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          n += mask[yy * w + xx];
        }
      }
      clean[i] = n >= 3 ? 1 : 0;
    }
  }
  inkMinX = maxX;
  inkMinY = maxY;
  inkMaxX = minX;
  inkMaxY = minY;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!clean[y * w + x]) continue;
      if (x < inkMinX) inkMinX = x;
      if (y < inkMinY) inkMinY = y;
      if (x > inkMaxX) inkMaxX = x;
      if (y > inkMaxY) inkMaxY = y;
    }
  }
  minX = Math.max(0, inkMinX - 4);
  minY = Math.max(0, inkMinY - 3);
  maxX = Math.min(w - 1, inkMaxX + 4);
  maxY = Math.min(h - 1, inkMaxY + 3);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const srcInk = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = minX + x;
      const sy = minY + y;
      const dst = (y * cw + x) * 4;
      if (!clean[sy * w + sx]) {
        srcInk.data[dst + 3] = 0;
        continue;
      }
      srcInk.data[dst] = 12;
      srcInk.data[dst + 1] = 40;
      srcInk.data[dst + 2] = 125;
      srcInk.data[dst + 3] = 255;
    }
  }
  // Nearest-neighbour upscale keeps pen edges sharp in Word.
  const ow = cw * SCALE;
  const oh = ch * SCALE;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.floor(x / SCALE);
      const sy = Math.floor(y / SCALE);
      const s = (sy * cw + sx) * 4;
      const d = (y * ow + x) * 4;
      out.data[d] = srcInk.data[s];
      out.data[d + 1] = srcInk.data[s + 1];
      out.data[d + 2] = srcInk.data[s + 2];
      out.data[d + 3] = srcInk.data[s + 3];
    }
  }
  writeFileSync(pngPath, PNG.sync.write(out));
  console.log(`${pngPath} ${ow}x${oh} (from ${cw}x${ch})`);
}

for (const n of [1, 2, 3]) {
  toInkPng(join(ui, `certificate-signature-${n}.jpg`), join(ui, `certificate-signature-${n}.png`));
}
