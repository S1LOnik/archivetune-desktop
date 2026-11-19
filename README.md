# ArchiveTune Desktop (V16 Beta)

Desktop music player for Linux (Wayland/X11) and Windows inspired by [`S1LOnik/ArchiveTune`](https://github.com/S1LOnik/ArchiveTune) (V16) and built on an enhanced Electron + Dual-Deck `mpv` IPC architecture.

## Key Features Ported from `S1LOnik/ArchiveTune`

- **Dual-Deck `mpv` Engine (`Deck A` + `Deck B`) & Smart DJ Automix**:
  - Real simultaneous two-deck audio playback over JSON IPC sockets (`src/main/player.ts`).
  - Direct TypeScript port of `SmartDjAutomixManager.kt` (`src/main/automix.ts`): BPM rhythm resolution, 2/4/8-bar phrase alignment, downbeat phase sync seek, DJ S-curve volume crossfade, midpoint Bass Swap crossover (`p = 0.5` high-pass filter cut), and Tempo Warping (`0.85x..1.15x` within `±15%` BPM delta).
- **10-Band Parametric Equalizer & DSP**:
  - Live `lavfi=[anequalizer=...]` filter graph across `31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz` (`-12dB..+12dB`) with presets (`Flat`, `Bass Boost`, `Vocal`, `Electronic`, `Rock`, `Acoustic`, `Harman`) + `dynaudnorm` loudness normalization.
- **Universal Audio Fallback Matrix & Multi-Source Search (`src/main/providers.ts`)**:
  - Direct port of `TrackMatching.kt` (token overlap, version mismatch rejection for `remix/live/acoustic/demo`, `±45s` duration tolerance).
  - Streams and searches across **Tidal Lossless** (`HI_RES_LOSSLESS` / `LOSSLESS` FLAC via hifi API), **YouTube Music** (fast direct InnerTube JSON API + `yt-dlp` fallback), **SoundCloud** (dynamic `client_id` + API v2), **Deezer**, and **Spotify**.
- **10-Provider Waterfall Lyrics + Word-by-Word Karaoke + Romaji + Translation (`src/main/lyrics.ts`)**:
  - Queries **YouLyPlus (LyricsPlus)**, **BetterLyrics (TTML XML word-sync + Kugou + QQ)**, **LRCLib** (Enhanced LRC + fuzzy search), and **SimpMusic**.
  - Supports syllable/word-level active fill animations, Japanese Kana Romanization, live Cloud Translation (`RU`, `EN`, `JA`, `KO`, `ES`), and **Lyrics Share Card PNG generator**.
- **Motion Video Canvas (`:canvas` port in `src/main/canvas.ts`)**:
  - Direct binary Protobuf wire encoder/decoder for `SpotifyCanvazProtocol.kt` (`spclient.wg.spotify.com/canvaz-cache/v0/canvases`) + `TidalCanvasProvider.kt` (`1280x1280.mp4` animated video covers).
- **8 Expressive Player Styles (`src/renderer/components/NowPlayingOverlay.tsx`)**:
  - `Flamingo`, `V8 Immersive`, `V10 Expressive`, `BitChord`, `SimpMusic`, `SpatialFlow`, `TikTok Rail`, and `Classic` with `0.85x` cover spring compression on pause/scrubbing, dynamic artwork color extraction, and spring recoil buttons.
- **Persistent Storage (`src/main/db.ts`) & Desktop Integration (`src/main/desktop.ts`)**:
  - Transactional state + SQLite (`archivetune.db`) mirror for settings, liked songs, playlists, history, and queue.
  - System Tray, Close-to-Tray, Global Media Shortcuts, Always-on-Top Mini PiP widget, Discord Rich Presence (native IPC), and Last.fm Audioscrobbler 2.0.

## Quick Start

```bash
# Development mode (Vite HMR + Electron)
npm run dev

# Production build
npm run build

# Launch compiled production build
npx electron dist/main/index.js

# Build Linux AppImage / directory bundle
npm run dist:linux
```

The audio-analysis build uses Rust/WASM when the Rust toolchain (1.85+) has the
`wasm32-unknown-unknown` target installed (`rustup target add wasm32-unknown-unknown`).
Otherwise AutoMix and acoustic quality analysis use the TypeScript worker.
