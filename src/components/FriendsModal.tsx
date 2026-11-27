import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, LocateFixed, MapPin, Search, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import {
  evaluatePlayerProximity,
  formatDistanceLabel,
  getBrowserTimezoneRegion,
  isRealRegisteredPlayer,
  roundCoarseCoord,
  sanitizePlayerLocation,
  sortPlayersByProximity,
} from '../game/location.ts';
import { formatPlayerId, stripPlayerId } from '../game/playerId.ts';
import type { AuthProviderType, PlayerLocation } from '../game/types.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { updateFirestoreLocation } from '../services/firebase.ts';
import {
  fetchFirestoreFriends,
  fetchFirestoreRecommendedPlayers,
  removeFirestoreFriendship,
  respondFirestoreFriendRequest,
  sendFirestoreFriendRequest,
} from '../services/firestoreFriends.ts';
import { isFirebaseSessionActive, parseRoomErrorMessage } from '../services/firestoreRooms.ts';
import { t, type Language } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';

interface FriendPlayer {
  uid: string;
  playerId: string;
  username: string;
  authProvider?: AuthProviderType;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints?: number;
  online: boolean;
  location?: PlayerLocation;
  distanceKm?: number | null;
  sameRegion?: boolean;
  locationLabel?: string;
}

interface FriendEntry {
  friendshipId: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  player: FriendPlayer;
  source?: 'server' | 'firestore';
}

interface FriendsModalProps {
  currentUid: string;
  currentPlayerId?: string;
  currentLocation?: PlayerLocation;
  language?: Language;
  token: string;
  isFirebaseAccount: boolean;
  onLocationUpdated?: (location: PlayerLocation) => void;
  onInviteToPrivateRoom: (friend?: { uid: string; username: string }) => void;
  onClose: () => void;
}

export const FriendsModal: React.FC<FriendsModalProps> = ({
  currentUid,
  currentPlayerId,
  currentLocation,
  language = 'en',
  token,
  isFirebaseAccount,
  onLocationUpdated,
  onInviteToPrivateRoom,
  onClose,
}) => {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [recommendedPlayers, setRecommendedPlayers] = useState<FriendPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedOwnId, setCopiedOwnId] = useState(false);
  const [activeLocation, setActiveLocation] = useState<PlayerLocation | undefined>(currentLocation);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const isId = language === 'id';

  useEffect(() => {
    if (currentLocation) {
      setActiveLocation(currentLocation);
    }
  }, [currentLocation]);

  const hasPreciseLocation = Boolean(
    activeLocation &&
      typeof activeLocation.lat === 'number' &&
      typeof activeLocation.lng === 'number',
  );

  const loadFriends = useCallback(async () => {
    try {
      const merged = new Map<string, FriendEntry>();

      if (token) {
        const res = await safeFetchJson<{ friends: FriendEntry[] }>('/api/friends', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && res.data?.friends) {
          for (const entry of res.data.friends) {
            if (isRealRegisteredPlayer(entry.player)) {
              merged.set(entry.player.uid, { ...entry, source: 'server' });
            }
          }
        }
      }

      if (isFirebaseAccount || isFirebaseSessionActive()) {
        const fsFriends = await fetchFirestoreFriends(currentUid).catch(() => []);
        for (const entry of fsFriends) {
          if (!merged.has(entry.player.uid) && isRealRegisteredPlayer(entry.player)) {
            merged.set(entry.player.uid, { ...entry, source: 'firestore' });
          }
        }
      }

      setFriends(Array.from(merged.values()));
    } finally {
      setLoading(false);
    }
  }, [currentUid, isFirebaseAccount, token]);

  const searchPlayers = useCallback(
    async (q: string, overrideLocation?: PlayerLocation) => {
      const selfLoc = overrideLocation ?? activeLocation;
      const merged = new Map<string, FriendPlayer>();

      if (token) {
        const res = await safeFetchJson<{ players: FriendPlayer[] }>(
          `/api/players/search?q=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok && res.data?.players) {
          for (const p of res.data.players) {
            if (p.uid !== currentUid && isRealRegisteredPlayer(p)) {
              merged.set(p.uid, evaluatePlayerProximity(p, selfLoc));
            }
          }
        }
      }

      if (isFirebaseAccount || isFirebaseSessionActive()) {
        const fsPlayers = await fetchFirestoreRecommendedPlayers(currentUid, q, selfLoc).catch(() => []);
        for (const p of fsPlayers) {
          if (!isRealRegisteredPlayer(p)) continue;
          const scored = evaluatePlayerProximity(p, selfLoc);
          if (!merged.has(p.uid)) {
            merged.set(p.uid, scored);
          } else {
            const existing = merged.get(p.uid)!;
            merged.set(p.uid, {
              ...existing,
              online: existing.online || scored.online,
              location: existing.location || scored.location,
              distanceKm: existing.distanceKm ?? scored.distanceKm,
              sameRegion: existing.sameRegion || scored.sameRegion,
              locationLabel: existing.locationLabel || scored.locationLabel,
            });
          }
        }
      }

      setRecommendedPlayers(sortPlayersByProximity(Array.from(merged.values())));
    },
    [activeLocation, currentUid, isFirebaseAccount, token],
  );

  useEffect(() => {
    void loadFriends();
    void searchPlayers('');
  }, [loadFriends, searchPlayers]);

  const handleEnableNearbyLocation = () => {
    audioEngine.playClick();
    setLocationError(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError(t(language, 'locationUnavailableError'));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const tzInfo = getBrowserTimezoneRegion();
        const nextLoc = sanitizePlayerLocation({
          lat: roundCoarseCoord(pos.coords.latitude),
          lng: roundCoarseCoord(pos.coords.longitude),
          city: tzInfo.city,
          region: tzInfo.region,
          timezone: tzInfo.timezone,
          updatedAt: new Date().toISOString(),
        });

        if (nextLoc) {
          setActiveLocation(nextLoc);
          onLocationUpdated?.(nextLoc);

          if (token) {
            void safeFetchJson('/api/profile/location', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(nextLoc),
            });
          }
          if (isFirebaseAccount || isFirebaseSessionActive()) {
            void updateFirestoreLocation(currentUid, nextLoc).catch(() => {});
          }
          await searchPlayers(searchQuery, nextLoc);
        }
        setLocating(false);
      },
      () => {
        const fallbackLoc = sanitizePlayerLocation({
          ...getBrowserTimezoneRegion(),
          updatedAt: new Date().toISOString(),
        });
        if (fallbackLoc) {
          setActiveLocation(fallbackLoc);
        }
        setLocationError(t(language, 'locationDeniedError'));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const handleCopyOwnId = async () => {
    if (!currentPlayerId) return;
    audioEngine.playClick();
    try {
      await navigator.clipboard.writeText(stripPlayerId(currentPlayerId));
    } catch {
      // Clipboard fallback ignored
    }
    setCopiedOwnId(true);
    window.setTimeout(() => setCopiedOwnId(false), 1800);
  };

  const handleAddFriend = async (friendId: string) => {
    audioEngine.playClick();
    setFeedback(null);

    if (token) {
      const res = await safeFetchJson<{ error?: string }>('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendId }),
      });
      if (res.ok) {
        setFeedback(isId ? 'Permintaan pertemanan terkirim.' : 'Friend request sent.');
        void loadFriends();
        return;
      }
      if (res.isBackendAvailable && res.status !== 404) {
        if (!(isFirebaseSessionActive() && res.status === 404)) {
          setFeedback(
            res.data?.error || (isId ? 'Tidak dapat mengirim permintaan.' : 'Could not send friend request.'),
          );
          return;
        }
      }
    }

    if (isFirebaseSessionActive()) {
      try {
        const fsRes = await sendFirestoreFriendRequest(currentUid, friendId);
        if (fsRes.ok) {
          setFeedback(isId ? 'Permintaan pertemanan terkirim.' : 'Friend request sent.');
          void loadFriends();
        } else {
          setFeedback(fsRes.error);
        }
      } catch (err) {
        setFeedback(parseRoomErrorMessage(err));
      }
      return;
    }

    setFeedback(
      isId
        ? 'Masuk dengan Google atau hubungkan ke server untuk menambah teman.'
        : 'Sign in with Google or connect to live server to add friends.',
    );
  };

  const handleRespond = async (entry: FriendEntry, accept: boolean) => {
    audioEngine.playClick();
    if (entry.source === 'firestore') {
      await respondFirestoreFriendRequest(entry.friendshipId, accept);
      void loadFriends();
      return;
    }
    if (token) {
      await safeFetchJson('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendshipId: entry.friendshipId, accept }),
      });
    }
    void loadFriends();
  };

  const handleRemove = async (entry: FriendEntry) => {
    audioEngine.playClick();
    if (entry.source === 'firestore') {
      await removeFirestoreFriendship(entry.friendshipId);
      void loadFriends();
      return;
    }
    if (token) {
      await safeFetchJson('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ friendshipId: entry.friendshipId }),
      });
    }
    void loadFriends();
  };

  const friendUids = new Set(friends.map((f) => f.player.uid));

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'friends')}
        className="w-full max-w-2xl max-h-[90vh] liquid-metal-border glass-panel mafia-texture-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden text-zinc-100"
      >
        {/* Sticky Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-white/10 shrink-0">
          <div>
            <h2 className="font-display text-xl font-black text-zinc-50">
              {isId ? 'Teman & Pemain Terdekat' : 'Friends & Nearby Players'}
            </h2>
            <p className="text-[11px] text-[#a69a87] mt-0.5 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{t(language, 'realPlayersOnlyNote')}</span>
            </p>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Teman' : 'Close Friends'}
            onClick={onClose}
            className="w-9 h-9 rounded-full neu-inset text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sticky Search & Own ID Controls */}
        <div className="px-5 sm:px-6 pt-4 pb-2 space-y-3 shrink-0">
          {currentPlayerId && (
            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl neu-inset">
              <div className="text-xs">
                <span className="text-zinc-400 font-semibold">{t(language, 'playerIdLabel')}: </span>
                <span className="font-mono-tabular font-bold text-amber-300">
                  {formatPlayerId(currentPlayerId)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyOwnId()}
                className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 text-zinc-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                {copiedOwnId ? <Check className="w-3.5 h-3.5 text-amber-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedOwnId ? t(language, 'copied') : t(language, 'copyId')}</span>
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchPlayers(searchQuery);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                data-testid="friends-search-input"
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  void searchPlayers(e.target.value);
                }}
                placeholder={t(language, 'searchFriendsPlaceholder')}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl neu-inset text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl neu-btn-blue text-xs font-bold cursor-pointer"
            >
              {isId ? 'Cari' : 'Search'}
            </button>
          </form>

          {feedback && (
            <div className="text-xs font-semibold text-zinc-100 bg-[#161820] border border-white/15 rounded-xl px-3 py-2">
              {feedback}
            </div>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-3 space-y-5">
          {/* Friend List & Requests */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              {isId ? `Daftar Teman & Permintaan (${friends.length})` : `Friends & Requests (${friends.length})`}
            </h3>
            {loading ? (
              <div className="text-xs text-zinc-400 py-3">{isId ? 'Memuat daftar teman...' : 'Loading friends...'}</div>
            ) : friends.length === 0 ? (
              <div className="text-xs text-zinc-400 py-3 neu-inset rounded-2xl p-4 text-center">
                {isId
                  ? 'Belum ada teman. Cari 9 angka Player ID atau nama pemain asli di bawah.'
                  : 'No friends added yet. Search by 9 digit Player ID or verified username below.'}
              </div>
            ) : (
              <div className="space-y-2">
                {friends.map((entry) => (
                  <div
                    key={entry.friendshipId}
                    className="flex items-center justify-between p-3 rounded-2xl neu-inset"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PlayerAvatar
                        avatarId={entry.player.avatar}
                        customAvatarUrl={entry.player.customAvatarUrl}
                        frameId={entry.player.frame}
                        username={entry.player.username}
                        size="sm"
                        online={entry.player.online}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-zinc-100 truncate">
                            {entry.player.username}
                          </span>
                          {entry.player.rankPoints !== undefined && (
                            <RankBadge rankPoints={entry.player.rankPoints} size="xs" language={language} />
                          )}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-zinc-400 flex items-center gap-2 mt-0.5">
                          <span>{formatPlayerId(entry.player.playerId)}</span>
                          <span className={entry.player.online ? 'text-sky-400 font-bold' : 'text-zinc-500'}>
                            {entry.status === 'accepted'
                              ? entry.player.online
                                ? t(language, 'online')
                                : t(language, 'offline')
                              : entry.direction === 'incoming'
                                ? isId
                                  ? 'Permintaan Masuk'
                                  : 'Incoming Request'
                                : isId
                                  ? 'Menunggu'
                                  : 'Pending'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {entry.status === 'pending' && entry.direction === 'incoming' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRespond(entry, true)}
                            className="px-2.5 py-1.5 rounded-lg neu-btn-gold text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isId ? 'Terima' : 'Accept'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRespond(entry, false)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#0e1015] hover:bg-[#1e212b] border border-white/12 text-zinc-300 text-xs font-semibold cursor-pointer"
                          >
                            {isId ? 'Tolak' : 'Decline'}
                          </button>
                        </>
                      )}

                      {entry.status === 'accepted' && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInviteToPrivateRoom({
                              uid: entry.player.uid,
                              username: entry.player.username,
                            });
                          }}
                          className="px-3 py-1.5 rounded-lg neu-btn-gold text-xs font-bold cursor-pointer"
                        >
                          {t(language, 'inviteFriend')}
                        </button>
                      )}

                      <button
                        type="button"
                        aria-label={`Remove ${entry.player.username}`}
                        onClick={() => void handleRemove(entry)}
                        className="p-1.5 rounded-lg hover:bg-red-950/60 text-zinc-500 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nearby & Registered Google/Email Players */}
          <div className="space-y-2.5 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {hasPreciseLocation
                      ? `${t(language, 'nearbyPlayersTitle')} (${recommendedPlayers.length})`
                      : `${t(language, 'registeredPlayersTitle')} (${recommendedPlayers.length})`}
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {hasPreciseLocation ? t(language, 'locationEnabledNote') : t(language, 'locationEnablePrompt')}
                </p>
              </div>

              <button
                type="button"
                data-testid="friends-share-location-btn"
                disabled={locating}
                onClick={handleEnableNearbyLocation}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors border ${
                  hasPreciseLocation
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/20'
                    : 'bg-amber-400/15 border-amber-300/40 text-amber-200 hover:bg-amber-400/25'
                }`}
              >
                <LocateFixed className={`w-3.5 h-3.5 ${locating ? 'animate-spin' : ''}`} />
                <span>{locating ? t(language, 'updatingLocation') : t(language, 'enableNearbyLocation')}</span>
              </button>
            </div>

            {locationError && (
              <div className="text-[11px] font-medium text-amber-300 bg-amber-950/35 border border-amber-400/30 rounded-xl px-3 py-2">
                {locationError}
              </div>
            )}

            {recommendedPlayers.length === 0 ? (
              <div className="text-xs text-zinc-400 py-5 text-center neu-inset rounded-2xl px-4">
                {t(language, 'noNearbyPlayers')}
              </div>
            ) : (
              <div className="space-y-2" data-testid="recommended-players-list">
                {recommendedPlayers.map((player) => {
                  const distText = formatDistanceLabel(player.distanceKm, player.location, language);
                  const providerTag =
                    player.authProvider === 'google'
                      ? 'Google'
                      : player.authProvider === 'email'
                        ? 'Email'
                        : null;
                  return (
                    <div
                      key={player.uid}
                      data-testid={`recommended-player-${player.uid}`}
                      className="flex items-center justify-between gap-2 p-3 rounded-2xl neu-inset"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          avatarId={player.avatar}
                          customAvatarUrl={player.customAvatarUrl}
                          frameId={player.frame}
                          username={player.username}
                          size="sm"
                          online={player.online}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-zinc-100 truncate">{player.username}</span>
                            {providerTag && (
                              <span className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[9px] font-bold text-amber-200">
                                {providerTag}
                              </span>
                            )}
                            {player.rankPoints !== undefined && (
                              <RankBadge rankPoints={player.rankPoints} size="xs" language={language} />
                            )}
                          </div>
                          <div className="text-[11px] font-mono-tabular text-zinc-400 flex items-center gap-2 flex-wrap mt-0.5">
                            <span>{formatPlayerId(player.playerId)}</span>
                            <span className={player.online ? 'text-sky-400 font-bold' : 'text-zinc-500'}>
                              {player.online ? t(language, 'online') : t(language, 'offline')}
                            </span>
                            {distText && (
                              <span className="inline-flex items-center gap-1 text-emerald-300 font-sans font-semibold">
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span>{distText}</span>
                              </span>
                            )}
                            {!distText && player.sameRegion && (
                              <span className="text-amber-300 font-sans font-semibold">
                                {t(language, 'sameRegionLabel')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={friendUids.has(player.uid)}
                        onClick={() => void handleAddFriend(player.uid)}
                        data-testid={`add-friend-${player.uid}`}
                        className="px-3 py-1.5 rounded-xl neu-btn-blue disabled:opacity-45 text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>
                          {friendUids.has(player.uid) ? t(language, 'alreadyFriends') : t(language, 'addFriend')}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
