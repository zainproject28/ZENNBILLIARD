import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Share2,
  Swords,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { MAX_CUSTOM_ENTRY_FEE, PRESET_ENTRY_FEES, sanitizeEntryFee } from '../game/constants.ts';
import {
  classifyRoomJoinError,
  extractRoomCode,
  isValidRoomCode,
  type RoomJoinErrorCode,
} from '../game/roomCode.ts';
import type { GameVariant, MatchFormat, UserProfile } from '../game/types.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { auth } from '../services/firebase.ts';
import {
  createFirestoreRoomDirectly,
  isFirebaseSessionActive,
  joinRoomViaFirestore,
  leaveFirestoreRoom,
  listOpenFirestoreRooms,
  loadFirestoreMatch,
  mirrorCreatedRoomToFirestore,
  parseRoomErrorMessage,
  sendFirestoreRoomInvite,
  startFirestoreMatch,
  subscribeFirestoreRoom,
} from '../services/firestoreRooms.ts';
import { fetchFirestoreFriends } from '../services/firestoreFriends.ts';
import { t, type Language } from '../services/i18n.ts';
import { wsClient } from '../services/wsClient.ts';
import type { OnlineMatchInit } from './GameView.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';

export interface RoomParticipant {
  uid: string;
  username: string;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  online: boolean;
  isBot?: boolean;
}

export interface RoomStateView {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  participants?: string[];
  participantIds?: string[];
  seats?: (RoomParticipant | null)[];
  matchFormat?: MatchFormat;
  entryFee: number;
  gameVariant?: GameVariant;
  status: string;
  matchId?: string | null;
  host: RoomParticipant | null;
  guest: RoomParticipant | null;
  isFirestoreBridged?: boolean;
}

interface OpenRoomSummary {
  roomId: string;
  roomCode: string;
  entryFee: number;
  gameVariant: GameVariant;
  matchFormat: MatchFormat;
  seatsCount: number;
  maxSeats: number;
  createdAt: number;
  host: {
    username: string;
    avatar: string;
    customAvatarUrl?: string;
    frame: string;
    rating: number;
    online: boolean;
  } | null;
}

interface PrivateRoomModalProps {
  currentProfile: UserProfile;
  language?: Language;
  token: string;
  isFirebaseAccount: boolean;
  room: RoomStateView | null;
  initialJoinCode?: string;
  autoJoin?: boolean;
  inviteTarget?: { uid: string; username: string } | null;
  error: string | null;
  onTokenRefreshed?: (freshToken: string, updatedProfile?: UserProfile) => void;
  onRoomChange: (room: RoomStateView | null) => void;
  onMatchStarted: (match: OnlineMatchInit) => void;
  onError: (msg: string | null) => void;
  onClose: () => void;
}

function mapJoinErrorCodeToCopy(code: RoomJoinErrorCode, lang: Language): string {
  switch (code) {
    case 'INVALID_FORMAT':
      return t(lang, 'roomInvalidFormat');
    case 'ROOM_NOT_FOUND':
      return t(lang, 'roomNotFound');
    case 'ROOM_FULL':
      return t(lang, 'roomFull');
    case 'ROOM_EXPIRED':
      return t(lang, 'roomExpired');
    case 'IN_PROGRESS':
      return t(lang, 'roomInProgress');
    case 'NOT_SIGNED_IN':
      return t(lang, 'roomNotSignedIn');
    case 'INSUFFICIENT_COINS':
      return t(lang, 'roomInsufficientCoins');
    case 'CONNECTION_FAILED':
      return t(lang, 'roomConnectionFailed');
    case 'SERVER_ERROR':
    default:
      return t(lang, 'roomServerError');
  }
}

export const PrivateRoomModal: React.FC<PrivateRoomModalProps> = ({
  currentProfile,
  language = 'en',
  token,
  isFirebaseAccount,
  room,
  initialJoinCode = '',
  autoJoin = false,
  inviteTarget = null,
  error,
  onTokenRefreshed,
  onRoomChange,
  onMatchStarted,
  onError,
  onClose,
}) => {
  const initialExtracted = extractRoomCode(initialJoinCode);
  const [tab, setTab] = useState<'create' | 'join'>(initialExtracted ? 'join' : 'create');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [customStakeInput, setCustomStakeInput] = useState<string>('');
  const [gameVariant, setGameVariant] = useState<GameVariant>('8ball');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('1v1');
  const [joinCode, setJoinCode] = useState(initialExtracted);
  const [openRooms, setOpenRooms] = useState<OpenRoomSummary[]>([]);
  const [loadingOpenRooms, setLoadingOpenRooms] = useState(false);
  const [busyAction, setBusyAction] = useState<'create' | 'join' | 'start' | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [friends, setFriends] = useState<Array<{ player: RoomParticipant; status: string }>>([]);
  const [invitedUids, setInvitedUids] = useState<Set<string>>(new Set());

  const isId = language === 'id';
  const autoJoinedCodeRef = useRef<string>('');
  const startingMatchLockRef = useRef(false);
  const roomRef = useRef<RoomStateView | null>(room);
  roomRef.current = room;

  const reissueAuthToken = useCallback(async (): Promise<string> => {
    if (isFirebaseAccount && auth.currentUser) {
      try {
        const fresh = await auth.currentUser.getIdToken(true);
        onTokenRefreshed?.(fresh);
        return fresh;
      } catch {
        return token;
      }
    }
    try {
      const guestRes = await safeFetchJson<{ token?: string; profile?: UserProfile }>('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentProfile.username,
          existingUid: currentProfile.uid,
          playerId: currentProfile.playerId,
        }),
      });
      if (guestRes.ok && guestRes.data?.token) {
        const freshTok = guestRes.data.token;
        let syncedProf = guestRes.data.profile;
        const syncRes = await safeFetchJson<{ profile?: UserProfile }>('/api/profile/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshTok}`,
          },
          body: JSON.stringify(currentProfile),
        });
        if (syncRes.ok && syncRes.data?.profile) {
          syncedProf = syncRes.data.profile;
        }
        onTokenRefreshed?.(freshTok, syncedProf);
        return freshTok;
      }
    } catch {
      // ignore refresh failure
    }
    return token;
  }, [currentProfile, isFirebaseAccount, onTokenRefreshed, token]);

  const getActiveAuthToken = useCallback(async () => {
    if (isFirebaseAccount && auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        return token;
      }
    }
    return token;
  }, [isFirebaseAccount, token]);

  const fetchOpenRooms = useCallback(async () => {
    setLoadingOpenRooms(true);
    try {
      const merged = new Map<string, OpenRoomSummary>();

      const res = await safeFetchJson<{ rooms?: OpenRoomSummary[] }>('/api/rooms/open');
      if (res.ok && Array.isArray(res.data?.rooms)) {
        for (const r of res.data.rooms) {
          merged.set(r.roomCode, r);
        }
      }

      if (isFirebaseSessionActive()) {
        const fsRooms = await listOpenFirestoreRooms().catch(() => []);
        for (const r of fsRooms) {
          if (!merged.has(r.roomCode)) {
            merged.set(r.roomCode, r);
          }
        }
      }

      setOpenRooms(Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt));
    } finally {
      setLoadingOpenRooms(false);
    }
  }, []);

  useEffect(() => {
    if (room || tab !== 'join') return;
    void fetchOpenRooms();
    const timer = window.setInterval(() => {
      void fetchOpenRooms();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [room, tab, fetchOpenRooms]);

  useEffect(() => {
    const code = extractRoomCode(initialJoinCode);
    if (code) {
      setJoinCode(code);
      setTab('join');
    }
  }, [initialJoinCode]);

  useEffect(() => {
    if (room?.hostId !== currentProfile.uid) return;
    void getActiveAuthToken().then(async (authTok) => {
      const merged = new Map<string, { player: RoomParticipant; status: string }>();

      if (authTok) {
        const res = await safeFetchJson<{ friends?: Array<{ player: RoomParticipant; status: string }> }>(
          '/api/friends',
          { headers: { Authorization: `Bearer ${authTok}` } },
        );
        if (res.ok && res.data?.friends) {
          for (const f of res.data.friends) {
            if (f.status === 'accepted') {
              merged.set(f.player.uid, f);
            }
          }
        }
      }

      if (isFirebaseSessionActive()) {
        const fsFriends = await fetchFirestoreFriends(currentProfile.uid).catch(() => []);
        for (const f of fsFriends) {
          if (f.status === 'accepted' && !merged.has(f.player.uid)) {
            merged.set(f.player.uid, {
              status: f.status,
              player: {
                uid: f.player.uid,
                username: f.player.username,
                avatar: f.player.avatar,
                frame: f.player.frame,
                level: f.player.level,
                rating: f.player.rating,
                online: Boolean(f.player.online),
              },
            });
          }
        }
      }

      const list = Array.from(merged.values());
      if (inviteTarget) {
        list.sort((a, b) => (a.player.uid === inviteTarget.uid ? -1 : b.player.uid === inviteTarget.uid ? 1 : 0));
      }
      setFriends(list);
    });
  }, [room?.roomId, room?.hostId, currentProfile.uid, getActiveAuthToken, inviteTarget]);

  const joinRoomByCode = useCallback(
    async (rawInput: string) => {
      const cleaned = extractRoomCode(rawInput);
      if (!isValidRoomCode(cleaned)) {
        onError(t(language, 'roomInvalidFormat'));
        return;
      }

      onError(null);
      setBusyAction('join');
      try {
        let authTok = await getActiveAuthToken();
        let res = await safeFetchJson<{
          room?: RoomStateView;
          code?: string;
          error?: string;
        }>('/api/rooms/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authTok ? { Authorization: `Bearer ${authTok}` } : {}),
          },
          body: JSON.stringify({ roomCode: cleaned }),
        });

        if (res.isBackendAvailable && res.status === 401) {
          const freshTok = await reissueAuthToken();
          if (freshTok) {
            authTok = freshTok;
            res = await safeFetchJson<{
              room?: RoomStateView;
              code?: string;
              error?: string;
            }>('/api/rooms/join', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${freshTok}`,
              },
              body: JSON.stringify({ roomCode: cleaned }),
            });
          }
        }

        if (res.ok && res.data?.room) {
          onRoomChange(res.data.room);
          return;
        }

        const classifiedServer = classifyRoomJoinError({
          status: res.status,
          code: res.data?.code,
          message: res.data?.error,
          isBackendAvailable: res.isBackendAvailable,
          isSignedIn: Boolean(authTok || isFirebaseSessionActive()),
        });

        if (isFirebaseSessionActive() && (!res.isBackendAvailable || classifiedServer === 'ROOM_NOT_FOUND')) {
          const fsResult = await joinRoomViaFirestore(cleaned, currentProfile);
          if (fsResult.ok) {
            onRoomChange(fsResult.room);
            return;
          }
          const fsCode = classifyRoomJoinError({
            code: fsResult.code,
            message: fsResult.error,
            isBackendAvailable: true,
            isSignedIn: true,
          });
          onError(mapJoinErrorCodeToCopy(fsCode, language));
          return;
        }

        onError(mapJoinErrorCodeToCopy(classifiedServer, language));
      } catch (err) {
        const classified = classifyRoomJoinError({
          message: err instanceof Error ? err.message : '',
          isBackendAvailable: false,
          isSignedIn: Boolean(token || isFirebaseSessionActive()),
        });
        onError(mapJoinErrorCodeToCopy(classified, language));
      } finally {
        setBusyAction(null);
      }
    },
    [currentProfile, getActiveAuthToken, language, onError, onRoomChange, reissueAuthToken, token],
  );

  useEffect(() => {
    const code = extractRoomCode(initialJoinCode);
    if (autoJoin && !room && isValidRoomCode(code) && autoJoinedCodeRef.current !== code) {
      autoJoinedCodeRef.current = code;
      void joinRoomByCode(code);
    }
  }, [autoJoin, initialJoinCode, joinRoomByCode, room]);

  const activeRoomId = room?.roomId || '';
  const isBridged = Boolean(room?.isFirestoreBridged);
  useEffect(() => {
    if (!activeRoomId || isBridged) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const curRoom = roomRef.current;
      if (!curRoom || curRoom.isFirestoreBridged || cancelled) return;
      try {
        let authTok = await getActiveAuthToken();
        if (!authTok || cancelled) return;
        let res = await safeFetchJson<{
          room?: RoomStateView;
          match?: OnlineMatchInit | null;
        }>(`/api/rooms/${encodeURIComponent(curRoom.roomId)}`, {
          headers: { Authorization: `Bearer ${authTok}` },
        });
        if (res.isBackendAvailable && res.status === 401 && !cancelled) {
          const freshTok = await reissueAuthToken();
          if (freshTok && !cancelled) {
            authTok = freshTok;
            res = await safeFetchJson<{
              room?: RoomStateView;
              match?: OnlineMatchInit | null;
            }>(`/api/rooms/${encodeURIComponent(curRoom.roomId)}`, {
              headers: { Authorization: `Bearer ${freshTok}` },
            });
          }
        }
        if (!res.ok || !res.data || cancelled) return;
        const data = res.data;
        if (data.match) {
          onMatchStarted(data.match);
          return;
        }
        if (data.room) {
          const prevIds = (curRoom.participants || curRoom.participantIds || [curRoom.hostId, ...(curRoom.guestId ? [curRoom.guestId] : [])]).join(',');
          const nextIds = (data.room.participants || data.room.participantIds || [data.room.hostId, ...(data.room.guestId ? [data.room.guestId] : [])]).join(',');
          if (data.room.status === 'cancelled') {
            onRoomChange(null);
            onError(t(language, 'roomExpired'));
          } else if (
            data.room.guestId !== curRoom.guestId ||
            data.room.hostId !== curRoom.hostId ||
            data.room.status !== curRoom.status ||
            nextIds !== prevIds
          ) {
            onRoomChange(data.room);
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 850);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRoomId, isBridged, getActiveAuthToken, language, onError, onMatchStarted, onRoomChange, reissueAuthToken]);

  const activeRoomCode = room?.roomCode || '';
  useEffect(() => {
    if (!activeRoomCode || !isFirebaseSessionActive()) return;

    const unsub = subscribeFirestoreRoom(activeRoomCode, async (fsRoom) => {
      const curRoom = roomRef.current;
      if (!curRoom) return;

      if (fsRoom.status === 'cancelled' && curRoom.isFirestoreBridged) {
        onRoomChange(null);
        onError(t(language, 'roomExpired'));
        return;
      }

      const prevIds = (
        curRoom.participantIds ||
        curRoom.participants ||
        [curRoom.hostId, ...(curRoom.guestId ? [curRoom.guestId] : [])]
      ).join(',');
      const nextIds = fsRoom.participantIds.join(',');
      const prevCount =
        curRoom.participantIds?.length || curRoom.participants?.length || (curRoom.guestId ? 2 : 1);
      const nextCount = fsRoom.participantIds.length;
      const participantsChanged = nextIds !== prevIds || fsRoom.guestId !== curRoom.guestId;

      if (
        (curRoom.isFirestoreBridged && participantsChanged) ||
        (!curRoom.isFirestoreBridged && curRoom.hostId === currentProfile.uid && nextCount > prevCount)
      ) {
        onRoomChange({
          ...curRoom,
          guestId: fsRoom.guestId,
          guest: fsRoom.guest,
          participantIds: fsRoom.participantIds,
          participants: fsRoom.participantIds,
          seats: fsRoom.seats,
          matchFormat: fsRoom.matchFormat,
          isFirestoreBridged: curRoom.isFirestoreBridged || nextCount > prevCount,
        });
      }

      if (
        curRoom.isFirestoreBridged &&
        fsRoom.status === 'playing' &&
        fsRoom.matchId &&
        !startingMatchLockRef.current
      ) {
        startingMatchLockRef.current = true;
        try {
          let loaded = await loadFirestoreMatch(fsRoom.matchId);
          if (!loaded) {
            await new Promise((r) => setTimeout(r, 350));
            loaded = await loadFirestoreMatch(fsRoom.matchId);
          }
          if (loaded) {
            const seatIdx = [loaded.playerA, loaded.playerB, loaded.playerA2, loaded.playerB2].findIndex(
              (u) => u === currentProfile.uid,
            );
            const slot = seatIdx === 0 || seatIdx === 2 ? 'A' : 'B';
            onMatchStarted({
              matchId: loaded.matchId,
              roomId: fsRoom.roomId,
              gameMode: 'private_room',
              matchFormat: loaded.matchFormat || fsRoom.matchFormat || '1v1',
              entryFee: loaded.entryFee,
              yourSlot: slot,
              yourSeatIndex: seatIdx >= 0 ? seatIdx : 1,
              reconnectToken: '',
              seq: loaded.seq,
              simulating: false,
              balls: loaded.balls,
              rules: loaded.rules,
              playerA: loaded.playerAInfo,
              playerB: loaded.playerBInfo,
              ...(loaded.playerA2Info ? { playerA2: loaded.playerA2Info } : {}),
              ...(loaded.playerB2Info ? { playerB2: loaded.playerB2Info } : {}),
              firestoreSync: true,
              firestoreRoomCode: fsRoom.roomCode,
            });
          }
        } finally {
          startingMatchLockRef.current = false;
        }
      }
    });

    return () => unsub();
  }, [activeRoomCode, currentProfile.uid, language, onError, onMatchStarted, onRoomChange]);

  const maxAllowed = Math.min(MAX_CUSTOM_ENTRY_FEE, Math.max(0, currentProfile.coins));
  const resolvedFee = sanitizeEntryFee(entryFee, MAX_CUSTOM_ENTRY_FEE);

  const handleCreateRoom = async () => {
    audioEngine.playClick();
    onError(null);
    if (resolvedFee > currentProfile.coins) {
      onError(t(language, 'roomInsufficientCoins'));
      return;
    }
    setBusyAction('create');
    try {
      const authTok = await getActiveAuthToken();
      let res = await safeFetchJson<{ room?: RoomStateView; error?: string }>('/api/rooms/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authTok ? { Authorization: `Bearer ${authTok}` } : {}),
        },
        body: JSON.stringify({ entryFee: resolvedFee, gameVariant, matchFormat }),
      });

      if (res.isBackendAvailable && res.status === 401) {
        const freshTok = await reissueAuthToken();
        if (freshTok) {
          res = await safeFetchJson<{ room?: RoomStateView; error?: string }>('/api/rooms/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${freshTok}`,
            },
            body: JSON.stringify({ entryFee: resolvedFee, gameVariant, matchFormat }),
          });
        }
      }

      if (!res.ok || !res.data?.room) {
        if (isFirebaseSessionActive()) {
          try {
            const direct = await createFirestoreRoomDirectly({
              hostProfile: currentProfile,
              entryFee: resolvedFee,
              gameVariant,
              matchFormat,
            });
            onRoomChange(direct);
            return;
          } catch (fsErr) {
            onError(
              parseRoomErrorMessage(fsErr, {
                isBackendAvailable: res.isBackendAvailable,
                status: res.status,
                dataError: res.data?.error,
                hasFirebaseUser: true,
              }),
            );
            return;
          }
        }

        onError(
          parseRoomErrorMessage(new Error(res.data?.error || ''), {
            isBackendAvailable: res.isBackendAvailable,
            status: res.status,
            dataError: res.data?.error,
            hasFirebaseUser: false,
          }),
        );
        return;
      }

      onRoomChange(res.data.room);

      if (isFirebaseSessionActive()) {
        void mirrorCreatedRoomToFirestore({
          roomCode: res.data.room.roomCode,
          hostId: currentProfile.uid,
          entryFee: res.data.room.entryFee,
          gameVariant: res.data.room.gameVariant || gameVariant,
          matchFormat: res.data.room.matchFormat || matchFormat,
        }).catch(() => {});
      }
    } catch (err) {
      if (isFirebaseSessionActive()) {
        try {
          const direct = await createFirestoreRoomDirectly({
            hostProfile: currentProfile,
            entryFee: resolvedFee,
            gameVariant,
            matchFormat,
          });
          onRoomChange(direct);
          return;
        } catch (fsErr) {
          onError(parseRoomErrorMessage(fsErr, { hasFirebaseUser: true }));
          return;
        }
      }
      onError(parseRoomErrorMessage(err, { hasFirebaseUser: false }));
    } finally {
      setBusyAction(null);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.playClick();
    void joinRoomByCode(joinCode);
  };

  const handleLeaveRoom = async () => {
    audioEngine.playClick();
    if (room) {
      try {
        const authTok = await getActiveAuthToken();
        if (!room.isFirestoreBridged && authTok) {
          await safeFetchJson(`/api/rooms/${encodeURIComponent(room.roomId)}/leave`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authTok}` },
          });
        }
        if (isFirebaseSessionActive()) {
          await leaveFirestoreRoom(room.roomCode, room.hostId === currentProfile.uid).catch(() => {});
        }
      } finally {
        onRoomChange(null);
      }
    }
    onClose();
  };

  const requiredSeats = room?.matchFormat === '2v2' ? 4 : 2;
  const humanCount = room?.participants?.length || room?.participantIds?.length || (room?.guestId ? 2 : 1);
  const allHumanSeatsFilled = humanCount >= requiredSeats;

  const handleStartMatch = async () => {
    if (!room || !allHumanSeatsFilled || busyAction) return;
    audioEngine.playClick();
    onError(null);
    setBusyAction('start');

    try {
      const fmt: MatchFormat = room.matchFormat === '2v2' ? '2v2' : '1v1';
      if (room.isFirestoreBridged) {
        startingMatchLockRef.current = true;
        const pIds = room.participantIds || room.participants || [room.hostId, room.guestId || ''];
        const created = await startFirestoreMatch(
          room.roomCode,
          currentProfile,
          pIds,
          room.entryFee,
          room.gameVariant || '8ball',
          fmt,
        );
        onMatchStarted({
          matchId: created.matchId,
          roomId: room.roomId,
          gameMode: 'private_room',
          matchFormat: fmt,
          entryFee: created.entryFee,
          yourSlot: 'A',
          yourSeatIndex: 0,
          reconnectToken: '',
          seq: created.seq,
          simulating: false,
          balls: created.balls,
          rules: created.rules,
          playerA: created.playerAInfo,
          playerB: created.playerBInfo,
          ...(created.playerA2Info ? { playerA2: created.playerA2Info } : {}),
          ...(created.playerB2Info ? { playerB2: created.playerB2Info } : {}),
          firestoreSync: true,
          firestoreRoomCode: room.roomCode,
        });
        return;
      }

      const authTok = await getActiveAuthToken();
      let res = await safeFetchJson<{ match?: OnlineMatchInit; error?: string }>(
        `/api/rooms/${encodeURIComponent(room.roomId)}/start`,
        {
          method: 'POST',
          headers: authTok ? { Authorization: `Bearer ${authTok}` } : {},
        },
      );
      if (res.isBackendAvailable && res.status === 401) {
        const freshTok = await reissueAuthToken();
        if (freshTok) {
          res = await safeFetchJson<{ match?: OnlineMatchInit; error?: string }>(
            `/api/rooms/${encodeURIComponent(room.roomId)}/start`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${freshTok}` },
            },
          );
        }
      }
      if (!res.ok || !res.data?.match) {
        onError(res.data?.error || t(language, 'waitingHumanSeats'));
        return;
      }
      onMatchStarted(res.data.match);
    } catch (err) {
      onError(parseRoomErrorMessage(err, { hasFirebaseUser: isFirebaseSessionActive() }));
    } finally {
      startingMatchLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleCopyCode = async () => {
    if (!room) return;
    audioEngine.playClick();
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareNote(`${room.roomCode}`);
    }
  };

  const handleShareInvite = async () => {
    if (!room) return;
    audioEngine.playClick();
    const url = `${window.location.origin}/?room=${room.roomCode}`;
    const variantLabel = room.gameVariant === '9ball' ? t(language, 'nineBall') : t(language, 'eightBall');
    const text = `Join my ZENN BILLIARD (${variantLabel}) match! Room Code: ${room.roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ZENN BILLIARD', text, url });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareNote(isId ? 'Tautan undangan disalin.' : 'Invitation link copied to clipboard.');
      setTimeout(() => setShareNote(null), 2500);
    } catch {
      setShareNote(`${room.roomCode}`);
    }
  };

  const handleInviteFriend = (friendUid: string) => {
    if (!room) return;
    audioEngine.playClick();
    if (!room.isFirestoreBridged) {
      wsClient.send({ type: 'room:invite', roomId: room.roomId, friendId: friendUid });
    }
    if (isFirebaseSessionActive()) {
      void sendFirestoreRoomInvite({
        roomId: room.roomId,
        roomCode: room.roomCode,
        hostProfile: currentProfile,
        targetUid: friendUid,
        entryFee: room.entryFee,
        gameVariant: room.gameVariant,
        matchFormat: room.matchFormat,
      }).catch(() => {});
    }
    setInvitedUids((prev) => new Set(prev).add(friendUid));
  };

  const isHost = room?.hostId === currentProfile.uid;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'playWithFriends')}
        className="w-full max-w-lg liquid-metal-border glass-panel rounded-3xl p-5 sm:p-6 space-y-5 max-h-[90vh] overflow-y-auto text-zinc-100"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-lg sm:text-xl font-black text-zinc-50">
            {room
              ? isId
                ? 'Ruang Tunggu Teman'
                : 'Friend Waiting Room'
              : isId
                ? 'Main Bersama Teman'
                : 'Play with Friends'}
          </h2>
          <button
            type="button"
            aria-label={isId ? 'Tutup Room' : 'Close Private Room'}
            onClick={() => void handleLeaveRoom()}
            className="p-2 rounded-xl bg-[#161820] hover:bg-[#1f222c] border border-white/12 text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="room-error-banner"
            className="p-3 rounded-xl bg-red-950/50 border border-red-500/35 text-xs text-red-200 font-semibold"
          >
            {error}
          </div>
        )}

        {!room ? (
          <>
            <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-[#0c0e13] border border-white/10">
              <button
                type="button"
                onClick={() => {
                  setTab('create');
                  onError(null);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  tab === 'create' ? 'neu-btn-blue' : 'text-zinc-400 hover:text-zinc-100 hover:bg-[#181b24]'
                }`}
              >
                {isId ? 'BUAT ROOM' : 'CREATE ROOM'}
              </button>
              <button
                type="button"
                data-testid="tab-join-room"
                onClick={() => {
                  setTab('join');
                  onError(null);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  tab === 'join' ? 'neu-btn-blue' : 'text-zinc-400 hover:text-zinc-100 hover:bg-[#181b24]'
                }`}
              >
                {isId ? 'GABUNG / MEJA TERBUKA' : 'JOIN / OPEN TABLES'}
              </button>
            </div>

            {tab === 'create' ? (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-bold text-zinc-300 mb-2">
                    {isId ? 'Pilih Format Tim' : 'Select Match Format'}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      data-testid="room-format-1v1"
                      onClick={() => setMatchFormat('1v1')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        matchFormat === '1v1'
                          ? 'neu-btn-blue'
                          : 'bg-[#161820] border border-white/10 text-zinc-300 hover:bg-[#1e212b]'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>1v1 (2P)</span>
                    </button>
                    <button
                      type="button"
                      data-testid="room-format-2v2"
                      onClick={() => setMatchFormat('2v2')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        matchFormat === '2v2'
                          ? 'neu-btn-blue'
                          : 'bg-[#161820] border border-white/10 text-zinc-300 hover:bg-[#1e212b]'
                      }`}
                    >
                      <Swords className="w-3.5 h-3.5" />
                      <span>2v2 (4P)</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-bold text-zinc-300 mb-2">
                    {isId ? 'Pilih Aturan Permainan' : 'Select Billiard Rules'}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      data-testid="room-variant-8ball"
                      onClick={() => setGameVariant('8ball')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        gameVariant === '8ball'
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
                      data-testid="room-variant-9ball"
                      onClick={() => setGameVariant('9ball')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        gameVariant === '9ball'
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
                    <span className="font-bold text-zinc-300">
                      {isId ? 'Taruhan Meja' : 'Table Stake'}
                    </span>
                    <span className="font-mono-tabular font-bold text-amber-300">
                      {resolvedFee === 0 ? t(language, 'freeMatch') : `${resolvedFee.toLocaleString()} Coins`}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_ENTRY_FEES.map((fee) => (
                      <button
                        key={fee}
                        type="button"
                        disabled={currentProfile.coins < fee}
                        onClick={() => {
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
                      data-testid="room-custom-stake-input"
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
                      disabled={currentProfile.coins < 100}
                      onClick={() => {
                        const allIn = Math.min(MAX_CUSTOM_ENTRY_FEE, currentProfile.coins);
                        setEntryFee(allIn);
                        setCustomStakeInput(String(allIn));
                      }}
                      className="px-3 py-2 rounded-xl bg-amber-950/50 border border-amber-400/35 text-[11px] font-bold text-amber-200 disabled:opacity-40 cursor-pointer hover:bg-amber-950/80"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <LiquidMetalButton
                  fullWidth
                  height={46}
                  disabled={busyAction !== null}
                  onClick={() => void handleCreateRoom()}
                  testId="create-room-btn"
                  icon={
                    busyAction === 'create' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                    ) : (
                      <Users className="w-4 h-4 text-amber-300" />
                    )
                  }
                  label={
                    busyAction === 'create'
                      ? isId
                        ? 'Membuat Room...'
                        : 'Creating Room...'
                      : isId
                        ? 'Buat Room Teman'
                        : 'Create Friend Room'
                  }
                />
              </div>
            ) : (
              <div className="space-y-4">
                <form onSubmit={handleJoinSubmit} className="space-y-3">
                  <div>
                    <label htmlFor="room-code-input" className="block text-xs font-bold text-zinc-300 mb-2">
                      {isId ? 'Masukkan 6 Karakter Kode Room' : 'Enter 6 Character Room Code'}
                    </label>
                    <input
                      id="room-code-input"
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(extractRoomCode(e.target.value))}
                      placeholder="K7M9P2"
                      className="w-full px-4 py-3 rounded-2xl bg-[#0b0c10] border border-white/15 text-center font-mono-tabular text-xl tracking-[0.25em] font-bold text-amber-300 placeholder:text-zinc-600 uppercase focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <LiquidMetalButton
                    fullWidth
                    height={46}
                    type="submit"
                    disabled={!isValidRoomCode(joinCode) || busyAction !== null}
                    testId="join-room-btn"
                    icon={
                      busyAction === 'join' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                      ) : undefined
                    }
                    label={
                      busyAction === 'join'
                        ? isId
                          ? 'Bergabung...'
                          : 'Joining Room...'
                        : isId
                          ? 'GABUNG DENGAN KODE'
                          : 'JOIN BY CODE'
                    }
                  />
                </form>

                {/* Live Open Tables Lobby */}
                <div className="pt-2 border-t border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">{t(language, 'openRooms')}</span>
                    <button
                      type="button"
                      onClick={() => void fetchOpenRooms()}
                      className="px-2.5 py-1 rounded-lg bg-[#161820] hover:bg-[#1e212b] border border-white/12 text-[11px] font-bold text-zinc-200 flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingOpenRooms ? 'animate-spin' : ''}`} />
                      <span>{t(language, 'refresh')}</span>
                    </button>
                  </div>

                  {openRooms.length === 0 ? (
                    <div className="p-3 rounded-xl bg-[#12141a] border border-white/10 text-center text-[11px] text-zinc-400">
                      {t(language, 'noOpenRooms')}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
                      {openRooms.map((r) => (
                        <div
                          key={r.roomId}
                          data-testid={`open-room-${r.roomCode}`}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#161820] border border-white/10"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <PlayerAvatar
                              avatarId={r.host?.avatar || 'avatar_ace'}
                              customAvatarUrl={r.host?.customAvatarUrl}
                              frameId={r.host?.frame || 'frame_bronze'}
                              username={r.host?.username || 'Host'}
                              size="sm"
                              online={Boolean(r.host?.online)}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-zinc-100 truncate">
                                {r.host?.username || 'Host'}
                              </div>
                              <div className="text-[10px] font-mono-tabular text-amber-300">
                                {r.gameVariant === '9ball' ? '9 Ball' : '8 Ball'} · {r.matchFormat.toUpperCase()} ·{' '}
                                {r.entryFee === 0 ? t(language, 'freeMatch') : `${r.entryFee.toLocaleString()} Coins`} ·{' '}
                                {r.seatsCount}/{r.maxSeats}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busyAction !== null || currentProfile.coins < r.entryFee}
                            onClick={() => void joinRoomByCode(r.roomCode)}
                            className="px-3 py-1.5 rounded-xl neu-btn-blue text-[11px] font-bold shrink-0 disabled:opacity-45 cursor-pointer"
                          >
                            {t(language, 'joinNow')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            {/* Room Code Display */}
            <div className="rounded-2xl bg-[#161820] border border-white/12 p-4 text-center space-y-2.5 shadow-xs">
              <div className="text-xs text-zinc-400 font-semibold">
                {room.matchFormat === '2v2' ? '2v2' : '1v1'} ·{' '}
                {room.gameVariant === '9ball' ? '9 Ball' : '8 Ball'} ·{' '}
                {room.entryFee > 0 ? `${room.entryFee.toLocaleString()} Coins` : t(language, 'freeMatch')}
              </div>
              <div
                data-testid="room-code-display"
                className="font-mono-tabular text-3xl font-extrabold tracking-[0.28em] text-amber-300"
              >
                {room.roomCode}
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleCopyCode()}
                  className="px-3.5 py-1.5 rounded-xl bg-[#0e1015] hover:bg-[#1e212b] border border-white/12 text-xs font-bold flex items-center gap-1.5 text-zinc-200 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-amber-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? t(language, 'copied') : t(language, 'copyCode')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleShareInvite()}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-950/50 hover:bg-amber-950/80 border border-amber-400/35 text-xs font-bold flex items-center gap-1.5 text-amber-200 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{t(language, 'shareInvite')}</span>
                </button>
              </div>
              {shareNote && <p className="text-[11px] font-semibold text-amber-300">{shareNote}</p>}
            </div>

            {/* 1v1 or 2v2 Human Seats (NO AI Auto Fill in Play with Friends) */}
            {room.matchFormat === '2v2' ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    teamLabel: t(language, 'teamAlpha'),
                    tone: 'text-sky-300',
                    members: [room.seats?.[0] ?? room.host, room.seats?.[2] ?? null],
                  },
                  {
                    teamLabel: t(language, 'teamBravo'),
                    tone: 'text-red-300',
                    members: [room.seats?.[1] ?? room.guest, room.seats?.[3] ?? null],
                  },
                ].map((team) => (
                  <div key={team.teamLabel} className="bg-[#161820] border border-white/10 rounded-2xl p-3 space-y-2">
                    <div className={`text-[10px] font-bold uppercase tracking-wider text-center ${team.tone}`}>
                      {team.teamLabel}
                    </div>
                    {team.members.map((member, mIdx) => (
                      <div
                        key={mIdx}
                        className="flex items-center gap-2 p-2 rounded-xl bg-[#0e1015] border border-white/8"
                      >
                        {member ? (
                          <>
                            <PlayerAvatar
                              avatarId={member.avatar}
                              customAvatarUrl={member.customAvatarUrl}
                              frameId={member.frame}
                              username={member.username}
                              size="sm"
                              online={member.online}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-zinc-100 truncate">{member.username}</div>
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-zinc-400 py-1 px-1">
                            {t(language, 'waitingOpponent')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#161820] border border-white/10 rounded-2xl p-3.5 flex flex-col items-center text-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Host</span>
                  {room.host && (
                    <>
                      <PlayerAvatar
                        avatarId={room.host.avatar}
                        customAvatarUrl={room.host.customAvatarUrl}
                        frameId={room.host.frame}
                        username={room.host.username}
                        size="lg"
                        online={room.host.online}
                      />
                      <div className="text-xs font-bold text-zinc-100 truncate max-w-full">{room.host.username}</div>
                    </>
                  )}
                </div>

                <div className="bg-[#161820] border border-white/10 rounded-2xl p-3.5 flex flex-col items-center justify-center text-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">
                    {isId ? 'Teman' : 'Friend'}
                  </span>
                  {room.guest ? (
                    <>
                      <PlayerAvatar
                        avatarId={room.guest.avatar}
                        customAvatarUrl={room.guest.customAvatarUrl}
                        frameId={room.guest.frame}
                        username={room.guest.username}
                        size="lg"
                        online={room.guest.online}
                      />
                      <div className="text-xs font-bold text-zinc-100 truncate max-w-full">{room.guest.username}</div>
                    </>
                  ) : (
                    <div className="py-5 space-y-1">
                      <div className="text-xs font-semibold text-zinc-300">{t(language, 'waitingOpponent')}</div>
                      <div className="text-[11px] text-zinc-400">
                        {isId ? 'Bagikan kode room di atas kepada teman' : 'Share the room code above with your friend'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Invite Friends List */}
            {isHost && !allHumanSeatsFilled && friends.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-zinc-300">
                  {t(language, 'inviteFriend')}
                  {inviteTarget ? ` · ${inviteTarget.username}` : ''}
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {friends.map((f) => {
                    const highlighted = inviteTarget?.uid === f.player.uid;
                    return (
                      <div
                        key={f.player.uid}
                        className={`flex items-center justify-between p-2 rounded-xl border ${
                          highlighted
                            ? 'bg-amber-950/40 border-amber-400/50'
                            : 'bg-[#161820] border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <PlayerAvatar
                            avatarId={f.player.avatar}
                            username={f.player.username}
                            size="sm"
                            online={f.player.online}
                          />
                          <span className="text-xs font-bold text-zinc-100">{f.player.username}</span>
                        </div>
                        <button
                          type="button"
                          disabled={invitedUids.has(f.player.uid)}
                          onClick={() => handleInviteFriend(f.player.uid)}
                          className="px-2.5 py-1 rounded-lg neu-btn-blue disabled:opacity-45 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>{invitedUids.has(f.player.uid) ? t(language, 'friendSent') : t(language, 'inviteFriend')}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!allHumanSeatsFilled && (
              <div className="text-center text-[11px] font-semibold text-amber-200 bg-amber-950/40 border border-amber-400/35 rounded-xl py-2 px-3">
                {t(language, 'waitingHumanSeats')}
              </div>
            )}

            {/* Action Footer */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void handleLeaveRoom()}
                className="px-5 py-3 rounded-2xl bg-[#161820] border border-white/12 text-zinc-200 hover:bg-[#1e212b] font-bold text-sm cursor-pointer transition-colors"
              >
                {t(language, 'leaveRoom')}
              </button>

              {isHost ? (
                <div className="flex-1 min-w-0">
                  <LiquidMetalButton
                    fullWidth
                    height={46}
                    disabled={!allHumanSeatsFilled || busyAction !== null}
                    onClick={() => void handleStartMatch()}
                    testId="start-room-match-btn"
                    icon={
                      busyAction === 'start' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                      ) : (
                        <Play className="w-4 h-4 fill-current text-amber-300" />
                      )
                    }
                    label={
                      busyAction === 'start'
                        ? isId
                          ? 'Memulai...'
                          : 'Starting...'
                        : t(language, 'startMatch')
                    }
                  />
                </div>
              ) : (
                <div className="flex-1 py-2.5 rounded-2xl bg-[#161820] border border-white/12 text-center text-xs text-zinc-300 font-bold">
                  {isId ? 'Menunggu host memulai...' : 'Waiting for host to start...'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
