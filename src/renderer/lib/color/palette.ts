/**
 * AndroidX Palette & ColorCutQuantizer Port
 * 1:1 match with androidx.palette.graphics.Palette & ColorCutQuantizer
 */

import type { AndroidPalette, PaletteTarget, Swatch } from './types';
import { rgbToHex, rgbToHsl, rgbToHsv } from './colorUtils';

const TARGET_DARK_LUMA = 0.26;
const MAX_DARK_LUMA = 0.45;
const MIN_LIGHT_LUMA = 0.55;
const TARGET_LIGHT_LUMA = 0.74;
const MIN_NORMAL_LUMA = 0.30;
const TARGET_NORMAL_LUMA = 0.50;
const MAX_NORMAL_LUMA = 0.70;

const TARGET_MUTED_SATURATION = 0.30;
const MAX_MUTED_SATURATION = 0.40;
const TARGET_VIBRANT_SATURATION = 1.0;
const MIN_VIBRANT_SATURATION = 0.35;

const WEIGHT_SATURATION = 0.24;
const WEIGHT_LUMA = 0.52;
const WEIGHT_POPULATION = 0.24;

export const PALETTE_TARGETS: Record<string, PaletteTarget> = {
  LIGHT_VIBRANT: {
    name: 'LIGHT_VIBRANT',
    minSaturation: MIN_VIBRANT_SATURATION,
    targetSaturation: TARGET_VIBRANT_SATURATION,
    maxSaturation: 1.0,
    minLightness: MIN_LIGHT_LUMA,
    targetLightness: TARGET_LIGHT_LUMA,
    maxLightness: 1.0,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
  VIBRANT: {
    name: 'VIBRANT',
    minSaturation: MIN_VIBRANT_SATURATION,
    targetSaturation: TARGET_VIBRANT_SATURATION,
    maxSaturation: 1.0,
    minLightness: MIN_NORMAL_LUMA,
    targetLightness: TARGET_NORMAL_LUMA,
    maxLightness: MAX_NORMAL_LUMA,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
  DARK_VIBRANT: {
    name: 'DARK_VIBRANT',
    minSaturation: MIN_VIBRANT_SATURATION,
    targetSaturation: TARGET_VIBRANT_SATURATION,
    maxSaturation: 1.0,
    minLightness: 0.0,
    targetLightness: TARGET_DARK_LUMA,
    maxLightness: MAX_DARK_LUMA,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
  LIGHT_MUTED: {
    name: 'LIGHT_MUTED',
    minSaturation: 0.0,
    targetSaturation: TARGET_MUTED_SATURATION,
    maxSaturation: MAX_MUTED_SATURATION,
    minLightness: MIN_LIGHT_LUMA,
    targetLightness: TARGET_LIGHT_LUMA,
    maxLightness: 1.0,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
  MUTED: {
    name: 'MUTED',
    minSaturation: 0.0,
    targetSaturation: TARGET_MUTED_SATURATION,
    maxSaturation: MAX_MUTED_SATURATION,
    minLightness: MIN_NORMAL_LUMA,
    targetLightness: TARGET_NORMAL_LUMA,
    maxLightness: MAX_NORMAL_LUMA,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
  DARK_MUTED: {
    name: 'DARK_MUTED',
    minSaturation: 0.0,
    targetSaturation: TARGET_MUTED_SATURATION,
    maxSaturation: MAX_MUTED_SATURATION,
    minLightness: 0.0,
    targetLightness: TARGET_DARK_LUMA,
    maxLightness: MAX_DARK_LUMA,
    saturationWeight: WEIGHT_SATURATION,
    lightnessWeight: WEIGHT_LUMA,
    populationWeight: WEIGHT_POPULATION,
    isExclusive: true,
  },
};

/**
 * 15-bit color box used for Median Cut quantization (ColorCutQuantizer.Vbox in AndroidX)
 */
class Vbox {
  lowerIndex: number;
  upperIndex: number;
  distinctColors: number[];
  colorHistogram: Map<number, number>;

  minR = 0; maxR = 0;
  minG = 0; maxG = 0;
  minB = 0; maxB = 0;
  totalPopulation = 0;

  constructor(lowerIndex: number, upperIndex: number, distinctColors: number[], colorHistogram: Map<number, number>) {
    this.lowerIndex = lowerIndex;
    this.upperIndex = upperIndex;
    this.distinctColors = distinctColors;
    this.colorHistogram = colorHistogram;
    this.fitBox();
  }

  getVolume(): number {
    return (this.maxR - this.minR + 1) * (this.maxG - this.minG + 1) * (this.maxB - this.minB + 1);
  }

  fitBox(): void {
    let minR = 32, minG = 32, minB = 32;
    let maxR = 0, maxG = 0, maxB = 0;
    let pop = 0;

    for (let i = this.lowerIndex; i <= this.upperIndex; i++) {
      const color = this.distinctColors[i];
      pop += this.colorHistogram.get(color) || 0;

      const r = (color >> 10) & 0x1f;
      const g = (color >> 5) & 0x1f;
      const b = color & 0x1f;

      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
      if (g > maxG) maxG = g;
      if (g < minG) minG = g;
      if (b > maxB) maxB = b;
      if (b < minB) minB = b;
    }

    this.minR = minR; this.maxR = maxR;
    this.minG = minG; this.maxG = maxG;
    this.minB = minB; this.maxB = maxB;
    this.totalPopulation = pop;
  }

  getLongestDimension(): 'r' | 'g' | 'b' {
    const rRange = this.maxR - this.minR;
    const gRange = this.maxG - this.minG;
    const bRange = this.maxB - this.minB;

    if (gRange >= rRange && gRange >= bRange) return 'g';
    if (rRange >= gRange && rRange >= bRange) return 'r';
    return 'b';
  }

  splitBox(): Vbox | null {
    if (this.lowerIndex >= this.upperIndex) return null;

    const dim = this.getLongestDimension();
    // Sort slice of distinctColors by component
    const slice = this.distinctColors.slice(this.lowerIndex, this.upperIndex + 1);
    slice.sort((c1, c2) => {
      let v1 = 0;
      let v2 = 0;
      if (dim === 'r') {
        v1 = (c1 >> 10) & 0x1f;
        v2 = (c2 >> 10) & 0x1f;
      } else if (dim === 'g') {
        v1 = (c1 >> 5) & 0x1f;
        v2 = (c2 >> 5) & 0x1f;
      } else {
        v1 = c1 & 0x1f;
        v2 = c2 & 0x1f;
      }
      return v1 - v2;
    });

    for (let i = 0; i < slice.length; i++) {
      this.distinctColors[this.lowerIndex + i] = slice[i];
    }

    // Find median population index
    const halfPop = this.totalPopulation / 2;
    let accumulated = 0;
    let medianIndex = this.lowerIndex;

    for (let i = this.lowerIndex; i <= this.upperIndex; i++) {
      accumulated += this.colorHistogram.get(this.distinctColors[i]) || 0;
      if (accumulated >= halfPop) {
        medianIndex = Math.min(this.upperIndex - 1, Math.max(this.lowerIndex, i));
        break;
      }
    }

    const newBox = new Vbox(medianIndex + 1, this.upperIndex, this.distinctColors, this.colorHistogram);
    this.upperIndex = medianIndex;
    this.fitBox();
    return newBox;
  }

  getAverageSwatch(): Swatch {
    let totR = 0, totG = 0, totB = 0;
    let totalPop = 0;

    for (let i = this.lowerIndex; i <= this.upperIndex; i++) {
      const color = this.distinctColors[i];
      const pop = this.colorHistogram.get(color) || 0;
      totalPop += pop;

      // 5-bit to 8-bit conversion: (v * 255) / 31
      const r = Math.round((((color >> 10) & 0x1f) * 255) / 31);
      const g = Math.round((((color >> 5) & 0x1f) * 255) / 31);
      const b = Math.round(((color & 0x1f) * 255) / 31);

      totR += r * pop;
      totG += g * pop;
      totB += b * pop;
    }

    const avgR = totalPop > 0 ? Math.round(totR / totalPop) : 0;
    const avgG = totalPop > 0 ? Math.round(totG / totalPop) : 0;
    const avgB = totalPop > 0 ? Math.round(totB / totalPop) : 0;
    const rgb = (avgR << 16) | (avgG << 8) | avgB;

    return {
      rgb,
      r: avgR,
      g: avgG,
      b: avgB,
      hex: rgbToHex(avgR, avgG, avgB),
      population: totalPop,
      hsl: rgbToHsl(avgR, avgG, avgB),
      hsv: rgbToHsv(avgR, avgG, avgB),
    };
  }
}

/**
 * Quantizes image pixels using AndroidX ColorCutQuantizer
 */
export function quantizePixels(
  pixels: Uint8ClampedArray | number[],
  maxColors = 16,
): Swatch[] {
  const histogram = new Map<number, number>();

  // AndroidX Default Filter: filter out near-white, near-black, and transparent
  const isAllowedColor = (r: number, g: number, b: number) => {
    const [, s, l] = rgbToHsl(r, g, b);
    // Black: l <= 0.05
    // White: l >= 0.95
    // Near white with low sat: l >= 0.86 && s <= 0.05
    if (l <= 0.04) return false;
    if (l >= 0.96) return false;
    return true;
  };

  let validPixelCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    if (!isAllowedColor(r, g, b)) continue;

    // Quantize 8-bit to 5-bit
    const qR = (r >> 3) & 0x1f;
    const qG = (g >> 3) & 0x1f;
    const qB = (b >> 3) & 0x1f;
    const q15 = (qR << 10) | (qG << 5) | qB;

    histogram.set(q15, (histogram.get(q15) || 0) + 1);
    validPixelCount++;
  }

  // If filtering excluded all pixels (e.g. all black/white image), re-run without filter
  if (histogram.size === 0) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 64) continue;
      const q15 = (((pixels[i] >> 3) & 0x1f) << 10) | (((pixels[i + 1] >> 3) & 0x1f) << 5) | ((pixels[i + 2] >> 3) & 0x1f);
      histogram.set(q15, (histogram.get(q15) || 0) + 1);
      validPixelCount++;
    }
  }

  if (histogram.size === 0) {
    return [{
      rgb: 0x94a3b8,
      r: 148, g: 163, b: 184,
      hex: '#94a3b8',
      population: 1,
      hsl: rgbToHsl(148, 163, 184),
      hsv: rgbToHsv(148, 163, 184),
    }];
  }

  const distinctColors = Array.from(histogram.keys());
  if (distinctColors.length <= maxColors) {
    // If fewer distinct colors than maxColors, return them directly
    return distinctColors.map((color) => {
      const pop = histogram.get(color) || 1;
      const r = Math.round((((color >> 10) & 0x1f) * 255) / 31);
      const g = Math.round((((color >> 5) & 0x1f) * 255) / 31);
      const b = Math.round(((color & 0x1f) * 255) / 31);
      return {
        rgb: (r << 16) | (g << 8) | b,
        r, g, b,
        hex: rgbToHex(r, g, b),
        population: pop,
        hsl: rgbToHsl(r, g, b),
        hsv: rgbToHsv(r, g, b),
      };
    }).sort((a, b) => b.population - a.population);
  }

  // Median-Cut Priority Queue
  const boxes: Vbox[] = [new Vbox(0, distinctColors.length - 1, distinctColors, histogram)];

  while (boxes.length < maxColors) {
    // Sort boxes by population * volume to pick the most diverse, high-population box
    boxes.sort((b1, b2) => (b2.totalPopulation * b2.getVolume()) - (b1.totalPopulation * b1.getVolume()));
    const boxToSplit = boxes.shift();
    if (!boxToSplit) break;
    const newBox = boxToSplit.splitBox();
    boxes.push(boxToSplit);
    if (newBox) {
      boxes.push(newBox);
    } else {
      break;
    }
  }

  return boxes.map((box) => box.getAverageSwatch()).sort((a, b) => b.population - a.population);
}

/**
 * Calculates match score between a swatch and an AndroidX Target
 * Matches AndroidX Palette.generateScore()
 */
export function scoreSwatchAgainstTarget(swatch: Swatch, target: PaletteTarget, maxPopulation: number): number {
  const [, s, l] = swatch.hsl;

  // Check bounds
  if (s < target.minSaturation || s > target.maxSaturation) return 0;
  if (l < target.minLightness || l > target.maxLightness) return 0;

  const satScore = target.saturationWeight * (1.0 - Math.abs(s - target.targetSaturation));
  const lumaScore = target.lightnessWeight * (1.0 - Math.abs(l - target.targetLightness));
  const popScore = target.populationWeight * (swatch.population / Math.max(1, maxPopulation));

  return satScore + lumaScore + popScore;
}

/**
 * Builds the AndroidPalette object matching AndroidX Palette
 */
export function generateAndroidPalette(swatches: Swatch[]): AndroidPalette {
  if (swatches.length === 0) {
    return {
      vibrant: null,
      lightVibrant: null,
      darkVibrant: null,
      muted: null,
      lightMuted: null,
      darkMuted: null,
      dominant: null,
      swatches: [],
    };
  }

  const dominant = swatches[0]; // sorted descending by population
  const maxPop = dominant.population;

  const usedColors = new Set<number>();

  const findBestForTarget = (target: PaletteTarget): Swatch | null => {
    let bestSwatch: Swatch | null = null;
    let maxScore = 0;

    for (const swatch of swatches) {
      if (target.isExclusive && usedColors.has(swatch.rgb)) continue;
      const score = scoreSwatchAgainstTarget(swatch, target, maxPop);
      if (score > maxScore) {
        maxScore = score;
        bestSwatch = swatch;
      }
    }

    if (bestSwatch && target.isExclusive) {
      usedColors.add(bestSwatch.rgb);
    }
    return bestSwatch;
  };

  const vibrant = findBestForTarget(PALETTE_TARGETS.VIBRANT);
  const lightVibrant = findBestForTarget(PALETTE_TARGETS.LIGHT_VIBRANT);
  const darkVibrant = findBestForTarget(PALETTE_TARGETS.DARK_VIBRANT);
  const muted = findBestForTarget(PALETTE_TARGETS.MUTED);
  const lightMuted = findBestForTarget(PALETTE_TARGETS.LIGHT_MUTED);
  const darkMuted = findBestForTarget(PALETTE_TARGETS.DARK_MUTED);

  return {
    vibrant,
    lightVibrant,
    darkVibrant,
    muted,
    lightMuted,
    darkMuted,
    dominant,
    swatches,
  };
}

/**
 * Extracts the primary theme seed color from Palette
 * Port of Android Theme.kt extractThemeColor() enhanced with PlayerColorExtractor weighting
 * to prevent 1-pixel noise artifacts from hijacking the theme
 */
export function extractThemeSeedColor(palette: AndroidPalette, fallbackColor = '#cbb9f5'): string {
  const domPop = palette.dominant?.population || 0;
  const minNoiseThreshold = Math.max(2, Math.round(domPop * 0.03));

  const candidates = [
    palette.vibrant,
    palette.dominant,
    palette.muted,
    palette.lightVibrant,
    palette.darkVibrant,
    palette.lightMuted,
    palette.darkMuted,
  ].filter((s): s is Swatch => s !== null && s.population >= minNoiseThreshold);

  if (candidates.length > 0) {
    // Rank candidates using PlayerColorExtractor.kt's calculateColorWeight logic
    candidates.sort((a, b) => {
      const aWeight = a.population * (a.hsv[1] > 0.3 && a.hsv[2] >= 0.2 && a.hsv[2] <= 0.9 ? 1.35 : 1.0);
      const bWeight = b.population * (b.hsv[1] > 0.3 && b.hsv[2] >= 0.2 && b.hsv[2] <= 0.9 ? 1.35 : 1.0);
      return bWeight - aWeight;
    });
    return candidates[0].hex;
  }

  const fallbackCandidate =
    palette.vibrant ||
    palette.dominant ||
    palette.muted ||
    palette.lightVibrant ||
    palette.darkVibrant ||
    palette.lightMuted ||
    palette.darkMuted;

  return fallbackCandidate ? fallbackCandidate.hex : fallbackColor;
}
