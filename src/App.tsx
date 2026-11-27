import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthScreen } from './components/AuthScreen.tsx';
import { DailyRewardModal } from './components/DailyRewardModal.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FriendsModal } from './components/FriendsModal.tsx';
import { GameView, type OnlineMatchInit } from './components/GameView.tsx';
import { LeaderboardModal } from './components/LeaderboardModal.tsx';
import { MainMenu } from './components/MainMenu.tsx';
import { PracticeSetupModal, type PracticeLaunchConfig, type PracticeSubMode } from './components/PracticeSetupModal.tsx';
import { PrivateRoomModal, type RoomStateView } from './components/PrivateRoomModal.tsx';
import { ProfileModal, type SaveProfilePayload } from './components/ProfileModal.tsx';
import { QuickMatchModal } from './components/QuickMatchModal.tsx';
import { RankedMatchModal } from './components/RankedMatchModal.tsx';
import { RankTiersModal } from './components/RankTiersModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { ShopModal } from './components/ShopModal.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import { DEFAULT_FREE_OWNED_ITEMS, SHOP_CATALOG } from './game/constants.ts';
import { generateRandomPlayerId } from './game/playerId.ts';
import { computeQuickMatchClientSettlement } from './game/quickMatchAi.ts';
import { createEmptyPlayerStats } from './game/rank.ts';
import { extractRoomCode } from './game/roomCode.ts';
import type {
  AiDifficulty,
  GameVariant,
  OnlineParticipantMeta,
  ShopItemDef,
  UserProfile,
  UserSettings,
} from './game/types.ts';
import {
  clearStoredGuestSession,
  loadLocalSettings,
  loadStoredGuestSession,
  safeFetchJson,
  saveLocalSettings,
  saveStoredGuestSession,
  saveStoredLocalGuestProfile,
} from './services/apiFallback.ts';
import { audioEngine } from './services/audio.ts';
import {
  auth,
  DEFAULT_SETTINGS,
  loadFirestoreSettings,
  logoutFirebase,
  syncFirebaseUserProfile,
  testFirestoreConnection,
  updateFirestoreMatchStats,
  updateFirestoreProfileFields,
  updateFirestoreSettings,
  updateFirestoreShopPurchase,
} from './services/firebase.ts';
import {
  respondFirestoreRoomInvite,
  subscribeFirestoreRoomInvites,
} from './services/firestoreRooms.ts';
import { wsClient } from './services/wsClient.ts';

type AppScreen = 'splash' | 'auth' | 'menu' | 'playing';
type ActiveModal =
  | null
  | 'private_room'
  | 'quick_match'
  | 'ranked'
  | 'practice_setup'
  | 'friends'
  | 'shop'
  | 'leaderboard'
  | 'profile'
  | 'settings'
  | 'daily_reward';

export function AppContent() {
  const params = new URLSearchParams(window.location.search);
  const autoStart = params.get('autostart') === '1';
  const inviteRoomParam = extractRoomCode(params.get('room') || '');

  const initialVariant: GameVariant = params.get('variant') === '9ball' ? '9ball' : '8ball';
  const rawSub = params.get('submode');
  const initialSubMode: PracticeSubMode =
    rawSub === 'solo' ||
    rawSub === 'local_2p' ||
    rawSub === 'local_2v2_ai' ||
    rawSub === 'local_2v2_pass' ||
    rawSub === 'vs_ai'
      ? rawSub
      : 'vs_ai';
  const rawAi = params.get('ai');
  const initialAiDiff: AiDifficulty =
    rawAi === 'club' || rawAi === 'semipro' || rawAi === 'pro' ? rawAi : 'pro';

  const [screen, setScreen] = useState<AppScreen>(autoStart ? 'playing' : 'splash');
  const [token, setToken] = useState<string>('');
  const [isFirebaseAccount, setIsFirebaseAccount] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(
    autoStart
      ? {
          uid: 'practice_autostart',
          playerId: generateRandomPlayerId(),
          username: 'Practice_Pro',
          avatar: 'avatar_ace',
          frame: 'frame_bronze',
          equippedCue: 'cue_basic',
          equippedTable: 'table_tournament_blue',
          equippedVenue: 'venue_billiard_cafe',
          equippedEffect: 'effect_classic',
          ownedItems: [...DEFAULT_FREE_OWNED_ITEMS],
          level: 1,
          xp: 0,
          coins: 15000,
          rating: 1000,
          rankPoints: 0,
          highestRankPoints: 0,
          wins: 0,
          losses: 0,
          matches: 0,
          stats: createEmptyPlayerStats(),
          dailyStreak: 0,
          lastDailyClaim: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : null,
  );
  const profileRef = useRef<UserProfile | null>(profile);
  profileRef.current = profile;
  const lastGuestRefreshRef = useRef<number>(0);

  const [settings, setSettings] = useState<UserSettings>(() => loadLocalSettings(DEFAULT_SETTINGS));
  const [modal, setModal] = useState<ActiveModal>(null);
  const [showRankTiers, setShowRankTiers] = useState(false);
  const [practiceInitialSubMode, setPracticeInitialSubMode] = useState<PracticeSubMode>('vs_ai');
  const [shopTab, setShopTab] = useState<ShopItemDef['category']>('cue');
  const [practiceConfig, setPracticeConfig] = useState<PracticeLaunchConfig>({
    variant: initialVariant,
    subMode: initialSubMode,
    aiDifficulty: initialAiDiff,
  });
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  // Multiplayer Room / Active Match State
  const [room, setRoom] = useState<RoomStateView | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [inviteFriendTarget, setInviteFriendTarget] = useState<{ uid: string; username: string } | null>(null);
  const [pendingRoomCode, setPendingRoomCode] = useState<string>(inviteRoomParam);
  const [autoJoinRoom, setAutoJoinRoom] = useState<boolean>(Boolean(inviteRoomParam));
  const [activeOnlineMatch, setActiveOnlineMatch] = useState<OnlineMatchInit | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{
    inviteId?: string;
    roomCode: string;
    entryFee: number;
    from: { uid: string; username: string; avatar: string };
  } | null>(null);

  // Sync body[data-state] for observability
  useEffect(() => {
    document.body.dataset.state = screen;
  }, [screen]);

  // Startup Firestore connection check
  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  // Keep audio engine synced with user settings
  useEffect(() => {
    audioEngine.setSfxEnabled(settings.sfxEnabled);
    audioEngine.setMusicEnabled(settings.musicEnabled);
    audioEngine.setMusicVolume(settings.musicVolume ?? 0.35);
  }, [settings.sfxEnabled, settings.musicEnabled, settings.musicVolume]);

  // Track WebSocket status & subscribe to Firestore cross-device room invites
  useEffect(() => {
    return wsClient.onStatusChange(setWsStatus);
  }, []);

  useEffect(() => {
    if (!isFirebaseAccount || !profile?.uid) return undefined;
    return subscribeFirestoreRoomInvites(profile.uid, (inv) => {
      audioEngine.playNotification();
      setPendingInvite({
        inviteId: inv.inviteId,
        roomCode: inv.roomCode,
        entryFee: inv.entryFee,
        from: {
          uid: inv.hostId,
          username: inv.hostName,
          avatar: inv.hostAvatar,
        },
      });
    });
  }, [isFirebaseAccount, profile?.uid]);

  // Subscribe to global WebSocket events (rooms, matchmaking, match start, invites)
  useEffect(() => {
    const unsub = wsClient.subscribe((msg) => {
      switch (msg.type) {
        case 'auth:ok': {
          if (msg.profile) {
            setProfile((prev) => prev || (msg.profile as UserProfile));
          }
          if (msg.activeMatch) {
            setActiveOnlineMatch(msg.activeMatch as OnlineMatchInit);
            setModal(null);
            setScreen('playing');
          } else if (msg.activeRoom) {
            setRoom(msg.activeRoom as RoomStateView);
            setModal('private_room');
          }
          break;
        }
        case 'auth:error': {
          // Silently re-issue fresh session token without surfacing credential errors
          if (auth.currentUser) {
            void auth.currentUser
              .getIdToken(true)
              .then((freshTok) => {
                setToken(freshTok);
                wsClient.connect(
                  freshTok,
                  async () => (auth.currentUser ? auth.currentUser.getIdToken(true) : null),
                );
              })
              .catch(() => {});
          } else {
            const now = Date.now();
            if (now - lastGuestRefreshRef.current < 3000) break;
            lastGuestRefreshRef.current = now;
            const curProf = profileRef.current;
            void safeFetchJson<{ token?: string; profile?: UserProfile }>('/api/auth/guest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: curProf?.username,
                existingUid: curProf?.uid,
                playerId: curProf?.playerId,
              }),
            })
              .then(async (res) => {
                if (res.ok && res.data?.token && res.data.profile) {
                  const freshTok = res.data.token;
                  let freshProf = res.data.profile;
                  if (curProf) {
                    const syncRes = await safeFetchJson<{ profile?: UserProfile }>('/api/profile/sync', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${freshTok}`,
                      },
                      body: JSON.stringify({
                        username: curProf.username,
                        avatar: curProf.avatar,
                        customAvatarUrl: curProf.customAvatarUrl || '',
                        frame: curProf.frame,
                        equippedCue: curProf.equippedCue,
                        equippedTable: curProf.equippedTable,
                        equippedVenue: curProf.equippedVenue || 'venue_billiard_cafe',
                        equippedEffect: curProf.equippedEffect,
                        ownedItems: curProf.ownedItems,
                      }),
                    });
                    if (syncRes.ok && syncRes.data?.profile) {
                      freshProf = syncRes.data.profile;
                    }
                  }
                  setToken(freshTok);
                  setProfile(freshProf);
                  saveStoredGuestSession(freshTok, freshProf);
                  wsClient.connect(freshTok);
                }
              })
              .catch(() => {});
          }
          break;
        }
        case 'error': {
          const errText = String(msg.error || 'Real-time server error.');
          if (!errText.toLowerCase().includes('credential')) {
            setRoomError(errText);
          }
          break;
        }
        case 'room:created':
        case 'room:updated': {
          setRoomError(null);
          setRoom(msg.room as RoomStateView);
          setModal('private_room');
          break;
        }
        case 'room:left': {
          setRoom(null);
          break;
        }
        case 'room:error': {
          setRoomError(String(msg.error || 'Room action failed.'));
          break;
        }
        case 'room:invitation': {
          audioEngine.playNotification();
          setPendingInvite({
            roomCode: String(msg.roomCode || ''),
            entryFee: Number(msg.entryFee || 0),
            from: msg.from as { uid: string; username: string; avatar: string },
          });
          break;
        }
        case 'queue:matched':
        case 'match:started': {
          setRoom(null);
          setAutoJoinRoom(false);
          setModal(null);
          setActiveOnlineMatch(msg.match as OnlineMatchInit);
          setScreen('playing');
          break;
        }
      }
    });
    return unsub;
  }, []);

  const finishAuthentication = useCallback(
    async (authToken: string, initialProfile: UserProfile, firebaseBacked: boolean) => {
      audioEngine.unlock();
      setIsFirebaseAccount(firebaseBacked);

      // Sync profile with authoritative server coordinator & auto-reissue expired guest tokens
      let activeToken = authToken;
      let syncedProfile = initialProfile;
      if (activeToken) {
        const res = await safeFetchJson<{ profile?: UserProfile }>('/api/profile/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
          },
          body: JSON.stringify(initialProfile),
        });
        if (res.ok && res.data?.profile) {
          syncedProfile = res.data.profile;
        } else if (!firebaseBacked && res.isBackendAvailable && res.status === 401) {
          const guestRes = await safeFetchJson<{ token?: string; profile?: UserProfile }>('/api/auth/guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: initialProfile.username,
              existingUid: initialProfile.uid,
              playerId: initialProfile.playerId,
            }),
          });
          if (guestRes.ok && guestRes.data?.token && guestRes.data.profile) {
            activeToken = guestRes.data.token;
            syncedProfile = guestRes.data.profile;
            const resync = await safeFetchJson<{ profile?: UserProfile }>('/api/profile/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${activeToken}`,
              },
              body: JSON.stringify(initialProfile),
            });
            if (resync.ok && resync.data?.profile) {
              syncedProfile = resync.data.profile;
            }
          }
        }
      }

      setToken(activeToken);
      if (!firebaseBacked && activeToken) {
        saveStoredGuestSession(activeToken, syncedProfile);
      }

      const localSet = loadLocalSettings(DEFAULT_SETTINGS);
      if (firebaseBacked) {
        const loadedSettings = await loadFirestoreSettings(syncedProfile.uid);
        const mergedSettings = { ...localSet, ...loadedSettings };
        setSettings(mergedSettings);
        saveLocalSettings(mergedSettings);
      } else {
        setSettings(localSet);
      }

      setProfile(syncedProfile);
      if (activeToken) {
        wsClient.connect(
          activeToken,
          firebaseBacked
            ? async () => (auth.currentUser ? auth.currentUser.getIdToken() : null)
            : undefined,
        );
      }
      setScreen('menu');

      if (inviteRoomParam) {
        setPendingRoomCode(inviteRoomParam);
        setAutoJoinRoom(true);
        setModal('private_room');
      }
    },
    [inviteRoomParam],
  );

  // Handle splash completion & check active Firebase or Guest session
  const handleSplashComplete = useCallback(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        try {
          const idToken = await user.getIdToken();
          const prof = await syncFirebaseUserProfile(user);
          await finishAuthentication(idToken, prof, true);
          return;
        } catch {
          // Fall through to stored guest or auth screen
        }
      }
      const storedGuest = loadStoredGuestSession();
      if (storedGuest && !storedGuest.profile.uid.startsWith('local_guest_')) {
        try {
          await finishAuthentication(storedGuest.token, storedGuest.profile, false);
          return;
        } catch {
          clearStoredGuestSession();
        }
      }
      setScreen((cur) => (cur === 'splash' ? 'auth' : cur));
    });
  }, [finishAuthentication]);

  const handleUpdateSettings = (next: UserSettings) => {
    setSettings(next);
    saveLocalSettings(next);
    if (isFirebaseAccount && profile) {
      void updateFirestoreSettings(profile.uid, next).catch(() => {});
    }
  };

  const handleSaveProfile = async (payload: SaveProfilePayload) => {
    if (!profile) return;
    let updated: UserProfile = {
      ...profile,
      username: payload.username,
      avatar: payload.avatar,
      customAvatarUrl: payload.customAvatarUrl,
      frame: payload.frame,
    };
    if (token) {
      const res = await safeFetchJson<{ profile?: UserProfile }>('/api/profile/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: payload.username,
          avatar: payload.avatar,
          customAvatarUrl: payload.customAvatarUrl,
          frame: payload.frame,
        }),
      });
      if (res.ok && res.data?.profile) {
        updated = res.data.profile;
      }
    }
    setProfile(updated);
    if (!isFirebaseAccount && token) {
      saveStoredGuestSession(token, updated);
    }
    if (!isFirebaseAccount && updated.uid.startsWith('local_guest_')) {
      saveStoredLocalGuestProfile(updated);
    }
    if (isFirebaseAccount) {
      await updateFirestoreProfileFields(profile.uid, {
        username: payload.username,
        avatar: payload.avatar,
        customAvatarUrl: payload.customAvatarUrl,
        frame: payload.frame,
      });
    }
  };

  const handleQuickEquip = useCallback(
    (itemId: string) => {
      const item = SHOP_CATALOG.find((entry) => entry.id === itemId);
      if (!item) return;

      setProfile((prev) => {
        if (!prev) return prev;
        if (item.price > 0 && !prev.ownedItems.includes(item.id)) return prev;
        const ownedItems = prev.ownedItems.includes(item.id)
          ? prev.ownedItems
          : [...prev.ownedItems, item.id];
        const next: UserProfile = { ...prev, ownedItems };
        if (item.category === 'cue') next.equippedCue = item.id;
        if (item.category === 'table') next.equippedTable = item.id;
        if (item.category === 'venue') next.equippedVenue = item.id;
        if (item.category === 'avatar') next.avatar = item.id;
        if (item.category === 'frame') next.frame = item.id;
        if (item.category === 'effect') next.equippedEffect = item.id;

        if (!isFirebaseAccount && next.uid.startsWith('local_guest_')) {
          saveStoredLocalGuestProfile(next);
        }
        if (isFirebaseAccount) {
          void updateFirestoreProfileFields(next.uid, {
            avatar: next.avatar,
            frame: next.frame,
            equippedCue: next.equippedCue,
            equippedTable: next.equippedTable,
            equippedVenue: next.equippedVenue || 'venue_billiard_cafe',
            equippedEffect: next.equippedEffect,
          }).catch(() => {});
        }
        return next;
      });

      if (token) {
        void safeFetchJson('/api/shop/equip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ itemId }),
        });
      }
    },
    [isFirebaseAccount, token],
  );

  const handleSettleQuickMatch = useCallback(
    async (payload: {
      won: boolean;
      entryFee: number;
      opponent: OnlineParticipantMeta;
      shots: number;
      durationSec: number;
    }): Promise<{ xpEarned: number; coinsEarned: number; ratingDelta: number }> => {
      const curProf = profileRef.current;
      if (!curProf) return { xpEarned: 0, coinsEarned: 0, ratingDelta: 0 };

      if (token) {
        const res = await safeFetchJson<{
          profile?: UserProfile;
          xpEarned?: number;
          coinsEarned?: number;
          ratingDelta?: number;
        }>('/api/matches/quick-ai/settle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            won: payload.won,
            entryFee: payload.entryFee,
            shots: payload.shots,
            duration: payload.durationSec,
            opponentRating: payload.opponent.rating,
            opponentName: payload.opponent.username,
            opponentAvatar: payload.opponent.avatar,
          }),
        });
        if (res.ok && res.data?.profile) {
          const updated = res.data.profile;
          setProfile(updated);
          if (!isFirebaseAccount) {
            saveStoredGuestSession(token, updated);
          } else {
            void updateFirestoreMatchStats(updated.uid, updated).catch(() => {});
          }
          return {
            xpEarned: Number(res.data.xpEarned || 0),
            coinsEarned: Number(res.data.coinsEarned || 0),
            ratingDelta: Number(res.data.ratingDelta || 0),
          };
        }
      }

      const settled = computeQuickMatchClientSettlement(
        curProf,
        payload.opponent.rating,
        payload.won,
        payload.entryFee,
        payload.shots,
      );
      setProfile(settled.nextProfile);
      if (!isFirebaseAccount && token) {
        saveStoredGuestSession(token, settled.nextProfile);
      }
      if (!isFirebaseAccount && settled.nextProfile.uid.startsWith('local_guest_')) {
        saveStoredLocalGuestProfile(settled.nextProfile);
      }
      if (isFirebaseAccount) {
        void updateFirestoreMatchStats(settled.nextProfile.uid, settled.nextProfile).catch(() => {});
      }
      return {
        xpEarned: settled.xpEarned,
        coinsEarned: settled.coinsEarned,
        ratingDelta: settled.ratingDelta,
      };
    },
    [isFirebaseAccount, token],
  );

  const handleLogout = async () => {
    wsClient.disconnect();
    clearStoredGuestSession();
    if (isFirebaseAccount) {
      await logoutFirebase();
    }
    setToken('');
    setProfile(null);
    setActiveOnlineMatch(null);
    setRoom(null);
    setInviteFriendTarget(null);
    setModal(null);
    setScreen('auth');
  };

  if (screen === 'splash') {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (screen === 'auth' || !profile) {
    return (
      <AuthScreen
        language={settings.language}
        onLanguageChange={(lang) => handleUpdateSettings({ ...settings, language: lang })}
        onAuthenticated={finishAuthentication}
      />
    );
  }

  if (screen === 'playing') {
    return (
      <GameView
        profile={profile}
        settings={settings}
        onlineMatch={activeOnlineMatch}
        practiceConfig={practiceConfig}
        onQuickEquip={handleQuickEquip}
        onSettleQuickMatch={handleSettleQuickMatch}
        onUpdateSettings={handleUpdateSettings}
        onOnlineMatchUpdate={(nextMatch) => {
          setActiveOnlineMatch(nextMatch);
        }}
        onProfileUpdate={(next) => {
          const prevMatches = profileRef.current?.matches ?? 0;
          setProfile(next);
          if (!isFirebaseAccount && token) {
            saveStoredGuestSession(token, next);
          }
          if (isFirebaseAccount && activeOnlineMatch?.firestoreSync && next.matches > prevMatches) {
            void updateFirestoreMatchStats(next.uid, next).catch(() => {});
          }
        }}
        onExitToMenu={() => {
          setActiveOnlineMatch(null);
          setScreen('menu');
        }}
        onPlayAgainRanked={() => {
          setActiveOnlineMatch(null);
          setScreen('menu');
          setModal('ranked');
        }}
        onInviteFriendFromResult={() => {
          setActiveOnlineMatch(null);
          setScreen('menu');
          setAutoJoinRoom(false);
          setInviteFriendTarget(null);
          setModal('private_room');
        }}
      />
    );
  }

  return (
    <>
      <MainMenu
        profile={profile}
        settings={settings}
        wsStatus={wsStatus}
        pendingInvite={pendingInvite}
        onAcceptInvite={(code) => {
          if (pendingInvite?.inviteId) {
            void respondFirestoreRoomInvite(pendingInvite.inviteId, 'accepted').catch(() => {});
          }
          setPendingInvite(null);
          setRoomError(null);
          setPendingRoomCode(extractRoomCode(code));
          setAutoJoinRoom(true);
          setModal('private_room');
        }}
        onDismissInvite={() => {
          if (pendingInvite?.inviteId) {
            void respondFirestoreRoomInvite(pendingInvite.inviteId, 'declined').catch(() => {});
          }
          setPendingInvite(null);
        }}
        onOpenPrivateRoom={() => {
          setRoomError(null);
          setAutoJoinRoom(false);
          setInviteFriendTarget(null);
          setModal('private_room');
        }}
        onOpenQuickMatch={() => {
          setModal('quick_match');
        }}
        onOpenRanked={() => {
          setModal('ranked');
        }}
        onOpenPracticeArena={(initialSub = 'vs_ai') => {
          setPracticeInitialSubMode(initialSub);
          setModal('practice_setup');
        }}
        onOpenFriends={() => setModal('friends')}
        onOpenShop={(initialTab = 'cue') => {
          setShopTab(initialTab);
          setModal('shop');
        }}
        onOpenLeaderboard={() => setModal('leaderboard')}
        onOpenProfile={() => setModal('profile')}
        onOpenSettings={() => setModal('settings')}
        onOpenDailyReward={() => setModal('daily_reward')}
        onOpenRankTiers={() => setShowRankTiers(true)}
      />

      {modal === 'private_room' && (
        <PrivateRoomModal
          currentProfile={profile}
          language={settings.language}
          token={token}
          isFirebaseAccount={isFirebaseAccount}
          room={room}
          initialJoinCode={pendingRoomCode}
          autoJoin={autoJoinRoom}
          inviteTarget={inviteFriendTarget}
          error={roomError}
          onTokenRefreshed={(freshTok, updatedProf) => {
            setToken(freshTok);
            if (updatedProf) {
              setProfile(updatedProf);
              if (!isFirebaseAccount) {
                saveStoredGuestSession(freshTok, updatedProf);
              }
            }
            if (freshTok) {
              wsClient.connect(freshTok);
            }
          }}
          onRoomChange={setRoom}
          onMatchStarted={(match) => {
            setRoom(null);
            setAutoJoinRoom(false);
            setPendingRoomCode('');
            setInviteFriendTarget(null);
            setModal(null);
            setActiveOnlineMatch(match);
            setScreen('playing');
          }}
          onError={setRoomError}
          onClose={() => {
            setRoom(null);
            setPendingRoomCode('');
            setAutoJoinRoom(false);
            setInviteFriendTarget(null);
            setModal(null);
          }}
        />
      )}

      {modal === 'quick_match' && (
        <QuickMatchModal
          token={token}
          playerCoins={profile.coins}
          playerProfile={profile}
          language={settings.language}
          onStartServerMatch={(matchPayload) => {
            setActiveOnlineMatch(matchPayload as unknown as OnlineMatchInit);
            setModal(null);
            setScreen('playing');
          }}
          onStartQuickMatch={(cfg) => {
            setPracticeConfig({
              variant: cfg.variant,
              subMode: 'vs_ai',
              aiDifficulty: 'pro',
              isQuickMatch: true,
              entryFee: cfg.entryFee,
              opponent: cfg.opponent,
            });
            setActiveOnlineMatch(null);
            setModal(null);
            setScreen('playing');
          }}
          onOpenPrivateRoom={() => {
            setRoomError(null);
            setAutoJoinRoom(false);
            setInviteFriendTarget(null);
            setModal('private_room');
          }}
          onClose={() => {
            setModal(null);
          }}
        />
      )}

      {modal === 'practice_setup' && (
        <PracticeSetupModal
          profile={profile}
          settings={settings}
          initialSubMode={practiceInitialSubMode}
          onStart={(cfg) => {
            setPracticeConfig(cfg);
            setActiveOnlineMatch(null);
            setModal(null);
            setScreen('playing');
          }}
          onQuickEquip={handleQuickEquip}
          onOpenArsenal={() => {
            setShopTab('cue');
            setModal('shop');
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'friends' && (
        <FriendsModal
          currentUid={profile.uid}
          currentPlayerId={profile.playerId}
          currentLocation={profile.location}
          language={settings.language}
          token={token}
          isFirebaseAccount={isFirebaseAccount}
          onLocationUpdated={(loc) => {
            setProfile((prev) => (prev ? { ...prev, location: loc } : prev));
          }}
          onInviteToPrivateRoom={(target) => {
            setRoomError(null);
            setAutoJoinRoom(false);
            setInviteFriendTarget(target || null);
            setModal('private_room');
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'shop' && (
        <ShopModal
          profile={profile}
          language={settings.language}
          token={token}
          initialCategory={shopTab}
          onProfileUpdate={(next, purchasedNew) => {
            setProfile(next);
            if (!isFirebaseAccount && token) {
              saveStoredGuestSession(token, next);
            }
            if (isFirebaseAccount) {
              if (purchasedNew) {
                void updateFirestoreShopPurchase(next.uid, next).catch(() => {});
              } else {
                void updateFirestoreProfileFields(next.uid, {
                  avatar: next.avatar,
                  frame: next.frame,
                  equippedCue: next.equippedCue,
                  equippedTable: next.equippedTable,
                  equippedVenue: next.equippedVenue || 'venue_billiard_cafe',
                  equippedEffect: next.equippedEffect,
                }).catch(() => {});
              }
            }
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'ranked' && (
        <RankedMatchModal
          token={token}
          profile={profile}
          language={settings.language}
          onStartServerMatch={(matchPayload) => {
            setActiveOnlineMatch(matchPayload as unknown as OnlineMatchInit);
            setModal(null);
            setScreen('playing');
          }}
          onOpenRankTiers={() => setShowRankTiers(true)}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'leaderboard' && (
        <LeaderboardModal
          currentUid={profile.uid}
          language={settings.language}
          token={token}
          isFirebaseAccount={isFirebaseAccount}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'profile' && (
        <ProfileModal
          profile={profile}
          language={settings.language}
          token={token}
          isFirebaseAccount={isFirebaseAccount}
          onSaveProfile={handleSaveProfile}
          onOpenRankTiers={() => setShowRankTiers(true)}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal
          profile={profile}
          settings={settings}
          isFirebaseAccount={isFirebaseAccount}
          onUpdateSettings={handleUpdateSettings}
          onEditProfile={() => setModal('profile')}
          onLogout={handleLogout}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'daily_reward' && (
        <DailyRewardModal
          profile={profile}
          language={settings.language}
          token={token}
          onProfileUpdate={(next) => {
            setProfile(next);
            if (!isFirebaseAccount && token) {
              saveStoredGuestSession(token, next);
            }
          }}
          onClose={() => setModal(null)}
        />
      )}

      {showRankTiers && (
        <RankTiersModal
          language={settings.language}
          rankPoints={profile.rankPoints ?? 0}
          highestRankPoints={profile.highestRankPoints ?? 0}
          onClose={() => setShowRankTiers(false)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
