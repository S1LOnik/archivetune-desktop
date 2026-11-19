/**
 * Material You (M3) Dynamic Color Scheme Generator
 * Ported from ArchiveTune Android's Theme.kt & TonalPalettes.kt
 * Powered by perceptual HCT tonal palettes
 */

import type { MaterialYouScheme } from './types';
import { contrastRatio, hctToHex, hexToRgb, rgbToHct } from './colorUtils';
import { extractBackdropTonePalette } from './playerColorExtractor';

export type ThemeMode = 'dark' | 'light' | 'amoled';

export interface TonalPalette {
  tone: (t: number) => string;
}

export function createTonalPalette(hue: number, chroma: number): TonalPalette {
  return {
    tone: (t: number) => hctToHex(hue, chroma, t),
  };
}

/**
 * Determines PaletteStyle matching Android Theme.kt: paletteStyleFor()
 */
export function getPaletteStyle(chroma: number): 'Monochrome' | 'Neutral' | 'TonalSpot' {
  if (chroma < 4.0) return 'Monochrome';
  if (chroma < 12.0) return 'Neutral';
  return 'TonalSpot';
}

/**
 * Generates the full Material 3 Color Scheme for a given seed color and theme mode
 * Matching ArchiveTune Android Theme.kt materialKolorDynamicColorScheme() & pureBlack()
 */
export function generateMaterialYouScheme(
  seedHex: string,
  mode: ThemeMode = 'dark',
  gradientColors: string[] = [],
): MaterialYouScheme {
  const seedRgb = hexToRgb(seedHex);
  const seedHct = rgbToHct(seedRgb.r, seedRgb.g, seedRgb.b);

  const style = getPaletteStyle(seedHct.chroma);

  let primaryChroma = Math.max(36.0, seedHct.chroma);
  let secondaryChroma = 16.0;
  let tertiaryChroma = 24.0;
  let neutralChroma = 4.0;
  let neutralVariantChroma = 8.0;

  if (style === 'Monochrome') {
    primaryChroma = 0;
    secondaryChroma = 0;
    tertiaryChroma = 0;
    neutralChroma = 0;
    neutralVariantChroma = 0;
  } else if (style === 'Neutral') {
    primaryChroma = Math.min(seedHct.chroma, 12.0);
    secondaryChroma = 8.0;
    tertiaryChroma = 12.0;
    neutralChroma = 2.0;
    neutralVariantChroma = 4.0;
  }

  const primaryPalette = createTonalPalette(seedHct.hue, primaryChroma);
  const secondaryPalette = createTonalPalette(seedHct.hue, secondaryChroma);
  const tertiaryPalette = createTonalPalette((seedHct.hue + 60.0) % 360, tertiaryChroma);
  const neutralPalette = createTonalPalette(seedHct.hue, neutralChroma);
  const neutralVariantPalette = createTonalPalette(seedHct.hue, neutralVariantChroma);
  const errorPalette = createTonalPalette(25.0, 84.0);

  const isDark = mode === 'dark' || mode === 'amoled';
  const isAmoled = mode === 'amoled';

  // Android M3 Standard Tone Tokens
  let primary: string;
  let onPrimary: string;
  let primaryContainer: string;
  let onPrimaryContainer: string;
  let inversePrimary: string;

  let secondary: string;
  let onSecondary: string;
  let secondaryContainer: string;
  let onSecondaryContainer: string;

  let tertiary: string;
  let onTertiary: string;
  let tertiaryContainer: string;
  let onTertiaryContainer: string;

  let surface: string;
  let surfaceDim: string;
  let surfaceBright: string;
  let surfaceContainerLowest: string;
  let surfaceContainerLow: string;
  let surfaceContainer: string;
  let surfaceContainerHigh: string;
  let surfaceContainerHighest: string;
  let surfaceVariant: string;
  let onSurface: string;
  let onSurfaceVariant: string;

  let outline: string;
  let outlineVariant: string;

  let error: string;
  let onError: string;
  let errorContainer: string;
  let onErrorContainer: string;

  if (isDark) {
    primary = primaryPalette.tone(80);
    onPrimary = primaryPalette.tone(20);
    primaryContainer = primaryPalette.tone(30);
    onPrimaryContainer = primaryPalette.tone(90);
    inversePrimary = primaryPalette.tone(40);

    secondary = secondaryPalette.tone(80);
    onSecondary = secondaryPalette.tone(20);
    secondaryContainer = secondaryPalette.tone(30);
    onSecondaryContainer = secondaryPalette.tone(90);

    tertiary = tertiaryPalette.tone(80);
    onTertiary = tertiaryPalette.tone(20);
    tertiaryContainer = tertiaryPalette.tone(30);
    onTertiaryContainer = tertiaryPalette.tone(90);

    if (isAmoled) {
      // Pure black amoled mode matching Android Theme.kt pureBlack(true)
      surface = '#000000';
      surfaceDim = '#000000';
      surfaceBright = neutralPalette.tone(18);
      surfaceContainerLowest = '#000000';
      surfaceContainerLow = neutralPalette.tone(6);
      surfaceContainer = neutralPalette.tone(10);
      surfaceContainerHigh = neutralPalette.tone(14);
      surfaceContainerHighest = neutralPalette.tone(18);
    } else {
      surface = neutralPalette.tone(6);
      surfaceDim = neutralPalette.tone(6);
      surfaceBright = neutralPalette.tone(24);
      surfaceContainerLowest = neutralPalette.tone(4);
      surfaceContainerLow = neutralPalette.tone(10);
      surfaceContainer = neutralPalette.tone(12);
      surfaceContainerHigh = neutralPalette.tone(17);
      surfaceContainerHighest = neutralPalette.tone(22);
    }

    surfaceVariant = neutralVariantPalette.tone(30);
    onSurface = neutralPalette.tone(90);
    onSurfaceVariant = neutralVariantPalette.tone(80);

    outline = neutralVariantPalette.tone(60);
    outlineVariant = neutralVariantPalette.tone(30);

    error = errorPalette.tone(80);
    onError = errorPalette.tone(20);
    errorContainer = errorPalette.tone(30);
    onErrorContainer = errorPalette.tone(90);
  } else {
    // Light Theme
    primary = primaryPalette.tone(40);
    onPrimary = primaryPalette.tone(100);
    primaryContainer = primaryPalette.tone(90);
    onPrimaryContainer = primaryPalette.tone(10);
    inversePrimary = primaryPalette.tone(80);

    secondary = secondaryPalette.tone(40);
    onSecondary = secondaryPalette.tone(100);
    secondaryContainer = secondaryPalette.tone(90);
    onSecondaryContainer = secondaryPalette.tone(10);

    tertiary = tertiaryPalette.tone(40);
    onTertiary = tertiaryPalette.tone(100);
    tertiaryContainer = tertiaryPalette.tone(90);
    onTertiaryContainer = tertiaryPalette.tone(10);

    surface = neutralPalette.tone(98);
    surfaceDim = neutralPalette.tone(87);
    surfaceBright = neutralPalette.tone(98);
    surfaceContainerLowest = '#ffffff';
    surfaceContainerLow = neutralPalette.tone(96);
    surfaceContainer = neutralPalette.tone(94);
    surfaceContainerHigh = neutralPalette.tone(92);
    surfaceContainerHighest = neutralPalette.tone(90);
    surfaceVariant = neutralVariantPalette.tone(90);
    onSurface = neutralPalette.tone(10);
    onSurfaceVariant = neutralVariantPalette.tone(30);

    outline = neutralVariantPalette.tone(50);
    outlineVariant = neutralVariantPalette.tone(80);

    error = errorPalette.tone(40);
    onError = errorPalette.tone(100);
    errorContainer = errorPalette.tone(90);
    onErrorContainer = errorPalette.tone(10);
  }

  // Ensure high contrast on onPrimary and onSurface
  const ensureContrast = (fgHex: string, bgHex: string, minRatio = 4.5): string => {
    const fgRgb = hexToRgb(fgHex);
    const bgRgb = hexToRgb(bgHex);
    if (contrastRatio(fgRgb, bgRgb) < minRatio) {
      // Pick either white or black, whichever has highest contrast
      const whiteRgb = { r: 255, g: 255, b: 255 };
      const blackRgb = { r: 0, g: 0, b: 0 };
      return contrastRatio(whiteRgb, bgRgb) > contrastRatio(blackRgb, bgRgb) ? '#ffffff' : '#000000';
    }
    return fgHex;
  };

  onPrimary = ensureContrast(onPrimary, primary);
  onSecondary = ensureContrast(onSecondary, secondary);
  onTertiary = ensureContrast(onTertiary, tertiary);

  // Player tone tokens
  const backdrop = extractBackdropTonePalette(
    gradientColors.length > 0 ? gradientColors : [seedHex],
    seedHex,
    isDark,
  );

  const primaryRgb = hexToRgb(primary);
  const playerGlowAccent = `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.35)`;
  const playerBgTint = `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.12)`;

  return {
    primary,
    onPrimary,
    primaryContainer,
    onPrimaryContainer,
    inversePrimary,
    secondary,
    onSecondary,
    secondaryContainer,
    onSecondaryContainer,
    tertiary,
    onTertiary,
    tertiaryContainer,
    onTertiaryContainer,
    surface,
    surfaceDim,
    surfaceBright,
    surfaceContainerLowest,
    surfaceContainerLow,
    surfaceContainer,
    surfaceContainerHigh,
    surfaceContainerHighest,
    surfaceVariant,
    onSurface,
    onSurfaceVariant,
    outline,
    outlineVariant,
    error,
    onError,
    errorContainer,
    onErrorContainer,
    scrim: '#000000',
    playerGlowAccent,
    playerBgTint,
    backdropTop: backdrop.top,
    backdropMid: backdrop.mid,
    backdropBottom: backdrop.bottom,
    gradientColors: gradientColors.length > 0 ? gradientColors : [primary, secondary, tertiary],
  };
}
