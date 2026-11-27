import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Coins, Star } from 'lucide-react';
import { isValidCustomAvatarDataUrl } from '../game/avatarCrop.ts';
import { AVATAR_ASSETS } from '../game/constants.ts';
import { buildSpinReelItems, type SpinReelCandidate } from '../game/matchmakingSpin.ts';
import { PRO_AI_CHALLENGERS } from '../game/quickMatchAi.ts';
import type { GameVariant, OnlineParticipantMeta } from '../game/types.ts';
import { t, type Language } from '../services/i18n.ts';

interface MatchmakingSpinStageProps {
  title: string;
  subtitle?: string;
  variant: GameVariant;
  potAmount?: number;
  language?: Language;
  phase: 'searching' | 'locking';
  player: {
    uid: string;
    username: string;
    avatar: string;
    customAvatarUrl?: string;
    level: number;
  };
  playerPartner?: OnlineParticipantMeta;
  opponent?: OnlineParticipantMeta | null;
  opponentPartner?: OnlineParticipantMeta;
  onCancel?: () => void;
  cancelTestId?: string;
  cancelLabel?: string;
  compactModal?: boolean;
}

const SquarePortrait: React.FC<{
  avatar: string;
  customAvatarUrl?: string;
  username: string;
}> = ({ avatar, customAvatarUrl = '', username }) => {
  const [imgErr, setImgErr] = useState(false);
  const src =
    customAvatarUrl && isValidCustomAvatarDataUrl(customAvatarUrl)
      ? customAvatarUrl
      : AVATAR_ASSETS[avatar] || AVATAR_ASSETS.avatar_ace;

  useEffect(() => {
    setImgErr(false);
  }, [src]);

  if (!imgErr && src) {
    return (
      <img
        src={src}
        alt={username}
        referrerPolicy="no-referrer"
        onError={() => setImgErr(true)}
        className="w-full h-full object-cover"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#12141c] font-display font-black text-2xl text-amber-300">
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
};

export const MatchmakingSpinStage: React.FC<MatchmakingSpinStageProps> = ({
  title,
  subtitle,
  variant,
  potAmount = 0,
  language = 'en',
  phase,
  player,
  playerPartner,
  opponent,
  opponentPartner,
  onCancel,
  cancelTestId = 'spin-stage-back-btn',
  cancelLabel,
  compactModal = false,
}) => {
  const isId = language === 'id';
  const [reelIndex, setReelIndex] = useState(0);
  const [locked, setLocked] = useState(false);

  const lockItems = useMemo(() => {
    if (!opponent) return [];
    const target: SpinReelCandidate = {
      uid: opponent.uid,
      username: opponent.username,
      avatar: opponent.avatar,
      customAvatarUrl: opponent.customAvatarUrl,
      frame: opponent.frame,
      level: opponent.level,
    };
    return buildSpinReelItems(target, PRO_AI_CHALLENGERS, 16);
  }, [opponent]);

  const searchLoopItems = useMemo(
    () => [...PRO_AI_CHALLENGERS, ...PRO_AI_CHALLENGERS],
    [],
  );

  // Continuous cycling ticker while in searching phase
  useEffect(() => {
    if (phase !== 'searching') return undefined;
    setLocked(false);
    const id = window.setInterval(() => {
      setReelIndex((cur) => (cur + 1) % PRO_AI_CHALLENGERS.length);
    }, 95);
    return () => window.clearInterval(id);
  }, [phase]);

  // Smooth decelerating spin-lock animation when opponent is resolved
  useEffect(() => {
    if (phase !== 'locking' || lockItems.length === 0) return undefined;
    setLocked(false);
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setReelIndex(lockItems.length - 1);
      setLocked(true);
      return undefined;
    }

    setReelIndex(0);
    let rafId = 0;
    const rafStart = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        setReelIndex(lockItems.length - 1);
      });
    });
    const doneTimer = window.setTimeout(() => {
      setLocked(true);
    }, 720);

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(rafStart);
      window.clearTimeout(doneTimer);
    };
  }, [phase, lockItems]);

  const activeItems = phase === 'locking' && lockItems.length > 0 ? lockItems : searchLoopItems;
  const tilePx = compactModal ? 96 : 124;

  const leftName = playerPartner
    ? `${player.username} & ${playerPartner.username}`
    : player.username;
  const rightName =
    phase === 'locking' && opponent
      ? locked
        ? opponentPartner
          ? `${opponent.username} & ${opponentPartner.username}`
          : opponent.username
        : t(language, 'searchingOpponentShort')
      : subtitle || t(language, 'searchingOpponentShort');

  return (
    <div
      data-testid="matchmaking-spin-stage"
      className={`relative flex flex-col justify-between select-none ${
        compactModal ? 'min-h-[270px] py-2' : 'w-full max-w-2xl rounded-3xl liquid-metal-border glass-panel mafia-texture-surface px-6 sm:px-10 py-6 sm:py-8 shadow-2xl'
      }`}
    >
      {/* Top Club / Arena Heading */}
      <div className="text-center space-y-0.5">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-amber-400">
          {variant === '9ball' ? '9 BALL' : '8 BALL'} TOURNAMENT
        </div>
        <h3 className="font-display text-lg sm:text-2xl font-black tracking-wide text-[#f4f1ea]">
          {title}
        </h3>
      </div>

      {/* Center VS Roulette Confrontation Stage */}
      <div className="my-5 sm:my-6 flex items-center justify-center gap-3.5 sm:gap-8">
        {/* Left Player Card */}
        <div className="flex flex-col items-center gap-2.5">
          <div className="relative">
            <div
              className="rounded-2xl overflow-hidden border-[2.5px] border-zinc-400/50 bg-[#0d0f14] shadow-[0_14px_30px_rgba(0,0,0,0.75)]"
              style={{ width: tilePx, height: tilePx }}
            >
              <SquarePortrait
                avatar={player.avatar}
                customAvatarUrl={player.customAvatarUrl}
                username={player.username}
              />
            </div>

            {/* Gold Star Level Badge on Top-Left */}
            <div
              aria-label={`Level ${player.level}`}
              className="absolute -top-2.5 -left-2.5 w-8 h-8 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 border-2 border-[#0a0b0f] shadow-lg flex items-center justify-center"
            >
              <Star className="w-3.5 h-3.5 text-zinc-950 fill-zinc-950 absolute opacity-20" />
              <span className="relative font-mono-tabular font-black text-[11px] text-zinc-950">
                {player.level}
              </span>
            </div>
          </div>

          <div className="px-3 py-1 rounded-lg bg-black/55 border border-white/10 max-w-[144px] sm:max-w-[172px] min-w-[104px]">
            <div className="text-xs sm:text-sm font-extrabold text-[#f4f1ea] truncate text-center">
              {leftName}
            </div>
          </div>
        </div>

        {/* Center VS + Pot Medallion */}
        <div className="flex flex-col items-center justify-center gap-2 shrink-0">
          <div
            className="font-display text-3xl sm:text-5xl font-black italic tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-amber-100 via-amber-400 to-amber-700 drop-shadow-[0_4px_14px_rgba(245,158,11,0.35)]"
          >
            VS
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[#0b0d12] border border-amber-400/35 shadow-inner flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-mono-tabular text-xs font-black text-amber-200">
              {potAmount > 0 ? potAmount.toLocaleString() : variant === '9ball' ? '9B' : '8B'}
            </span>
          </div>
        </div>

        {/* Right Spinning Challenger Slot Reel */}
        <div className="flex flex-col items-center gap-2.5">
          <div className="relative">
            <div
              data-testid="spin-reel-window"
              className={`rounded-2xl overflow-hidden border-[2.5px] bg-[#0d0f14] shadow-[0_14px_30px_rgba(0,0,0,0.75)] transition-colors duration-300 ${
                locked
                  ? 'border-amber-400/80 shadow-[0_0_24px_rgba(245,158,11,0.35)]'
                  : 'border-zinc-400/50'
              }`}
              style={{ width: tilePx, height: tilePx }}
            >
              <div
                className="flex flex-col will-change-transform"
                style={{
                  transform: `translate3d(0, -${reelIndex * tilePx}px, 0)`,
                  transition:
                    phase === 'locking'
                      ? 'transform 700ms cubic-bezier(0.14, 0.88, 0.24, 1)'
                      : 'transform 85ms linear',
                }}
              >
                {activeItems.map((cand, idx) => (
                  <div
                    key={`${cand.uid}-${idx}`}
                    style={{ width: tilePx, height: tilePx }}
                    className="shrink-0 relative"
                  >
                    <SquarePortrait
                      avatar={cand.avatar}
                      customAvatarUrl={cand.customAvatarUrl}
                      username={cand.username}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Gold Star Level Badge on Top-Right once Locked */}
            {phase === 'locking' && locked && opponent && (
              <div
                aria-label={`Opponent Level ${opponent.level}`}
                className="absolute -top-2.5 -right-2.5 w-8 h-8 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 border-2 border-[#0a0b0f] shadow-lg flex items-center justify-center"
              >
                <span className="font-mono-tabular font-black text-[11px] text-zinc-950">
                  {opponent.level}
                </span>
              </div>
            )}
          </div>

          <div className="px-3 py-1 rounded-lg bg-black/55 border border-white/10 max-w-[144px] sm:max-w-[172px] min-w-[110px]">
            <div
              className={`text-xs sm:text-sm font-extrabold truncate text-center ${
                locked ? 'text-amber-300' : 'text-zinc-300'
              }`}
            >
              {rightName}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Bottom-Left Crimson Back Button */}
      <div className="flex items-center justify-between gap-3 pt-1">
        {onCancel ? (
          <button
            type="button"
            data-testid={cancelTestId}
            aria-label={cancelLabel || (isId ? 'Batalkan Pencarian' : 'Cancel Search')}
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl neu-btn-crimson font-extrabold text-xs shadow-lg cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{cancelLabel || (isId ? 'Batal' : 'Back')}</span>
          </button>
        ) : (
          <span />
        )}

        <div className="text-[11px] font-bold tracking-wide text-[#a69a87]">
          {phase === 'locking' && locked
            ? t(language, 'opponentLocked')
            : isId
              ? 'Menyiapkan Meja...'
              : 'Preparing Table...'}
        </div>
      </div>
    </div>
  );
};
