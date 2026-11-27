import React from 'react';
import { Check, Clock, Coins, Home, RotateCcw, Trophy, UserPlus, X } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import type { PlayerSlot } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { t, type Language } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';

export interface MatchResultSummary {
  isPractice: boolean;
  isLocalPassPlay?: boolean;
  isRanked?: boolean;
  rankDelta?: number;
  newRankPoints?: number;
  matchFormat?: '1v1' | '2v2';
  winnerSlot: PlayerSlot;
  yourSlot: PlayerSlot;
  winReason: string;
  durationSec: number;
  playerA: {
    uid: string;
    username: string;
    avatar: string;
    customAvatarUrl?: string;
    frame: string;
    shots: number;
    potted: number;
  };
  playerB: {
    uid: string;
    username: string;
    avatar: string;
    customAvatarUrl?: string;
    frame: string;
    shots: number;
    potted: number;
  };
  playerA2?: { uid: string; username: string; avatar: string; customAvatarUrl?: string; frame: string };
  playerB2?: { uid: string; username: string; avatar: string; customAvatarUrl?: string; frame: string };
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  rematchRequestedByOpponent: boolean;
  rematchRequestedByYou: boolean;
  rematchStatus?: 'idle' | 'requested' | 'incoming' | 'accepted' | 'declined' | 'expired';
}

interface MatchResultModalProps {
  result: MatchResultSummary;
  language?: Language;
  onRematch: () => void;
  onFindRankedMatch?: () => void;
  onAcceptRematch?: () => void;
  onDeclineRematch?: () => void;
  onBackHome: () => void;
  onInviteFriend?: () => void;
}

export const MatchResultModal: React.FC<MatchResultModalProps> = ({
  result,
  language = 'en',
  onRematch,
  onFindRankedMatch,
  onAcceptRematch,
  onDeclineRematch,
  onBackHome,
  onInviteFriend,
}) => {
  const youWon = result.winnerSlot === result.yourSlot;
  const showCongrats = youWon || Boolean(result.isLocalPassPlay);
  const is2v2 = result.matchFormat === '2v2' || Boolean(result.playerA2 || result.playerB2);
  const isId = language === 'id';

  const safePlayerA = result.playerA || {
    uid: 'a',
    username: 'Player A',
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    shots: 0,
    potted: 0,
  };
  const safePlayerB = result.playerB || {
    uid: 'b',
    username: 'Player B',
    avatar: 'avatar_royale',
    frame: 'frame_bronze',
    shots: 0,
    potted: 0,
  };

  const winnerName =
    result.winnerSlot === 'A'
      ? result.playerA2
        ? `${safePlayerA.username} & ${result.playerA2.username}`
        : safePlayerA.username
      : result.playerB2
        ? `${safePlayerB.username} & ${result.playerB2.username}`
        : safePlayerB.username;

  const isIncomingRematch =
    !result.isPractice &&
    (result.rematchStatus === 'incoming' || (result.rematchRequestedByOpponent && !result.rematchRequestedByYou));
  const isWaitingRematch =
    !result.isPractice && (result.rematchStatus === 'requested' || result.rematchRequestedByYou);

  const rankDelta = result.rankDelta ?? 0;
  const safeCoinsEarned = Number.isFinite(result.coinsEarned) ? result.coinsEarned : 0;
  const safeDurationSec = Number.isFinite(result.durationSec) ? Math.max(0, result.durationSec) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/82 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        data-testid="match-result-modal"
        aria-label={t(language, 'matchComplete')}
        className="w-full max-w-lg liquid-metal-border glass-panel mafia-texture-surface rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 text-[#f4f1ea]"
      >
        <div className="text-center space-y-1.5">
          <div
            className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl neu-inset border mb-1 ${
              showCongrats ? 'border-amber-400/40 text-amber-300' : 'border-white/15 text-zinc-300'
            }`}
          >
            <Trophy className="w-6 h-6" />
          </div>
          <div
            data-testid="match-result-heading"
            className={`text-xs font-extrabold uppercase tracking-wider ${
              showCongrats ? 'text-amber-300' : 'text-zinc-400'
            }`}
          >
            {showCongrats ? t(language, 'congratulations') : t(language, 'matchComplete')}
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-[#f4f1ea]">
            {winnerName} {isId ? 'Menang' : 'Wins'}
          </h2>
          <p className="text-xs sm:text-sm font-medium text-[#a69a87]">
            {youWon ? t(language, 'youWon') : result.winReason || t(language, 'youLost')}
          </p>
        </div>

        {/* Ranked RP summary when finishing an online Ranked match */}
        {result.isRanked && typeof result.newRankPoints === 'number' && (
          <div className="p-3 rounded-2xl neu-inset border border-amber-400/35 flex items-center justify-between gap-3">
            <RankBadge rankPoints={result.newRankPoints} size="md" showPoints language={language} />
            <div className="text-right font-mono-tabular">
              <div className="text-[10px] uppercase tracking-wider text-[#a69a87] font-bold">
                {t(language, 'rankDeltaLabel')}
              </div>
              <div
                className={`text-sm font-black ${
                  rankDelta >= 0 ? 'text-amber-300' : 'text-red-400'
                }`}
              >
                {rankDelta >= 0 ? `+${rankDelta}` : `${rankDelta}`} RP
              </div>
            </div>
          </div>
        )}

        {/* Players / Teams Comparison */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { slot: 'A' as const, data: safePlayerA, partner: result.playerA2, teamName: t(language, 'teamAlpha') },
            { slot: 'B' as const, data: safePlayerB, partner: result.playerB2, teamName: t(language, 'teamBravo') },
          ].map(({ slot, data, partner, teamName }) => {
            const isWin = result.winnerSlot === slot;
            return (
              <div
                key={slot}
                className={`p-3.5 rounded-2xl border text-center space-y-2 ${
                  isWin
                    ? 'neu-surface border-amber-400/55 shadow-sm'
                    : 'neu-inset border-white/10'
                }`}
              >
                <div className={`text-[10px] font-extrabold uppercase tracking-wider ${isWin ? 'text-amber-300' : 'text-[#a69a87]'}`}>
                  {is2v2
                    ? `${teamName} · ${isWin ? (isId ? 'Juara' : 'Winners') : isId ? 'Penantang' : 'Challengers'}`
                    : isWin
                      ? isId
                        ? 'Pemenang'
                        : 'Winner'
                      : isId
                        ? 'Penantang'
                        : 'Challenger'}
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <PlayerAvatar
                    avatarId={data.avatar}
                    customAvatarUrl={data.customAvatarUrl}
                    frameId={data.frame}
                    username={data.username}
                    size="md"
                  />
                  {partner && (
                    <PlayerAvatar
                      avatarId={partner.avatar}
                      customAvatarUrl={partner.customAvatarUrl}
                      frameId={partner.frame}
                      username={partner.username}
                      size="md"
                    />
                  )}
                </div>
                <div className="text-sm font-bold text-[#f4f1ea] truncate">
                  {partner ? `${data.username} & ${partner.username}` : data.username}
                </div>
                <div className="text-[11px] font-mono-tabular text-[#a69a87]">
                  {isId ? `Masuk ${data.potted} · Sodok ${data.shots}` : `Potted ${data.potted} · Shots ${data.shots}`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rewards & Duration */}
        <div className="grid grid-cols-2 gap-2.5 text-center">
          <div className="p-3 rounded-xl neu-inset">
            <div className="text-[11px] text-[#a69a87] font-semibold flex items-center justify-center gap-1">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{isId ? 'Hadiah Koin' : 'Coins Earned'}</span>
            </div>
            <div className="font-mono-tabular text-base font-extrabold text-amber-300 mt-0.5">
              +{safeCoinsEarned.toLocaleString()}
            </div>
          </div>
          <div className="p-3 rounded-xl neu-inset">
            <div className="text-[11px] text-[#a69a87] font-semibold flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5 text-zinc-300" />
              <span>{isId ? 'Durasi' : 'Duration'}</span>
            </div>
            <div className="font-mono-tabular text-base font-extrabold text-[#f4f1ea] mt-0.5">
              {Math.floor(safeDurationSec / 60)}:{String(safeDurationSec % 60).padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Mutual Rematch Status Prompts */}
        {isIncomingRematch && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-400/35 space-y-2 text-center">
            <div className="text-xs font-bold text-amber-200">{t(language, 'rematchIncoming')}</div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                data-testid="accept-rematch-btn"
                onClick={() => {
                  audioEngine.playClick();
                  (onAcceptRematch || onRematch)();
                }}
                className="px-3.5 py-1.5 rounded-lg neu-btn-blue text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t(language, 'rematchAccept')}</span>
              </button>
              {onDeclineRematch && (
                <button
                  type="button"
                  data-testid="decline-rematch-btn"
                  onClick={() => {
                    audioEngine.playClick();
                    onDeclineRematch();
                  }}
                  className="px-3.5 py-1.5 rounded-lg neu-inset text-zinc-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t(language, 'rematchDecline')}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {result.rematchStatus === 'declined' && (
          <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-500/35 text-center text-xs text-red-200 font-semibold">
            {t(language, 'rematchDeclined')}
          </div>
        )}

        {result.rematchStatus === 'expired' && (
          <div className="p-2.5 rounded-xl neu-inset text-center text-xs text-zinc-300 font-semibold">
            {t(language, 'rematchExpired')}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <div className="flex-1 min-w-[160px]">
            {result.isRanked && onFindRankedMatch ? (
              <LiquidMetalButton
                fullWidth
                height={44}
                testId="play-again-ranked-btn"
                icon={<Trophy className="w-4 h-4 text-amber-300" />}
                label={t(language, 'playAgainRanked')}
                onClick={() => {
                  audioEngine.playClick();
                  onFindRankedMatch();
                }}
              />
            ) : (
              <LiquidMetalButton
                fullWidth
                height={44}
                testId="rematch-btn"
                disabled={isWaitingRematch || result.rematchStatus === 'declined' || result.rematchStatus === 'expired'}
                icon={<RotateCcw className="w-4 h-4 text-amber-300" />}
                label={isWaitingRematch ? t(language, 'rematchWaiting') : t(language, 'rematch')}
                onClick={() => {
                  audioEngine.playClick();
                  onRematch();
                }}
              />
            )}
          </div>

          {!result.isPractice && onInviteFriend && (
            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onInviteFriend();
              }}
              className="py-2.5 px-4 rounded-xl neu-btn-blue font-semibold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>{t(language, 'inviteFriend')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onBackHome();
            }}
            data-testid="back-home-btn"
            className="py-2.5 px-4 rounded-xl neu-inset hover:bg-[#191c25] text-[#f4f1ea] font-bold text-sm flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Home className="w-4 h-4" />
            <span>{t(language, 'exit')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
