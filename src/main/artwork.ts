import { nativeImage } from 'electron';
import fs from 'fs';
import { fileURLToPath } from 'url';

/** Bound remote artwork downloads; a failed cover must never fail the audio save. */
export async function readArtwork(url: string, signal?: AbortSignal): Promise<Buffer | null> {
  try {
    let bytes: Buffer;
    if (url.startsWith('data:image/')) {
      if (url.length > 6 * 1024 * 1024) return null;
      bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    } else if (url.startsWith('file://') || !/^https?:/.test(url)) {
      const filename = url.startsWith('file://') ? fileURLToPath(url) : url;
      if (fs.statSync(filename).size > 4 * 1024 * 1024) return null;
      bytes = fs.readFileSync(filename);
    } else {
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
      if (!response.ok || !response.body) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.length;
          if (size > 4 * 1024 * 1024) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      bytes = Buffer.concat(chunks);
    }
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    return image.resize({ width: 384, quality: 'good' }).toPNG();
  } catch { return null; }
}
