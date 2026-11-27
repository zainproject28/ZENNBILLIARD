import React, { useEffect, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { isRealRegisteredPlayer } from '../game/location.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { fetchFirestoreLeaderboard } from '../services/firebase.ts';
import { t, type Language } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';

interface RankingEntry {
  uid: string;
  playerId: string;
  username: string;
  authProvider?: 'google' | 'email' | 'guest';
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints?: number;
  wins: number;
  losses: number;
  matches: number;
  online: boolean;
}

interface LeaderboardModalProps {
  currentUid: string;
  language?: Language;
  token: string;
  isFirebaseAccount?: boolean;
  onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  currentUid,
  language = 'en',
  token,
  isFirebaseAccount = false,
  onClose,
}) => {
  const isId = language === 'id';
  const [scope, setScope] = useState<'global' | 'weekly' | 'monthly' | 'friends'>('global');
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      const res = await safeFetchJson<{ rankings?: RankingEntry[] }>(`/api/leaderboard?scope=${scope}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!active) return;
      if (res.ok && res.data?.rankings && res.data.rankings.length > 0) {
        setRankings(res.data.rankings.filter((entry) => isRealRegisteredPlayer(entry)));
        setLoading(false);
        return;
      }
      if (isFirebaseAccount && scope !== 'friends') {
        const fbEntries = await fetchFirestoreLeaderboard(30);
        if (active) {
          setRankings(fbEntries.filter((entry) => isRealRegisteredPlayer(entry)));
          setLoading(false);
          return;
        }
      }
      if (active) {
        setRankings([]);
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [scope, token, isFirebaseAccount]);

  const scopes: Array<{ id: 'global' | 'weekly' | 'monthly' | 'friends'; label: string }> = [
    { id: 'global', label: 'Global' },
    { id: 'weekly', label: isId ? 'Mingguan' : 'Weekly' },
    { id: 'monthly', label: isId ? 'Bulanan' : 'Monthly' },
    { id: 'friends', label: t(language, 'friends') },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'leaderboard')}
        className="w-full max-w-2xl max-h-[88vh] liquid-metal-border glass-panel mafia-texture-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#f4f1ea]"
      >
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-white/10 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <Trophy className="w-5 h-5 text-amber-400" />
              <h2 className="font-display text-xl font-black text-[#f8f5ee]">{t(language, 'leaderboard')}</h2>
            </div>
            <p className="text-[11px] text-[#a69a87] mt-0.5">{t(language, 'realPlayersOnlyNote')}</p>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Peringkat' : 'Close Leaderboard'}
            onClick={onClose}
            className="w-9 h-9 rounded-full neu-inset text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 pt-3.5 shrink-0">
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl neu-inset">
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  setScope(s.id);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  scope === s.id
                    ? 'neu-surface border border-amber-400/70 text-amber-300'
                    : 'text-[#a69a87] hover:text-[#f4f1ea]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-2">
          {loading ? (
            <div className="text-xs text-[#a69a87] py-8 text-center">
              {isId ? 'Memuat peringkat...' : 'Loading rankings...'}
            </div>
          ) : rankings.length === 0 ? (
            <div className="text-xs text-[#a69a87] py-10 text-center rounded-2xl neu-inset px-4">
              {t(language, 'noRealLeaderboard')}
            </div>
          ) : (
            rankings.map((entry, idx) => {
              const winRate = entry.matches > 0 ? Math.round((entry.wins / entry.matches) * 100) : 0;
              const isMe = entry.uid === currentUid;
              return (
                <div
                  key={entry.uid}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    isMe ? 'neu-surface border-amber-400/60' : 'neu-inset border-white/8'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-7 text-center font-mono-tabular font-bold text-sm shrink-0 ${
                        idx === 0
                          ? 'text-amber-300'
                          : idx === 1
                            ? 'text-zinc-300'
                            : idx === 2
                              ? 'text-amber-500'
                              : 'text-zinc-500'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <PlayerAvatar
                      avatarId={entry.avatar}
                      customAvatarUrl={entry.customAvatarUrl}
                      frameId={entry.frame}
                      username={entry.username}
                      size="sm"
                      online={entry.online}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#f4f1ea] truncate">
                          {entry.username}{' '}
                          {isMe && <span className="text-xs text-amber-300">({isId ? 'Anda' : 'You'})</span>}
                        </span>
                        <RankBadge rankPoints={entry.rankPoints ?? 0} size="xs" language={language} />
                      </div>
                      <div className="text-[11px] font-mono-tabular text-[#a69a87]">
                        {entry.wins}W / {entry.losses}L · {winRate}%
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono-tabular shrink-0 pl-2">
                    <div className="text-sm font-extrabold text-amber-300">
                      {(entry.rankPoints ?? 0) > 0 ? `${entry.rankPoints} RP` : `${entry.wins}`}
                    </div>
                    <div className="text-[10px] text-[#8c816f]">
                      {(entry.rankPoints ?? 0) > 0 ? 'RANKED' : isId ? 'MENANG' : 'WINS'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
