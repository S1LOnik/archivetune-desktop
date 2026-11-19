/**
 * Artwork Image Color & Palette Extractor
 * Loads album artwork, scales to 128x128, and runs Android Palette + PlayerColorExtractor
 * With LRU caching matching Android's PlayerPaletteCache (48 entries)
 */

import type { AndroidPalette, ExtractedArtworkResult } from './types';
import { extractThemeSeedColor, generateAndroidPalette, quantizePixels } from './palette';
import { extractBackdropTonePalette, extractGradientColors, isNearGray } from './playerColorExtractor';

const MAX_CACHE_ENTRIES = 48;
const paletteCache = new Map<string, ExtractedArtworkResult>();

function getCachedResult(key: string): ExtractedArtworkResult | undefined {
  if (!paletteCache.has(key)) return undefined;
  // Refresh LRU order
  const val = paletteCache.get(key)!;
  paletteCache.delete(key);
  paletteCache.set(key, val);
  return val;
}

function setCachedResult(key: string, value: ExtractedArtworkResult): void {
  if (paletteCache.has(key)) {
    paletteCache.delete(key);
  } else if (paletteCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey) paletteCache.delete(oldestKey);
  }
  paletteCache.set(key, value);
}

/**
 * Extracts full palette and color scheme from raw image pixels
 */
export function extractFromPixelData(
  pixels: Uint8ClampedArray | number[],
  fallbackColor = '#cbb9f5',
): ExtractedArtworkResult {
  // 1. Quantize pixels to up to 32 swatches (matching Android PlayerColorExtractor Config.MAX_COLOR_COUNT = 32)
  const swatches = quantizePixels(pixels, 32);

  // 2. Build Android Palette (Vibrant, LightVibrant, DarkVibrant, Muted, LightMuted, DarkMuted, Dominant)
  const palette: AndroidPalette = generateAndroidPalette(swatches);

  // 3. Extract Theme Seed Color matching Android Theme.kt extractThemeColor()
  const seedHex = extractThemeSeedColor(palette, fallbackColor);

  // 4. Extract 6 vibrant gradient colors matching Android PlayerColorExtractor.kt
  const gradientColors = extractGradientColors(palette, seedHex);

  // 5. Extract backdrop tones matching Android BackdropTonePalette.kt
  const backdrop = extractBackdropTonePalette(gradientColors, seedHex, true);

  const isMonochrome =
    swatches.length <= 1 ||
    (palette.dominant ? palette.dominant.hsv[1] < 0.15 : isNearGray(seedHex));

  return {
    seedHex,
    gradientColors,
    backdrop,
    isMonochrome,
    palette,
  };
}

/**
 * Decodes image from URL, data URL, or file path and extracts complete Android palette
 */
export async function extractPaletteFromArtwork(
  imageUrl: string,
  fallbackColor = '#cbb9f5',
): Promise<ExtractedArtworkResult | null> {
  if (!imageUrl) return null;

  const cacheKey = JSON.stringify([imageUrl, fallbackColor]);
  const cached = getCachedResult(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // Match Android PlayerColorExtractor.Config.IMAGE_SIZE = 128
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return resolve(null);
        }

        ctx.drawImage(img, 0, 0, 128, 128);
        const imgData = ctx.getImageData(0, 0, 128, 128);
        const result = extractFromPixelData(imgData.data, fallbackColor);

        setCachedResult(cacheKey, result);
        resolve(result);
      } catch (err) {
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = imageUrl;
  });
}
