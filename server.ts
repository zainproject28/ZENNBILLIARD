import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, getApp as getAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BILLIARD_EMOTES,
  DAILY_REWARD_SCHEDULE,
  DEFAULT_FREE_OWNED_ITEMS,
  getCueStats,
  PHYSICS_PARAMS,
  QUICK_CHAT_MESSAGES,
  sanitizeEntryFee,
  SHOP_CATALOG,
  TURN_DURATION_MS,
} from './src/game/constants.ts';
import { isValidCustomAvatarDataUrl } from './src/game/avatarCrop.ts';
import { applyXpProgress, calculateEloDelta, computeMatchRewards } from './src/game/elo.ts';
import {
  applyCueShot,
  areBallsMoving,
  cloneBalls,
  findSafeCueBallSpot,
  isValidCueBallPlacement,
  stepPhysicsFrame,
} from './src/game/physics.ts';
import { createInitialRulesState, createRackForVariant } from './src/game/rack.ts';
import { generateRandomPlayerId, isFormattedNineDigitPlayerId, matchesPlayerIdQuery } from './src/game/playerId.ts';
import {
  applyCompletedMatchToStats,
  areRanksMatchmakingCompatible,
  computeBotRankedDelta,
  computeHumanRankedDelta,
  createEmptyPlayerStats,
  getBotConfigForRank,
  normalizePlayerStats,
} from './src/game/rank.ts';
import { extractRoomCode, isValidRoomCode } from './src/game/roomCode.ts';
import { evaluateShotOutcome, evaluateTurnTimeout } from './src/game/rules.ts';
import { computeAiShotPlan, chooseAiCueBallPlacement } from './src/game/ai.ts';
import {
  evaluatePlayerProximity,
  isRealRegisteredPlayer,
  sanitizePlayerLocation,
  sortPlayersByProximity,
} from './src/game/location.ts';
import type {
  AiDifficulty,
  AuthProviderType,
  BallState,
  GameVariant,
  MatchFormat,
  MatchRulesState,
  PlayerLocation,
  PlayerSlot,
  ShotInput,
  ShotTelemetry,
  UserProfile,
} from './src/game/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Initialize Firebase Admin ONLY for ID Token verification (no IAM required)
let firebaseProjectId = '';
try {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    if (cfg.projectId && cfg.projectId !== 'remixed-project-id') {
      firebaseProjectId = cfg.projectId;
    }
  }
} catch {
  // Handled gracefully
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`${firebaseProjectId || 'zenn_billiard'}::zenn_billiard_session_v1`)
    .digest('hex');

if (firebaseProjectId) {
  const adminApp = getAdminApps().length
    ? getAdminApp()
    : initializeAdminApp({ projectId: firebaseProjectId });
  void adminApp;
}

// ============================================================================
// HMAC Token Helpers for Guest Sessions & Match Reconnect Tokens
// ============================================================================
function signPayload(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedPayload<T>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface VerifiedIdentity {
  uid: string;
  isGuest: boolean;
  authProvider: AuthProviderType;
  email?: string;
}

async function authenticateBearer(authHeader?: string): Promise<VerifiedIdentity | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // 1. Check HMAC guest token
  if (token.startsWith('guest_')) {
    const raw = token.slice(6);
    const parsed = verifySignedPayload<{ uid: string; exp: number }>(raw);
    if (parsed && parsed.uid && parsed.exp > Date.now()) {
      return { uid: parsed.uid, isGuest: true, authProvider: 'guest' };
    }
    return null;
  }

  // 2. Verify Firebase ID token
  if (firebaseProjectId) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      const signInProvider = decoded.firebase?.sign_in_provider;
      const isAnonymous = signInProvider === 'anonymous';
      const authProvider: AuthProviderType = isAnonymous
        ? 'guest'
        : signInProvider === 'google.com'
          ? 'google'
          : 'email';
      return {
        uid: decoded.uid,
        isGuest: isAnonymous,
        authProvider,
        email: decoded.email,
      };
    } catch {
      return null;
    }
  }

  return null;
}

async function authenticateRawToken(token: string): Promise<VerifiedIdentity | null> {
  return authenticateBearer(`Bearer ${token}`);
}

// ============================================================================
// Authoritative Server State (In-Memory Real-Time Coordinator)
// ============================================================================
interface MatchHistoryRecord {
  matchId: string;
  playerId: string;
  opponentName: string;
  opponentAvatar: string;
  result: 'win' | 'loss';
  shots: number;
  duration: number;
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  gameMode?: 'quick_match' | 'private_room' | 'online_ranked' | 'practice_ai';
  gameVariant?: GameVariant;
  isRanked?: boolean;
  isBotOpponent?: boolean;
  rankDelta?: number;
  createdAt: string;
}

interface TransactionRecord {
  transactionId: string;
  userId: string;
  amount: number;
  type: 'daily_reward' | 'match_reward' | 'match_entry' | 'shop_purchase' | 'starter_bonus';
  referenceId: string;
  createdAt: string;
}

interface FriendRecord {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  updatedAt: string;
}

interface PrivateRoomState {
  roomId: string;
  roomCode: string;
  hostId: string;
  guestId: string | null;
  participants: string[];
  matchFormat: MatchFormat;
  entryFee: number;
  gameVariant: GameVariant;
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  createdAt: number;
  expiresAt: number;
  matchId: string | null;
}

interface QueueEntry {
  uid: string;
  mode: 'quick_match' | 'online_ranked';
  gameVariant: GameVariant;
  entryFee: number;
  rating: number;
  rankPoints: number;
  joinedAt: number;
  lastPolledAt: number;
}

interface MatchParticipant {
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
  equippedVenue?: string;
  equippedEffect: string;
  connected: boolean;
  reconnectToken: string;
  isBot?: boolean;
  aiDifficulty?: AiDifficulty;
}

interface AuthoritativeMatch {
  matchId: string;
  roomId: string | null;
  gameMode: 'quick_match' | 'private_room' | 'online_ranked';
  matchFormat: MatchFormat;
  entryFee: number;
  playerA: MatchParticipant;
  playerB: MatchParticipant;
  playerA2?: MatchParticipant;
  playerB2?: MatchParticipant;
  seats: MatchParticipant[];
  balls: BallState[];
  rules: MatchRulesState;
  seq: number;
  simulating: boolean;
  simTimer: NodeJS.Timeout | null;
  aiTimer: NodeJS.Timeout | null;
  turnTimer: NodeJS.Timeout | null;
  turnDeadlineAt: number | null;
  telemetry: ShotTelemetry;
  startedAt: number;
  lastActivityAt: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  rematchVotes: Set<string>;
  rematchInitiatorUid: string | null;
  rematchTimer: NodeJS.Timeout | null;
  lastChatAt: Map<string, number>;
}

const RANKED_BOT_WAIT_MS = 5000;
const QUICK_MATCH_BOT_WAIT_MS = 4500;
const STATE_DIR = path.resolve(process.cwd(), '.zenn-data');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const profiles = new Map<string, UserProfile>();
const weeklyRatings = new Map<string, number>();
const friendRecords = new Map<string, FriendRecord>();
const matchHistoryStore = new Map<string, MatchHistoryRecord[]>();
const transactionStore = new Map<string, TransactionRecord[]>();
const activeSockets = new Map<string, Set<WebSocket>>();
const roomsByCode = new Map<string, PrivateRoomState>();
const roomsById = new Map<string, PrivateRoomState>();
const matchmakingQueue: QueueEntry[] = [];
const activeMatches = new Map<string, AuthoritativeMatch>();
const userMatchIndex = new Map<string, string>(); // uid -> matchId
const lastPracticeRecordedAt = new Map<string, number>();

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSaveServerState(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      const payload = {
        profiles: Array.from(profiles.entries()),
        weeklyRatings: Array.from(weeklyRatings.entries()),
        friendRecords: Array.from(friendRecords.entries()),
        matchHistoryStore: Array.from(matchHistoryStore.entries()),
        transactionStore: Array.from(transactionStore.entries()),
      };
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmp, STATE_FILE);
    } catch {
      // Non-fatal disk persistence fallback
    }
  }, 250);
}

function normalizeServerProfile(p: UserProfile): UserProfile {
  const lowerUid = (p.uid || '').toLowerCase();
  const inferredGuest =
    lowerUid.startsWith('guest_') ||
    lowerUid.startsWith('local_guest_') ||
    lowerUid.startsWith('bot_') ||
    lowerUid.startsWith('ranked_bot_') ||
    /^Guest_[0-9]+$/i.test(p.username || '');
  const authProvider: AuthProviderType | undefined = inferredGuest
    ? 'guest'
    : p.authProvider === 'google' || p.authProvider === 'email' || p.authProvider === 'guest'
      ? p.authProvider
      : undefined;
  const location = sanitizePlayerLocation(p.location);

  return {
    ...p,
    ...(authProvider ? { authProvider } : {}),
    ...(location ? { location } : {}),
    customAvatarUrl:
      typeof p.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(p.customAvatarUrl)
        ? p.customAvatarUrl
        : '',
    equippedVenue:
      typeof p.equippedVenue === 'string' && p.equippedVenue.length > 0
        ? p.equippedVenue
        : 'venue_billiard_cafe',
    rankPoints: typeof p.rankPoints === 'number' && Number.isFinite(p.rankPoints) ? Math.max(0, Math.floor(p.rankPoints)) : 0,
    highestRankPoints:
      typeof p.highestRankPoints === 'number' && Number.isFinite(p.highestRankPoints)
        ? Math.max(0, Math.floor(p.highestRankPoints))
        : 0,
    stats: normalizePlayerStats(p.stats),
  };
}

function loadServerStateFromDisk(): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      profiles?: [string, UserProfile][];
      weeklyRatings?: [string, number][];
      friendRecords?: [string, FriendRecord][];
      matchHistoryStore?: [string, MatchHistoryRecord[]][];
      transactionStore?: [string, TransactionRecord[]][];
    };
    if (Array.isArray(parsed.profiles)) {
      for (const [k, v] of parsed.profiles) {
        if (k && v && typeof v.uid === 'string') profiles.set(k, normalizeServerProfile(v));
      }
    }
    if (Array.isArray(parsed.weeklyRatings)) {
      for (const [k, v] of parsed.weeklyRatings) weeklyRatings.set(k, Number(v) || 0);
    }
    if (Array.isArray(parsed.friendRecords)) {
      for (const [k, v] of parsed.friendRecords) friendRecords.set(k, v);
    }
    if (Array.isArray(parsed.matchHistoryStore)) {
      for (const [k, v] of parsed.matchHistoryStore) matchHistoryStore.set(k, v);
    }
    if (Array.isArray(parsed.transactionStore)) {
      for (const [k, v] of parsed.transactionStore) transactionStore.set(k, v);
    }
  } catch {
    // Ignore corrupt disk state and start cleanly
  }
}
loadServerStateFromDisk();

function sanitizeUsername(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ .-]/g, '').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : `Player_${crypto.randomInt(1000, 9999)}`;
}

function isPlayerIdTaken(candidate: string, excludeUid?: string): boolean {
  for (const existing of profiles.values()) {
    if (existing.uid !== excludeUid && existing.playerId === candidate) return true;
  }
  return false;
}

function createDefaultProfile(
  uid: string,
  username?: string,
  preferredPlayerId?: string,
  authProvider?: AuthProviderType,
): UserProfile {
  const now = new Date().toISOString();
  const shortTag = uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const playerId =
    preferredPlayerId && isFormattedNineDigitPlayerId(preferredPlayerId) && !isPlayerIdTaken(preferredPlayerId, uid)
      ? preferredPlayerId
      : generateRandomPlayerId((cand) => isPlayerIdTaken(cand, uid));
  return {
    uid,
    playerId,
    username: sanitizeUsername(username || `Player ${shortTag}`),
    ...(authProvider ? { authProvider } : {}),
    avatar: 'avatar_ace',
    customAvatarUrl: '',
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
    createdAt: now,
    updatedAt: now,
  };
}

function getOrCreateProfile(uid: string, preferredName?: string): UserProfile {
  let profile = profiles.get(uid);
  if (!profile) {
    profile = createDefaultProfile(uid, preferredName);
    profiles.set(uid, profile);
    weeklyRatings.set(uid, 0);
    scheduleSaveServerState();
  }
  return profile;
}

function recordTransaction(
  userId: string,
  amount: number,
  type: TransactionRecord['type'],
  referenceId: string,
): TransactionRecord {
  const tx: TransactionRecord = {
    transactionId: `tx_${crypto.randomBytes(6).toString('hex')}`,
    userId,
    amount,
    type,
    referenceId,
    createdAt: new Date().toISOString(),
  };
  const list = transactionStore.get(userId) || [];
  list.unshift(tx);
  transactionStore.set(userId, list.slice(0, 100));
  return tx;
}

function sendToUser(uid: string, message: object): void {
  const sockets = activeSockets.get(uid);
  if (!sockets) return;
  const raw = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

function isUserOnline(uid: string): boolean {
  const sockets = activeSockets.get(uid);
  if (!sockets || sockets.size === 0) return false;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function broadcastPresenceToFriends(uid: string, online: boolean): void {
  for (const fr of friendRecords.values()) {
    if (fr.status !== 'accepted') continue;
    const other = fr.userId === uid ? fr.friendId : fr.friendId === uid ? fr.userId : null;
    if (other && isUserOnline(other)) {
      sendToUser(other, { type: 'friend:presence', uid, online });
    }
  }
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    if (!roomsByCode.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function serializeRoomUser(uid: string) {
  const u = profiles.get(uid);
  if (!u) return null;
  return {
    uid: u.uid,
    username: u.username,
    avatar: u.avatar,
    customAvatarUrl: u.customAvatarUrl || '',
    frame: u.frame,
    level: u.level,
    rating: u.rating,
    rankPoints: u.rankPoints ?? 0,
    online: isUserOnline(u.uid),
  };
}

function serializeRoom(room: PrivateRoomState) {
  const maxSeats = room.matchFormat === '2v2' ? 4 : 2;
  const host = serializeRoomUser(room.hostId);
  const guest = room.guestId ? serializeRoomUser(room.guestId) : null;
  const seats = Array.from({ length: maxSeats }, (_, i) => {
    const uid = room.participants[i];
    return uid ? serializeRoomUser(uid) : null;
  });
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    hostId: room.hostId,
    guestId: room.guestId,
    participants: room.participants,
    seats,
    matchFormat: room.matchFormat,
    entryFee: room.entryFee,
    gameVariant: room.gameVariant,
    status: room.status,
    expiresAt: room.expiresAt,
    matchId: room.matchId,
    host,
    guest,
  };
}

function findActiveWaitingRoomForUser(uid: string): PrivateRoomState | null {
  const now = Date.now();
  for (const room of roomsById.values()) {
    if (
      room.status === 'waiting' &&
      room.expiresAt > now &&
      (room.hostId === uid || room.guestId === uid || room.participants.includes(uid))
    ) {
      return room;
    }
  }
  return null;
}

function createPrivateRoomForUser(
  uid: string,
  rawEntryFee: unknown,
  rawGameVariant?: unknown,
  rawMatchFormat?: unknown,
) {
  const fee = sanitizeEntryFee(rawEntryFee);
  const gameVariant: GameVariant = rawGameVariant === '9ball' ? '9ball' : '8ball';
  const matchFormat: MatchFormat = rawMatchFormat === '2v2' ? '2v2' : '1v1';
  const profile = getOrCreateProfile(uid);
  if (profile.coins < fee) {
    return {
      ok: false as const,
      status: 400,
      code: 'INSUFFICIENT_COINS',
      error: 'Insufficient coins for selected table stake.',
    };
  }

  // Clean up any previous empty waiting room hosted by this user
  for (const [oldId, oldRoom] of roomsById.entries()) {
    if (oldRoom.hostId === uid && oldRoom.status === 'waiting' && oldRoom.participants.length <= 1) {
      oldRoom.status = 'cancelled';
      roomsByCode.delete(oldRoom.roomCode);
      roomsById.delete(oldId);
    }
  }

  const roomId = `room_${crypto.randomBytes(6).toString('hex')}`;
  const roomCode = generateRoomCode();
  const now = Date.now();
  const room: PrivateRoomState = {
    roomId,
    roomCode,
    hostId: uid,
    guestId: null,
    participants: [uid],
    matchFormat,
    entryFee: fee,
    gameVariant,
    status: 'waiting',
    createdAt: now,
    expiresAt: now + 1000 * 60 * 30,
    matchId: null,
  };
  roomsById.set(roomId, room);
  roomsByCode.set(roomCode, room);

  const serialized = serializeRoom(room);
  sendToUser(uid, { type: 'room:created', room: serialized });
  return { ok: true as const, room: serialized };
}

function joinPrivateRoomByCode(uid: string, rawCodeInput: unknown) {
  const code = typeof rawCodeInput === 'string' ? extractRoomCode(rawCodeInput) : '';
  if (!isValidRoomCode(code)) {
    return {
      ok: false as const,
      status: 400,
      code: 'INVALID_FORMAT',
      error: 'Enter a valid 6 character room code.',
    };
  }
  const room = roomsByCode.get(code);
  if (!room) {
    return {
      ok: false as const,
      status: 404,
      code: 'ROOM_NOT_FOUND',
      error: 'Room not found. Verify the code and try again.',
    };
  }
  if (room.expiresAt < Date.now() || room.status === 'cancelled' || room.status === 'finished') {
    return {
      ok: false as const,
      status: 410,
      code: 'ROOM_EXPIRED',
      error: 'This room has expired or closed.',
    };
  }
  if (room.participants.includes(uid)) {
    const serialized = serializeRoom(room);
    sendToUser(uid, { type: 'room:updated', room: serialized });
    return { ok: true as const, room: serialized };
  }
  const maxSeats = room.matchFormat === '2v2' ? 4 : 2;
  if (room.participants.length >= maxSeats) {
    return {
      ok: false as const,
      status: 409,
      code: 'ROOM_FULL',
      error: 'Room is already full.',
    };
  }
  if (room.status !== 'waiting') {
    return {
      ok: false as const,
      status: 409,
      code: 'IN_PROGRESS',
      error: 'Match is already in progress.',
    };
  }
  const profile = getOrCreateProfile(uid);
  if (profile.coins < room.entryFee) {
    return {
      ok: false as const,
      status: 400,
      code: 'INSUFFICIENT_COINS',
      error: 'Insufficient coins for this room stake.',
    };
  }

  room.participants.push(uid);
  if (!room.guestId) room.guestId = uid;
  const serialized = serializeRoom(room);
  const payload = { type: 'room:updated', room: serialized };
  for (const pUid of room.participants) {
    sendToUser(pUid, payload);
  }
  return { ok: true as const, room: serialized };
}

function leavePrivateRoomForUser(uid: string, roomId: string) {
  const room = roomsById.get(roomId);
  if (!room) return false;

  if (room.hostId !== uid && room.participants.includes(uid)) {
    room.participants = room.participants.filter((id) => id !== uid);
    room.guestId = room.participants[1] ?? null;
    const serialized = serializeRoom(room);
    for (const pUid of room.participants) {
      sendToUser(pUid, { type: 'room:updated', room: serialized });
    }
    sendToUser(uid, { type: 'room:left', roomId });
    return true;
  }
  if (room.hostId === uid) {
    room.participants = room.participants.filter((id) => id !== uid);
    if (room.participants.length > 0 && room.status === 'waiting') {
      const newHost = room.participants[0];
      room.hostId = newHost;
      room.guestId = room.participants[1] ?? null;
      const serialized = serializeRoom(room);
      for (const pUid of room.participants) {
        sendToUser(pUid, {
          type: 'room:updated',
          room: serialized,
          notice: pUid === newHost ? 'Host left. You are now the Room Host.' : undefined,
        });
      }
    } else {
      room.status = 'cancelled';
      roomsByCode.delete(room.roomCode);
      roomsById.delete(room.roomId);
    }
    sendToUser(uid, { type: 'room:left', roomId });
    return true;
  }
  return false;
}

function startPrivateRoomMatch(uid: string, roomId: string) {
  const room = roomsById.get(roomId);
  const requiredHumans = room?.matchFormat === '2v2' ? 4 : 2;
  if (!room || room.hostId !== uid || room.status !== 'waiting' || room.participants.length < requiredHumans) {
    return {
      ok: false as const,
      status: 400,
      code: 'NOT_READY',
      error:
        room?.matchFormat === '2v2'
          ? 'Need 4 human players in the room before starting a 2v2 match.'
          : 'Waiting for your friend to join before starting.',
    };
  }
  const humanUids = room.participants.slice(0, requiredHumans);
  for (const hUid of humanUids) {
    if (getOrCreateProfile(hUid).coins < room.entryFee) {
      return {
        ok: false as const,
        status: 400,
        code: 'INSUFFICIENT_COINS',
        error: 'One player has insufficient coins for this stake.',
      };
    }
  }
  if (room.entryFee > 0) {
    for (const hUid of humanUids) {
      const p = getOrCreateProfile(hUid);
      p.coins -= room.entryFee;
      recordTransaction(p.uid, -room.entryFee, 'match_entry', room.roomId);
    }
  }

  room.status = 'playing';
  const seatsUids: string[] =
    room.matchFormat === '2v2'
      ? [humanUids[0], humanUids[1], humanUids[2], humanUids[3]]
      : [humanUids[0], humanUids[1]];

  const match = createAuthoritativeMatch(
    seatsUids[0],
    seatsUids[1],
    'private_room',
    room.entryFee,
    room.roomId,
    room.gameVariant,
    room.matchFormat,
    seatsUids[2],
    seatsUids[3],
  );
  room.matchId = match.matchId;

  for (const hUid of humanUids) {
    sendToUser(hUid, { type: 'match:started', match: serializeMatchState(match, hUid) });
  }
  return { ok: true as const, match: serializeMatchState(match, room.hostId) };
}

function serializeParticipantPublic(p: MatchParticipant) {
  return {
    uid: p.uid,
    username: p.username,
    avatar: p.avatar,
    customAvatarUrl: p.customAvatarUrl || '',
    frame: p.frame,
    level: p.level,
    rating: p.rating,
    rankPoints: p.rankPoints ?? 0,
    equippedCue: p.equippedCue,
    equippedTable: p.equippedTable,
    equippedVenue: p.equippedVenue || 'venue_billiard_cafe',
    equippedEffect: p.equippedEffect,
    connected: p.connected,
    ...(p.isBot ? { isBot: true, aiDifficulty: p.aiDifficulty } : {}),
  };
}

function getSeatIndexForUid(match: AuthoritativeMatch, uid: string): number {
  return match.seats.findIndex((s) => s.uid === uid);
}

function serializeMatchState(match: AuthoritativeMatch, viewerUid: string) {
  const seatIdx = getSeatIndexForUid(match, viewerUid);
  const slot: PlayerSlot = seatIdx === 0 || seatIdx === 2 ? 'A' : 'B';
  const participant = seatIdx >= 0 ? match.seats[seatIdx] : match.playerA;
  return {
    matchId: match.matchId,
    roomId: match.roomId,
    gameMode: match.gameMode,
    matchFormat: match.matchFormat,
    entryFee: match.entryFee,
    yourSlot: slot,
    yourSeatIndex: seatIdx >= 0 ? seatIdx : 0,
    reconnectToken: participant.reconnectToken,
    seq: match.seq,
    simulating: match.simulating,
    balls: match.balls,
    rules: match.rules,
    turnDeadlineAt: match.turnDeadlineAt,
    serverNow: Date.now(),
    playerA: serializeParticipantPublic(match.playerA),
    playerB: serializeParticipantPublic(match.playerB),
    ...(match.playerA2 ? { playerA2: serializeParticipantPublic(match.playerA2) } : {}),
    ...(match.playerB2 ? { playerB2: serializeParticipantPublic(match.playerB2) } : {}),
  };
}

function toMatchParticipant(uid: string): MatchParticipant {
  if (uid === 'ai_partner') {
    return {
      uid,
      username: 'Ally AI (Pro)',
      avatar: 'avatar_royale',
      customAvatarUrl: '',
      frame: 'frame_royal_gold',
      level: 14,
      rating: 1240,
      rankPoints: 0,
      equippedCue: 'cue_gold',
      equippedTable: 'table_tournament_blue',
      equippedEffect: 'effect_gold_spark',
      connected: true,
      reconnectToken: 'bot',
      isBot: true,
      aiDifficulty: 'pro',
    };
  }
  if (uid === 'ai_opponent_1' || uid === 'ai_opponent_2') {
    return {
      uid,
      username: uid === 'ai_opponent_1' ? 'Zenn AI I' : 'Zenn AI II',
      avatar: uid === 'ai_opponent_1' ? 'avatar_shark' : 'avatar_master',
      customAvatarUrl: '',
      frame: 'frame_obsidian',
      level: 15,
      rating: 1260,
      rankPoints: 0,
      equippedCue: 'cue_carbon',
      equippedTable: 'table_tournament_blue',
      equippedEffect: 'effect_sky_trail',
      connected: true,
      reconnectToken: 'bot',
      isBot: true,
      aiDifficulty: 'pro',
    };
  }
  const p = getOrCreateProfile(uid);
  return {
    uid: p.uid,
    username: p.username,
    avatar: p.avatar,
    customAvatarUrl: p.customAvatarUrl || '',
    frame: p.frame,
    level: p.level,
    rating: p.rating,
    rankPoints: p.rankPoints ?? 0,
    equippedCue: p.equippedCue,
    equippedTable: p.equippedTable,
    equippedVenue: p.equippedVenue || 'venue_billiard_cafe',
    equippedEffect: p.equippedEffect,
    connected: isUserOnline(p.uid),
    reconnectToken: crypto.randomBytes(16).toString('hex'),
  };
}

function broadcastToMatch(match: AuthoritativeMatch, payload: object, excludeUid?: string): void {
  for (const s of match.seats) {
    if (s.isBot || s.uid === excludeUid) continue;
    sendToUser(s.uid, payload);
  }
}

function clearTurnTimer(match: AuthoritativeMatch): void {
  if (match.turnTimer) {
    clearTimeout(match.turnTimer);
    match.turnTimer = null;
  }
}

function resetAndStartTurnTimer(match: AuthoritativeMatch, extraGraceMs = 0): void {
  clearTurnTimer(match);
  if (match.rules.phase === 'gameover') {
    match.turnDeadlineAt = null;
    match.rules.turnDeadlineAt = null;
    return;
  }
  const waitMs = TURN_DURATION_MS + extraGraceMs;
  match.turnDeadlineAt = Date.now() + waitMs;
  match.rules.turnDeadlineAt = match.turnDeadlineAt;
  match.turnTimer = setTimeout(() => {
    match.turnTimer = null;
    if (match.simulating || match.rules.phase === 'gameover') return;
    if (match.aiTimer) {
      clearTimeout(match.aiTimer);
      match.aiTimer = null;
    }
    match.rules = evaluateTurnTimeout(match.rules);
    match.seq += 1;
    match.lastActivityAt = Date.now();
    resetAndStartTurnTimer(match);
    broadcastToMatch(match, {
      type: 'match:turn_timeout',
      matchId: match.matchId,
      seq: match.seq,
      rules: match.rules,
      turnDeadlineAt: match.turnDeadlineAt,
      serverNow: Date.now(),
    });
    scheduleServerAiTurnIfNeeded(match);
  }, waitMs);
}

function runServerPhysicsAndResolve(match: AuthoritativeMatch, shooterCueId: string, shot: ShotInput, shooterSlot: PlayerSlot): void {
  if (!applyCueShot(match.balls, shot, match.rules.headstringOnly, getCueStats(shooterCueId))) {
    return;
  }

  clearTurnTimer(match);
  match.turnDeadlineAt = null;
  match.rules.turnDeadlineAt = null;
  if (match.aiTimer) {
    clearTimeout(match.aiTimer);
    match.aiTimer = null;
  }

  match.seq += 1;
  match.simulating = true;
  match.lastActivityAt = Date.now();
  match.telemetry = {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };

  broadcastToMatch(match, {
    type: 'match:shot_accepted',
    matchId: match.matchId,
    seq: match.seq,
    shooterSlot,
    shot,
  });

  let frameCounter = 0;
  match.simTimer = setInterval(() => {
    const events = stepPhysicsFrame(match.balls, match.telemetry, PHYSICS_PARAMS.fixedDt);
    frameCounter += 1;

    if (frameCounter % 6 === 0 || events.some((e) => e.type === 'pocket')) {
      broadcastToMatch(match, {
        type: 'match:snapshot',
        matchId: match.matchId,
        seq: match.seq,
        balls: cloneBalls(match.balls),
        events,
      });
    }

    if (!areBallsMoving(match.balls) || frameCounter > 60 * 18) {
      if (match.simTimer) {
        clearInterval(match.simTimer);
        match.simTimer = null;
      }
      match.simulating = false;
      const nextRules = evaluateShotOutcome(match.rules, match.telemetry, match.balls);
      match.rules = nextRules;
      match.seq += 1;

      const cue = match.balls.find((b) => b.id === 0);
      if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
        const safe = findSafeCueBallSpot(match.balls, nextRules.headstringOnly);
        cue.x = safe.x;
        cue.y = safe.y;
        cue.vx = 0;
        cue.vy = 0;
        cue.pocketed = false;
        cue.pocketAnimProgress = 0;
        cue.pocketedInPocketId = null;
      }

      if (nextRules.phase === 'gameover' && nextRules.winner) {
        finalizeMatch(match, nextRules.winner, nextRules.winReason || 'Match finished');
      } else {
        resetAndStartTurnTimer(match);
        broadcastToMatch(match, {
          type: 'match:turn_resolved',
          matchId: match.matchId,
          seq: match.seq,
          balls: match.balls,
          rules: match.rules,
          turnDeadlineAt: match.turnDeadlineAt,
          serverNow: Date.now(),
        });
        scheduleServerAiTurnIfNeeded(match);
      }
    }
  }, 16);
}

function scheduleServerAiTurnIfNeeded(match: AuthoritativeMatch): void {
  if (match.aiTimer) {
    clearTimeout(match.aiTimer);
    match.aiTimer = null;
  }
  if (match.rules.phase === 'gameover' || match.simulating) return;
  const seatIdx = match.rules.activeSeatIndex ?? (match.rules.currentTurn === 'A' ? 0 : 1);
  const activeActor = match.seats[seatIdx];
  if (!activeActor || !activeActor.isBot) return;

  const botDifficulty: AiDifficulty = activeActor.aiDifficulty || 'pro';

  match.aiTimer = setTimeout(() => {
    match.aiTimer = null;
    if (match.rules.phase === 'gameover' || match.simulating) return;

    let cuePos: { x: number; y: number } | undefined;
    if (match.rules.ballInHand) {
      cuePos = chooseAiCueBallPlacement(match.balls, match.rules, botDifficulty);
      const cue = match.balls.find((b) => b.id === 0);
      if (cue) {
        cue.x = cuePos.x;
        cue.y = cuePos.y;
        cue.pocketed = false;
        cue.pocketAnimProgress = 0;
        match.seq += 1;
        broadcastToMatch(match, { type: 'match:cue_placed', matchId: match.matchId, x: cuePos.x, y: cuePos.y, seq: match.seq });
      }
    }

    const plan = computeAiShotPlan(match.balls, match.rules, botDifficulty);
    broadcastToMatch(match, {
      type: 'match:aim_update',
      matchId: match.matchId,
      angle: plan.shot.angle,
      spinX: plan.shot.spinX,
      spinY: plan.shot.spinY,
      power: plan.shot.power,
      isBotAim: true,
      targetBallId: plan.targetBallId,
      aiReasonEn: plan.reasonEn,
      aiReasonId: plan.reasonId,
    });

    match.aiTimer = setTimeout(() => {
      match.aiTimer = null;
      if (match.rules.phase === 'gameover' || match.simulating) return;
      const shot: ShotInput = {
        ...plan.shot,
        cueBallPos: cuePos,
        seq: match.seq + 1,
        cueId: activeActor.equippedCue,
      };
      runServerPhysicsAndResolve(match, activeActor.equippedCue, shot, seatIdx % 2 === 0 ? 'A' : 'B');
    }, 1150);
  }, 1050);
}

function createAuthoritativeMatch(
  uidA: string,
  uidB: string,
  gameMode: AuthoritativeMatch['gameMode'],
  entryFee: number,
  roomId: string | null = null,
  gameVariant: GameVariant = '8ball',
  matchFormat: MatchFormat = '1v1',
  uidA2?: string,
  uidB2?: string,
  customParticipantB?: MatchParticipant,
): AuthoritativeMatch {
  const playerA = toMatchParticipant(uidA);
  const playerB = customParticipantB ?? toMatchParticipant(uidB);
  const playerA2 = matchFormat === '2v2' && uidA2 ? toMatchParticipant(uidA2) : undefined;
  const playerB2 = matchFormat === '2v2' && uidB2 ? toMatchParticipant(uidB2) : undefined;
  const seats = [playerA, playerB, ...(playerA2 ? [playerA2] : []), ...(playerB2 ? [playerB2] : [])];

  const matchId = `m_${crypto.randomBytes(8).toString('hex')}`;
  const match: AuthoritativeMatch = {
    matchId,
    roomId,
    gameMode,
    matchFormat,
    entryFee,
    playerA,
    playerB,
    playerA2,
    playerB2,
    seats,
    balls: createRackForVariant(gameVariant),
    rules: createInitialRulesState('A', gameVariant, matchFormat),
    seq: 1,
    simulating: false,
    simTimer: null,
    aiTimer: null,
    turnTimer: null,
    turnDeadlineAt: null,
    telemetry: {
      firstContactBallId: null,
      pocketedBallIds: [],
      railContactAfterFirstHit: false,
      cushionHitCount: 0,
    },
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    disconnectTimers: new Map(),
    rematchVotes: new Set(),
    rematchInitiatorUid: null,
    rematchTimer: null,
    lastChatAt: new Map(),
  };

  activeMatches.set(matchId, match);
  for (const s of seats) {
    if (!s.isBot) userMatchIndex.set(s.uid, matchId);
  }
  resetAndStartTurnTimer(match, 1800);
  return match;
}

function finalizeMatch(match: AuthoritativeMatch, winnerSlot: PlayerSlot, winReason: string): void {
  clearTurnTimer(match);
  match.turnDeadlineAt = null;
  match.rules.turnDeadlineAt = null;
  if (match.simTimer) {
    clearInterval(match.simTimer);
    match.simTimer = null;
  }
  if (match.aiTimer) {
    clearTimeout(match.aiTimer);
    match.aiTimer = null;
  }
  match.simulating = false;
  for (const t of match.disconnectTimers.values()) clearTimeout(t);
  match.disconnectTimers.clear();

  match.rules.phase = 'gameover';
  match.rules.winner = winnerSlot;
  match.rules.winReason = winReason;

  const duration = Math.max(1, Math.round((Date.now() - match.startedAt) / 1000));
  const pA = match.playerA.isBot ? null : getOrCreateProfile(match.playerA.uid);
  const pB = match.playerB.isBot ? null : getOrCreateProfile(match.playerB.uid);
  const ratingA = pA?.rating ?? match.playerA.rating;
  const ratingB = pB?.rating ?? match.playerB.rating;

  const aWon = winnerSlot === 'A';
  const deltaA = calculateEloDelta(ratingA, ratingB, aWon);
  const deltaB = calculateEloDelta(ratingB, ratingA, !aWon);

  const rewA = computeMatchRewards(aWon, match.entryFee, match.rules.shotCountA);
  const rewB = computeMatchRewards(!aWon, match.entryFee, match.rules.shotCountB);
  const isRanked = match.gameMode === 'online_ranked';

  interface SeatSettlementResult {
    profile: UserProfile | null;
    rankBefore: number;
    rankAfter: number;
    rankDelta: number;
    isBotOpponent: boolean;
  }

  const settleSeat = (
    seat: MatchParticipant,
    opponentSeat: MatchParticipant,
    won: boolean,
    rew: ReturnType<typeof computeMatchRewards>,
    delta: number,
    shots: number,
  ): SeatSettlementResult => {
    const isBotOpp = Boolean(opponentSeat.isBot);
    if (seat.isBot) {
      return { profile: null, rankBefore: 0, rankAfter: 0, rankDelta: 0, isBotOpponent: isBotOpp };
    }
    const p = getOrCreateProfile(seat.uid);
    const prog = applyXpProgress(p.level, p.xp, rew.xpEarned);
    p.level = prog.level;
    p.xp = prog.xp;
    p.coins += rew.coinsEarned;
    p.rating = Math.max(100, p.rating + delta);
    p.matches += 1;
    if (won) p.wins += 1;
    else p.losses += 1;

    const rankBefore = p.rankPoints ?? 0;
    let rankDelta = 0;
    if (isRanked) {
      rankDelta = isBotOpp
        ? computeBotRankedDelta(rankBefore, won)
        : computeHumanRankedDelta(rankBefore, opponentSeat.rankPoints ?? 0, won);
      p.rankPoints = Math.max(0, rankBefore + rankDelta);
      p.highestRankPoints = Math.max(p.highestRankPoints ?? 0, p.rankPoints);
    }
    const rankAfter = p.rankPoints ?? 0;

    p.stats = applyCompletedMatchToStats(p.stats, {
      won,
      variant: match.rules.gameVariant,
      isRanked,
      isBotOpponent: isBotOpp,
    });
    p.updatedAt = new Date().toISOString();
    weeklyRatings.set(p.uid, (weeklyRatings.get(p.uid) || 0) + delta);
    if (rew.coinsEarned > 0) recordTransaction(p.uid, rew.coinsEarned, 'match_reward', match.matchId);

    const hist: MatchHistoryRecord = {
      matchId: match.matchId,
      playerId: p.uid,
      opponentName: opponentSeat.username,
      opponentAvatar: opponentSeat.avatar,
      result: won ? 'win' : 'loss',
      shots,
      duration,
      xpEarned: rew.xpEarned,
      coinsEarned: rew.coinsEarned,
      ratingDelta: delta,
      gameMode: match.gameMode,
      gameVariant: match.rules.gameVariant,
      isRanked,
      isBotOpponent: isBotOpp,
      rankDelta,
      createdAt: new Date().toISOString(),
    };
    const list = matchHistoryStore.get(p.uid) || [];
    list.unshift(hist);
    matchHistoryStore.set(p.uid, list.slice(0, 50));
    return { profile: p, rankBefore, rankAfter, rankDelta, isBotOpponent: isBotOpp };
  };

  const resA = settleSeat(match.playerA, match.playerB, aWon, rewA, deltaA, match.rules.shotCountA);
  const resB = settleSeat(match.playerB, match.playerA, !aWon, rewB, deltaB, match.rules.shotCountB);
  if (match.playerA2) settleSeat(match.playerA2, match.playerB, aWon, rewA, deltaA, match.rules.shotCountA);
  if (match.playerB2) settleSeat(match.playerB2, match.playerA, !aWon, rewB, deltaB, match.rules.shotCountB);

  if (match.roomId) {
    const room = roomsById.get(match.roomId);
    if (room) room.status = 'finished';
  }

  scheduleSaveServerState();

  const endPayload = {
    type: 'match:ended',
    matchId: match.matchId,
    winnerSlot,
    winReason,
    duration,
    rules: match.rules,
    balls: match.balls,
    rewards: {
      A: {
        xpEarned: rewA.xpEarned,
        coinsEarned: rewA.coinsEarned,
        ratingDelta: deltaA,
        isRanked,
        isBotOpponent: resA.isBotOpponent,
        rankBefore: resA.rankBefore,
        rankAfter: resA.rankAfter,
        rankDelta: resA.rankDelta,
        profile: resA.profile || pA || undefined,
      },
      B: {
        xpEarned: rewB.xpEarned,
        coinsEarned: rewB.coinsEarned,
        ratingDelta: deltaB,
        isRanked,
        isBotOpponent: resB.isBotOpponent,
        rankBefore: resB.rankBefore,
        rankAfter: resB.rankAfter,
        rankDelta: resB.rankDelta,
        profile: resB.profile || pB || undefined,
      },
    },
  };

  broadcastToMatch(match, endPayload);

  // Schedule stale match index cleanup so finished matches do not linger indefinitely
  setTimeout(() => {
    for (const s of match.seats) {
      if (!s.isBot && userMatchIndex.get(s.uid) === match.matchId) {
        userMatchIndex.delete(s.uid);
      }
    }
    if (match.rematchTimer) {
      clearTimeout(match.rematchTimer);
      match.rematchTimer = null;
    }
    activeMatches.delete(match.matchId);
  }, 120_000);
}

// ============================================================================
// Matchmaking Ticker (pairs real online users by tier / variant / rating)
// ============================================================================
function tryPairQueuedPlayers(targetUid?: string): AuthoritativeMatch | null {
  const now = Date.now();
  // Prune disconnected users who haven't polled recently
  for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
    const entry = matchmakingQueue[i];
    if (!isUserOnline(entry.uid) && now - entry.lastPolledAt > 12_000) {
      matchmakingQueue.splice(i, 1);
    }
  }

  for (let i = 0; i < matchmakingQueue.length; i++) {
    const a = matchmakingQueue[i];
    if (!a) continue;
    const waitSecA = (now - a.joinedAt) / 1000;
    const windowA = 200 + waitSecA * 35;

    for (let j = i + 1; j < matchmakingQueue.length; j++) {
      const b = matchmakingQueue[j];
      if (!b) continue;
      if (a.uid === b.uid) continue;
      if (a.mode !== b.mode || a.gameVariant !== b.gameVariant || a.entryFee !== b.entryFee) continue;

      const waitSecB = (now - b.joinedAt) / 1000;
      const waitMax = Math.max(waitSecA, waitSecB);

      const compatible =
        a.mode === 'online_ranked'
          ? areRanksMatchmakingCompatible(a.rankPoints, b.rankPoints, waitMax)
          : Math.abs(a.rating - b.rating) <= Math.max(windowA, 200 + waitSecB * 35);

      if (compatible) {
        const pA = getOrCreateProfile(a.uid);
        const pB = getOrCreateProfile(b.uid);
        if (pA.coins < a.entryFee || pB.coins < b.entryFee) continue;

        matchmakingQueue.splice(j, 1);
        matchmakingQueue.splice(i, 1);

        if (a.entryFee > 0) {
          pA.coins -= a.entryFee;
          pB.coins -= b.entryFee;
          recordTransaction(pA.uid, -a.entryFee, 'match_entry', 'queue_match');
          recordTransaction(pB.uid, -b.entryFee, 'match_entry', 'queue_match');
        }

        const match = createAuthoritativeMatch(pA.uid, pB.uid, a.mode, a.entryFee, null, a.gameVariant, '1v1');
        sendToUser(pA.uid, {
          type: 'queue:matched',
          match: serializeMatchState(match, pA.uid),
        });
        sendToUser(pB.uid, {
          type: 'queue:matched',
          match: serializeMatchState(match, pB.uid),
        });
        if (!targetUid || pA.uid === targetUid || pB.uid === targetUid) {
          return match;
        }
        i--;
        break;
      }
    }
  }
  return null;
}

setInterval(() => {
  tryPairQueuedPlayers();
}, 800);

// Prune expired rooms every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of roomsById.entries()) {
    if (room.status === 'waiting' && room.expiresAt < now) {
      room.status = 'cancelled';
      roomsByCode.delete(room.roomCode);
      roomsById.delete(id);
    }
  }
}, 60_000);

// ============================================================================
// Express App & HTTP/WebSocket Server
// ============================================================================
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => {
    const now = Date.now();
    let openRoomsCount = 0;
    for (const r of roomsById.values()) {
      const cap = r.matchFormat === '2v2' ? 4 : 2;
      if (r.status === 'waiting' && r.expiresAt > now && r.participants.length < cap) {
        openRoomsCount += 1;
      }
    }
    res.json({
      ok: true,
      onlinePlayers: activeSockets.size,
      activeMatches: activeMatches.size,
      openRoomsCount,
      queuedPlayers: matchmakingQueue.length,
      firebaseConfigured: Boolean(firebaseProjectId),
    });
  });

  // Guest Login (signed server token, optionally preserves prior username/uid/playerId)
  app.post('/api/auth/guest', (req, res) => {
    const rawName = typeof req.body?.username === 'string' ? req.body.username : '';
    const requestedUid = typeof req.body?.existingUid === 'string' ? req.body.existingUid.trim() : '';
    const preferredPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId.trim() : undefined;
    const isValidGuestUid = /^guest_[a-f0-9]{16}$/.test(requestedUid);
    const uid = isValidGuestUid ? requestedUid : `guest_${crypto.randomBytes(8).toString('hex')}`;

    let profile = profiles.get(uid);
    if (!profile) {
      profile = createDefaultProfile(
        uid,
        rawName || `Guest_${crypto.randomInt(1000, 9999)}`,
        preferredPlayerId,
        'guest',
      );
      profiles.set(uid, profile);
      weeklyRatings.set(uid, 0);
      recordTransaction(uid, 15000, 'starter_bonus', 'guest_welcome');
      scheduleSaveServerState();
    } else if (rawName.trim().length >= 2) {
      profile.username = sanitizeUsername(rawName);
      profile.authProvider = 'guest';
      profile.updatedAt = new Date().toISOString();
      scheduleSaveServerState();
    } else if (!profile.authProvider) {
      profile.authProvider = 'guest';
      scheduleSaveServerState();
    }

    const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
    const token = `guest_${signPayload({ uid, exp })}`;
    res.json({ token, profile });
  });

  // Sync Firebase profile with authoritative coordinator
  app.post('/api/profile/sync', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const incoming = req.body as Partial<UserProfile>;
    if (incoming.customAvatarUrl !== undefined) {
      if (typeof incoming.customAvatarUrl !== 'string' || !isValidCustomAvatarDataUrl(incoming.customAvatarUrl)) {
        res.status(400).json({ error: 'Unsupported custom photo format or size exceeds limit.' });
        return;
      }
    }

    const cleanLocation = sanitizePlayerLocation(incoming.location);
    const existing = profiles.get(identity.uid);
    if (!existing) {
      // Security: Never trust client-submitted rankPoints, highestRankPoints, or stats on creation
      const fresh = createDefaultProfile(
        identity.uid,
        typeof incoming.username === 'string' ? incoming.username : undefined,
        typeof incoming.playerId === 'string' ? incoming.playerId : undefined,
        identity.authProvider,
      );
      if (cleanLocation) fresh.location = cleanLocation;
      if (typeof incoming.avatar === 'string' && incoming.avatar.length <= 64) fresh.avatar = incoming.avatar;
      if (typeof incoming.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(incoming.customAvatarUrl)) {
        fresh.customAvatarUrl = incoming.customAvatarUrl;
      }
      if (typeof incoming.frame === 'string' && incoming.frame.length <= 64) fresh.frame = incoming.frame;
      if (typeof incoming.equippedCue === 'string' && incoming.equippedCue.length <= 64) fresh.equippedCue = incoming.equippedCue;
      if (typeof incoming.equippedTable === 'string' && incoming.equippedTable.length <= 64) fresh.equippedTable = incoming.equippedTable;
      if (typeof incoming.equippedVenue === 'string' && incoming.equippedVenue.length <= 64) fresh.equippedVenue = incoming.equippedVenue;
      if (typeof incoming.equippedEffect === 'string' && incoming.equippedEffect.length <= 64) fresh.equippedEffect = incoming.equippedEffect;
      if (Array.isArray(incoming.ownedItems)) {
        const validIds = new Set(SHOP_CATALOG.map((i) => i.id));
        const filtered = incoming.ownedItems.filter((id): id is string => typeof id === 'string' && validIds.has(id));
        if (filtered.length > 0) fresh.ownedItems = Array.from(new Set([...fresh.ownedItems, ...filtered]));
      }
      if (typeof incoming.coins === 'number' && Number.isFinite(incoming.coins) && incoming.coins >= 0 && incoming.coins <= 1000000) {
        fresh.coins = Math.floor(incoming.coins);
      }
      if (typeof incoming.rating === 'number' && Number.isFinite(incoming.rating) && incoming.rating >= 100 && incoming.rating <= 4000) {
        fresh.rating = Math.floor(incoming.rating);
      }
      if (typeof incoming.level === 'number' && Number.isFinite(incoming.level) && incoming.level >= 1 && incoming.level <= 500) {
        fresh.level = Math.floor(incoming.level);
      }
      if (typeof incoming.xp === 'number' && Number.isFinite(incoming.xp) && incoming.xp >= 0) {
        fresh.xp = Math.floor(incoming.xp);
      }
      if (typeof incoming.wins === 'number' && Number.isFinite(incoming.wins) && incoming.wins >= 0) {
        fresh.wins = Math.floor(incoming.wins);
      }
      if (typeof incoming.losses === 'number' && Number.isFinite(incoming.losses) && incoming.losses >= 0) {
        fresh.losses = Math.floor(incoming.losses);
      }
      if (typeof incoming.matches === 'number' && Number.isFinite(incoming.matches) && incoming.matches >= 0) {
        fresh.matches = Math.floor(incoming.matches);
      }
      profiles.set(identity.uid, fresh);
      scheduleSaveServerState();
      res.json({ profile: fresh });
      return;
    }

    // Update safe cosmetic/profile fields only (never trust client coins/wins/rating/rankPoints/stats)
    const ownsOrFree = (itemId: string) =>
      existing.ownedItems.includes(itemId) || DEFAULT_FREE_OWNED_ITEMS.includes(itemId);

    existing.authProvider = identity.authProvider;
    if (cleanLocation) {
      existing.location = { ...existing.location, ...cleanLocation };
    }
    if (typeof incoming.username === 'string' && incoming.username.trim().length >= 2) {
      existing.username = sanitizeUsername(incoming.username);
    }
    if (typeof incoming.avatar === 'string' && ownsOrFree(incoming.avatar)) {
      existing.avatar = incoming.avatar;
    }
    if (typeof incoming.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(incoming.customAvatarUrl)) {
      existing.customAvatarUrl = incoming.customAvatarUrl;
    }
    if (typeof incoming.frame === 'string' && ownsOrFree(incoming.frame)) {
      existing.frame = incoming.frame;
    }
    if (typeof incoming.equippedCue === 'string' && ownsOrFree(incoming.equippedCue)) {
      existing.equippedCue = incoming.equippedCue;
    }
    if (typeof incoming.equippedTable === 'string' && ownsOrFree(incoming.equippedTable)) {
      existing.equippedTable = incoming.equippedTable;
    }
    if (typeof incoming.equippedVenue === 'string' && ownsOrFree(incoming.equippedVenue)) {
      existing.equippedVenue = incoming.equippedVenue;
    }
    if (typeof incoming.equippedEffect === 'string' && ownsOrFree(incoming.equippedEffect)) {
      existing.equippedEffect = incoming.equippedEffect;
    }
    existing.updatedAt = new Date().toISOString();
    scheduleSaveServerState();
    res.json({ profile: existing });
  });

  // Update coarse player location (rounded coords / region / timezone) for nearby friend discovery
  app.post('/api/profile/location', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    const cleaned = sanitizePlayerLocation({
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      updatedAt: new Date().toISOString(),
    });
    if (!cleaned) {
      res.status(400).json({ error: 'Invalid location payload.' });
      return;
    }
    profile.location = cleaned;
    profile.authProvider = identity.authProvider;
    profile.updatedAt = new Date().toISOString();
    scheduleSaveServerState();
    res.json({ profile });
  });

  // Leaderboard — Strictly real registered Google / Email accounts (zero guests or bots)
  app.get('/api/leaderboard', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'global';

    let list = Array.from(profiles.values()).filter((p) => isRealRegisteredPlayer(p));
    if (scope === 'friends' && identity) {
      const friendIds = new Set<string>([identity.uid]);
      for (const fr of friendRecords.values()) {
        if (fr.status === 'accepted') {
          if (fr.userId === identity.uid) friendIds.add(fr.friendId);
          if (fr.friendId === identity.uid) friendIds.add(fr.userId);
        }
      }
      list = list.filter((p) => friendIds.has(p.uid));
    }

    const sorted = list
      .map((p) => ({
        uid: p.uid,
        playerId: p.playerId,
        username: p.username,
        authProvider: p.authProvider,
        avatar: p.avatar,
        customAvatarUrl: p.customAvatarUrl || '',
        frame: p.frame,
        level: p.level,
        rating: scope === 'weekly' ? 1000 + (weeklyRatings.get(p.uid) || 0) : p.rating,
        rankPoints: p.rankPoints ?? 0,
        wins: p.wins,
        losses: p.losses,
        matches: p.matches,
        online: isUserOnline(p.uid),
      }))
      .sort((a, b) => b.rankPoints - a.rankPoints || b.rating - a.rating || b.wins - a.wins)
      .slice(0, 50);

    res.json({ scope, rankings: sorted });
  });

  // Search & Nearest-Location Registered Players (Google / Email accounts only; zero guests or bots)
  app.get('/api/players/search', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const q = rawQuery.toLowerCase();

    const callerProfile = profiles.get(identity.uid);
    const qLat = typeof req.query.lat === 'string' ? Number(req.query.lat) : undefined;
    const qLng = typeof req.query.lng === 'string' ? Number(req.query.lng) : undefined;
    const selfLocation: PlayerLocation | undefined =
      typeof qLat === 'number' &&
      Number.isFinite(qLat) &&
      typeof qLng === 'number' &&
      Number.isFinite(qLng)
        ? sanitizePlayerLocation({
            lat: qLat,
            lng: qLng,
            city: callerProfile?.location?.city,
            region: callerProfile?.location?.region,
            timezone: callerProfile?.location?.timezone,
          })
        : callerProfile?.location;

    const candidates = Array.from(profiles.values())
      .filter((p) => {
        if (p.uid === identity.uid) return false;
        if (!isRealRegisteredPlayer(p)) return false;
        if (!q) return true;
        return p.username.toLowerCase().includes(q) || matchesPlayerIdQuery(p.playerId, rawQuery);
      })
      .map((p) => {
        const base = {
          uid: p.uid,
          playerId: p.playerId,
          username: p.username,
          authProvider: p.authProvider,
          avatar: p.avatar,
          customAvatarUrl: p.customAvatarUrl || '',
          frame: p.frame,
          level: p.level,
          rating: p.rating,
          rankPoints: p.rankPoints ?? 0,
          online: isUserOnline(p.uid),
          location: p.location,
          updatedAt: p.updatedAt,
        };
        return evaluatePlayerProximity(base, selfLocation);
      });

    const sorted = sortPlayersByProximity(candidates).slice(0, 30).map((p) => ({
      uid: p.uid,
      playerId: p.playerId,
      username: p.username,
      authProvider: p.authProvider,
      avatar: p.avatar,
      customAvatarUrl: p.customAvatarUrl,
      frame: p.frame,
      level: p.level,
      rating: p.rating,
      rankPoints: p.rankPoints,
      online: p.online,
      location: p.location,
      distanceKm: p.distanceKm,
      sameRegion: p.sameRegion,
      locationLabel: p.locationLabel,
    }));

    res.json({ players: sorted });
  });

  // Friends Endpoints
  app.get('/api/friends', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const friends: Array<{
      friendshipId: string;
      status: 'pending' | 'accepted';
      direction: 'incoming' | 'outgoing';
      player: {
        uid: string;
        playerId: string;
        username: string;
        avatar: string;
        customAvatarUrl?: string;
        frame: string;
        level: number;
        rating: number;
        rankPoints?: number;
        online: boolean;
      };
    }> = [];

    for (const fr of friendRecords.values()) {
      if (fr.userId !== identity.uid && fr.friendId !== identity.uid) continue;
      const otherUid = fr.userId === identity.uid ? fr.friendId : fr.userId;
      const p = profiles.get(otherUid);
      if (!p) continue;
      friends.push({
        friendshipId: fr.id,
        status: fr.status,
        direction: fr.userId === identity.uid ? 'outgoing' : 'incoming',
        player: {
          uid: p.uid,
          playerId: p.playerId,
          username: p.username,
          avatar: p.avatar,
          customAvatarUrl: p.customAvatarUrl || '',
          frame: p.frame,
          level: p.level,
          rating: p.rating,
          rankPoints: p.rankPoints ?? 0,
          online: isUserOnline(p.uid),
        },
      });
    }

    res.json({ friends });
  });

  app.post('/api/friends/request', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const targetUid = typeof req.body?.friendId === 'string' ? req.body.friendId.trim() : '';
    if (!targetUid || targetUid === identity.uid || !profiles.has(targetUid)) {
      res.status(400).json({ error: 'Player not found.' });
      return;
    }

    for (const fr of friendRecords.values()) {
      if (
        (fr.userId === identity.uid && fr.friendId === targetUid) ||
        (fr.userId === targetUid && fr.friendId === identity.uid)
      ) {
        res.status(409).json({ error: 'Friend request already exists.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const id = `fr_${crypto.randomBytes(6).toString('hex')}`;
    const record: FriendRecord = {
      id,
      userId: identity.uid,
      friendId: targetUid,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    friendRecords.set(id, record);
    scheduleSaveServerState();
    const sender = getOrCreateProfile(identity.uid);
    sendToUser(targetUid, {
      type: 'friend:request_received',
      from: { uid: sender.uid, username: sender.username, avatar: sender.avatar },
    });
    res.json({ friend: record });
  });

  app.post('/api/friends/respond', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const friendshipId = typeof req.body?.friendshipId === 'string' ? req.body.friendshipId : '';
    const accept = Boolean(req.body?.accept);
    const fr = friendRecords.get(friendshipId);
    if (!fr || fr.friendId !== identity.uid || fr.status !== 'pending') {
      res.status(404).json({ error: 'Friend request not found.' });
      return;
    }

    if (accept) {
      fr.status = 'accepted';
      fr.updatedAt = new Date().toISOString();
      scheduleSaveServerState();
      sendToUser(fr.userId, { type: 'friend:accepted', by: identity.uid });
      res.json({ friend: fr });
    } else {
      friendRecords.delete(friendshipId);
      scheduleSaveServerState();
      res.json({ removed: true });
    }
  });

  app.post('/api/friends/remove', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const friendshipId = typeof req.body?.friendshipId === 'string' ? req.body.friendshipId : '';
    const fr = friendRecords.get(friendshipId);
    if (!fr || (fr.userId !== identity.uid && fr.friendId !== identity.uid)) {
      res.status(404).json({ error: 'Friendship not found.' });
      return;
    }
    friendRecords.delete(friendshipId);
    scheduleSaveServerState();
    res.json({ removed: true });
  });

  // Shop Purchase & Equip (Authoritative Balance & Ownership)
  app.post('/api/shop/purchase', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
    const item = SHOP_CATALOG.find((i) => i.id === itemId);
    if (!item) {
      res.status(400).json({ error: 'Invalid shop item.' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    if (profile.ownedItems.includes(item.id)) {
      res.status(409).json({ error: 'Item already owned.' });
      return;
    }
    if (profile.coins < item.price) {
      res.status(400).json({ error: 'Insufficient coins.' });
      return;
    }

    profile.coins -= item.price;
    profile.ownedItems.push(item.id);
    if (item.category === 'cue') profile.equippedCue = item.id;
    else if (item.category === 'table') profile.equippedTable = item.id;
    else if (item.category === 'venue') profile.equippedVenue = item.id;
    else if (item.category === 'avatar') profile.avatar = item.id;
    else if (item.category === 'frame') profile.frame = item.id;
    else if (item.category === 'effect') profile.equippedEffect = item.id;
    profile.updatedAt = new Date().toISOString();

    const tx = recordTransaction(profile.uid, -item.price, 'shop_purchase', item.id);
    scheduleSaveServerState();
    res.json({ profile, transaction: tx });
  });

  app.post('/api/shop/equip', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
    const item = SHOP_CATALOG.find((i) => i.id === itemId);
    const profile = getOrCreateProfile(identity.uid);
    const owned = item ? profile.ownedItems.includes(item.id) || item.price === 0 : false;
    if (!item || !owned) {
      res.status(400).json({ error: 'Item not owned.' });
      return;
    }
    if (!profile.ownedItems.includes(item.id)) {
      profile.ownedItems.push(item.id);
    }

    if (item.category === 'cue') profile.equippedCue = item.id;
    else if (item.category === 'table') profile.equippedTable = item.id;
    else if (item.category === 'venue') profile.equippedVenue = item.id;
    else if (item.category === 'avatar') profile.avatar = item.id;
    else if (item.category === 'frame') profile.frame = item.id;
    else if (item.category === 'effect') profile.equippedEffect = item.id;
    profile.updatedAt = new Date().toISOString();

    const activeMId = userMatchIndex.get(identity.uid);
    const activeM = activeMId ? activeMatches.get(activeMId) : undefined;
    if (activeM && activeM.rules.phase !== 'gameover') {
      const targetPart = activeM.seats.find((s) => s.uid === identity.uid);
      if (targetPart) {
        targetPart.equippedCue = profile.equippedCue;
        targetPart.equippedTable = profile.equippedTable;
        targetPart.equippedVenue = profile.equippedVenue;
        targetPart.equippedEffect = profile.equippedEffect;
      }
    }

    scheduleSaveServerState();
    res.json({ profile });
  });

  // Daily Reward Claim (Server Cooldown Guard)
  app.post('/api/rewards/daily', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    const today = new Date().toISOString().slice(0, 10);
    if (profile.lastDailyClaim === today) {
      res.status(409).json({ error: 'Daily reward already claimed today.' });
      return;
    }

    const nextStreak = (profile.dailyStreak % DAILY_REWARD_SCHEDULE.length) + 1;
    const rewardCoins = DAILY_REWARD_SCHEDULE[nextStreak - 1];
    profile.coins += rewardCoins;
    profile.dailyStreak = nextStreak;
    profile.lastDailyClaim = today;
    profile.updatedAt = new Date().toISOString();

    const tx = recordTransaction(profile.uid, rewardCoins, 'daily_reward', `day_${nextStreak}_${today}`);
    scheduleSaveServerState();
    res.json({ profile, rewardCoins, transaction: tx });
  });

  // Match History & Transactions
  app.get('/api/history', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({
      matches: matchHistoryStore.get(identity.uid) || [],
      transactions: transactionStore.get(identity.uid) || [],
    });
  });

  // Ranked Competitive Queue & Transparent Bot Fallback
  app.post('/api/ranked/queue/join', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const gameVariant: GameVariant = req.body?.gameVariant === '9ball' ? '9ball' : '8ball';
    const profile = getOrCreateProfile(identity.uid);

    // Clear any stale finished match pointer
    const activeId = userMatchIndex.get(identity.uid);
    const activeMatch = activeId ? activeMatches.get(activeId) : undefined;
    if (activeMatch && activeMatch.gameMode === 'online_ranked' && activeMatch.rules.phase !== 'gameover') {
      res.json({ status: 'matched', match: serializeMatchState(activeMatch, identity.uid) });
      return;
    }

    const existingIdx = matchmakingQueue.findIndex((q) => q.uid === identity.uid);
    if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

    const now = Date.now();
    matchmakingQueue.push({
      uid: identity.uid,
      mode: 'online_ranked',
      gameVariant,
      entryFee: 0,
      rating: profile.rating,
      rankPoints: profile.rankPoints ?? 0,
      joinedAt: now,
      lastPolledAt: now,
    });

    const paired = tryPairQueuedPlayers(identity.uid);
    if (paired) {
      res.json({ status: 'matched', match: serializeMatchState(paired, identity.uid) });
      return;
    }

    res.json({
      status: 'searching',
      gameVariant,
      joinedAt: now,
      botFallbackAfterMs: RANKED_BOT_WAIT_MS,
    });
  });

  app.get('/api/ranked/queue/status', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const activeId = userMatchIndex.get(identity.uid);
    const activeMatch = activeId ? activeMatches.get(activeId) : undefined;
    if (activeMatch && activeMatch.gameMode === 'online_ranked' && activeMatch.rules.phase !== 'gameover') {
      res.json({ status: 'matched', match: serializeMatchState(activeMatch, identity.uid) });
      return;
    }

    const entry = matchmakingQueue.find((q) => q.uid === identity.uid && q.mode === 'online_ranked');
    if (!entry) {
      res.json({ status: 'idle' });
      return;
    }
    entry.lastPolledAt = Date.now();

    const paired = tryPairQueuedPlayers(identity.uid);
    if (paired) {
      res.json({ status: 'matched', match: serializeMatchState(paired, identity.uid) });
      return;
    }

    const elapsedMs = Date.now() - entry.joinedAt;
    if (elapsedMs >= RANKED_BOT_WAIT_MS) {
      const profile = getOrCreateProfile(identity.uid);
      const botConfig = getBotConfigForRank(profile.rankPoints ?? 0);
      res.json({
        status: 'bot_fallback',
        gameVariant: entry.gameVariant,
        elapsedMs,
        botProfile: {
          username: botConfig.username,
          avatar: botConfig.avatar,
          frame: botConfig.frame,
          difficulty: botConfig.aiDifficulty,
          tier: botConfig.tierLabel,
          rankPoints: botConfig.rankPoints,
          isBot: true,
        },
      });
      return;
    }

    res.json({
      status: 'searching',
      gameVariant: entry.gameVariant,
      elapsedMs,
      botFallbackAfterMs: RANKED_BOT_WAIT_MS,
    });
  });

  app.post('/api/ranked/queue/start-bot', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const entryIdx = matchmakingQueue.findIndex((q) => q.uid === identity.uid);
    const queuedVariant = entryIdx !== -1 ? matchmakingQueue[entryIdx].gameVariant : undefined;
    const gameVariant: GameVariant =
      req.body?.gameVariant === '9ball' || queuedVariant === '9ball' ? '9ball' : '8ball';
    if (entryIdx !== -1) matchmakingQueue.splice(entryIdx, 1);

    const profile = getOrCreateProfile(identity.uid);
    const botCfg = getBotConfigForRank(profile.rankPoints ?? 0);
    const botParticipant: MatchParticipant = {
      uid: `bot_ranked_${botCfg.tierLabel.toLowerCase()}_${crypto.randomBytes(3).toString('hex')}`,
      username: botCfg.username,
      avatar: botCfg.avatar,
      customAvatarUrl: '',
      frame: botCfg.frame,
      level: 10 + Math.min(40, Math.floor((profile.rankPoints ?? 0) / 80)),
      rating: 1000 + Math.floor((profile.rankPoints ?? 0) * 0.35),
      rankPoints: botCfg.rankPoints,
      equippedCue: botCfg.equippedCue,
      equippedTable: 'table_tournament_blue',
      equippedEffect: botCfg.equippedEffect,
      connected: true,
      reconnectToken: 'bot',
      isBot: true,
      aiDifficulty: botCfg.aiDifficulty,
    };

    const match = createAuthoritativeMatch(
      identity.uid,
      botParticipant.uid,
      'online_ranked',
      0,
      null,
      gameVariant,
      '1v1',
      undefined,
      undefined,
      botParticipant,
    );

    const serialized = serializeMatchState(match, identity.uid);
    sendToUser(identity.uid, { type: 'match:started', match: serialized });
    res.json({ match: serialized });
  });

  app.post('/api/ranked/queue/leave', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const idx = matchmakingQueue.findIndex((q) => q.uid === identity.uid);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
    res.json({ left: idx !== -1 });
  });

  // Quick Match Live Queue & Transparent Bot Fallback
  app.post('/api/quick-match/queue/join', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const gameVariant: GameVariant = req.body?.gameVariant === '9ball' ? '9ball' : '8ball';
    const entryFee = sanitizeEntryFee(req.body?.entryFee);
    const profile = getOrCreateProfile(identity.uid);

    if (profile.coins < entryFee) {
      res.status(400).json({ error: 'Insufficient coins for selected Quick Match stake.' });
      return;
    }

    const activeId = userMatchIndex.get(identity.uid);
    const activeMatch = activeId ? activeMatches.get(activeId) : undefined;
    if (activeMatch && activeMatch.gameMode === 'quick_match' && activeMatch.rules.phase !== 'gameover') {
      res.json({ status: 'matched', match: serializeMatchState(activeMatch, identity.uid) });
      return;
    }

    const existingIdx = matchmakingQueue.findIndex((q) => q.uid === identity.uid);
    if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

    const now = Date.now();
    matchmakingQueue.push({
      uid: identity.uid,
      mode: 'quick_match',
      gameVariant,
      entryFee,
      rating: profile.rating,
      rankPoints: profile.rankPoints ?? 0,
      joinedAt: now,
      lastPolledAt: now,
    });

    const paired = tryPairQueuedPlayers(identity.uid);
    if (paired) {
      res.json({ status: 'matched', match: serializeMatchState(paired, identity.uid) });
      return;
    }

    res.json({
      status: 'searching',
      gameVariant,
      entryFee,
      joinedAt: now,
      botFallbackAfterMs: QUICK_MATCH_BOT_WAIT_MS,
    });
  });

  app.get('/api/quick-match/queue/status', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const activeId = userMatchIndex.get(identity.uid);
    const activeMatch = activeId ? activeMatches.get(activeId) : undefined;
    if (activeMatch && activeMatch.gameMode === 'quick_match' && activeMatch.rules.phase !== 'gameover') {
      res.json({ status: 'matched', match: serializeMatchState(activeMatch, identity.uid) });
      return;
    }

    const entry = matchmakingQueue.find((q) => q.uid === identity.uid && q.mode === 'quick_match');
    if (!entry) {
      res.json({ status: 'idle' });
      return;
    }
    entry.lastPolledAt = Date.now();

    const paired = tryPairQueuedPlayers(identity.uid);
    if (paired) {
      res.json({ status: 'matched', match: serializeMatchState(paired, identity.uid) });
      return;
    }

    const elapsedMs = Date.now() - entry.joinedAt;
    if (elapsedMs >= QUICK_MATCH_BOT_WAIT_MS) {
      const profile = getOrCreateProfile(identity.uid);
      const botCfg = getBotConfigForRank(Math.max(0, (profile.rating - 1000) * 1.5));
      res.json({
        status: 'bot_fallback',
        gameVariant: entry.gameVariant,
        entryFee: entry.entryFee,
        elapsedMs,
        botProfile: {
          username: 'TourBot_Viper',
          avatar: botCfg.avatar,
          frame: botCfg.frame,
          difficulty: 'pro' as AiDifficulty,
          tier: botCfg.tierLabel,
          rating: Math.max(1150, profile.rating + 90),
          isBot: true,
        },
      });
      return;
    }

    res.json({
      status: 'searching',
      gameVariant: entry.gameVariant,
      entryFee: entry.entryFee,
      elapsedMs,
      botFallbackAfterMs: QUICK_MATCH_BOT_WAIT_MS,
    });
  });

  app.post('/api/quick-match/queue/start-bot', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const entryIdx = matchmakingQueue.findIndex((q) => q.uid === identity.uid);
    const queued = entryIdx !== -1 ? matchmakingQueue[entryIdx] : undefined;
    const gameVariant: GameVariant =
      req.body?.gameVariant === '9ball' || queued?.gameVariant === '9ball' ? '9ball' : '8ball';
    const entryFee = sanitizeEntryFee(req.body?.entryFee ?? queued?.entryFee ?? 0);
    if (entryIdx !== -1) matchmakingQueue.splice(entryIdx, 1);

    const profile = getOrCreateProfile(identity.uid);
    if (profile.coins < entryFee) {
      res.status(400).json({ error: 'Insufficient coins for selected Quick Match stake.' });
      return;
    }
    if (entryFee > 0) {
      profile.coins -= entryFee;
      recordTransaction(profile.uid, -entryFee, 'match_entry', 'quick_match_bot');
      scheduleSaveServerState();
    }

    const botParticipant: MatchParticipant = {
      uid: `bot_quick_${crypto.randomBytes(3).toString('hex')}`,
      username: 'TourBot_Viper',
      avatar: 'avatar_master',
      customAvatarUrl: '',
      frame: 'frame_obsidian',
      level: Math.max(12, profile.level + 2),
      rating: Math.max(1200, profile.rating + 85),
      rankPoints: 0,
      equippedCue: 'cue_carbon',
      equippedTable: profile.equippedTable,
      equippedVenue: profile.equippedVenue || 'venue_billiard_cafe',
      equippedEffect: 'effect_gold_spark',
      connected: true,
      reconnectToken: 'bot',
      isBot: true,
      aiDifficulty: 'pro',
    };

    const match = createAuthoritativeMatch(
      identity.uid,
      botParticipant.uid,
      'quick_match',
      entryFee,
      null,
      gameVariant,
      '1v1',
      undefined,
      undefined,
      botParticipant,
    );

    const serialized = serializeMatchState(match, identity.uid);
    sendToUser(identity.uid, { type: 'match:started', match: serialized });
    res.json({ match: serialized, profile });
  });

  app.post('/api/quick-match/queue/leave', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const idx = matchmakingQueue.findIndex((q) => q.uid === identity.uid && q.mode === 'quick_match');
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
    res.json({ left: idx !== -1 });
  });

  // Record completed non-ranked Practice vs Computer match (0 RP, 0 coins, 0 rating changes)
  app.post('/api/matches/practice/record', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const nowMs = Date.now();
    const lastMs = lastPracticeRecordedAt.get(identity.uid) || 0;
    if (nowMs - lastMs < 5000) {
      res.status(429).json({ error: 'Please wait a moment before recording another practice match.' });
      return;
    }
    lastPracticeRecordedAt.set(identity.uid, nowMs);

    const profile = getOrCreateProfile(identity.uid);
    const won = Boolean(req.body?.won);
    const gameVariant: GameVariant = req.body?.gameVariant === '9ball' ? '9ball' : '8ball';
    const shots =
      typeof req.body?.shots === 'number' && Number.isFinite(req.body.shots)
        ? Math.max(1, Math.min(200, Math.floor(req.body.shots)))
        : 1;
    const duration =
      typeof req.body?.duration === 'number' && Number.isFinite(req.body.duration)
        ? Math.max(1, Math.min(7200, Math.floor(req.body.duration)))
        : 45;
    const oppName =
      typeof req.body?.opponentName === 'string' && req.body.opponentName.trim().length > 0
        ? req.body.opponentName.trim().slice(0, 32)
        : 'Practice Bot';

    profile.matches += 1;
    if (won) profile.wins += 1;
    else profile.losses += 1;
    profile.stats = applyCompletedMatchToStats(profile.stats, {
      won,
      variant: gameVariant,
      isRanked: false,
      isBotOpponent: true,
    });
    profile.updatedAt = new Date().toISOString();

    const hist: MatchHistoryRecord = {
      matchId: `prac_${crypto.randomBytes(5).toString('hex')}`,
      playerId: profile.uid,
      opponentName: oppName,
      opponentAvatar: 'avatar_shark',
      result: won ? 'win' : 'loss',
      shots,
      duration,
      xpEarned: 0,
      coinsEarned: 0,
      ratingDelta: 0,
      gameMode: 'practice_ai',
      gameVariant,
      isRanked: false,
      isBotOpponent: true,
      rankDelta: 0,
      createdAt: new Date().toISOString(),
    };
    const list = matchHistoryStore.get(profile.uid) || [];
    list.unshift(hist);
    matchHistoryStore.set(profile.uid, list.slice(0, 50));
    scheduleSaveServerState();

    res.json({ profile });
  });

  // Settle Quick Match vs Pro AI (updates coins, Elo, XP, and non-ranked stats — never changes Ranked RP)
  app.post('/api/matches/quick-ai/settle', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = getOrCreateProfile(identity.uid);
    const won = Boolean(req.body?.won);
    const gameVariant: GameVariant = req.body?.gameVariant === '9ball' ? '9ball' : '8ball';
    const fee = sanitizeEntryFee(req.body?.entryFee);
    const shots =
      typeof req.body?.shots === 'number' && Number.isFinite(req.body.shots)
        ? Math.max(1, Math.min(200, Math.floor(req.body.shots)))
        : 1;
    const duration =
      typeof req.body?.duration === 'number' && Number.isFinite(req.body.duration)
        ? Math.max(1, Math.min(7200, Math.floor(req.body.duration)))
        : 60;
    const oppRating =
      typeof req.body?.opponentRating === 'number' && Number.isFinite(req.body.opponentRating)
        ? Math.max(1000, Math.min(2600, Math.floor(req.body.opponentRating)))
        : 2100;
    const oppName =
      typeof req.body?.opponentName === 'string' && req.body.opponentName.trim().length > 0
        ? req.body.opponentName.trim().slice(0, 32)
        : 'Pro AI Challenger';
    const oppAvatar =
      typeof req.body?.opponentAvatar === 'string' && req.body.opponentAvatar.trim().length > 0
        ? req.body.opponentAvatar.trim().slice(0, 64)
        : 'avatar_master';

    if (fee > profile.coins) {
      res.status(400).json({ error: 'Insufficient coins for selected Quick Match stake.' });
      return;
    }

    if (fee > 0) {
      profile.coins -= fee;
      recordTransaction(profile.uid, -fee, 'match_entry', 'quick_ai_match');
    }

    const rew = computeMatchRewards(won, fee, shots);
    const delta = calculateEloDelta(profile.rating, oppRating, won);
    const prog = applyXpProgress(profile.level, profile.xp, rew.xpEarned);

    profile.level = prog.level;
    profile.xp = prog.xp;
    profile.coins += rew.coinsEarned;
    profile.rating = Math.max(100, profile.rating + delta);
    profile.matches += 1;
    if (won) profile.wins += 1;
    else profile.losses += 1;
    profile.stats = applyCompletedMatchToStats(profile.stats, {
      won,
      variant: gameVariant,
      isRanked: false,
      isBotOpponent: true,
    });
    profile.updatedAt = new Date().toISOString();
    weeklyRatings.set(profile.uid, (weeklyRatings.get(profile.uid) || 0) + delta);
    if (rew.coinsEarned > 0) {
      recordTransaction(profile.uid, rew.coinsEarned, 'match_reward', 'quick_ai_match');
    }

    const hist: MatchHistoryRecord = {
      matchId: `qai_${crypto.randomBytes(5).toString('hex')}`,
      playerId: profile.uid,
      opponentName: oppName,
      opponentAvatar: oppAvatar,
      result: won ? 'win' : 'loss',
      shots,
      duration,
      xpEarned: rew.xpEarned,
      coinsEarned: rew.coinsEarned,
      ratingDelta: delta,
      gameMode: 'quick_match',
      gameVariant,
      isRanked: false,
      isBotOpponent: true,
      rankDelta: 0,
      createdAt: new Date().toISOString(),
    };
    const list = matchHistoryStore.get(profile.uid) || [];
    list.unshift(hist);
    matchHistoryStore.set(profile.uid, list.slice(0, 50));
    scheduleSaveServerState();

    res.json({
      profile,
      xpEarned: rew.xpEarned,
      coinsEarned: rew.coinsEarned,
      ratingDelta: delta,
    });
  });

  // Public Open Mabar Rooms Browser (lets anyone find & join live waiting rooms in 1 click)
  app.get('/api/rooms/open', (_req, res) => {
    const now = Date.now();
    const list = [];
    for (const room of roomsById.values()) {
      const maxSeats = room.matchFormat === '2v2' ? 4 : 2;
      if (room.status !== 'waiting' || room.expiresAt <= now || room.participants.length >= maxSeats) {
        continue;
      }
      const host = serializeRoomUser(room.hostId);
      list.push({
        roomId: room.roomId,
        roomCode: room.roomCode,
        entryFee: room.entryFee,
        gameVariant: room.gameVariant,
        matchFormat: room.matchFormat,
        seatsCount: room.participants.length,
        maxSeats,
        createdAt: room.createdAt,
        host: host
          ? {
              username: host.username,
              avatar: host.avatar,
              customAvatarUrl: host.customAvatarUrl,
              frame: host.frame,
              rating: host.rating,
              rankPoints: host.rankPoints,
              online: host.online,
            }
          : null,
      });
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ rooms: list.slice(0, 20) });
  });

  // Authoritative Private Rooms REST APIs (guarantees room operations even across brief WS reconnects)
  app.get('/api/rooms/active', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const active = findActiveWaitingRoomForUser(identity.uid);
    res.json({ room: active ? serializeRoom(active) : null });
  });

  app.post('/api/rooms/create', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    getOrCreateProfile(identity.uid);
    const result = createPrivateRoomForUser(
      identity.uid,
      req.body?.entryFee,
      req.body?.gameVariant,
      req.body?.matchFormat,
    );
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ room: result.room });
  });

  app.post('/api/rooms/join', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    getOrCreateProfile(identity.uid);
    const result = joinPrivateRoomByCode(identity.uid, req.body?.roomCode);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ room: result.room });
  });

  app.post('/api/rooms/:roomId/leave', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const left = leavePrivateRoomForUser(identity.uid, req.params.roomId);
    res.json({ left });
  });

  app.post('/api/rooms/:roomId/start', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = startPrivateRoomMatch(identity.uid, req.params.roomId);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, error: result.error });
      return;
    }
    res.json({ match: result.match });
  });

  app.get('/api/rooms/:roomId', async (req, res) => {
    const identity = await authenticateBearer(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const room = roomsById.get(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    if (!room.participants.includes(identity.uid)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const match = room.matchId ? activeMatches.get(room.matchId) : undefined;
    res.json({
      room: serializeRoom(room),
      match: match && match.rules.phase !== 'gameover' ? serializeMatchState(match, identity.uid) : null,
    });
  });

  // Vite or Static Frontend Serving
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let authedUid: string | null = null;
    let lastAimSentAt = 0;

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';

      if (type === 'ping') {
        ws.send(
          JSON.stringify({
            type: 'pong',
            ts: Date.now(),
            clientTs: typeof msg.clientTs === 'number' ? msg.clientTs : undefined,
          }),
        );
        return;
      }

      if (type === 'auth') {
        const token = typeof msg.token === 'string' ? msg.token : '';
        const identity = await authenticateRawToken(token);
        if (!identity) {
          ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid credentials' }));
          return;
        }
        authedUid = identity.uid;
        let set = activeSockets.get(authedUid);
        if (!set) {
          set = new Set();
          activeSockets.set(authedUid, set);
        }
        set.add(ws);
        const profile = getOrCreateProfile(authedUid);
        broadcastPresenceToFriends(authedUid, true);

        // Check if player has an active match to restore
        const existingMatchId = userMatchIndex.get(authedUid);
        const activeMatch = existingMatchId ? activeMatches.get(existingMatchId) : undefined;
        if (activeMatch && activeMatch.rules.phase !== 'gameover') {
          const timer = activeMatch.disconnectTimers.get(authedUid);
          if (timer) {
            clearTimeout(timer);
            activeMatch.disconnectTimers.delete(authedUid);
          }
          const seatPlayer = activeMatch.seats.find((s) => s.uid === authedUid);
          if (seatPlayer) seatPlayer.connected = true;
          broadcastToMatch(activeMatch, { type: 'match:opponent_reconnected', matchId: activeMatch.matchId }, authedUid);
        }

        const activeRoom = findActiveWaitingRoomForUser(authedUid);

        ws.send(
          JSON.stringify({
            type: 'auth:ok',
            uid: authedUid,
            profile,
            activeRoom: activeRoom ? serializeRoom(activeRoom) : null,
            activeMatch:
              activeMatch && activeMatch.rules.phase !== 'gameover'
                ? serializeMatchState(activeMatch, authedUid)
                : null,
          }),
        );
        return;
      }

      if (!authedUid) {
        ws.send(JSON.stringify({ type: 'error', error: 'Authenticate first.' }));
        return;
      }

      const uid = authedUid;

      // -------------------- PRIVATE ROOMS --------------------
      if (type === 'room:create') {
        const result = createPrivateRoomForUser(uid, msg.entryFee, msg.gameVariant, msg.matchFormat);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      if (type === 'room:join') {
        const result = joinPrivateRoomByCode(uid, msg.roomCode);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      if (type === 'room:leave') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        leavePrivateRoomForUser(uid, roomId);
        return;
      }

      if (type === 'room:invite') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        const targetUid = typeof msg.friendId === 'string' ? msg.friendId : '';
        const room = roomsById.get(roomId);
        if (!room || room.hostId !== uid || room.status !== 'waiting') return;
        const host = getOrCreateProfile(uid);
        sendToUser(targetUid, {
          type: 'room:invitation',
          roomCode: room.roomCode,
          entryFee: room.entryFee,
          from: { uid: host.uid, username: host.username, avatar: host.avatar },
        });
        ws.send(JSON.stringify({ type: 'room:invite_sent', targetUid }));
        return;
      }

      if (type === 'room:start') {
        const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
        const result = startPrivateRoomMatch(uid, roomId);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'room:error', code: result.code, error: result.error }));
        }
        return;
      }

      // -------------------- QUICK MATCH / RANKED QUEUE --------------------
      if (type === 'queue:join') {
        const mode = msg.mode === 'online_ranked' ? 'online_ranked' : 'quick_match';
        const gameVariant: GameVariant = msg.gameVariant === '9ball' ? '9ball' : '8ball';
        const fee = mode === 'online_ranked' ? 0 : sanitizeEntryFee(msg.entryFee);
        const profile = getOrCreateProfile(uid);
        if (profile.coins < fee) {
          ws.send(JSON.stringify({ type: 'queue:error', error: 'Insufficient coins for this table entry fee.' }));
          return;
        }
        // Remove existing queue entry for this user
        const existingIdx = matchmakingQueue.findIndex((q) => q.uid === uid);
        if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

        const now = Date.now();
        matchmakingQueue.push({
          uid,
          mode,
          gameVariant,
          entryFee: fee,
          rating: profile.rating,
          rankPoints: profile.rankPoints ?? 0,
          joinedAt: now,
          lastPolledAt: now,
        });
        ws.send(JSON.stringify({ type: 'queue:searching', mode, gameVariant, entryFee: fee }));
        return;
      }

      if (type === 'queue:leave') {
        const idx = matchmakingQueue.findIndex((q) => q.uid === uid);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
        ws.send(JSON.stringify({ type: 'queue:cancelled' }));
        return;
      }

      // -------------------- AUTHORITATIVE MATCH ACTIONS --------------------
      if (type === 'match:reconnect') {
        const matchId = typeof msg.matchId === 'string' ? msg.matchId : '';
        const reconnectToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken : '';
        const match = activeMatches.get(matchId);
        if (!match) {
          ws.send(JSON.stringify({ type: 'match:error', error: 'Match not found or expired.' }));
          return;
        }
        const seatIdx = getSeatIndexForUid(match, uid);
        const seatPlayer = seatIdx >= 0 ? match.seats[seatIdx] : null;
        if (!seatPlayer || seatPlayer.reconnectToken !== reconnectToken) {
          ws.send(JSON.stringify({ type: 'match:error', error: 'Invalid reconnect token.' }));
          return;
        }
        const timer = match.disconnectTimers.get(uid);
        if (timer) {
          clearTimeout(timer);
          match.disconnectTimers.delete(uid);
        }
        seatPlayer.connected = true;
        broadcastToMatch(match, { type: 'match:opponent_reconnected', matchId }, uid);
        ws.send(JSON.stringify({ type: 'match:state', match: serializeMatchState(match, uid) }));
        return;
      }

      const matchId = typeof msg.matchId === 'string' ? msg.matchId : userMatchIndex.get(uid) || '';
      const match = activeMatches.get(matchId);
      if (!match) return;

      const callerSeatIdx = getSeatIndexForUid(match, uid);
      if (callerSeatIdx < 0) return;
      const callerSlot: PlayerSlot = callerSeatIdx % 2 === 0 ? 'A' : 'B';
      const activeSeatIdx = match.rules.activeSeatIndex ?? (match.rules.currentTurn === 'A' ? 0 : 1);

      if (type === 'match:aim') {
        if (callerSeatIdx !== activeSeatIdx || match.simulating || match.rules.phase === 'gameover') return;
        const now = Date.now();
        if (now - lastAimSentAt < 45) return; // throttle 22Hz
        lastAimSentAt = now;
        const angle = typeof msg.angle === 'number' && Number.isFinite(msg.angle) ? msg.angle : 0;
        const spinX = typeof msg.spinX === 'number' && Number.isFinite(msg.spinX) ? Math.max(-1, Math.min(1, msg.spinX)) : 0;
        const spinY = typeof msg.spinY === 'number' && Number.isFinite(msg.spinY) ? Math.max(-1, Math.min(1, msg.spinY)) : 0;
        const power = typeof msg.power === 'number' && Number.isFinite(msg.power) ? Math.max(0, Math.min(1, msg.power)) : 0;
        broadcastToMatch(match, { type: 'match:aim_update', matchId: match.matchId, angle, spinX, spinY, power }, uid);
        return;
      }

      if (type === 'match:place_cue_ball') {
        if (callerSeatIdx !== activeSeatIdx || match.simulating || !match.rules.ballInHand || match.rules.phase === 'gameover') {
          return;
        }
        const x = typeof msg.x === 'number' && Number.isFinite(msg.x) ? msg.x : -1;
        const y = typeof msg.y === 'number' && Number.isFinite(msg.y) ? msg.y : -1;
        if (!isValidCueBallPlacement(match.balls, x, y, match.rules.headstringOnly)) {
          return;
        }
        const cue = match.balls.find((b) => b.id === 0);
        if (cue) {
          cue.x = x;
          cue.y = y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
          match.seq += 1;
          broadcastToMatch(match, { type: 'match:cue_placed', matchId: match.matchId, x, y, seq: match.seq });
        }
        return;
      }

      if (type === 'match:shot') {
        if (callerSeatIdx !== activeSeatIdx || match.simulating || match.rules.phase === 'gameover') {
          ws.send(JSON.stringify({ type: 'match:shot_rejected', error: 'Not your turn or balls still in motion.' }));
          return;
        }

        const angle = typeof msg.angle === 'number' && Number.isFinite(msg.angle) ? msg.angle : 0;
        const power = typeof msg.power === 'number' && Number.isFinite(msg.power) ? Math.max(0.02, Math.min(1, msg.power)) : 0.5;
        const spinX = typeof msg.spinX === 'number' && Number.isFinite(msg.spinX) ? Math.max(-1, Math.min(1, msg.spinX)) : 0;
        const spinY = typeof msg.spinY === 'number' && Number.isFinite(msg.spinY) ? Math.max(-1, Math.min(1, msg.spinY)) : 0;
        const cueBallPos =
          msg.cueBallPos && typeof msg.cueBallPos === 'object'
            ? {
                x: Number((msg.cueBallPos as { x?: unknown }).x),
                y: Number((msg.cueBallPos as { y?: unknown }).y),
              }
            : undefined;

        const shooterCueId = match.seats[callerSeatIdx]?.equippedCue || match.playerA.equippedCue;
        const shot: ShotInput = {
          angle,
          power,
          spinX,
          spinY,
          cueBallPos,
          seq: match.seq + 1,
          cueId: shooterCueId,
        };

        runServerPhysicsAndResolve(match, shooterCueId, shot, callerSlot);
        return;
      }

      if (type === 'match:chat') {
        const now = Date.now();
        const last = match.lastChatAt.get(uid) || 0;
        if (now - last < 1200) return; // anti-spam rate limit
        match.lastChatAt.set(uid, now);

        const rawText = typeof msg.text === 'string' ? msg.text.replace(/[<>]/g, '').trim().slice(0, 64) : '';
        const rawEmote = typeof msg.emote === 'string' && (BILLIARD_EMOTES as readonly string[]).includes(msg.emote) ? msg.emote : '';
        if (!rawText && !rawEmote) return;

        const safeText = (QUICK_CHAT_MESSAGES as readonly string[]).includes(rawText)
          ? rawText
          : rawText;

        const sender = getOrCreateProfile(uid);
        broadcastToMatch(match, {
          type: 'match:chat_message',
          matchId: match.matchId,
          senderUid: uid,
          senderName: sender.username,
          text: safeText,
          emote: rawEmote,
          timestamp: now,
        });
        return;
      }

      if (type === 'match:concede') {
        if (match.rules.phase === 'gameover') return;
        const winner: PlayerSlot = callerSlot === 'A' ? 'B' : 'A';
        finalizeMatch(match, winner, 'Opponent conceded the match.');
        return;
      }

      if (type === 'match:rematch' || type === 'match:rematch_accept') {
        if (match.rules.phase !== 'gameover') return;
        if (match.gameMode === 'online_ranked') {
          ws.send(JSON.stringify({ type: 'match:error', error: 'Ranked matches use the Ranked queue for new opponents.' }));
          return;
        }
        match.rematchVotes.add(uid);
        const requiredHumans = match.seats.filter((s) => !s.isBot);

        if (!match.rematchInitiatorUid) {
          match.rematchInitiatorUid = uid;
          const expiresAt = Date.now() + 30_000;
          if (match.rematchTimer) clearTimeout(match.rematchTimer);
          match.rematchTimer = setTimeout(() => {
            match.rematchTimer = null;
            if (match.rematchVotes.size < requiredHumans.length) {
              match.rematchVotes.clear();
              match.rematchInitiatorUid = null;
              broadcastToMatch(match, { type: 'match:rematch_expired', matchId: match.matchId });
            }
          }, 30_000);
          broadcastToMatch(
            match,
            { type: 'match:rematch_requested', matchId: match.matchId, fromUid: uid, expiresAt },
            uid,
          );
        }

        if (requiredHumans.every((s) => match.rematchVotes.has(s.uid))) {
          if (match.rematchTimer) {
            clearTimeout(match.rematchTimer);
            match.rematchTimer = null;
          }
          for (const h of requiredHumans) {
            if (getOrCreateProfile(h.uid).coins < match.entryFee) {
              broadcastToMatch(match, { type: 'match:error', error: 'Insufficient coins for rematch stake.' });
              return;
            }
          }
          if (match.entryFee > 0) {
            for (const h of requiredHumans) {
              const prof = getOrCreateProfile(h.uid);
              prof.coins -= match.entryFee;
              recordTransaction(prof.uid, -match.entryFee, 'match_entry', 'rematch');
            }
          }
          const nextMatch = createAuthoritativeMatch(
            match.playerB.uid,
            match.playerA.uid,
            match.gameMode,
            match.entryFee,
            match.roomId,
            match.rules.gameVariant,
            match.matchFormat,
            match.playerB2?.uid,
            match.playerA2?.uid,
          );
          for (const s of nextMatch.seats) {
            if (!s.isBot) {
              sendToUser(s.uid, { type: 'match:started', match: serializeMatchState(nextMatch, s.uid) });
            }
          }
        }
        return;
      }

      if (type === 'match:rematch_decline') {
        if (match.rules.phase !== 'gameover') return;
        if (match.rematchTimer) {
          clearTimeout(match.rematchTimer);
          match.rematchTimer = null;
        }
        match.rematchVotes.clear();
        match.rematchInitiatorUid = null;
        broadcastToMatch(match, { type: 'match:rematch_declined', matchId: match.matchId, byUid: uid });
      }
    });

    ws.on('close', () => {
      if (!authedUid) return;
      const uid = authedUid;
      const sockets = activeSockets.get(uid);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          activeSockets.delete(uid);
          broadcastPresenceToFriends(uid, false);

          // Remove from matchmaking queue if disconnected
          const qIdx = matchmakingQueue.findIndex((q) => q.uid === uid);
          if (qIdx !== -1) matchmakingQueue.splice(qIdx, 1);

          // Start 45s reconnect grace timer if in an active match
          const mId = userMatchIndex.get(uid);
          const match = mId ? activeMatches.get(mId) : undefined;
          if (match && match.rules.phase !== 'gameover') {
            const seatIdx = getSeatIndexForUid(match, uid);
            const seatPlayer = seatIdx >= 0 ? match.seats[seatIdx] : null;
            if (seatPlayer) seatPlayer.connected = false;
            broadcastToMatch(
              match,
              {
                type: 'match:opponent_disconnected',
                matchId: match.matchId,
                countdownSec: 45,
              },
              uid,
            );
            const timer = setTimeout(() => {
              if (match.rules.phase === 'gameover') return;
              const winner: PlayerSlot = seatIdx % 2 === 0 ? 'B' : 'A';
              finalizeMatch(match, winner, 'Player failed to reconnect within 45 seconds.');
            }, 45_000);
            match.disconnectTimers.set(uid, timer);
          }
        }
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ZENN BILLIARD server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
