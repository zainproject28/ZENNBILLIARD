import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { t, type Language } from '../services/i18n.ts';

interface SpinControlProps {
  spinX: number; // -1..1
  spinY: number; // -1..1
  disabled: boolean;
  variant?: 'default' | 'compact';
  language?: Language;
  onChange: (spinX: number, spinY: number) => void;
}

export const SpinControl: React.FC<SpinControlProps> = ({
  spinX,
  spinY,
  disabled,
  variant = 'default',
  language = 'en',
  onChange,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled && modalOpen) {
      setModalOpen(false);
    }
  }, [disabled, modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.37;
    let dx = (clientX - cx) / maxR;
    let dy = -(clientY - cy) / maxR;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    onChange(Number(dx.toFixed(2)), Number(dy.toFixed(2)));
  };

  const intensityBars = Math.round(Math.min(1, Math.hypot(spinX, spinY)) * 10);

  if (variant === 'compact') {
    return (
      <>
        {/* Ultra-Clean Top-Right Glossy Cue Ball Icon ONLY (No "Center" box below!) */}
        <button
          type="button"
          aria-label={t(language, 'spinTitle')}
          data-testid="spin-control"
          disabled={disabled}
          onClick={() => {
            if (!disabled) setModalOpen(true);
          }}
          className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-full border border-white/50 shadow-[0_6px_16px_rgba(0,0,0,0.65)] transition-transform active:scale-95 pointer-events-auto cursor-pointer ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'
          }`}
          style={{
            background:
              'radial-gradient(circle at 30% 26%, #ffffff 0%, #f1f5f9 52%, #cbd5e1 82%, #64748b 100%)',
          }}
        >
          {/* Red English target ring showing current cue ball contact offset */}
          <span
            className="absolute w-3 h-3 rounded-full border-[2.5px] border-red-600 shadow-sm pointer-events-none"
            style={{
              left: `calc(50% + ${spinX * 30}% - 6px)`,
              top: `calc(50% - ${spinY * 30}% - 6px)`,
            }}
          />
        </button>

        {/* Centered Giant 3D Cue Ball Spin Modal (Zero backdrop-blur over live felt!) */}
        {modalOpen && (
          <div
            data-testid="spin-modal-backdrop"
            onClick={() => setModalOpen(false)}
            className="fixed inset-0 z-50 bg-black/58 flex flex-col items-center justify-center p-4 gap-4 select-none"
          >
            {/* Header Strip: Spin Label + 10-Bar Meter + Reset Button */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-[#101218] border border-white/15 shadow-2xl"
            >
              <span className="font-display text-sm sm:text-base font-black text-[#f4f1ea] tracking-wide">
                {t(language, 'spinTitle')}
              </span>
              <div className="flex items-center gap-1" aria-label="Spin Intensity">
                {Array.from({ length: 10 }, (_, idx) => {
                  const active = idx < intensityBars;
                  return (
                    <span
                      key={idx}
                      className={`w-2 h-4 sm:w-2.5 sm:h-5 rounded-[3px] transition-colors ${
                        active
                          ? 'bg-gradient-to-t from-amber-500 to-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
                          : 'bg-white/20'
                      }`}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                aria-label={t(language, 'spinReset')}
                data-testid="spin-reset-btn"
                onClick={() => onChange(0, 0)}
                className="p-1.5 rounded-lg bg-[#1c1f29] hover:bg-[#262a36] border border-white/15 text-zinc-200 hover:text-amber-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Giant 3D Glossy Cue Ball Interactive Target */}
            <div
              ref={padRef}
              role="group"
              aria-label="Cue Ball Spin Selector"
              data-testid="spin-control-pad"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                if (disabled) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateFromPointer(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (disabled || e.buttons === 0) return;
                updateFromPointer(e.clientX, e.clientY);
              }}
              className="relative w-56 h-56 sm:w-72 sm:h-72 rounded-full shadow-[0_30px_70px_rgba(0,0,0,0.85)] cursor-pointer touch-none overflow-hidden"
              style={{
                background:
                  'radial-gradient(circle at 34% 28%, #ffffff 0%, #f8fafc 44%, #e2e8f0 74%, #94a3b8 94%, #64748b 100%)',
              }}
            >
              {/* Realistic Studio Window Specular Highlight */}
              <div
                className="absolute top-[7%] right-[12%] w-[44%] h-[28%] rounded-full pointer-events-none opacity-80"
                style={{
                  background:
                    'linear-gradient(155deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.12) 70%, transparent 100%)',
                  transform: 'rotate(26deg)',
                }}
              />
              {/* Crisp Red English Strike Reticle */}
              <div
                data-testid="spin-contact-dot"
                className="absolute w-8 h-8 sm:w-9 sm:h-9 rounded-full border-[4.5px] border-red-600 shadow-[0_2px_8px_rgba(0,0,0,0.35)] pointer-events-none"
                style={{
                  left: `calc(50% + ${spinX * 36}% - 18px)`,
                  top: `calc(50% - ${spinY * 36}% - 18px)`,
                }}
              />
            </div>

            <button
              type="button"
              data-testid="spin-done-btn"
              onClick={() => setModalOpen(false)}
              className="px-6 py-2 rounded-xl neu-btn-gold text-xs sm:text-sm font-black tracking-wide shadow-xl cursor-pointer"
            >
              {t(language, 'spinDone')}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-center select-none pointer-events-auto gap-1.5">
      <div
        ref={padRef}
        role="group"
        aria-label="Cue Ball Spin Control"
        data-testid="spin-control"
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (disabled || e.buttons === 0) return;
          updateFromPointer(e.clientX, e.clientY);
        }}
        className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-amber-300/60 shadow-xl cursor-pointer touch-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        style={{
          background:
            'radial-gradient(circle at 32% 28%, #ffffff 0%, #e2e8f0 58%, #94a3b8 100%)',
        }}
      >
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-[2.5px] border-red-600 shadow pointer-events-none"
          style={{
            left: `calc(50% + ${spinX * 32}% - 7px)`,
            top: `calc(50% - ${spinY * 32}% - 7px)`,
          }}
        />
      </div>
    </div>
  );
};
