import React from 'react';
import { Sparkles, ArrowLeftRight, ShieldCheck, Disc3, AlertCircle, X } from 'lucide-react';
import { useUIStore } from '../store';

export default function ToastContainer() {
  const { toasts, dismissToast } = useUIStore();
  if (toasts.length === 0) return null;

  const getStyle = (kind: string) => {
    switch (kind) {
      case 'lossless':
        return {
          icon: <Sparkles size={16} className="text-emerald-400" />,
          surface: ' bg-emerald-950/85 text-emerald-50',
        };
      case 'switch':
        return {
          icon: <ArrowLeftRight size={16} className="text-amber-300" />,
          surface: ' bg-surface-container-highest/95 text-on-surface',
        };
      case 'sponsorblock':
        return {
          icon: <ShieldCheck size={16} className="text-sky-400" />,
          surface: ' bg-surface-container-highest/95 text-on-surface',
        };
      case 'automix':
        return {
          icon: <Disc3 size={16} className="text-primary animate-spin" />,
          surface: ' bg-surface-container-highest/95 text-on-surface',
        };
      case 'error':
        return {
          icon: <AlertCircle size={16} className="text-red-400" />,
          surface: ' bg-red-950/90 text-red-50',
        };
      default:
        return {
          icon: <Sparkles size={16} className="text-primary" />,
          surface: ' bg-surface-container-highest/95 text-on-surface',
        };
    }
  };

  return (
    <div className="fixed bottom-24 right-5 z-[120] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => {
        const s = getStyle(t.kind);
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-3.5 py-2.5 rounded-2xl  shadow-2xl backdrop-blur-xl text-xs font-medium transition-all ${s.surface}`}
          >
            <span className="flex-shrink-0">{s.icon}</span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="opacity-60 hover:opacity-100 p-0.5 rounded"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
