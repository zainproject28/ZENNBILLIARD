import React, { useEffect } from 'react';
import { Award, Crown, X } from 'lucide-react';
import { getRankFromPoints, RANK_TIER_GROUPS } from '../game/rank.ts';
import { t, type Language } from '../services/i18n.ts';
import { RankBadge, RankShieldIcon, TIER_VISUALS } from './RankBadge.tsx';

interface RankTiersModalProps {
  language: Language;
  rankPoints: number;
  highestRankPoints: number;
  onClose: () => void;
}

export const RankTiersModal: React.FC<RankTiersModalProps> = ({
  language,
  rankPoints,
  highestRankPoints,
  onClose,
}) => {
  const current = getRankFromPoints(rankPoints);
  const peak = getRankFromPoints(Math.max(rankPoints, highestRankPoints));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-2xl max-h-[90vh] rounded-3xl liquid-metal-border glass-panel flex flex-col overflow-hidden">
        {/* Sticky Clean Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl neu-surface flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-display font-black tracking-tight text-zinc-100 truncate">
                {t(language, 'rankTiersTitle')}
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                {t(language, 'rankTiersSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Rank Tiers"
            className="w-9 h-9 rounded-full neu-surface flex items-center justify-center text-zinc-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          {/* Active Player Rank Progress + Peak Rank */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
            <div className="sm:col-span-2">
              <RankBadge rankPoints={rankPoints} size="lg" showProgress language={language} className="h-full" />
            </div>
            <div className="rounded-2xl neu-inset p-3.5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <span>{t(language, 'highestRank')}</span>
                <Crown className="w-3.5 h-3.5 text-amber-300" />
              </div>
              <RankBadge rankPoints={peak.points} size="md" showPoints language={language} />
            </div>
          </div>

          {/* Complete Ordered 6-Tier Ladder (Silver I -> Grandmaster MAX) */}
          <div className="space-y-3">
            {RANK_TIER_GROUPS.map((group) => {
              const vis = TIER_VISUALS[group.tier];
              const isCurrentTier = current.tier === group.tier;
              const isGrandmaster = group.tier === 'Grandmaster';

              return (
                <div
                  key={group.tier}
                  className={`rounded-2xl border p-3.5 sm:p-4 transition-colors ${
                    isCurrentTier
                      ? `${vis.pillBg} ${vis.pillBorder}`
                      : isGrandmaster
                        ? 'bg-gradient-to-r from-red-950/35 via-[#171216] to-amber-950/30 border-amber-400/30'
                        : 'bg-[#101218]/90 border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <RankShieldIcon tier={group.tier} className="w-6 h-6" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm sm:text-base font-display font-black ${vis.pillText}`}>
                            {group.tier}
                          </span>
                          {isCurrentTier && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-400 text-black">
                              {t(language, 'currentTierLabel')}
                            </span>
                          )}
                          {isGrandmaster && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-600/80 text-amber-100 border border-amber-300/40">
                              {t(language, 'maxTierLabel')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-zinc-400 shrink-0">
                      {group.maxPoints !== null
                        ? `${group.minPoints.toLocaleString()} – ${group.maxPoints.toLocaleString()} RP`
                        : `${group.minPoints.toLocaleString()}+ RP`}
                    </span>
                  </div>

                  {/* Ordered Divisions */}
                  <div className="flex flex-wrap gap-1.5">
                    {group.steps.map((step) => {
                      const active = current.index === step.index;
                      const unlocked = rankPoints >= step.minPoints;
                      return (
                        <div
                          key={step.label}
                          className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 transition-all ${
                            active
                              ? 'bg-amber-400 text-[#090a0d] border-amber-200 font-black shadow-[0_0_14px_rgba(251,191,36,0.35)]'
                              : unlocked
                                ? 'bg-white/10 text-zinc-100 border-white/20 font-semibold'
                                : 'bg-black/35 text-zinc-500 border-white/5 font-medium'
                          }`}
                        >
                          <span className="whitespace-nowrap">{step.label}</span>
                          <span className={`text-[10px] font-mono-tabular ${active ? 'text-[#090a0d]/80' : 'text-zinc-500'}`}>
                            {step.minPoints.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
