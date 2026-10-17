// Procedural surface textures for the realistic render: wood planks and tiles, drawn once on a canvas per
// color and cached. Textures cover TEXTURE_M × TEXTURE_M meters; set repeat = size / TEXTURE_M.
import * as THREE from "three";

export const TEXTURE_M = 2;
const PX = 1024;

const cache = new Map<string, THREE.CanvasTexture>();

/** Deterministic pseudo-random numbers (same planks on every render and in the exported video). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * f)));
  return `#${c.getHexString()}`;
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Staggered wood planks (18 cm × 1.2 m) with per-plank tone and fine grain. */
export function woodTexture(color: string): THREE.CanvasTexture {
  const key = `wood:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PX;
  const ctx = canvas.getContext("2d")!;
  const rand = rng(7);
  const pxPerM = PX / TEXTURE_M;
  const plankW = 0.18 * pxPerM;
  const plankL = 1.2 * pxPerM;
  const rows = Math.ceil(PX / plankW);
  for (let r = 0; r < rows; r++) {
    const y = r * plankW;
    let x = -rand() * plankL;
    while (x < PX) {
      ctx.fillStyle = shade(color, 0.88 + rand() * 0.24);
      ctx.fillRect(x, y, plankL, plankW);
      // grain: thin darker streaks along the plank
      ctx.globalAlpha = 0.08;
      for (let g = 0; g < 7; g++) {
        ctx.fillStyle = shade(color, 0.6 + rand() * 0.3);
        ctx.fillRect(x, y + rand() * plankW, plankL, 1 + rand() * 1.5);
      }
      ctx.globalAlpha = 1;
      // seam
      ctx.fillStyle = shade(color, 0.55);
      ctx.fillRect(x, y, 1.5, plankW);
      x += plankL;
    }
    ctx.fillStyle = shade(color, 0.6);
    ctx.fillRect(0, y, PX, 1.2);
  }
  const tex = finish(canvas);
  cache.set(key, tex);
  return tex;
}

/** 60 cm tiles with grout lines (bathrooms, kitchens). */
export function tileTexture(color: string): THREE.CanvasTexture {
  const key = `tile:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PX;
  const ctx = canvas.getContext("2d")!;
  const rand = rng(11);
  const step = (0.6 * PX) / TEXTURE_M;
  for (let y = 0; y < PX; y += step)
    for (let x = 0; x < PX; x += step) {
      ctx.fillStyle = shade(color, 0.96 + rand() * 0.08);
      ctx.fillRect(x, y, step, step);
    }
  ctx.strokeStyle = shade(color, 0.72);
  ctx.lineWidth = 3;
  for (let v = 0; v <= PX; v += step) {
    ctx.beginPath();
    ctx.moveTo(v, 0);
    ctx.lineTo(v, PX);
    ctx.moveTo(0, v);
    ctx.lineTo(PX, v);
    ctx.stroke();
  }
  const tex = finish(canvas);
  cache.set(key, tex);
  return tex;
}

/** Floor finish per room type: tiles in wet rooms, wood elsewhere. Tiles use a light stone tone. */
export function floorFinish(roomType: string, floorColor: string): { map: THREE.CanvasTexture; roughness: number } {
  if (roomType === "bathroom" || roomType === "kitchen") return { map: tileTexture("#D9D6D0"), roughness: 0.35 };
  return { map: woodTexture(floorColor), roughness: 0.62 };
}

/** A clone of `tex` repeated to cover `w × d` meters (clones share the image; only the transform differs). */
export function repeated(tex: THREE.Texture, w: number, d: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(w / TEXTURE_M, d / TEXTURE_M);
  t.needsUpdate = true;
  return t;
}
