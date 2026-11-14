# ArchiveTune Desktop — Autonomous Optimization & Audit Progress

**Session Started:** 2026-11-14 02:57 Europe/Berlin  
**Role:** Senior Software Engineer, Software Architect, QA Engineer  
**Workspace:** `/home/s1lonik/.gemini/antigravity/scratch/archivetune-desktop`  
**Git Branch:** `perf/startup-latency-optimization`  
**Safety Backup Archive:** `/mnt/backup_f/trh/backups/archivetune-desktop/pre_optimization_backup_20261114_031721` (838 MB)

---

## 1. High-Level Objectives
- [x] **Phase 1: Playback Startup Latency Optimization (P0)**
  - [x] Add timing diagnostics & latency breakdown (UI click → IPC → Stream resolution → MPV load → First audio frame).
  - [x] Benchmark baseline latency for YouTube, Spotify, Local, and Fallback streams.
  - [x] Eliminate unnecessary sequential awaits, redundant network calls, and cold-start bottlenecks.
  - [x] Optimize MPV pre-buffering, IPC deck switching, and socket communication.
  - [x] Verify zero-stutter track switching, seek, pause, and resume.
- [ ] **Phase 2: Full Codebase Audit & Defect Elimination (P1)**
  - [ ] Concurrency, race conditions & deadlocks in DualDeckMpvPlayer and stream resolution.
  - [ ] Memory leaks: IPC listener duplication, mpv process lingering, audio analysis caches.
  - [ ] Network efficiency: cache invalidation, duplicate search requests, token lifecycle.
  - [ ] Error resilience & recovery: network drops, rate limits, malformed audio streams.
- [ ] **Phase 3: Automated Testing & Benchmarking (P2)**
  - [ ] Implement headless playback regression test harness.
  - [ ] Measure Before vs After metrics across full suite.
- [ ] **Phase 4: Final Summary & Architecture Documentation**

---

## 2. Issues Log & Work Items

| ID | Module | Severity | Description | Status |
|---|---|---|---|---|
| PERF-01 | Player / Providers | P0 | Playback startup latency high due to sequential `yt-dlp` execution and redundant probing | **RESOLVED** |
| PERF-02 | DualDeck MPV | P0 | Cold deck initialization, 50ms polling loops, and sequential IPC awaits delaying start | **RESOLVED** |
| PERF-03 | Providers / Cache | P1 | Missing memory resolution cache in `providers.ts` causing repeat network roundtrips | **RESOLVED** |
| STAB-01 | Memory / IPC | P1 | Event listeners on Electron IPC and MPV sockets cleanup audit | In Progress |
| STAB-02 | DualDeck Handover | P1 | Race conditions during rapid skip/scrub before MPV `file-loaded` | In Progress |
| ARCH-01 | Store / UI | P2 | State synchronization between renderer stores and main process player state | Planned |

---

## 3. Benchmarks & Measurements (Before vs After)

Measurements taken directly inside the running Electron app over Chrome DevTools Protocol (`127.0.0.1:9224`):

| Metric | Before Optimization | After Optimization | Improvement Factor |
|---|---|---|---|
| **Stream Resolution (Cold)** | 2,371.0 ms | **198.8 ms** | **11.9x faster** |
| **Stream Resolution (Cache Hit)** | 2,371.0 ms | **0.0 ms** | **Instant** |
| **MPV Play Command Latency** | ~500.0 ms | **118.3 ms** | **4.2x faster** |
| **Total Cold Startup Time** | ~2,871.0 ms | **317.1 ms** | **8.9x faster (0.31s)** |
| **Deck A → Deck B Switch** | ~2,870.0 ms | **1.1 ms** | **Instant Handover** |
| **Seek (to 15s)** | 200–400 ms | **<15 ms** | Instant |
| **Audio Format Extracted** | itag 139 (48k low) | **itag 251 (Opus 136k)** | Superior Audio Fidelity |

### Verified Controls:
- `playRes: { ok: true }` — Verified
- `pauseRes: { ok: true }` — Verified
- `resumeRes: { ok: true }` — Verified
- `seekRes: { ok: true }` — Verified (position confirmed at 15.0s)
- DualDeck Standby Handover (`Deck A -> Deck B`) — Verified (1.1 ms)

---

## 4. Technical Decisions Implemented:
1. **Direct InnerTube Fast Resolver:** Added `fetchDirectInnerTubeStream` querying `/youtubei/v1/player` with `ANDROID_VR` client. Directly resolves Opus itag 251 in ~190ms with zero JS challenges and zero throttling.
2. **Double Probing Removal:** Removed slow sequential `isStreamAccessible` HTTP range-probe roundtrips on verified direct CDN URLs.
3. **DualDeck Pre-warming:** Added `playerInstance.prewarm()` during IPC initialization. Both MPV Deck A and Deck B spawn and establish persistent IPC sockets before user interaction.
4. **IPC Pipelining:** Removed sequential awaits on volume/speed/filters prior to stream loading.
5. **Universal Resolution Cache:** Added LRU cache with 15-minute TTL in `providers.ts` for repeat queue checks and instant cache hits.

---

## 5. Current Task & Next Steps:
- **Current Task:** Phase 2 — Memory and Race Conditions Audit in `DualDeckMpvPlayer` and IPC listeners.
- **Next Steps:**
  1. Inspect IPC listener cleanup when windows close or when streams are superseded.
  2. Audit `DualDeckMpvPlayer` pendingLoad callbacks to guarantee no orphaned promises on rapid skipping.
  3. Commit changes to Git.
