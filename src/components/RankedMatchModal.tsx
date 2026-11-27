import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Loader2, Shield, Trophy, WifiOff, X } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { getRankFromPoints } from '../game/rank.ts';
import type { AiDifficulty, GameVariant, OnlineParticipantMeta, UserProfile } from '../game/types.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { t, type Language } from '../services/i18n.ts';
import { MatchmakingSpinStage } from './MatchmakingSpinStage.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';

export interface ServerStartedMatchPayload {
  matchId: string;
  roomId: string | null;
  gameMode: 'quick_match' | 'private_room' | 'online_ranked';
  matchFormat: '1v1' | '2v2';
  entryFee: number;
  yourSlot: 'A' | 'B';
  yourSeatIndex: number;
  reconnectToken: string;
  seq: number;
  simulating: boolean;
  balls: unknown[];
  rules: unknown;
  turnDeadlineAt: number | null;
  serverNow: number;
  playerA: OnlineParticipantMeta;
  playerB: OnlineParticipantMeta;
  playerA2?: OnlineParticipantMeta;
  playerB2?: OnlineParticipantMeta;
}

interface RankedMatchModalProps {
  token: string;
  profile: UserProfile;
  language?: Language;
  onStartServerMatch: (matchPayload: ServerStartedMatchPayload) => void;
  onOpenRankTiers?: () => void;
  onClose: () => void;
}

interface BotNoticeProfile {
  username: string;
  avatar: string;
  frame: string;
  difficulty: AiDifficulty;
  tier: string;
  rankPoints: number;
  isBot: true;
}

export const RankedMatchModal: React.FC<RankedMatchModalProps> = ({
  token,
  profile,
  language = 'en',
  onStartServerMatch,
  onOpenRankTiers,
  onClose,
}) => {
  const isId = language === 'id';
  const [variant, setVariant] = useState<GameVariant>('8ball');
  const [phase, setPhase] = useState<'setup' | 'searching' | 'bot_notice' | 'unavailable'>('setup');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [botProfile, setBotProfile] = useState<BotNoticeProfile | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startingBot, setStartingBot] = useState(false);

  const pollTimerRef = useRef<number | null>(null);
  const clockTimerRef = useRef<number | null>(null);

  const currentRank = getRankFromPoints(profile.rankPoints ?? 0);
  const highestRank = getRankFromPoints(Math.max(profile.highestRankPoints ?? 0, profile.rankPoints ?? 0));

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (clockTimerRef.current) {
      window.clearInterval(clockTimerRef.current);
      clockTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const difficultyLabel = (diff: AiDifficulty) => {
    if (diff === 'club') return t(language, 'aiClub');
    if (diff === 'semipro') return t(language, 'aiSemiPro');
    return t(language, 'aiPro');
  };

  const handleJoinQueue = async () => {
    audioEngine.playClick();
    setErrorMsg(null);
    setElapsedSec(0);
    setPhase('searching');

    const res = await safeFetchJson<{
      status?: 'searching' | 'matched';
      match?: ServerStartedMatchPayload;
      error?: string;
    }>('/api/ranked/queue/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gameVariant: variant }),
    });

    if (!res.isBackendAvailable || res.status >= 500) {
      setPhase('unavailable');
      return;
    }

    if (!res.ok) {
      setPhase('setup');
      setErrorMsg(res.data?.error || t(language, 'rankedOfflineBody'));
      return;
    }

    if (res.data?.status === 'matched' && res.data.match) {
      stopPolling();
      audioEngine.playNotification();
      onStartServerMatch(res.data.match);
      return;
    }

    const startedAt = Date.now();
    clockTimerRef.current = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);

    pollTimerRef.current = window.setInterval(async () => {
      const statusRes = await safeFetchJson<{
        status?: 'idle' | 'searching' | 'matched' | 'bot_fallback';
        match?: ServerStartedMatchPayload;
        botProfile?: BotNoticeProfile;
      }>('/api/ranked/queue/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!statusRes.isBackendAvailable) {
        stopPolling();
        setPhase('unavailable');
        return;
      }

      if (statusRes.ok && statusRes.data?.status === 'matched' && statusRes.data.match) {
        stopPolling();
        audioEngine.playNotification();
        onStartServerMatch(statusRes.data.match);
        return;
      }

      if (statusRes.ok && statusRes.data?.status === 'bot_fallback' && statusRes.data.botProfile) {
        stopPolling();
        audioEngine.playNotification();
        setBotProfile(statusRes.data.botProfile);
        setPhase('bot_notice');
      }
    }, 950);
  };

  const handleStartBotMatch = async () => {
    audioEngine.playClick();
    setStartingBot(true);
    setErrorMsg(null);

    const res = await safeFetchJson<{
      match?: ServerStartedMatchPayload;
      error?: string;
    }>('/api/ranked/queue/start-bot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gameVariant: variant }),
    });

    setStartingBot(false);

    if (!res.isBackendAvailable) {
      setPhase('unavailable');
      return;
    }

    if (!res.ok || !res.data?.match) {
      setErrorMsg(res.data?.error || t(language, 'roomServerError'));
      return;
    }

    onStartServerMatch(res.data.match);
  };

  const handleCancelAndClose = async () => {
    audioEngine.playClick();
    stopPolling();
    if (phase === 'searching' || phase === 'bot_notice') {
      void safeFetchJson('/api/ranked/queue/leave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'rankedMatchTitle')}
        className="w-full max-w-md max-h-[90vh] liquid-metal-border glass-panel mafia-texture-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#f4f1ea]"
      >
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-700 to-amber-500 text-white flex items-center justify-center shadow-sm">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg sm:text-xl font-black text-zinc-50">
                {t(language, 'rankedMatchTitle')}
              </h2>
              <p className="text-[11px] text-zinc-400">{t(language, 'rankedSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup' : 'Close Ranked Matchmaking'}
            onClick={handleCancelAndClose}
            className="w-9 h-9 rounded-full bg-[#161820] hover:bg-[#1f222c] border border-white/12 flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/35 text-xs text-red-200 font-semibold">
            {errorMsg}
          </div>
        )}

        {phase === 'setup' && (
          <div className="space-y-4">
            <RankBadge rankPoints={profile.rankPoints ?? 0} size="lg" showProgress language={language} />

            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#161820] border border-white/10 text-xs gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-zinc-400">{t(language, 'highestRank')}</span>
                <RankBadge rankPoints={highestRank.points} size="xs" language={language} />
              </div>
              {onOpenRankTiers && (
                <button
                  type="button"
                  data-testid="ranked-view-tiers-btn"
                  onClick={() => {
                    audioEngine.playClick();
                    onOpenRankTiers();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-400/12 hover:bg-amber-400/20 border border-amber-300/35 text-[11px] font-bold text-amber-200 shrink-0 cursor-pointer transition-colors"
                >
                  {t(language, 'viewRankTiers')}
                </button>
              )}
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-bold text-zinc-300">
                {isId ? 'Pilih Aturan Ranked' : 'Select Ranked Rules'}
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  data-testid="ranked-variant-8ball"
                  onClick={() => {
                    audioEngine.playClick();
                    setVariant('8ball');
                  }}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    variant === '8ball'
                      ? 'neu-btn-gold'
                      : 'bg-[#161820] border border-white/10 text-zinc-300 hover:bg-[#1e212b]'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-zinc-950 border border-white/25 text-white text-[10px] flex items-center justify-center">
                    8
                  </span>
                  <span>8 Ball</span>
                </button>
                <button
                  type="button"
                  data-testid="ranked-variant-9ball"
                  onClick={() => {
                    audioEngine.playClick();
                    setVariant('9ball');
                  }}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    variant === '9ball'
                      ? 'neu-btn-gold'
                      : 'bg-[#161820] border border-white/10 text-zinc-300 hover:bg-[#1e212b]'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-yellow-400 text-zinc-950 text-[10px] flex items-center justify-center font-extrabold">
                    9
                  </span>
                  <span>9 Ball</span>
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#161820] border border-white/10 text-xs text-zinc-300 leading-relaxed flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                {isId
                  ? `Pencarian dimulai di tier ${currentRank.tier} lalu diperluas ke tier terdekat. Jika tidak ada pemain online, Bot berlabel jelas akan disiapkan sesuai tier Anda.`
                  : `Matchmaking searches ${currentRank.tier} tier first before expanding to adjacent divisions. If no online player is available, a clearly labeled tier Bot is offered.`}
              </span>
            </div>

            <LiquidMetalButton
              fullWidth
              height={46}
              testId="ranked-find-btn"
              icon={<Trophy className="w-4 h-4 text-amber-300" />}
              label={t(language, 'findRankedMatch')}
              onClick={handleJoinQueue}
            />
          </div>
        )}

        {phase === 'searching' && (
          <div data-testid="ranked-searching-state" className="space-y-3">
            <MatchmakingSpinStage
              compactModal
              title={t(language, 'rankedMatchTitle')}
              subtitle={`${currentRank.label} · ${elapsedSec}s`}
              variant={variant}
              potAmount={0}
              language={language}
              phase="searching"
              player={{
                uid: profile.uid,
                username: profile.username,
                avatar: profile.avatar,
                customAvatarUrl: profile.customAvatarUrl,
                level: profile.level,
              }}
              onCancel={handleCancelAndClose}
              cancelTestId="ranked-cancel-btn"
              cancelLabel={t(language, 'cancelSearch')}
            />
          </div>
        )}

        {phase === 'bot_notice' && botProfile && (
          <div data-testid="ranked-bot-notice" className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-400/35 text-amber-100 flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-extrabold uppercase tracking-wide text-amber-200">
                  {t(language, 'botOpponentNoticeTitle')}
                </div>
                <p className="text-xs leading-relaxed text-amber-100/85">{t(language, 'botOpponentNoticeBody')}</p>
              </div>
            </div>

            <div className="bg-[#161820] border border-white/12 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
              <PlayerAvatar
                avatarId={botProfile.avatar}
                frameId={botProfile.frame}
                username={botProfile.username}
                size="lg"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-bold text-zinc-100 truncate">{botProfile.username}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 border border-white/15 text-amber-300 text-[10px] font-black tracking-wide">
                    <Bot className="w-3 h-3" />
                    <span>{t(language, 'botBadge')}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <RankBadge rankPoints={botProfile.rankPoints} size="xs" />
                  <span className="text-[11px] font-semibold text-zinc-400">
                    {t(language, 'botDifficultyLabel')}: {difficultyLabel(botProfile.difficulty)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCancelAndClose}
                className="py-2.5 rounded-xl bg-[#161820] border border-white/12 text-zinc-200 hover:bg-[#1e212b] font-bold text-xs cursor-pointer transition-colors"
              >
                {t(language, 'cancelSearch')}
              </button>
              <button
                type="button"
                disabled={startingBot}
                data-testid="ranked-start-bot-btn"
                onClick={handleStartBotMatch}
                className="py-2.5 rounded-xl neu-btn-gold font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {startingBot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                <span>{t(language, 'acceptBotMatch')}</span>
              </button>
            </div>
          </div>
        )}

        {phase === 'unavailable' && (
          <div data-testid="ranked-unavailable" className="py-4 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-950/50 border border-red-500/35 text-red-400 flex items-center justify-center mx-auto">
              <WifiOff className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <div className="text-base font-bold text-zinc-100">{t(language, 'rankedOfflineTitle')}</div>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto">
                {t(language, 'rankedOfflineBody')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelAndClose}
              className="w-full py-2.5 rounded-xl neu-btn-blue font-bold text-sm cursor-pointer"
            >
              {t(language, 'backToHome')}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
