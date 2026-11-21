use std::{cell::RefCell, f64::consts::PI};

struct Fft {
    real: Vec<f32>,
    imaginary: Vec<f32>,
    hann: Vec<f32>,
    reverse: Vec<usize>,
    twiddles: Vec<(f64, f64)>,
}

impl Fft {
    fn new(size: usize) -> Self {
        let bits = size.trailing_zeros();
        let reverse = (0..size)
            .map(|index| index.reverse_bits() >> (usize::BITS - bits))
            .collect();
        let twiddles = (0..size / 2)
            .map(|index| {
                let angle = -2.0 * PI * index as f64 / size as f64;
                let (sine, cosine) = angle.sin_cos();
                (cosine, sine)
            })
            .collect();
        let hann = (0..size)
            .map(|index| {
                let angle = 2.0 * PI * index as f64 / (size - 1) as f64;
                (0.5 * (1.0 - angle.cos())) as f32
            })
            .collect();
        Self {
            real: vec![0.0; size],
            imaginary: vec![0.0; size],
            hann,
            reverse,
            twiddles,
        }
    }

    fn transform(&mut self) {
        self.imaginary.fill(0.0);
        for (index, &reversed) in self.reverse.iter().enumerate() {
            if index < reversed {
                self.real.swap(index, reversed);
            }
        }

        let size = self.real.len();
        let mut width = 2;
        while width <= size {
            let half = width / 2;
            let stride = size / width;
            for (real, imaginary) in self
                .real
                .chunks_exact_mut(width)
                .zip(self.imaginary.chunks_exact_mut(width))
            {
                let (real_left, real_right) = real.split_at_mut(half);
                let (imaginary_left, imaginary_right) = imaginary.split_at_mut(half);
                for offset in 0..half {
                    let (cosine, sine) = self.twiddles[offset * stride];
                    let left_real = f64::from(real_left[offset]);
                    let left_imaginary = f64::from(imaginary_left[offset]);
                    let right_real = f64::from(real_right[offset]);
                    let right_imaginary = f64::from(imaginary_right[offset]);
                    let real = right_real * cosine - right_imaginary * sine;
                    let imaginary = right_real * sine + right_imaginary * cosine;
                    real_left[offset] = (left_real + real) as f32;
                    imaginary_left[offset] = (left_imaginary + imaginary) as f32;
                    real_right[offset] = (left_real - real) as f32;
                    imaginary_right[offset] = (left_imaginary - imaginary) as f32;
                }
            }
            width *= 2;
        }
    }
}

thread_local! {
    static FFT: RefCell<Option<Fft>> = const { RefCell::new(None) };
}

// The host owns no allocations. The views stay valid until the next prepare call.
#[unsafe(no_mangle)]
pub extern "C" fn prepare(size: usize) -> *const f32 {
    if !matches!(size, 512 | 1024 | 4096) {
        return std::ptr::null();
    }
    FFT.with(|slot| {
        let mut current = slot.borrow_mut();
        if current.as_ref().is_none_or(|fft| fft.real.len() != size) {
            *current = Some(Fft::new(size));
        }
        current.as_ref().unwrap().real.as_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn imaginary() -> *const f32 {
    FFT.with(|slot| {
        slot.borrow()
            .as_ref()
            .map_or(std::ptr::null(), |fft| fft.imaginary.as_ptr())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn hann_window() -> *const f32 {
    FFT.with(|slot| {
        slot.borrow()
            .as_ref()
            .map_or(std::ptr::null(), |fft| fft.hann.as_ptr())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn transform() {
    FFT.with(|slot| {
        if let Some(fft) = slot.borrow_mut().as_mut() {
            fft.transform();
        }
    });
}
