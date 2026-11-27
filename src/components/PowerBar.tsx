import React, { useRef, useState } from 'react';
import { audioEngine } from '../services/audio.ts';

interface PowerBarProps {
  disabled: boolean;
  power: number; // 0..1
  onPowerChange: (power: number) => void;
  onShoot: (power: number) => void;
}

export const PowerBar: React.FC<PowerBarProps> = ({
  disabled,
  power,
  onPowerChange,
  onShoot,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const lastQuarterRef = useRef(0);

  const computePull = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const height = track.getBoundingClientRect().height || 180;
    const delta = Math.max(0, clientY - startYRef.current);
    return Math.max(0, Math.min(1, delta / (height * 0.72)));
  };

  const maybePlayQuarterTick = (nextPower: number) => {
    const quarter = Math.floor(nextPower * 4);
    if (quarter !== lastQuarterRef.current) {
      lastQuarterRef.current = quarter;
      audioEngine.playAimTick();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    audioEngine.unlock();
    e.currentTarget.setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    lastQuarterRef.current = 0;
    setDragging(true);
    onPowerChange(0.05);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    const nextPower = computePull(e.clientY);
    maybePlayQuarterTick(nextPower);
    onPowerChange(nextPower);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const finalPower = computePull(e.clientY);
    onPowerChange(0);
    if (!disabled && finalPower >= 0.04) {
      onShoot(finalPower);
    }
  };

  const pct = Math.round(power * 100);
  const isCancelZone = dragging && power < 0.04;
  const isMaxBreak = pct >= 90;

  return (
    <div className="flex flex-col items-center gap-2 select-none touch-none pointer-events-auto">
      <div
        className={`text-[11px] sm:text-xs font-mono-tabular font-extrabold px-2.5 py-0.5 rounded-lg border transition-colors min-w-[48px] text-center shadow-md ${
          isCancelZone
            ? 'bg-red-950/90 border-red-400/75 text-red-200'
            : isMaxBreak
              ? 'bg-red-950/90 border-red-400 text-amber-200'
              : 'bg-[#12141c]/95 border-amber-300/25 text-amber-300'
        }`}
      >
        {isCancelZone ? 'ABORT' : isMaxBreak ? 'MAX' : `${pct}%`}
      </div>

      {/* Lengthened Brushed Metallic Grooved Cue-Stick Housing */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Shot Power"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={disabled ? -1 : 0}
        data-testid="power-bar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onShoot(power > 0.05 ? power : 0.65);
            onPowerChange(0);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onPowerChange(Math.min(1, power + 0.08));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onPowerChange(Math.max(0, power - 0.08));
          }
        }}
        className={`relative w-11 sm:w-12 h-44 sm:h-[380px] lg:h-[460px] max-h-[62dvh] rounded-2xl border-[1.5px] overflow-hidden transition-colors cursor-grab active:cursor-grabbing shadow-[inset_0_4px_14px_rgba(0,0,0,0.85),0_14px_32px_rgba(0,0,0,0.78)] flex justify-center ${
          disabled
            ? 'bg-[#0d0f15] border-white/10 opacity-45 cursor-not-allowed'
            : isCancelZone
              ? 'bg-gradient-to-b from-red-950/85 to-[#08090c] border-red-400/75'
              : 'bg-gradient-to-r from-[#282b37] via-[#12141c] to-[#282b37] border-amber-200/25'
        }`}
      >
        {/* Subtle Precision Gauge Ticks along sides */}
        <div className="pointer-events-none absolute inset-y-4 left-1.5 flex flex-col justify-between z-10">
          {[0, 25, 50, 75, 100].map((mark) => (
            <span
              key={mark}
              className={`h-px transition-colors ${
                pct >= mark ? 'w-2 bg-amber-300/80' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-4 right-1.5 flex flex-col justify-between z-10">
          {[0, 25, 50, 75, 100].map((mark) => (
            <span
              key={mark}
              className={`h-px transition-colors ${
                pct >= mark ? 'w-2 bg-amber-300/80' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Inner Recessed Groove + Power Glow */}
        <div className="relative my-2.5 w-6 sm:w-7 h-[calc(100%-20px)] rounded-lg bg-[#06070a] shadow-inner overflow-hidden flex justify-center border border-white/10">
          <div
            className="absolute inset-x-0 top-0 pointer-events-none"
            style={{
              height: `${pct}%`,
              background: isCancelZone
                ? 'rgba(239, 68, 68, 0.45)'
                : pct > 78
                  ? 'linear-gradient(to bottom, rgba(250,204,21,0.38), rgba(239,68,68,0.62))'
                  : 'linear-gradient(to bottom, rgba(232,199,130,0.25), rgba(245,158,11,0.46))',
            }}
          />

          {/* Vertical Maple & Walnut Cue Stick sliding downward on pull */}
          <div
            className="relative w-3 sm:w-3.5 h-full flex flex-col items-center pointer-events-none"
            style={{
              transform: `translate3d(0, ${Math.round(power * 62)}%, 0)`,
            }}
          >
            {/* Blue Chalk Tip */}
            <div className="w-2 sm:w-2.5 h-2 rounded-t-sm bg-sky-400 shrink-0" />
            {/* Ivory Ferrule */}
            <div className="w-2 sm:w-2.5 h-2.5 bg-zinc-100 shrink-0" />
            {/* Seasoned Maple Shaft */}
            <div
              className="w-2 sm:w-2.5 flex-1"
              style={{
                background: 'linear-gradient(to right, #c2935b, #f3d7ad, #a16f39)',
              }}
            />
            {/* Brass Joint Collar */}
            <div className="w-2.5 sm:w-3 h-2 bg-gradient-to-r from-amber-700 via-amber-300 to-amber-700 shrink-0" />
            {/* Walnut & Linen Butt */}
            <div
              className="w-3 sm:w-3.5 h-[42%] rounded-b-sm"
              style={{
                background: 'linear-gradient(to right, #3a1d10, #7c3f23, #2b1409)',
              }}
            />
            {/* Black Rubber Bumper */}
            <div className="w-3 sm:w-3.5 h-2.5 rounded-b bg-zinc-950 border-t border-white/15 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
};
