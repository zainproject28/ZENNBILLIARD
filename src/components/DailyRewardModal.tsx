import React, { useState } from 'react';
import { Check, Coins, Gift, Sparkles, X } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { DAILY_REWARD_SCHEDULE } from '../game/constants.ts';
import type { UserProfile } from '../game/types.ts';
import { applyLocalDailyReward, safeFetchJson, saveStoredGuestSession } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { auth, updateFirestoreDailyReward } from '../services/firebase.ts';
import { t, type Language } from '../services/i18n.ts';

interface DailyRewardModalProps {
  profile: UserProfile;
  language?: Language;
  token: string;
  onProfileUpdate: (profile: UserProfile) => void;
  onClose: () => void;
}

export const DailyRewardModal: React.FC<DailyRewardModalProps> = ({
  profile,
  language = 'en',
  token,
  onProfileUpdate,
  onClose,
}) => {
  const isId = language === 'id';
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = profile.lastDailyClaim === today;

  const handleClaim = async () => {
    audioEngine.unlock();
    audioEngine.playClick();
    setClaiming(true);
    setMessage(null);
    try {
      const res = await safeFetchJson<{ profile?: UserProfile; rewardCoins?: number; error?: string }>(
        '/api/rewards/daily',
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (res.ok && res.data?.profile) {
        audioEngine.playCoinCollect();
        if (auth.currentUser) {
          void updateFirestoreDailyReward(auth.currentUser.uid, res.data.profile).catch(() => {});
        } else if (token) {
          saveStoredGuestSession(token, res.data.profile);
        }
        onProfileUpdate(res.data.profile);
        setMessage(
          isId
            ? `Berhasil klaim +${(res.data.rewardCoins || 5000).toLocaleString()} koin!`
            : `Claimed +${(res.data.rewardCoins || 5000).toLocaleString()} coins!`,
        );
        return;
      }
      if (!res.isBackendAvailable) {
        const localRes = applyLocalDailyReward(profile);
        if (localRes.ok) {
          if (auth.currentUser) {
            await updateFirestoreDailyReward(auth.currentUser.uid, localRes.profile);
          }
          audioEngine.playCoinCollect();
          onProfileUpdate(localRes.profile);
          setMessage(
            isId
              ? `Berhasil klaim +${localRes.rewardCoins.toLocaleString()} koin!`
              : `Claimed +${localRes.rewardCoins.toLocaleString()} coins!`,
          );
        } else {
          setMessage(localRes.error);
        }
        return;
      }
      setMessage(res.data?.error || (isId ? 'Sudah diklaim hari ini.' : 'Already claimed today.'));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'dailyReward')}
        className="w-full max-w-lg liquid-metal-border glass-panel mafia-texture-surface rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 text-[#f4f1ea]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-xl font-black text-zinc-50">{t(language, 'dailyReward')}</h2>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Hadiah Harian' : 'Close Daily Rewards'}
            onClick={onClose}
            className="p-1.5 rounded-xl bg-[#161820] hover:bg-[#1f222c] border border-white/12 text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-950/35 border border-amber-400/35">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{isId ? 'Bonus Login Harian' : 'Daily Login Bonus'}</span>
          </div>
          <span className="font-mono-tabular text-sm font-extrabold text-amber-300">
            +5,000 Coins
          </span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {DAILY_REWARD_SCHEDULE.map((coins, idx) => {
            const day = idx + 1;
            const claimed = day <= profile.dailyStreak;
            const isNext = !alreadyClaimed && day === (profile.dailyStreak % 7) + 1;

            return (
              <div
                key={day}
                className={`p-2.5 rounded-xl border text-center space-y-1.5 ${
                  isNext
                    ? 'bg-amber-950/40 border-amber-400/50 shadow-sm'
                    : claimed
                      ? 'bg-[#1a1d27] border-white/20'
                      : 'bg-[#12141a] border-white/10'
                }`}
              >
                <div className="text-[10px] font-bold text-zinc-400">
                  {isId ? `Hari ${day}` : `Day ${day}`}
                </div>
                <Coins className="w-4 h-4 text-amber-400 mx-auto" />
                <div className="font-mono-tabular text-xs font-extrabold text-zinc-100">
                  {coins >= 1000 ? `${coins / 1000}K` : coins}
                </div>
                {claimed && <Check className="w-3.5 h-3.5 text-amber-400 mx-auto" />}
              </div>
            );
          })}
        </div>

        {message && (
          <div className="p-2.5 rounded-xl bg-zinc-800/80 border border-white/15 text-xs text-zinc-100 text-center font-semibold">
            {message}
          </div>
        )}

        <LiquidMetalButton
          fullWidth
          height={46}
          disabled={alreadyClaimed || claiming}
          onClick={handleClaim}
          testId="claim-daily-btn"
          icon={<Gift className="w-4 h-4 text-amber-300" />}
          label={
            alreadyClaimed
              ? isId
                ? 'Sudah Diklaim Hari Ini'
                : 'Already Claimed Today'
              : claiming
                ? isId
                  ? 'Mengklaim...'
                  : 'Claiming...'
                : isId
                  ? 'Klaim +5,000 Koin'
                  : 'Claim +5,000 Coins'
          }
        />
      </div>
    </div>
  );
};
