/**
 * High-precision Color Math & Space Transformations
 * sRGB <-> Linear sRGB <-> CIE XYZ (D65) <-> CIELAB / HCT
 */

import type { HctColor, RgbColor } from './types';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (isNaN(num)) return { r: 203, g: 185, b: 245 };
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) / 6;
    } else if (max === gNorm) {
      h = ((bNorm - rNorm) / delta + 2) / 6;
    } else {
      h = ((rNorm - gNorm) / delta + 4) / 6;
    }
  }

  return [h * 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RgbColor {
  const hNorm = ((h % 360) + 360) % 360 / 360;
  const sClamped = clamp(s, 0, 1);
  const lClamped = clamp(l, 0, 1);

  if (sClamped === 0) {
    const val = Math.round(lClamped * 255);
    return { r: val, g: val, b: val };
  }

  const q = lClamped < 0.5 ? lClamped * (1 + sClamped) : lClamped + sClamped - lClamped * sClamped;
  const p = 2 * lClamped - q;

  const hue2rgb = (t: number) => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  return {
    r: Math.round(hue2rgb(hNorm + 1 / 3) * 255),
    g: Math.round(hue2rgb(hNorm) * 255),
    b: Math.round(hue2rgb(hNorm - 1 / 3) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const v = max;
  let h = 0;
  const s = max === 0 ? 0 : delta / max;

  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) * 60;
    } else if (max === gNorm) {
      h = ((bNorm - rNorm) / delta + 2) * 60;
    } else {
      h = ((rNorm - gNorm) / delta + 4) * 60;
    }
  }

  return [((h % 360) + 360) % 360, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const hNorm = ((h % 360) + 360) % 360;
  const sClamped = clamp(s, 0, 1);
  const vClamped = clamp(v, 0, 1);

  const c = vClamped * sClamped;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = vClamped - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hNorm < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hNorm < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hNorm < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hNorm < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hNorm < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

// ===== Material You HCT (Hue, Chroma, Tone) Color Space =====

function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const clamped = clamp(c, 0, 1);
  return clamped <= 0.0031308
    ? Math.round(clamped * 12.92 * 255)
    : Math.round((1.055 * Math.pow(clamped, 1 / 2.4) - 0.055) * 255);
}

// Reference white D65
const XN = 95.047;
const YN = 100.0;
const ZN = 108.883;

export function rgbToHct(r: number, g: number, b: number): HctColor {
  const rL = srgbToLinear(r);
  const gL = srgbToLinear(g);
  const bL = srgbToLinear(b);

  const x = (0.41233895 * rL + 0.35762064 * gL + 0.18051042 * bL) * 100;
  const y = (0.21260000 * rL + 0.71520000 * gL + 0.07220000 * bL) * 100;
  const z = (0.01932141 * rL + 0.11916382 * gL + 0.95034478 * bL) * 100;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / XN);
  const fy = f(y / YN);
  const fz = f(z / ZN);

  const tone = 116 * fy - 16;
  const aStar = 500 * (fx - fy);
  const bStar = 200 * (fy - fz);
  const chroma = Math.sqrt(aStar * aStar + bStar * bStar);
  let hue = (Math.atan2(bStar, aStar) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return { hue, chroma, tone: clamp(tone, 0, 100) };
}

export function hctToRgb(hue: number, chroma: number, tone: number): RgbColor {
  const toneClamped = clamp(tone, 0, 100);
  if (toneClamped <= 0.05) return { r: 0, g: 0, b: 0 };
  if (toneClamped >= 99.95) return { r: 255, g: 255, b: 255 };

  const rad = (hue * Math.PI) / 180;
  const fInv = (t: number) => (t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787);

  const tryChroma = (c: number): RgbColor | null => {
    const a = c * Math.cos(rad);
    const b = c * Math.sin(rad);
    const fy = (toneClamped + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;

    const x = (fInv(fx) * XN) / 100;
    const y = (fInv(fy) * YN) / 100;
    const z = (fInv(fz) * ZN) / 100;

    const rL = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    const gL = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    const bL = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

    if (rL >= -0.001 && rL <= 1.001 && gL >= -0.001 && gL <= 1.001 && bL >= -0.001 && bL <= 1.001) {
      return {
        r: linearToSrgb(rL),
        g: linearToSrgb(gL),
        b: linearToSrgb(bL),
      };
    }
    return null;
  };

  const direct = tryChroma(chroma);
  if (direct) return direct;

  // Gamut mapping binary search for max achievable chroma
  let low = 0;
  let high = chroma;
  let bestRgb: RgbColor = { r: 128, g: 128, b: 128 };

  for (let iter = 0; iter < 12; iter++) {
    const mid = (low + high) / 2;
    const candidate = tryChroma(mid);
    if (candidate) {
      bestRgb = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }

  return bestRgb;
}

export function hctToHex(hue: number, chroma: number, tone: number): string {
  const rgb = hctToRgb(hue, chroma, tone);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// Relative luminance for WCAG contrast
export function relativeLuminance(r: number, g: number, b: number): number {
  const rL = srgbToLinear(r);
  const gL = srgbToLinear(g);
  const bL = srgbToLinear(b);
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

export function contrastRatio(rgb1: RgbColor, rgb2: RgbColor): number {
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
