import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Cpu, Loader2, Users, X, Zap } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { MAX_CUSTOM_ENTRY_FEE, PRESET_ENTRY_FEES, sanitizeEntryFee } from '../game/constants.ts';
import { pickRandomQuickMatchOpponent } from '../game/quickMatchAi.ts';
import type { GameVariant, OnlineParticipantMeta } from '../game/types.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { t, type Language } from '../services/i18n.ts';
import { MatchmakingSpinStage } from './MatchmakingSpinStage.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import type { ServerStartedMatchPayload } from './RankedMatchModal.tsx';

interface QuickBotNoticeProfile {
  username: string;
  avatar: string;
  frame: string;
  rating: number;
  tier: string;
  isBot: true;
}

interface QuickMatchModalProps {
  token: string;
  playerCoins: number;
  playerProfile?: {
    uid: string;
    username: string;
    avatar: string;
    customAvatarUrl?: string;
    level: number;
  };
  language?: Language;
  onStartServerMatch: (matchPayload: ServerStartedMatchPayload) => void;
  onStartQuickMatch: (cfg: {
    variant: GameVariant;
    entryFee: number;
    opponent: OnlineParticipantMeta;
  }) => void;
  onOpenPrivateRoom?: () => void;
  onClose: () => void;
}

export const QuickMatchModal: React.FC<QuickMatchModalProps> = ({
  token,
  playerCoins,
  playerProfile,
  language = 'en',
  onStartServerMatch,
  onStartQuickMatch,
  onOpenPrivateRoom,
  onClose,
}) => {
  const isId = language === 'id';
  const [variant, setVariant] = useState<GameVariant>('8ball');
  const [entryFee, setEntryFee] = useState(0);
  const [customStakeInput, setCustomStakeInput] = useState('');
  const [phase, setPhase] = useState<'setup' | 'searching' | 'bot_notice' | 'offline_notice'>('setup');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [botProfile, setBotProfile] = useState<QuickBotNoticeProfile | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [startingBot, setStartingBot] = useState(false);
  const [openRoomsCount, setOpenRoomsCount] = useState<number>(0);

  const pollTimerRef = useRef<number | null>(null);
  const clockTimerRef = useRef<number | null>(null);

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
    void safeFetchJson<{ ok?: boolean; openRoomsCount?: number }>('/api/health').then((res) => {
      if (res.ok && res.data) {
        setOpenRoomsCount(Number(res.data.openRoomsCount || 0));
      }
    });
    return () => {
      stopPolling();
    };
  }, []);

  const maxAllowed = Math.min(MAX_CUSTOM_ENTRY_FEE, Math.max(0, playerCoins));
  const resolvedFee = sanitizeEntryFee(entryFee, MAX_CUSTOM_ENTRY_FEE);

  const handleFindOpponent = async () => {
    audioEngine.playClick();
    setLocalError(null);
    if (resolvedFee > playerCoins) {
      setLocalError(t(language, 'roomInsufficientCoins'));
      return;
    }

    setElapsedSec(0);
    setPhase('searching');

    const res = await safeFetchJson<{
      status?: 'searching' | 'matched';
      match?: ServerStartedMatchPayload;
      error?: string;
    }>('/api/quick-match/queue/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gameVariant: variant, entryFee: resolvedFee }),
    });

    if (!res.isBackendAvailable || res.status >= 500) {
      stopPolling();
      setPhase('offline_notice');
      return;
    }

    if (!res.ok) {
      stopPolling();
      setPhase('setup');
      setLocalError(res.data?.error || t(language, 'roomServerError'));
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
        botProfile?: QuickBotNoticeProfile;
      }>('/api/quick-match/queue/status', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!statusRes.isBackendAvailable) {
        stopPolling();
        setPhase('offline_notice');
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
    }, 900);
  };

  const handleStartOnlineBotMatch = async () => {
    audioEngine.playClick();
    setStartingBot(true);
    setLocalError(null);
    const res = await safeFetchJson<{
      match?: ServerStartedMatchPayload;
      error?: string;
    }>('/api/quick-match/queue/start-bot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gameVariant: variant, entryFee: resolvedFee }),
    });
    setStartingBot(false);

    if (!res.isBackendAvailable) {
      setPhase('offline_notice');
      return;
    }

    if (!res.ok || !res.data?.match) {
      setLocalError(res.data?.error || t(language, 'roomServerError'));
      return;
    }

    onStartServerMatch(res.data.match);
  };

  const handleStartOfflineBotMatch = () => {
    audioEngine.playClick();
    const bot = pickRandomQuickMatchOpponent();
    onStartQuickMatch({
      variant,
      entryFee: resolvedFee,
      opponent: bot,
    });
  };

  const handleCancel = () => {
    audioEngine.playClick();
    stopPolling();
    if ((phase === 'searching' || phase === 'bot_notice') && token) {
      void safeFetchJson('/api/quick-match/queue/leave', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'quickMatch')}
        className="w-full max-w-md liquid-metal-border glass-panel mafia-texture-surface rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-[#f4f1ea]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h2 className="font-display text-xl font-black text-zinc-50">{t(language, 'quickMatch')}</h2>
            <p className="text-[11px] text-zinc-400">
              {isId ? 'Duel taruhan koin melawan pemain online atau Bot' : 'Coin match against online players or Bot'}
            </p>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup' : 'Close Matchmaking'}
            onClick={handleCancel}
            className="p-2 rounded-xl bg-[#161820] hover:bg-[#1f222c] border border-white/12 text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {localError && (
          <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/35 text-xs text-red-200 font-semibold">
            {localError}
          </div>
        )}

        {phase === 'setup' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-bold text-zinc-300">
                {isId ? 'Pilih Aturan Permainan' : 'Select Billiard Rules'}
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  data-testid="quickmatch-variant-8ball"
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
                  data-testid="quickmatch-variant-9ball"
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

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-300">{isId ? 'Taruhan Meja' : 'Table Stake'}</span>
                <span className="font-mono-tabular text-amber-300 font-bold">
                  {resolvedFee === 0 ? t(language, 'freeMatch') : `${resolvedFee.toLocaleString()} Coins`}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {PRESET_ENTRY_FEES.map((fee) => (
                  <button
                    key={fee}
                    type="button"
                    disabled={playerCoins < fee}
                    onClick={() => {
                      audioEngine.playClick();
                      setEntryFee(fee);
                      setCustomStakeInput(fee === 0 ? '' : String(fee));
                    }}
                    className={`py-2 rounded-xl text-xs font-mono-tabular font-bold transition-all disabled:opacity-40 cursor-pointer ${
                      resolvedFee === fee
                        ? 'neu-btn-gold'
                        : 'bg-[#161820] border border-white/10 text-zinc-300 hover:bg-[#1e212b]'
                    }`}
                  >
                    {fee === 0 ? t(language, 'freeMatch') : fee >= 1000 ? `${fee / 1000}K` : `${fee}`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={maxAllowed}
                  step={100}
                  value={customStakeInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCustomStakeInput(raw);
                    if (raw.trim() === '') {
                      setEntryFee(0);
                    } else {
                      setEntryFee(sanitizeEntryFee(Number(raw), maxAllowed));
                    }
                  }}
                  placeholder={`${t(language, 'customStake')} (0 to ${maxAllowed.toLocaleString()})`}
                  className="flex-1 px-3 py-2 rounded-xl bg-[#0b0c10] border border-white/12 text-xs font-mono-tabular text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  disabled={playerCoins < 100}
                  onClick={() => {
                    const allIn = Math.min(MAX_CUSTOM_ENTRY_FEE, playerCoins);
                    setEntryFee(allIn);
                    setCustomStakeInput(String(allIn));
                  }}
                  className="px-3 py-2 rounded-xl bg-amber-950/50 border border-amber-400/35 text-[11px] font-bold text-amber-200 disabled:opacity-40 cursor-pointer hover:bg-amber-950/80"
                >
                  MAX
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#161820] border border-white/10 text-xs text-zinc-300 leading-relaxed flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {isId
                  ? 'Mencari lawan online terlebih dahulu; jika tidak ada yang online, Anda bisa lanjut melawan Bot.'
                  : 'Searches live online players first; if none are online, you can opt into a Bot match.'}
              </span>
            </div>

            <LiquidMetalButton
              fullWidth
              height={46}
              testId="quickmatch-find-btn"
              icon={<Zap className="w-4 h-4 text-amber-300" />}
              label={isId ? 'Cari Lawan' : 'Find Opponent'}
              onClick={() => void handleFindOpponent()}
            />

            {onOpenPrivateRoom && (
              <button
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  onClose();
                  onOpenPrivateRoom();
                }}
                className="w-full py-2.5 rounded-xl bg-[#161820] hover:bg-[#1e212b] border border-white/12 text-xs font-bold text-zinc-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                <span>
                  {t(language, 'openRooms')}
                  {openRoomsCount > 0 ? ` (${openRoomsCount})` : ''}
                </span>
              </button>
            )}
          </div>
        )}

        {phase === 'searching' && (
          <div className="space-y-3" data-testid="quickmatch-searching-stage">
            <MatchmakingSpinStage
              compactModal
              title={t(language, 'searchingQuickMatch')}
              subtitle={
                resolvedFee === 0 ? t(language, 'freeMatch') : `${resolvedFee.toLocaleString()} Coins`
              }
              variant={variant}
              potAmount={resolvedFee * 2}
              language={language}
              phase="searching"
              player={
                playerProfile || {
                  uid: 'player',
                  username: 'Player',
                  avatar: 'avatar_ace',
                  level: 1,
                }
              }
              opponent={null}
              onCancel={handleCancel}
              cancelLabel={t(language, 'cancelSearch')}
            />
            <div className="text-center text-[11px] font-mono-tabular font-bold text-zinc-400">
              {t(language, 'searchingQuickMatchHint')} ({elapsedSec}s)
            </div>
          </div>
        )}

        {phase === 'bot_notice' && botProfile && (
          <div className="space-y-4" data-testid="quickmatch-bot-notice">
            <div className="p-4 rounded-2xl bg-amber-950/35 border border-amber-400/35 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-black text-amber-200">{t(language, 'quickBotNoticeTitle')}</div>
                  <p className="text-xs text-amber-100/80 mt-0.5 leading-relaxed">
                    {t(language, 'quickBotNoticeBody')}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#161820] border border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <PlayerAvatar
                  avatarId={botProfile.avatar}
                  frameId={botProfile.frame}
                  username={botProfile.username}
                  size="md"
                  online
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-zinc-100 truncate">{botProfile.username}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/40 text-[10px] font-mono-tabular font-black text-amber-300">
                      <Bot className="w-3 h-3" />
                      {t(language, 'botBadge')}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {t(language, 'botDifficultyLabel')}: {t(language, 'aiPro')} · ELO {botProfile.rating}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-3 rounded-2xl bg-[#161820] hover:bg-[#1e212b] border border-white/12 text-xs font-bold text-zinc-200 cursor-pointer"
              >
                {t(language, 'cancelSearch')}
              </button>
              <button
                type="button"
                disabled={startingBot}
                onClick={() => void handleStartOnlineBotMatch()}
                data-testid="quickmatch-accept-bot-btn"
                className="flex-1 py-3 px-4 rounded-2xl neu-btn-gold text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                {startingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                <span>{t(language, 'acceptQuickBotMatch')}</span>
              </button>
            </div>
          </div>
        )}

        {phase === 'offline_notice' && (
          <div className="space-y-4" data-testid="quickmatch-offline-notice">
            <div className="p-4 rounded-2xl bg-zinc-900/70 border border-white/15 space-y-2">
              <div className="text-sm font-black text-zinc-100">{t(language, 'quickOfflineBotTitle')}</div>
              <p className="text-xs text-zinc-300 leading-relaxed">{t(language, 'quickOfflineBotBody')}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-3 rounded-2xl bg-[#161820] hover:bg-[#1e212b] border border-white/12 text-xs font-bold text-zinc-200 cursor-pointer"
              >
                {t(language, 'cancelSearch')}
              </button>
              <button
                type="button"
                onClick={handleStartOfflineBotMatch}
                className="flex-1 py-3 px-4 rounded-2xl neu-btn-gold text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <Bot className="w-4 h-4" />
                <span>{t(language, 'startOfflineBotMatch')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
