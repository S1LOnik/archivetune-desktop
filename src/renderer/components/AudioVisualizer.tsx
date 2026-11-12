import React, { useEffect, useRef } from 'react';
import { usePlayerStore, useUIStore } from '../store';

interface AudioVisualizerProps {
  className?: string;
  height?: number;
  styleOverride?: 'bars' | 'wave' | 'circular';
}

export default function AudioVisualizer({
  className = '',
  height = 56,
  styleOverride,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const { visualizerEnabled, visualizerStyle, seedColor, activeArtColor, dynamicColorFromArt } =
    useUIStore();

  const activeStyle = styleOverride ?? visualizerStyle;
  const accent = (dynamicColorFromArt && activeArtColor) || seedColor || '#cbb9f5';

  useEffect(() => {
    if (!visualizerEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const bins = 40;
    const levels = new Float32Array(bins).fill(0.12);
    let phase = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      phase += isPlaying ? 0.08 : 0.015;

      for (let i = 0; i < bins; i++) {
        const beatWave =
          Math.sin(phase * 1.9 + i * 0.37) * 0.35 +
          Math.cos(phase * 3.1 - i * 0.21) * 0.28 +
          Math.sin(phase * 0.7 + (position || 0) + i * 0.5) * 0.22;
        const target = isPlaying
          ? Math.max(0.1, Math.min(0.95, 0.42 + beatWave * (1 - Math.abs(i - bins / 2) / bins)))
          : 0.08 + 0.04 * Math.sin(phase + i * 0.25);
        levels[i] += (target - levels[i]) * 0.22;
      }

      if (activeStyle === 'bars') {
        const gap = 3;
        const barW = Math.max(2, (w - gap * (bins - 1)) / bins);
        for (let i = 0; i < bins; i++) {
          const barH = Math.max(3, levels[i] * (h - 6));
          const x = i * (barW + gap);
          const y = h - barH;
          const grad = ctx.createLinearGradient(0, y, 0, h);
          grad.addColorStop(0, accent);
          grad.addColorStop(1, `${accent}33`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, Math.min(4, barW / 2));
          ctx.fill();
        }
      } else if (activeStyle === 'wave') {
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent;
        for (let i = 0; i < bins; i++) {
          const x = (i / (bins - 1)) * w;
          const y = h / 2 + (levels[i] - 0.5) * h * 0.8 * (i % 2 === 0 ? 1 : -1);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const cx = w / 2;
        const cy = h / 2;
        const baseR = Math.min(w, h) * 0.26;
        for (let i = 0; i < bins; i++) {
          const angle = (i / bins) * Math.PI * 2 + phase * 0.25;
          const r2 = baseR + levels[i] * Math.min(w, h) * 0.22;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
          ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
          ctx.stroke();
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [visualizerEnabled, activeStyle, isPlaying, accent, position]);

  if (!visualizerEnabled) return null;

  return (
    <canvas
      ref={canvasRef}
      width={360}
      height={height}
      className={`w-full pointer-events-none ${className}`}
      style={{ height }}
    />
  );
}
