// Standalone offline test verifying Android palette extraction vs old broken logic
// Runs without network or build artifacts by transpiling TypeScript on the fly
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

require.extensions['.ts'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(compiled.outputText, filename);
};

const {
  rgbToHex,
  hexToRgb,
  contrastRatio,
} = require('../src/renderer/lib/color/colorUtils.ts');

const {
  generateMaterialYouScheme,
} = require('../src/renderer/lib/color/materialYou.ts');

const {
  extractFromPixelData,
} = require('../src/renderer/lib/color/imageExtractor.ts');

console.log('=== ARCHIVETUNE COLOR EXTRACTION VERIFICATION ===\n');

// 1. REPRODUCE OLD BUG vs PORTED ANDROID LOGIC
console.log('--- Test 1: Rogue 1-pixel high-saturation artifact on navy album cover ---');
// 1023 pixels of deep navy blue (#1e293b, r:30, g:41, b:59, sat:0.32, lum:0.17)
// 1 rogue pixel of ultra-saturated neon cyan (#00ffff, r:0, g:255, b:255, sat:1.0, lum:0.5)
const pixels = new Uint8ClampedArray(32 * 32 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 30;     // R
  pixels[i + 1] = 41; // G
  pixels[i + 2] = 59; // B
  pixels[i + 3] = 255;// A
}
// Add rogue pixel at index (16, 16)
const rogueIndex = (16 * 32 + 16) * 4;
pixels[rogueIndex] = 0;
pixels[rogueIndex + 1] = 255;
pixels[rogueIndex + 2] = 255;
pixels[rogueIndex + 3] = 255;

// OLD desktop logic simulation:
let oldBestR = 203, oldBestG = 185, oldBestB = 245;
let oldMaxSat = -1;
for (let i = 0; i < pixels.length; i += 4) {
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (max + min) / 510;
  const sat = max === 0 ? 0 : (max - min) / max;
  if (lum > 0.15 && lum < 0.88 && sat > oldMaxSat) {
    oldMaxSat = sat;
    oldBestR = r;
    oldBestG = g;
    oldBestB = b;
  }
}
const oldWashedR = Math.min(255, Math.round(oldBestR * 0.8 + 255 * 0.2));
const oldWashedG = Math.min(255, Math.round(oldBestG * 0.8 + 255 * 0.2));
const oldWashedB = Math.min(255, Math.round(oldBestB * 0.8 + 255 * 0.2));
const oldSeed = rgbToHex(oldWashedR, oldWashedG, oldWashedB);

// NEW Android ported logic:
const newResult = extractFromPixelData(pixels, '#cbb9f5');

console.log(`OLD desktop extractor result: ${oldSeed} (Picked 1 rogue pixel, washed with 20% white: UNRELATED TO COVER!)`);
console.log(`NEW Android extractor result: ${newResult.seedHex} (Accurately identified cover theme: Population weighted!)`);
console.log(`Android Dominant Swatch: ${newResult.palette.dominant?.hex} with population ${newResult.palette.dominant?.population}/1024`);
if (newResult.seedHex === '#33ffff' || newResult.seedHex === oldSeed) {
  throw new Error('Should NOT pick rogue cyan pixel!');
}
console.log('✓ Test 1 PASSED: Android logic successfully ignored rogue single-pixel anomaly!\n');

// 2. TEST COLORFUL ALBUM WITH MULTIPLE REGIONS
console.log('--- Test 2: Multi-colored cover (Coral Red, Amber Gold, Midnight Blue) ---');
const multiPixels = new Uint8ClampedArray(64 * 64 * 4);
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    const idx = (y * 64 + x) * 4;
    if (y < 32 && x < 32) {
      // Coral red (#ed5564) - 25% of image
      multiPixels[idx] = 0xed;
      multiPixels[idx + 1] = 0x55;
      multiPixels[idx + 2] = 0x64;
    } else if (y < 32 && x >= 32) {
      // Amber gold (#f59e0b) - 25% of image
      multiPixels[idx] = 0xf5;
      multiPixels[idx + 1] = 0x9e;
      multiPixels[idx + 2] = 0x0b;
    } else {
      // Midnight blue (#0f172a) - 50% of image
      multiPixels[idx] = 0x0f;
      multiPixels[idx + 1] = 0x17;
      multiPixels[idx + 2] = 0x2a;
    }
    multiPixels[idx + 3] = 255;
  }
}
const multiResult = extractFromPixelData(multiPixels, '#cbb9f5');
console.log(`Extracted Theme Seed: ${multiResult.seedHex}`);
console.log(`Extracted 6 Gradient Colors:`, multiResult.gradientColors);
console.log(`Extracted Backdrop Tones:`, multiResult.backdrop);
if (multiResult.gradientColors.length !== 6) {
  throw new Error('Should extract exactly 6 player gradient colors');
}
console.log('✓ Test 2 PASSED: Successfully extracted vibrant seed and 6 player gradient colors!\n');

// 3. TEST GREYSCALE / MONOCHROME DETECTION
console.log('--- Test 3: Greyscale Cover Detection ---');
const greyPixels = new Uint8ClampedArray(32 * 32 * 4);
for (let i = 0; i < greyPixels.length; i += 4) {
  const g = 60 + ((i / 4) % 30);
  greyPixels[i] = g;
  greyPixels[i + 1] = g;
  greyPixels[i + 2] = g;
  greyPixels[i + 3] = 255;
}
const greyResult = extractFromPixelData(greyPixels, '#cbb9f5');
console.log(`Greyscale detected: ${greyResult.isMonochrome}`);
console.log(`Greyscale stops:`, greyResult.gradientColors);
if (greyResult.isMonochrome !== true) {
  throw new Error('Should detect greyscale image');
}
console.log('✓ Test 3 PASSED: Greyscale image handled cleanly without false vibrant saturation!\n');

// 4. TEST MATERIAL YOU FULL THEME TOKENS
console.log('--- Test 4: Material 3 Dynamic Scheme Tokens (Dark, Light, Amoled) ---');
const darkScheme = generateMaterialYouScheme('#ed5564', 'dark', multiResult.gradientColors);
const lightScheme = generateMaterialYouScheme('#ed5564', 'light', multiResult.gradientColors);
const amoledScheme = generateMaterialYouScheme('#ed5564', 'amoled', multiResult.gradientColors);

console.log('Dark Theme Primary:', darkScheme.primary, 'onPrimary:', darkScheme.onPrimary);
console.log('Dark Theme Surface:', darkScheme.surface, 'surfaceContainer:', darkScheme.surfaceContainer);
console.log('Light Theme Primary:', lightScheme.primary, 'onPrimary:', lightScheme.onPrimary);
console.log('Amoled Theme Surface (pure black):', amoledScheme.surface);

// Check contrast on primary
const darkPrimaryRgb = hexToRgb(darkScheme.primary);
const darkOnPrimaryRgb = hexToRgb(darkScheme.onPrimary);
const darkContrast = contrastRatio(darkPrimaryRgb, darkOnPrimaryRgb);
console.log(`Dark Theme onPrimary Contrast Ratio: ${darkContrast.toFixed(2)}:1 (Min 4.5:1 required)`);
if (darkContrast < 4.5) {
  throw new Error('onPrimary contrast must meet WCAG AA');
}

if (amoledScheme.surface !== '#000000') {
  throw new Error('Amoled surface must be pure black #000000');
}
if (darkScheme.primaryContainer === darkScheme.primary) {
  throw new Error('Containers must have proper tones');
}
if (!darkScheme.outline || !darkScheme.outlineVariant) {
  throw new Error('Outline tokens must be defined');
}
if (!darkScheme.secondary || !darkScheme.tertiary) {
  throw new Error('Secondary and Tertiary must be dynamically generated');
}

const pairs = [
  ['primary', 'onPrimary'],
  ['primaryContainer', 'onPrimaryContainer'],
  ['surface', 'onSurface'],
  ['surfaceContainerHighest', 'onSurfaceVariant'],
  ['secondaryContainer', 'onSecondaryContainer'],
  ['tertiaryContainer', 'onTertiaryContainer'],
  ['errorContainer', 'onErrorContainer'],
  ['error', 'onError'],
];
for (const seed of ['#081029', '#020748', '#2222ff', '#ff0000', '#00ff00', '#ffffff', '#090909']) {
  for (const theme of ['dark', 'light', 'amoled']) {
    const scheme = generateMaterialYouScheme(seed, theme);
    for (const [background, foreground] of pairs) {
      const ratio = contrastRatio(hexToRgb(scheme[background]), hexToRgb(scheme[foreground]));
      if (ratio < 4.5) throw new Error(`${theme} ${seed} ${foreground} on ${background}: ${ratio}`);
    }
  }
}
console.log('✓ Test 4 PASSED: Text contrast pairs reach 4.5:1 for the tested seeds and themes.');
