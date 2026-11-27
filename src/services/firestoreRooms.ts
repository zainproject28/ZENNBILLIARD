import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { sanitizeEntryFee, TURN_DURATION_MS } from '../game/constants.ts';
import { stripUndefinedDeep } from '../game/matchmakingSpin.ts';
import { createInitialRulesState, createRackForVariant } from '../game/rack.ts';
import type {
  BallState,
  GameVariant,
  MatchFormat,
  MatchRulesState,
  PlayerSlot,
  ShotInput,
  UserProfile,
} from '../game/types.ts';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';

export interface FirestoreParticipant {
  uid: string;
  username: string;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints?: number;
  equippedCue: string;
  equippedTable: string;
  equippedEffect: string;
  online: boolean;
  connected: boolean;
  isBot?: boolean;
}

export interface FirestoreRoomDoc {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string;
  entryFee: number;
  gameVariant?: GameVariant;
  matchFormat?: MatchFormat;
  participants?: string[];
  matchId: string;
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  createdAt: string;
  expiresAt: string;
}

export interface FirestoreMatchAction {
  type: 'init' | 'aim' | 'place_cue_ball' | 'shot' | 'turn_resolved' | 'turn_timeout' | 'concede' | 'chat';
  actorSlot: PlayerSlot;
  seq: number;
  angle?: number;
  power?: number;
  spinX?: number;
  spinY?: number;
  cueId?: string;
  x?: number;
  y?: number;
  cueBallX?: number;
  cueBallY?: number;
  targetBallId?: number;
  aiReasonEn?: string;
  aiReasonId?: string;
  turnDeadlineAt?: number;
  text?: string;
  emote?: string;
  senderUid?: string;
  senderName?: string;
  timestamp?: number;
}

export interface FirestoreAimState {
  actorSlot: PlayerSlot;
  angle: number;
  spinX: number;
  spinY: number;
  power: number;
  targetBallId?: number;
  aiReasonEn?: string;
  aiReasonId?: string;
  timestamp: number;
}

export interface FirestoreMatchDoc {
  matchId: string;
  playerA: string;
  playerB: string;
  playerA2?: string;
  playerB2?: string;
  participants?: string[];
  gameMode: 'private_room';
  gameVariant?: GameVariant;
  matchFormat?: MatchFormat;
  currentTurn: PlayerSlot;
  status: 'active' | 'completed' | 'cancelled';
  winnerId: string;
  createdAt: string;
  endedAt?: string;
  entryFee: number;
  seq: number;
  winReason: string;
  balls: BallState[];
  rules: MatchRulesState;
  lastAction: FirestoreMatchAction;
  aimState?: FirestoreAimState;
  rematchStatus?: 'none' | 'pending' | 'accepted' | 'declined' | 'expired';
  rematchRequesterUid?: string;
  rematchExpiresAt?: number;
  rematchNextMatchId?: string;
}

const participantCache = new Map<string, FirestoreParticipant>();

export function buildBotParticipant(uid: string, name: string, avatar: string): FirestoreParticipant {
  return {
    uid,
    username: name,
    avatar,
    frame: 'frame_royal_gold',
    level: 14,
    rating: 1220,
    equippedCue: 'cue_gold',
    equippedTable: 'table_tournament_blue',
    equippedEffect: 'effect_gold_spark',
    online: true,
    connected: true,
    isBot: true,
  };
}

export function isFirebaseSessionActive(): boolean {
  return Boolean(auth.currentUser);
}

export function parseRoomErrorMessage(
  err: unknown,
  context?: {
    isBackendAvailable?: boolean;
    status?: number;
    dataError?: string;
    hasFirebaseUser?: boolean;
  },
): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  let parsedError = raw;
  let pathInfo = '';
  try {
    const obj = JSON.parse(raw) as { error?: string; path?: string };
    if (obj && typeof obj.error === 'string') {
      parsedError = obj.error;
      pathInfo = obj.path ? ` (${obj.path})` : '';
    }
  } catch {
    // Plain error message
  }

  const lower = parsedError.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return `Database rule rejected access${pathInfo}. Please sign in with Google again or verify Firestore rules.`;
  }
  if (lower.includes('unauthenticated') || lower.includes('firebase session not active') || context?.status === 401) {
    return 'Session authentication expired. Please sign in with Google again or reload to refresh your session.';
  }
  if (lower.includes('offline') || lower.includes('unavailable') || lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Network connection to the server or database failed. Check your internet connection and retry.';
  }
  if (context?.dataError) {
    return context.dataError;
  }
  if (context && context.isBackendAvailable === false && !context.hasFirebaseUser) {
    return 'Static hosting requires Google Sign In to create cross device Mabar rooms.';
  }
  return parsedError || 'Unable to create room due to an unexpected error.';
}

export async function fetchFirestoreParticipant(uid: string): Promise<FirestoreParticipant> {
  const cached = participantCache.get(uid);
  if (cached) return cached;

  const userPath = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const p = snap.data() as Partial<UserProfile>;
      const participant: FirestoreParticipant = {
        uid,
        username: p.username || 'Player',
        avatar: p.avatar || 'avatar_ace',
        customAvatarUrl: typeof p.customAvatarUrl === 'string' ? p.customAvatarUrl : '',
        frame: p.frame || 'frame_bronze',
        level: typeof p.level === 'number' ? p.level : 1,
        rating: typeof p.rating === 'number' ? p.rating : 1000,
        rankPoints: typeof p.rankPoints === 'number' ? p.rankPoints : 0,
        equippedCue: p.equippedCue || 'cue_basic',
        equippedTable: p.equippedTable || 'table_tournament_blue',
        equippedEffect: p.equippedEffect || 'effect_classic',
        online: false,
        connected: false,
      };
      participantCache.set(uid, participant);
      return participant;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  return {
    uid,
    username: 'Player',
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    level: 1,
    rating: 1000,
    equippedCue: 'cue_basic',
    equippedTable: 'table_tournament_blue',
    equippedEffect: 'effect_classic',
    online: false,
    connected: false,
  };
}

export async function mirrorCreatedRoomToFirestore(params: {
  roomCode: string;
  hostId: string;
  entryFee: number;
  gameVariant?: GameVariant;
  matchFormat?: MatchFormat;
}): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || user.uid !== params.hostId) return false;

  const roomId = `room_${params.roomCode}`;
  const path = `rooms/${roomId}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 30);
  const gameVariant: GameVariant = params.gameVariant === '9ball' ? '9ball' : '8ball';
  const matchFormat: MatchFormat = params.matchFormat === '2v2' ? '2v2' : '1v1';

  try {
    const existing = await getDoc(doc(db, 'rooms', roomId));
    if (existing.exists()) {
      return false;
    }

    const roomDoc: FirestoreRoomDoc = {
      roomId,
      roomCode: params.roomCode,
      hostId: user.uid,
      guestId: '',
      entryFee: sanitizeEntryFee(params.entryFee),
      gameVariant,
      matchFormat,
      participants: [user.uid],
      matchId: '',
      status: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    await setDoc(doc(db, 'rooms', roomId), roomDoc);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createFirestoreRoomDirectly(params: {
  hostProfile: UserProfile;
  entryFee: number;
  gameVariant: GameVariant;
  matchFormat?: MatchFormat;
}): Promise<{
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  entryFee: number;
  gameVariant: GameVariant;
  matchFormat: MatchFormat;
  participantIds: string[];
  seats: (FirestoreParticipant | null)[];
  status: string;
  matchId: string;
  host: FirestoreParticipant;
  guest: null;
  isFirestoreBridged: true;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Firebase session not active');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const matchFormat: MatchFormat = params.matchFormat === '2v2' ? '2v2' : '1v1';
  let createdCode = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    let candidate = '';
    for (let i = 0; i < 6; i++) {
      candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const ok = await mirrorCreatedRoomToFirestore({
      roomCode: candidate,
      hostId: user.uid,
      entryFee: params.entryFee,
      gameVariant: params.gameVariant,
      matchFormat,
    });
    if (ok) {
      createdCode = candidate;
      break;
    }
  }

  if (!createdCode) {
    throw new Error('Could not reserve a unique Firestore room code after multiple attempts.');
  }

  const host = await fetchFirestoreParticipant(user.uid);
  return {
    roomId: `room_${createdCode}`,
    roomCode: createdCode,
    hostId: user.uid,
    guestId: null,
    entryFee: params.entryFee,
    gameVariant: params.gameVariant,
    matchFormat,
    participantIds: [user.uid],
    seats: matchFormat === '2v2' ? [host, null, null, null] : [host, null],
    status: 'waiting',
    matchId: '',
    host,
    guest: null,
    isFirestoreBridged: true,
  };
}

export interface FirestoreOpenRoomSummary {
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
    frame: string;
    rating: number;
    online: boolean;
  } | null;
}

export async function listOpenFirestoreRooms(): Promise<FirestoreOpenRoomSummary[]> {
  if (!auth.currentUser) return [];
  const path = 'rooms';
  try {
    const snap = await getDocs(
      query(collection(db, 'rooms'), where('status', '==', 'waiting'), limit(25)),
    );
    const now = Date.now();
    const summaries: FirestoreOpenRoomSummary[] = [];

    for (const d of snap.docs) {
      const data = d.data() as FirestoreRoomDoc;
      if (!data.roomCode || !data.hostId) continue;
      if (new Date(data.expiresAt).getTime() < now) continue;
      const fmt: MatchFormat = data.matchFormat === '2v2' ? '2v2' : '1v1';
      const maxSeats = fmt === '2v2' ? 4 : 2;
      const participants = Array.isArray(data.participants) && data.participants.length > 0
        ? data.participants
        : [data.hostId, ...(data.guestId ? [data.guestId] : [])];
      if (participants.length >= maxSeats) continue;

      const host = await fetchFirestoreParticipant(data.hostId).catch(() => null);
      summaries.push({
        roomId: data.roomId,
        roomCode: data.roomCode,
        entryFee: data.entryFee || 0,
        gameVariant: data.gameVariant === '9ball' ? '9ball' : '8ball',
        matchFormat: fmt,
        seatsCount: participants.length,
        maxSeats,
        createdAt: new Date(data.createdAt).getTime() || now,
        host: host
          ? {
              username: host.username,
              avatar: host.avatar,
              frame: host.frame,
              rating: host.rating,
              online: false,
            }
          : null,
      });
    }

    return summaries.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export interface FirestoreRoomInvite {
  inviteId: string;
  roomId: string;
  roomCode: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  targetUid: string;
  entryFee: number;
  gameVariant: GameVariant;
  matchFormat: MatchFormat;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export async function sendFirestoreRoomInvite(params: {
  roomId: string;
  roomCode: string;
  hostProfile: UserProfile;
  targetUid: string;
  entryFee: number;
  gameVariant?: GameVariant;
  matchFormat?: MatchFormat;
}): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || user.uid !== params.hostProfile.uid || !params.targetUid) return false;
  const inviteId = `inv_${params.roomCode}_${params.targetUid.slice(0, 16)}_${Date.now().toString(36)}`;
  const path = `room_invites/${inviteId}`;
  const docData: FirestoreRoomInvite = {
    inviteId,
    roomId: params.roomId,
    roomCode: params.roomCode,
    hostId: user.uid,
    hostName: (params.hostProfile.username || 'Host').slice(0, 32),
    hostAvatar: (params.hostProfile.avatar || 'avatar_ace').slice(0, 64),
    targetUid: params.targetUid,
    entryFee: sanitizeEntryFee(params.entryFee),
    gameVariant: params.gameVariant === '9ball' ? '9ball' : '8ball',
    matchFormat: params.matchFormat === '2v2' ? '2v2' : '1v1',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'room_invites', inviteId), docData);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeFirestoreRoomInvites(
  targetUid: string,
  onInvite: (invite: FirestoreRoomInvite) => void,
): Unsubscribe {
  if (!auth.currentUser || !targetUid) return () => {};
  const q = query(
    collection(db, 'room_invites'),
    where('targetUid', '==', targetUid),
    where('status', '==', 'pending'),
    limit(10),
  );
  return onSnapshot(
    q,
    (snap) => {
      const recentCutoff = Date.now() - 1000 * 60 * 15;
      for (const d of snap.docs) {
        const inv = d.data() as FirestoreRoomInvite;
        const ts = new Date(inv.createdAt).getTime();
        if (Number.isFinite(ts) && ts >= recentCutoff) {
          onInvite(inv);
          break;
        }
      }
    },
    () => {
      // Non-fatal subscription warning
    },
  );
}

export async function respondFirestoreRoomInvite(
  inviteId: string,
  status: 'accepted' | 'declined',
): Promise<void> {
  if (!auth.currentUser || !inviteId) return;
  const path = `room_invites/${inviteId}`;
  try {
    await updateDoc(doc(db, 'room_invites', inviteId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function joinRoomViaFirestore(
  roomCode: string,
  currentProfile: UserProfile,
): Promise<
  | {
      ok: true;
      room: {
        roomId: string;
        roomCode: string;
        hostId: string;
        guestId: string | null;
        entryFee: number;
        gameVariant: GameVariant;
        matchFormat: MatchFormat;
        participantIds: string[];
        seats: (FirestoreParticipant | null)[];
        status: string;
        matchId: string;
        host: FirestoreParticipant | null;
        guest: FirestoreParticipant | null;
        isFirestoreBridged: true;
      };
    }
  | { ok: false; code: string; error: string }
> {
  const user = auth.currentUser;
  if (!user) {
    return {
      ok: false,
      code: 'NOT_SIGNED_IN',
      error: 'Please sign in first before joining an online room.',
    };
  }

  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;
  let data: FirestoreRoomDoc;

  try {
    const snap = await getDoc(doc(db, 'rooms', roomId));
    if (!snap.exists()) {
      return { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room not found' };
    }
    data = snap.data() as FirestoreRoomDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (data.status === 'cancelled' || data.status === 'finished') {
    return { ok: false, code: 'ROOM_EXPIRED', error: 'Room has expired or was closed' };
  }
  if (new Date(data.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'ROOM_EXPIRED', error: 'Room code expired' };
  }
  if (data.status !== 'waiting') {
    return { ok: false, code: 'IN_PROGRESS', error: 'Match already in progress' };
  }

  const matchFormat: MatchFormat = data.matchFormat === '2v2' ? '2v2' : '1v1';
  const maxSeats = matchFormat === '2v2' ? 4 : 2;
  const currentParticipants = Array.isArray(data.participants) && data.participants.length > 0
    ? [...data.participants]
    : [data.hostId, ...(data.guestId ? [data.guestId] : [])];

  if (!currentParticipants.includes(user.uid) && currentParticipants.length >= maxSeats) {
    return { ok: false, code: 'ROOM_FULL', error: 'Room Is Full' };
  }
  if (currentProfile.coins < data.entryFee) {
    return { ok: false, code: 'INSUFFICIENT_COINS', error: 'Insufficient coins for this room stake.' };
  }

  if (!currentParticipants.includes(user.uid)) {
    const nextParticipants = [...currentParticipants, user.uid];
    const nextGuestId = data.guestId || (nextParticipants[1] ?? '');
    try {
      await updateDoc(doc(db, 'rooms', roomId), {
        guestId: nextGuestId,
        participants: nextParticipants,
      });
      data = { ...data, guestId: nextGuestId, participants: nextParticipants };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const finalIds = Array.isArray(data.participants) && data.participants.length > 0
    ? data.participants
    : [data.hostId, ...(data.guestId ? [data.guestId] : [])];
  const resolved = await Promise.all(finalIds.map((uid) => fetchFirestoreParticipant(uid)));
  const seats: (FirestoreParticipant | null)[] = Array.from({ length: maxSeats }, (_, idx) => resolved[idx] ?? null);

  return {
    ok: true,
    room: {
      roomId: data.roomId,
      roomCode: data.roomCode,
      hostId: data.hostId,
      guestId: data.guestId || null,
      entryFee: data.entryFee,
      gameVariant: data.gameVariant === '9ball' ? '9ball' : '8ball',
      matchFormat,
      participantIds: finalIds,
      seats,
      status: data.status,
      matchId: data.matchId || '',
      host: seats[0] ?? null,
      guest: seats[1] ?? null,
      isFirestoreBridged: true,
    },
  };
}

export function subscribeFirestoreRoom(
  roomCode: string,
  onRoomChange: (room: {
    roomId: string;
    roomCode: string;
    hostId: string;
    guestId: string | null;
    entryFee: number;
    gameVariant: GameVariant;
    matchFormat: MatchFormat;
    participantIds: string[];
    seats: (FirestoreParticipant | null)[];
    status: string;
    matchId: string;
    host: FirestoreParticipant | null;
    guest: FirestoreParticipant | null;
  }) => void,
): Unsubscribe {
  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;

  return onSnapshot(
    doc(db, 'rooms', roomId),
    async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as FirestoreRoomDoc;
      const matchFormat: MatchFormat = data.matchFormat === '2v2' ? '2v2' : '1v1';
      const maxSeats = matchFormat === '2v2' ? 4 : 2;
      const participantIds = Array.isArray(data.participants) && data.participants.length > 0
        ? data.participants
        : [data.hostId, ...(data.guestId ? [data.guestId] : [])];
      const resolved = await Promise.all(participantIds.map((uid) => fetchFirestoreParticipant(uid)));
      const seats: (FirestoreParticipant | null)[] = Array.from({ length: maxSeats }, (_, idx) => resolved[idx] ?? null);
      onRoomChange({
        roomId: data.roomId,
        roomCode: data.roomCode,
        hostId: data.hostId,
        guestId: data.guestId || null,
        entryFee: data.entryFee,
        gameVariant: data.gameVariant === '9ball' ? '9ball' : '8ball',
        matchFormat,
        participantIds,
        seats,
        status: data.status,
        matchId: data.matchId || '',
        host: seats[0] ?? null,
        guest: seats[1] ?? null,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    },
  );
}

export async function leaveFirestoreRoom(roomCode: string, isHost: boolean): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const roomId = `room_${roomCode}`;
  const path = `rooms/${roomId}`;

  try {
    const snap = await getDoc(doc(db, 'rooms', roomId));
    if (!snap.exists()) return;
    const data = snap.data() as FirestoreRoomDoc;
    if (data.status !== 'waiting') return;

    if (isHost && data.hostId === user.uid) {
      await updateDoc(doc(db, 'rooms', roomId), { status: 'cancelled' });
    } else if (data.hostId !== user.uid) {
      const currentParticipants = Array.isArray(data.participants) ? data.participants : [data.hostId, ...(data.guestId ? [data.guestId] : [])];
      const remaining = currentParticipants.filter((id) => id !== user.uid);
      const nextGuest = remaining[1] ?? '';
      await updateDoc(doc(db, 'rooms', roomId), {
        guestId: nextGuest,
        participants: remaining,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function startFirestoreMatch(
  roomCode: string,
  hostProfile: UserProfile,
  guestOrParticipants: string | string[],
  entryFee: number,
  gameVariant: GameVariant = '8ball',
  matchFormat: MatchFormat = '1v1',
): Promise<
  FirestoreMatchDoc & {
    playerAInfo: FirestoreParticipant;
    playerBInfo: FirestoreParticipant;
    playerA2Info?: FirestoreParticipant;
    playerB2Info?: FirestoreParticipant;
  }
> {
  const user = auth.currentUser;
  if (!user || user.uid !== hostProfile.uid) {
    throw new Error('Only the authenticated host can start this match.');
  }

  const rawList = Array.isArray(guestOrParticipants)
    ? guestOrParticipants.filter(Boolean)
    : [hostProfile.uid, guestOrParticipants].filter(Boolean);

  const requiredHumans = matchFormat === '2v2' ? 4 : 2;
  if (rawList.length < requiredHumans) {
    throw new Error('All player seats must be filled by real players before starting.');
  }

  // Seats: [0]=A1 (host), [1]=B1, [2]=A2, [3]=B2
  const pA = rawList[0];
  const pB = rawList[1];
  const pA2 = matchFormat === '2v2' ? rawList[2] : undefined;
  const pB2 = matchFormat === '2v2' ? rawList[3] : undefined;
  const participants = matchFormat === '2v2' ? [pA, pB, pA2!, pB2!] : [pA, pB];

  const matchId = `mf_${roomCode}_${Date.now().toString(36)}`;
  const matchPath = `matches/${matchId}`;
  const roomId = `room_${roomCode}`;
  const roomPath = `rooms/${roomId}`;

  const nowIso = new Date().toISOString();
  const initialDeadline = Date.now() + TURN_DURATION_MS + 1800;
  const initialRules: MatchRulesState = {
    ...createInitialRulesState('A', gameVariant, matchFormat),
    turnDeadlineAt: initialDeadline,
  };
  const initialMatch: FirestoreMatchDoc = {
    matchId,
    playerA: pA,
    playerB: pB,
    ...(pA2 ? { playerA2: pA2 } : {}),
    ...(pB2 ? { playerB2: pB2 } : {}),
    participants,
    gameMode: 'private_room',
    gameVariant,
    matchFormat,
    currentTurn: 'A',
    status: 'active',
    winnerId: '',
    createdAt: nowIso,
    entryFee,
    seq: 1,
    winReason: '',
    balls: createRackForVariant(gameVariant),
    rules: initialRules,
    lastAction: {
      type: 'init',
      actorSlot: 'A',
      seq: 1,
      turnDeadlineAt: initialDeadline,
      timestamp: Date.now(),
    },
  };

  try {
    await setDoc(doc(db, 'matches', matchId), stripUndefinedDeep(initialMatch));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, matchPath);
  }

  try {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'playing',
      matchId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }

  const [playerAInfo, playerBInfo, playerA2Info, playerB2Info] = await Promise.all([
    fetchFirestoreParticipant(pA),
    fetchFirestoreParticipant(pB),
    pA2 ? fetchFirestoreParticipant(pA2) : Promise.resolve(undefined),
    pB2 ? fetchFirestoreParticipant(pB2) : Promise.resolve(undefined),
  ]);

  return {
    ...initialMatch,
    playerAInfo,
    playerBInfo,
    ...(playerA2Info ? { playerA2Info } : {}),
    ...(playerB2Info ? { playerB2Info } : {}),
  };
}

export async function loadFirestoreMatch(
  matchId: string,
): Promise<
  | (FirestoreMatchDoc & {
      playerAInfo: FirestoreParticipant;
      playerBInfo: FirestoreParticipant;
      playerA2Info?: FirestoreParticipant;
      playerB2Info?: FirestoreParticipant;
    })
  | null
> {
  const path = `matches/${matchId}`;
  try {
    const snap = await getDoc(doc(db, 'matches', matchId));
    if (!snap.exists()) return null;
    const data = snap.data() as FirestoreMatchDoc;
    const [playerAInfo, playerBInfo, playerA2Info, playerB2Info] = await Promise.all([
      fetchFirestoreParticipant(data.playerA),
      fetchFirestoreParticipant(data.playerB),
      data.playerA2 ? fetchFirestoreParticipant(data.playerA2) : Promise.resolve(undefined),
      data.playerB2 ? fetchFirestoreParticipant(data.playerB2) : Promise.resolve(undefined),
    ]);
    return {
      ...data,
      playerAInfo,
      playerBInfo,
      ...(playerA2Info ? { playerA2Info } : {}),
      ...(playerB2Info ? { playerB2Info } : {}),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeFirestoreMatch(
  matchId: string,
  onMatchUpdate: (matchDoc: FirestoreMatchDoc) => void,
): Unsubscribe {
  const path = `matches/${matchId}`;
  return onSnapshot(
    doc(db, 'matches', matchId),
    (snap) => {
      if (!snap.exists()) return;
      onMatchUpdate(snap.data() as FirestoreMatchDoc);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    },
  );
}

export async function pushFirestoreMatchAction(
  matchId: string,
  payload: Partial<
    Pick<
      FirestoreMatchDoc,
      'currentTurn' | 'status' | 'winnerId' | 'endedAt' | 'seq' | 'winReason' | 'balls' | 'rules' | 'lastAction' | 'aimState'
    >
  >,
): Promise<void> {
  const path = `matches/${matchId}`;
  try {
    await updateDoc(doc(db, 'matches', matchId), stripUndefinedDeep(payload));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function pushFirestoreAimState(
  matchId: string,
  aimState: FirestoreAimState,
): Promise<void> {
  const path = `matches/${matchId}`;
  try {
    await updateDoc(doc(db, 'matches', matchId), { aimState: stripUndefinedDeep(aimState) });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function requestFirestoreRematch(
  matchId: string,
  requesterUid: string,
  expiresAt: number = Date.now() + 30_000,
): Promise<void> {
  if (!auth.currentUser) return;
  const path = `matches/${matchId}`;
  try {
    await updateDoc(doc(db, 'matches', matchId), {
      rematchStatus: 'pending',
      rematchRequesterUid: requesterUid,
      rematchExpiresAt: expiresAt,
      rematchNextMatchId: '',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function respondFirestoreRematch(
  currentMatch: FirestoreMatchDoc,
  accept: boolean,
): Promise<string | null> {
  if (!auth.currentUser) return null;
  const path = `matches/${currentMatch.matchId}`;
  try {
    if (!accept) {
      await updateDoc(doc(db, 'matches', currentMatch.matchId), {
        rematchStatus: 'declined',
      });
      return null;
    }

    const nextMatchId = `mf_re_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const gameVariant: GameVariant = currentMatch.gameVariant === '9ball' ? '9ball' : '8ball';
    const matchFormat: MatchFormat = currentMatch.matchFormat === '2v2' ? '2v2' : '1v1';
    const initialDeadline = Date.now() + TURN_DURATION_MS + 1800;
    const nextDoc: FirestoreMatchDoc = {
      matchId: nextMatchId,
      playerA: currentMatch.playerA,
      playerB: currentMatch.playerB,
      ...(currentMatch.playerA2 ? { playerA2: currentMatch.playerA2 } : {}),
      ...(currentMatch.playerB2 ? { playerB2: currentMatch.playerB2 } : {}),
      ...(currentMatch.participants ? { participants: currentMatch.participants } : {}),
      gameMode: 'private_room',
      gameVariant,
      matchFormat,
      currentTurn: 'A',
      status: 'active',
      winnerId: '',
      createdAt: new Date().toISOString(),
      entryFee: currentMatch.entryFee || 0,
      seq: 1,
      winReason: '',
      balls: createRackForVariant(gameVariant),
      rules: {
        ...createInitialRulesState('A', gameVariant, matchFormat),
        turnDeadlineAt: initialDeadline,
      },
      lastAction: {
        type: 'init',
        actorSlot: 'A',
        seq: 1,
        turnDeadlineAt: initialDeadline,
        timestamp: Date.now(),
      },
    };
    await setDoc(doc(db, 'matches', nextMatchId), nextDoc);
    await updateDoc(doc(db, 'matches', currentMatch.matchId), {
      rematchStatus: 'accepted',
      rematchNextMatchId: nextMatchId,
    });
    return nextMatchId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function expireFirestoreRematch(matchId: string): Promise<void> {
  if (!auth.currentUser) return;
  const path = `matches/${matchId}`;
  try {
    await updateDoc(doc(db, 'matches', matchId), {
      rematchStatus: 'expired',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function buildShotAction(
  actorSlot: PlayerSlot,
  seq: number,
  shot: ShotInput,
): FirestoreMatchAction {
  return {
    type: 'shot',
    actorSlot,
    seq,
    angle: shot.angle,
    power: shot.power,
    spinX: shot.spinX,
    spinY: shot.spinY,
    ...(shot.cueId ? { cueId: shot.cueId } : {}),
    ...(shot.cueBallPos ? { cueBallX: shot.cueBallPos.x, cueBallY: shot.cueBallPos.y } : {}),
    timestamp: Date.now(),
  };
}
