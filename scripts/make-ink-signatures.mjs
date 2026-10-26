import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");
const SCALE = 5;

function inkScore(r, g, b) {
  const bright = (r + g + b) / 3;
  const blueBias = b - (r + g) / 2;
  // Prefer real blue/purple pen; ignore grey paper texture / shadows.
  if (bright > 210 && blueBias < 8) return 0;
  return (255 - bright) * 0.85 + Math.max(0, blueBias) * 2.2;
}

function sampleScore(score, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    return score[yi * w + xi];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = y0 * w + x0;
  const a = score[i00] * (1 - fx) + score[i00 + 1] * fx;
  const b = score[i00 + w] * (1 - fx) + score[i00 + w + 1] * fx;
  return a * (1 - fy) + b * fy;
}

function toInkPng(jpgPath, pngPath) {
  const raw = jpeg.decode(readFileSync(jpgPath), { useTArray: true, formatAsRGBA: true });
  const { width: w, height: h, data } = raw;
  const score = new Float32Array(w * h);
  const order = [];
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    score[i] = inkScore(data[o], data[o + 1], data[o + 2]);
    if (score[i] > 0) order.push(i);
  }
  order.sort((a, b) => score[b] - score[a]);
  if (order.length < 80) throw new Error(`no ink in ${jpgPath}`);

  const topN = Math.min(order.length, Math.max(300, Math.floor(w * h * 0.008)));
  let cutSum = 0;
  for (let i = 0; i < topN; i++) cutSum += score[order[i]];
  const cut = cutSum / topN;
  const soft = cut * 0.38;
  const boxCut = cut * 0.55; // only strong ink for the crop box

  // Seed from the strongest ink; grow a tight box around nearby strong pixels.
  const seed = order[0];
  const seedX = seed % w;
  const seedY = Math.floor(seed / w);
  let inkMinX = seedX;
  let inkMinY = seedY;
  let inkMaxX = seedX;
  let inkMaxY = seedY;
  let found = 0;
  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    if (score[idx] < boxCut) break;
    const x = idx % w;
    const y = Math.floor(idx / w);
    // Ignore isolated far noise (more than ~45% of the image away from the seed cluster).
    if (Math.abs(x - seedX) > w * 0.45 || Math.abs(y - seedY) > h * 0.35) continue;
    found += 1;
    if (x < inkMinX) inkMinX = x;
    if (y < inkMinY) inkMinY = y;
    if (x > inkMaxX) inkMaxX = x;
    if (y > inkMaxY) inkMaxY = y;
  }
  if (!found) throw new Error(`no ink cluster in ${jpgPath}`);

  const padX = Math.max(10, Math.round((inkMaxX - inkMinX) * 0.08));
  const padY = Math.max(8, Math.round((inkMaxY - inkMinY) * 0.1));
  const minX = Math.max(0, inkMinX - padX);
  const minY = Math.max(0, inkMinY - padY);
  const maxX = Math.min(w - 1, inkMaxX + padX);
  const maxY = Math.min(h - 1, inkMaxY + padY);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const ow = cw * SCALE;
  const oh = ch * SCALE;
  const out = new PNG({ width: ow, height: oh });
  const span = Math.max(1, cut - soft);

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const v = sampleScore(score, w, h, minX + x / SCALE, minY + y / SCALE);
      let a = 0;
      if (v >= cut) a = 255;
      else if (v > soft) a = Math.round(255 * ((v - soft) / span));
      const d = (y * ow + x) * 4;
      if (a < 8) {
        out.data[d + 3] = 0;
        continue;
      }
      out.data[d] = 18;
      out.data[d + 1] = 48;
      out.data[d + 2] = 140;
      out.data[d + 3] = a;
    }
  }
  writeFileSync(pngPath, PNG.sync.write(out));
  console.log(`${pngPath} ${ow}x${oh} crop=${cw}x${ch} (@${minX},${minY})`);
}

for (const n of [1, 2, 3]) {
  toInkPng(join(ui, `certificate-signature-${n}.jpg`), join(ui, `certificate-signature-${n}.png`));
}
