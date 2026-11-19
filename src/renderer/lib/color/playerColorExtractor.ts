/**
 * Player Color Extraction & Backdrop Tone System
 * 1:1 port of ArchiveTune Android's:
 * - moe.rukamori.archivetune.ui.theme.PlayerColorExtractor
 * - moe.rukamori.archivetune.ui.theme.BackdropTonePalette
 * - moe.rukamori.archivetune.ui.theme.PlayerBackgroundColorUtils
 */

import type { AndroidPalette, BackdropTonePalette, Swatch } from './types';
import { clamp, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './colorUtils';

/**
 * Checks if two colors are too visually similar
 * Direct port of PlayerColorExtractor.isSimilarColor
 */
export function isSimilarColor(hex1: string, hex2: string): boolean {
  if (!hex1 || !hex2) return false;
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  const hsv1 = rgbToHsv(rgb1.r, rgb1.g, rgb1.b);
  const hsv2 = rgbToHsv(rgb2.r, rgb2.g, rgb2.b);

  const hueDiffRaw = Math.abs(hsv1[0] - hsv2[0]);
  const hueDiff = Math.min(hueDiffRaw, 360 - hueDiffRaw);
  const satDiff = Math.abs(hsv1[1] - hsv2[1]);
  const valDiff = Math.abs(hsv1[2] - hsv2[2]);

  if (hueDiff < 12 && satDiff < 0.12 && valDiff < 0.12) return true;

  const threshold = 28;
  return (
    Math.abs(rgb1.r - rgb2.r) < threshold &&
    Math.abs(rgb1.g - rgb2.g) < threshold &&
    Math.abs(rgb1.b - rgb2.b) < threshold
  );
}

export function isNearGray(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const [, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return s < 0.15 || v < 0.08;
}

function calculateColorWeight(swatch: Swatch | null): number {
  if (!swatch) return 0;
  const [, s, v] = swatch.hsv;
  const vibrancyBonus = s > 0.3 && v >= 0.2 && v <= 0.9 ? 1.3 : 1.0;
  return swatch.population * vibrancyBonus;
}

function enhanceColorVividness(hex: string, saturationFactor = 1.4): string {
  const rgb = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const newS = clamp(s * saturationFactor, 0, 1.0);
  const newV = clamp(v * 1.02, 0.32, 0.88);
  const enhanced = hsvToRgb(h, newS, newV);
  return rgbToHex(enhanced.r, enhanced.g, enhanced.b);
}

function hueShift(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const shiftedH = ((h + degrees) % 360 + 360) % 360;
  const out = hsvToRgb(shiftedH, s, v);
  return rgbToHex(out.r, out.g, out.b);
}

function tuneColorForMesh(
  hex: string,
  saturationMin: number,
  saturationBoost: number,
  valueTarget: number,
  valueMin: number,
  valueMax: number,
): string {
  const rgb = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const newS = clamp(Math.max(s, saturationMin) * saturationBoost, 0, 1.0);
  const newV = clamp(v * 0.85 + valueTarget * 0.15, valueMin, valueMax);
  const out = hsvToRgb(h, newS, newV);
  return rgbToHex(out.r, out.g, out.b);
}

/**
 * Extracts 6 harmonious, vivid gradient colors from album art palette
 * Direct port of PlayerColorExtractor.extractGradientColors
 */
export function extractGradientColors(palette: AndroidPalette, fallbackColor = '#cbb9f5'): string[] {
  const candidateSwatches = [
    palette.vibrant,
    palette.lightVibrant,
    palette.darkVibrant,
    palette.dominant,
    palette.muted,
    palette.darkMuted,
    palette.lightMuted,
  ].filter((s): s is Swatch => s !== null);

  // Distinct by rgb
  const uniqueSwatchesMap = new Map<number, Swatch>();
  for (const s of candidateSwatches) {
    if (!uniqueSwatchesMap.has(s.rgb)) uniqueSwatchesMap.set(s.rgb, s);
  }
  const allSwatches = Array.from(uniqueSwatchesMap.values());

  const rankedSwatches = allSwatches.slice().sort((a, b) => calculateColorWeight(b) - calculateColorWeight(a));
  const availableColors: string[] = [];

  const addIfUnique = (hex: string, satFactor: number) => {
    if (!availableColors.some((c) => isSimilarColor(hex, c))) {
      availableColors.push(enhanceColorVividness(hex, satFactor));
    }
  };

  for (const swatch of rankedSwatches) {
    const [, s] = swatch.hsv;
    const satFactor = s > 0.3 ? 1.25 : 1.05;
    addIfUnique(swatch.hex, satFactor);
    if (availableColors.length >= 6) break;
  }

  const totalPopulation = Math.max(1, allSwatches.reduce((sum, s) => sum + s.population, 0));
  const weightedSaturation =
    allSwatches.reduce((sum, s) => sum + s.hsv[1] * s.population, 0) / totalPopulation;

  const dominantColor = availableColors[0] || fallbackColor;
  const isGreyscaleImage = weightedSaturation < 0.22 || isNearGray(dominantColor);

  if (isGreyscaleImage) {
    availableColors.length = 0;
    const maxPopSwatch = allSwatches.slice().sort((a, b) => b.population - a.population)[0];
    const baseBrightness = maxPopSwatch ? maxPopSwatch.hsv[2] : 0.10;
    const greyStops = [
      clamp(baseBrightness * 1.2, 0.06, 0.40),
      clamp(baseBrightness * 0.9, 0.04, 0.28),
      clamp(baseBrightness * 0.6, 0.02, 0.16),
      clamp(baseBrightness * 1.4, 0.08, 0.44),
      clamp(baseBrightness * 0.7, 0.03, 0.20),
      clamp(baseBrightness * 0.5, 0.01, 0.12),
    ];
    while (availableColors.length < 6) {
      const v = greyStops[availableColors.length % greyStops.length];
      const rgb = hsvToRgb(0, 0, v);
      availableColors.push(rgbToHex(rgb.r, rgb.g, rgb.b));
    }
    return availableColors;
  }

  const fallbackSeed =
    (!isNearGray(fallbackColor) ? fallbackColor : null) ||
    (palette.dominant && !isNearGray(palette.dominant.hex) ? palette.dominant.hex : '#334155');

  const seed = availableColors[0] || fallbackSeed;
  const targets = [25, -25, 55, -55, 120, -120, 180, 150, -150];
  const valueTargets = [0.82, 0.74, 0.68, 0.60, 0.86, 0.70];

  const baseCandidates = Array.from(new Set([...availableColors, seed]));
  let baseIndex = 0;
  let targetIndex = 0;

  while (availableColors.length < 6) {
    const baseColor = baseCandidates[baseIndex % baseCandidates.length];
    const hueShiftDeg = targets[targetIndex % targets.length];
    const valueTarget = valueTargets[availableColors.length % valueTargets.length];

    const derived = tuneColorForMesh(
      hueShift(baseColor, hueShiftDeg),
      0.62,
      1.08,
      valueTarget,
      0.38,
      0.90,
    );

    if (!availableColors.some((c) => isSimilarColor(derived, c))) {
      availableColors.push(derived);
    }
    baseIndex++;
    targetIndex++;
    if (baseIndex > 40) break;
  }

  if (availableColors.length === 0) {
    availableColors.push(tuneColorForMesh(fallbackSeed, 0.62, 1.08, 0.75, 0.38, 0.90));
  }

  return availableColors;
}

/**
 * Direct port of BackdropTonePalette.kt
 */
function toBackdropTone(
  hex: string,
  valueMin: number,
  valueMax: number,
  saturationScale = 0.45,
  saturationCap = 0.30,
): string {
  const rgb = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const newS = Math.min(s * saturationScale, saturationCap);
  const newV = clamp(v, valueMin, valueMax);
  const out = hsvToRgb(h, newS, newV);
  return rgbToHex(out.r, out.g, out.b);
}

export function extractBackdropTonePalette(
  colors: string[],
  fallbackColor = '#cbb9f5',
  darkTheme = true,
): BackdropTonePalette {
  const dominantColor = colors[0] || fallbackColor;

  if (darkTheme) {
    const fallback = toBackdropTone(fallbackColor, 0.12, 0.38, 0.45, 0.30);
    const top = dominantColor ? toBackdropTone(dominantColor, 0.20, 0.72, 0.45, 0.30) : fallback;
    const mid = dominantColor ? toBackdropTone(dominantColor, 0.13, 0.48, 0.45, 0.30) : top;
    const bottom = dominantColor ? toBackdropTone(dominantColor, 0.08, 0.32, 0.45, 0.30) : mid;
    return { top, mid, bottom };
  } else {
    const fallback = toBackdropTone(fallbackColor, 0.72, 0.98, 0.45, 0.30);
    const top = dominantColor ? toBackdropTone(dominantColor, 0.88, 0.98, 0.45, 0.30) : fallback;
    const mid = dominantColor ? toBackdropTone(dominantColor, 0.82, 0.96, 0.45, 0.30) : top;
    const bottom = dominantColor ? toBackdropTone(dominantColor, 0.74, 0.92, 0.45, 0.30) : mid;
    return { top, mid, bottom };
  }
}
