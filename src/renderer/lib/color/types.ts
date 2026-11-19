/**
 * Material You / Android Palette Types
 * Ported from ArchiveTune Android (Kotlin) & Material 3 specification
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HctColor {
  hue: number;
  chroma: number;
  tone: number;
}

export interface Swatch {
  rgb: number;
  r: number;
  g: number;
  b: number;
  hex: string;
  population: number;
  hsl: [number, number, number]; // [hue 0..360, sat 0..1, light 0..1]
  hsv: [number, number, number]; // [hue 0..360, sat 0..1, value 0..1]
}

export interface PaletteTarget {
  name: string;
  minSaturation: number;
  targetSaturation: number;
  maxSaturation: number;
  minLightness: number;
  targetLightness: number;
  maxLightness: number;
  saturationWeight: number;
  lightnessWeight: number;
  populationWeight: number;
  isExclusive: boolean;
}

export interface AndroidPalette {
  vibrant: Swatch | null;
  lightVibrant: Swatch | null;
  darkVibrant: Swatch | null;
  muted: Swatch | null;
  lightMuted: Swatch | null;
  darkMuted: Swatch | null;
  dominant: Swatch | null;
  swatches: Swatch[];
}

export interface BackdropTonePalette {
  top: string;
  mid: string;
  bottom: string;
}

export interface MaterialYouScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  inversePrimary: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  surfaceVariant: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  scrim: string;
  playerGlowAccent: string;
  playerBgTint: string;
  backdropTop: string;
  backdropMid: string;
  backdropBottom: string;
  gradientColors: string[];
}

export interface ExtractedArtworkResult {
  seedHex: string;
  gradientColors: string[];
  backdrop: BackdropTonePalette;
  isMonochrome: boolean;
  palette: AndroidPalette;
}
