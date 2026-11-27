import React from 'react';
import { getRankFromPoints, RANK_STEPS } from '../game/rank.ts';
import type { RankTier } from '../game/types.ts';
import { t, type Language } from '../services/i18n.ts';

interface RankBadgeProps {
  rankPoints?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showPoints?: boolean;
  showProgress?: boolean;
  language?: Language;
  className?: string;
}

export const TIER_VISUALS: Record<
  RankTier,
  {
    primary: string;
    secondary: string;
    trim: string;
    pillBg: string;
    pillBorder: string;
    pillText: string;
    barFill: string;
  }
> = {
  Silver: {
    primary: '#94a3b8',
    secondary: '#475569',
    trim: '#f1f5f9',
    pillBg: 'bg-zinc-900/90',
    pillBorder: 'border-zinc-400/40',
    pillText: 'text-zinc-200',
    barFill: 'bg-zinc-400',
  },
  Gold: {
    primary: '#f59e0b',
    secondary: '#b45309',
    trim: '#fef08a',
    pillBg: 'bg-amber-950/55',
    pillBorder: 'border-amber-400/45',
    pillText: 'text-amber-200',
    barFill: 'bg-amber-400',
  },
  Platinum: {
    primary: '#38bdf8',
    secondary: '#0369a1',
    trim: '#e0f2fe',
    pillBg: 'bg-sky-950/55',
    pillBorder: 'border-sky-400/45',
    pillText: 'text-sky-200',
    barFill: 'bg-sky-400',
  },
  Diamond: {
    primary: '#60a5fa',
    secondary: '#1d4ed8',
    trim: '#e0f2fe',
    pillBg: 'bg-blue-950/60',
    pillBorder: 'border-blue-400/45',
    pillText: 'text-blue-200',
    barFill: 'bg-blue-400',
  },
  Master: {
    primary: '#ef4444',
    secondary: '#7f1d1d',
    trim: '#fde047',
    pillBg: 'bg-red-950/60',
    pillBorder: 'border-red-500/45',
    pillText: 'text-red-200',
    barFill: 'bg-gradient-to-r from-red-500 to-amber-400',
  },
  Grandmaster: {
    primary: '#fbbf24',
    secondary: '#991b1b',
    trim: '#fffbeb',
    pillBg: 'bg-gradient-to-r from-red-950/80 via-amber-950/75 to-red-950/80',
    pillBorder: 'border-amber-300/60',
    pillText: 'text-amber-200',
    barFill: 'bg-gradient-to-r from-amber-300 via-yellow-200 to-red-500',
  },
};

export const RankShieldIcon: React.FC<{ tier: RankTier; className?: string }> = ({ tier, className = 'w-4 h-4' }) => {
  const vis = TIER_VISUALS[tier];
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} shrink-0`} aria-hidden="true">
      <path
        d="M12 2L20 5.5V11.8C20 16.6 16.6 20.6 12 22C7.4 20.6 4 16.6 4 11.8V5.5L12 2Z"
        fill={vis.primary}
        stroke={vis.secondary}
        strokeWidth="1.6"
      />
      <path
        d="M12 4.3L17.8 6.9V11.6C17.8 15.2 15.3 18.3 12 19.5C8.7 18.3 6.2 15.2 6.2 11.6V6.9L12 4.3Z"
        fill={vis.secondary}
        opacity="0.28"
      />
      {tier === 'Grandmaster' ? (
        <>
          <path
            d="M6.8 15.2L8.2 8.8L10.8 11.2L12 7.2L13.2 11.2L15.8 8.8L17.2 15.2H6.8Z"
            fill={vis.trim}
          />
          <circle cx="12" cy="13.1" r="1.2" fill={vis.secondary} />
        </>
      ) : tier === 'Master' ? (
        <path
          d="M7.5 14.5L8.6 9.2L11.2 11.4L12 8.2L12.8 11.4L15.4 9.2L16.5 14.5H7.5Z"
          fill={vis.trim}
        />
      ) : tier === 'Diamond' ? (
        <path d="M12 7L16.2 11.5L12 16.8L7.8 11.5L12 7Z" fill={vis.trim} />
      ) : (
        <path
          d="M12 7.2L13.4 10.2L16.6 10.6L14.2 12.8L14.8 16L12 14.4L9.2 16L9.8 12.8L7.4 10.6L10.6 10.2L12 7.2Z"
          fill={vis.trim}
        />
      )}
    </svg>
  );
};

export const RankBadge: React.FC<RankBadgeProps> = ({
  rankPoints = 0,
  size = 'sm',
  showPoints = false,
  showProgress = false,
  language = 'en',
  className = '',
}) => {
  const rank = getRankFromPoints(rankPoints);
  const nextStep = !rank.isMaxRank ? RANK_STEPS[rank.index + 1] : undefined;
  const vis = TIER_VISUALS[rank.tier];

  if (showProgress) {
    return (
      <div className={`rounded-2xl border ${vis.pillBorder} ${vis.pillBg} p-3 space-y-2 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <RankShieldIcon tier={rank.tier} className={size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'} />
            <div className="min-w-0">
              <div className={`font-display font-black leading-tight ${vis.pillText} ${size === 'lg' ? 'text-base' : 'text-sm'}`}>
                {rank.label}
              </div>
              <div className="text-[11px] font-mono-tabular text-zinc-400">
                {rank.points.toLocaleString()} RP
              </div>
            </div>
          </div>
          {nextStep ? (
            <div className="text-right shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {nextStep.label}
              </div>
              <div className="text-[11px] font-mono-tabular font-semibold text-amber-300">
                {rank.pointsToNext} {t(language, 'pointsToNextRank')}
              </div>
            </div>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-200 bg-red-950/60 border border-red-400/35 px-2 py-0.5 rounded-lg">
              {t(language, 'maxDivisionReached')}
            </span>
          )}
        </div>
        <div className="w-full h-2 rounded-full bg-[#090a0d] border border-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${vis.barFill}`}
            style={{ width: `${rank.progressPct}%` }}
          />
        </div>
      </div>
    );
  }

  const sizeClasses =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[10px] gap-1 rounded-md'
      : size === 'md'
        ? 'px-2.5 py-1 text-xs gap-1.5 rounded-xl'
        : size === 'lg'
          ? 'px-3 py-1.5 text-sm gap-2 rounded-xl'
          : 'px-2 py-0.5 text-[11px] gap-1 rounded-lg';

  const iconSize = size === 'xs' ? 'w-3 h-3' : size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5';

  return (
    <span
      className={`inline-flex items-center font-bold border ${vis.pillBg} ${vis.pillBorder} ${vis.pillText} ${sizeClasses} ${className}`}
    >
      <RankShieldIcon tier={rank.tier} className={iconSize} />
      <span className="whitespace-nowrap">{rank.label}</span>
      {showPoints && (
        <span className="font-mono-tabular opacity-80 whitespace-nowrap">
          {rank.points.toLocaleString()} RP
        </span>
      )}
    </span>
  );
};
