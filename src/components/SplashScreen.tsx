import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: (networkOk: boolean) => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(25);
  const [statusText, setStatusText] = useState('Checking network connection...');

  useEffect(() => {
    let cancelled = false;

    const runChecks = async () => {
      setProgress(52);
      setStatusText('Verifying ZENN BILLIARD club...');

      let ok = navigator.onLine;
      const controller = new AbortController();
      const abortTimer = window.setTimeout(() => controller.abort(), 450);
      try {
        const res = await fetch('/api/health', { signal: controller.signal });
        if (res.ok) ok = true;
      } catch {
        // Offline or static runtime
      } finally {
        window.clearTimeout(abortTimer);
      }

      if (cancelled) return;
      setProgress(100);
      setStatusText('Ready for break');

      window.setTimeout(() => {
        if (!cancelled) onComplete(ok);
      }, 120);
    };

    void runChecks();
    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <div className="min-h-screen bg-[#06070a] text-zinc-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 mafia-lattice opacity-35" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 34%, rgba(245, 158, 11, 0.12) 0%, rgba(28, 20, 14, 0.65) 42%, #06070a 84%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center max-w-md w-full text-center space-y-6">
        <div className="animate-subtle-float">
          <svg viewBox="0 0 140 140" className="w-28 h-28 drop-shadow-[0_14px_28px_rgba(0,0,0,0.75)]" aria-hidden="true">
            <defs>
              <radialGradient id="zennMatteSphere" cx="35%" cy="30%" r="72%">
                <stop offset="0%" stopColor="#3f3f46" />
                <stop offset="52%" stopColor="#18181b" />
                <stop offset="100%" stopColor="#09090b" />
              </radialGradient>
              <linearGradient id="zennLiquidTrim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f4f4f5" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#a1a1aa" />
              </linearGradient>
            </defs>
            <line x1="16" y1="124" x2="124" y2="16" stroke="url(#zennLiquidTrim)" strokeWidth="6" strokeLinecap="round" />
            <line x1="16" y1="16" x2="124" y2="124" stroke="#52525b" strokeWidth="6" strokeLinecap="round" />
            <circle cx="70" cy="70" r="46" fill="url(#zennMatteSphere)" stroke="#d4d4d8" strokeWidth="3.5" />
            <circle cx="70" cy="70" r="40" fill="none" stroke="#f59e0b" strokeWidth="2" />
            <circle cx="70" cy="70" r="26" fill="#111318" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
            <path
              d="M57 57 H83 L59 83 H84"
              fill="none"
              stroke="#f4f4f5"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-wider bg-gradient-to-b from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            ZENN BILLIARD
          </h1>
          <p className="text-xs sm:text-sm uppercase tracking-[0.22em] text-amber-400 font-bold">
            Precision 8 Ball &amp; 9 Ball Club
          </p>
        </div>

        <div className="w-full space-y-2 pt-2">
          <div className="w-full h-3 rounded-full bg-[#12141a] border border-white/15 overflow-hidden shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-zinc-400 via-amber-400 to-zinc-200 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400 font-mono-tabular">
            <span>{statusText}</span>
            <span className="text-amber-400 font-bold">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
