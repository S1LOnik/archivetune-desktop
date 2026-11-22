//! Rust port of `runAcousticAuditFft` for `native/audio-dsp`.
//!
//! Review notes:
//! - Exact parity: Uses `FFT_SIZE = 4096`, `STEP = 2048`, and `num_frames = (len - 4096) / 2048`
//!   (no `+ 1`). Applies `f32` Hann windowing into `fft.real`, runs the existing 4096 `Fft`,
//!   accumulates `f64` magnitudes `sqrt(re^2 + im^2)` and energies `mag * mag` across `2048` bins,
//!   and matches JS `Math.round` via `f64::round` on non-negative frequencies.
//! - Allocation: Performs zero heap allocations; `sum_mag` and `sum_energy` live on the stack
//!   (32 KiB total) and `fft` buffers are reused in-place across frames.
//! - Unsupported / fallback cases: Returns `None` if `fft` is not prepared for 4096 samples, if
//!   `sample_rate` is non-finite or `<= 0.0`, if `bin_hz` or bin-bound divisions are non-finite,
//!   if any input sample is non-finite, or if `f32` FFT overflow produces non-finite magnitudes or
//!   energy totals.
//! - Cutoff and energy edge conditions: Short inputs (`len < 6144`, i.e., `num_frames == 0`) and
//!   all-zero inputs (`max_mag == 0.0`) return `Some([0.0, 0.0, nyquist_hz, 0.0, 0.0])`. Signals
//!   below `1e-8` preserve the JS `+ 1e-8` / `.max(1e-8)` dB floor behavior. When `k15k >= 2048`
//!   (e.g., `sample_rate <= 30000`), JS reads past `sumEnergy` (`undefined` -> `NaN`) and takes the
//!   `ratio = 0` branch; Rust mirrors `ratio = 0.0` directly without out-of-bounds indexing.

const FFT_SIZE: usize = 4096;
const STEP: usize = FFT_SIZE / 2;
const NUM_BINS: usize = FFT_SIZE / 2;

const MAX_DB_DROP: f64 = 42.0;
const DB_FLOOR: f64 = 1e-8;
const ROLLOFF_ENERGY_FRACTION: f64 = 0.99;

const VERDICT_SUSPECTED_FAKE: f64 = 0.0;
const VERDICT_UPSCALED_LOSSY: f64 = 1.0;
const VERDICT_TRUE_LOSSLESS: f64 = 2.0;

/// Analyzes mono PCM samples using the prepared 4096-point FFT and returns
/// `[cutoffHz, rollOffHz, nyquistHz, highBandEnergyRatio, verdictId]`, or `None`
/// when inputs are unsupported/non-finite and require TypeScript fallback.
pub(super) fn analyze(samples: &[f32], sample_rate: f64, fft: &mut super::Fft) -> Option<[f64; 5]> {
    if fft.real.len() != FFT_SIZE || fft.imaginary.len() != FFT_SIZE || fft.hann.len() != FFT_SIZE {
        return None;
    }
    if !sample_rate.is_finite() || sample_rate <= 0.0 {
        return None;
    }

    let nyquist_hz = sample_rate / 2.0;
    let bin_hz = nyquist_hz / (NUM_BINS as f64);
    if !bin_hz.is_finite() || bin_hz <= 0.0 {
        return None;
    }

    let k1k_f = (1000.0 / bin_hz).floor();
    let k15k_f = (15000.0 / bin_hz).floor();
    let k20_5k_f = (20500.0 / bin_hz).floor();
    let k22k_f = (22050.0 / bin_hz).floor();
    if !k1k_f.is_finite() || !k15k_f.is_finite() || !k20_5k_f.is_finite() || !k22k_f.is_finite() {
        return None;
    }

    if samples.iter().any(|sample| !sample.is_finite()) {
        return None;
    }

    // Match JS `Math.floor((samples.length - 4096) / 2048)` without `+ 1`.
    let num_frames = if samples.len() >= FFT_SIZE {
        (samples.len() - FFT_SIZE) / STEP
    } else {
        0
    };
    if num_frames == 0 {
        return Some([0.0, 0.0, nyquist_hz, 0.0, VERDICT_SUSPECTED_FAKE]);
    }

    let mut sum_mag = [0.0_f64; NUM_BINS];
    let mut sum_energy = [0.0_f64; NUM_BINS];

    for frame in 0..num_frames {
        let offset = frame * STEP;
        let window = &samples[offset..offset + FFT_SIZE];
        for ((dst, &sample), &weight) in fft.real[..FFT_SIZE]
            .iter_mut()
            .zip(window.iter())
            .zip(fft.hann[..FFT_SIZE].iter())
        {
            *dst = sample * weight;
        }
        fft.transform();

        for (((&re, &im), mag_acc), energy_acc) in fft.real[..NUM_BINS]
            .iter()
            .zip(fft.imaginary[..NUM_BINS].iter())
            .zip(sum_mag.iter_mut())
            .zip(sum_energy.iter_mut())
        {
            let re = f64::from(re);
            let im = f64::from(im);
            let mag = (re * re + im * im).sqrt();
            if !mag.is_finite() {
                return None;
            }
            *mag_acc += mag;
            *energy_acc += mag * mag;
        }
    }

    let frames_f64 = num_frames as f64;
    let mut max_mag = 0.0_f64;
    for &mag in &sum_mag {
        let avg = mag / frames_f64;
        if avg > max_mag {
            max_mag = avg;
        }
    }
    if max_mag == 0.0 {
        return Some([0.0, 0.0, nyquist_hz, 0.0, VERDICT_SUSPECTED_FAKE]);
    }

    let max_db = 20.0 * max_mag.max(DB_FLOOR).log10();
    let threshold_db = max_db - MAX_DB_DROP;

    let mut highest_active_bin: Option<usize> = None;
    for (bin, &mag) in sum_mag.iter().enumerate() {
        let avg_db = 20.0 * (mag / frames_f64 + DB_FLOOR).log10();
        if avg_db > threshold_db {
            highest_active_bin = Some(bin);
        }
    }
    let cutoff_hz = highest_active_bin.map_or(0.0, |bin| ((bin as f64) * bin_hz).round());

    let mut total_energy = 0.0_f64;
    for &energy in &sum_energy {
        total_energy += energy;
    }
    if !total_energy.is_finite() {
        return None;
    }

    let rolloff_target = total_energy * ROLLOFF_ENERGY_FRACTION;
    let mut accum = 0.0_f64;
    let mut roll_off_bin = 0_usize;
    for (bin, &energy) in sum_energy.iter().enumerate() {
        accum += energy;
        if accum >= rolloff_target {
            roll_off_bin = bin;
            break;
        }
    }
    let roll_off_hz = ((roll_off_bin as f64) * bin_hz).round();

    // When `k15k >= NUM_BINS`, JS reads `undefined` from `sumEnergy` (`midE = NaN`), yielding `0`.
    let ratio = if k15k_f < NUM_BINS as f64 {
        let k1k = k1k_f as usize;
        let k15k = k15k_f as usize;
        let mut mid_e = 0.0_f64;
        for &energy in &sum_energy[k1k..=k15k] {
            mid_e += energy;
        }
        if mid_e > 0.0 {
            let k20_5k = k20_5k_f as usize;
            let k22k = (k22k_f as usize).min(NUM_BINS - 1);
            let mut high_e = 0.0_f64;
            if k20_5k <= k22k {
                for &energy in &sum_energy[k20_5k..=k22k] {
                    high_e += energy;
                }
            }
            high_e / mid_e
        } else {
            0.0
        }
    } else {
        0.0
    };

    if !ratio.is_finite() {
        return None;
    }

    let verdict_id = if cutoff_hz >= 20_200.0 || (roll_off_hz >= 19_500.0 && ratio > 1e-6) {
        VERDICT_TRUE_LOSSLESS
    } else if cutoff_hz < 16_200.0 {
        VERDICT_SUSPECTED_FAKE
    } else {
        VERDICT_UPSCALED_LOSSY
    };

    Some([cutoff_hz, roll_off_hz, nyquist_hz, ratio, verdict_id])
}
