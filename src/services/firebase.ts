import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { DEFAULT_FREE_OWNED_ITEMS } from '../game/constants.ts';
import { isValidCustomAvatarDataUrl } from '../game/avatarCrop.ts';
import { DEFAULT_KEY_BINDINGS, normalizeKeyBindings } from '../game/controls.ts';
import {
  getBrowserTimezoneRegion,
  isRealRegisteredPlayer,
  sanitizePlayerLocation,
} from '../game/location.ts';
import { generateRandomPlayerId } from '../game/playerId.ts';
import { createEmptyPlayerStats, normalizePlayerStats } from '../game/rank.ts';
import type { AuthProviderType, PlayerLocation, UserProfile, UserSettings } from '../game/types.ts';
import type { Language } from './i18n.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;
export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore is offline. Please verify your Firebase configuration.');
      return false;
    }
    return true; // Permission denied / not-found still confirms server reachability
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  musicEnabled: false,
  musicVolume: 0.35,
  sfxEnabled: true,
  vibrationEnabled: true,
  graphicsQuality: 'high',
  language: 'en',
  sensitivity: 1.0,
  aimGuide: 'pro',
  keyBindings: DEFAULT_KEY_BINDINGS,
};

function sanitizeUsernameForRule(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ .-]/g, '').trim().slice(0, 24).trim();
  return cleaned.length >= 2 ? cleaned : 'Player';
}

const inFlightProfileSyncs = new Map<string, Promise<UserProfile>>();

async function generateUniqueFirestorePlayerId(): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const candidate = generateRandomPlayerId();
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('playerId', '==', candidate), limit(1)),
      );
      if (snap.empty) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return generateRandomPlayerId();
}

export function resolveFirebaseAuthProvider(user: User): AuthProviderType {
  if (user.isAnonymous) return 'guest';
  if (user.providerData?.some((p) => p.providerId === 'google.com')) return 'google';
  return 'email';
}

export async function syncFirebaseUserProfile(user: User, preferredName?: string): Promise<UserProfile> {
  const existingPromise = inFlightProfileSyncs.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const syncTask = (async (): Promise<UserProfile> => {
    const userPath = `users/${user.uid}`;
    const ref = doc(db, 'users', user.uid);
    const now = new Date().toISOString();
    const authProvider = resolveFirebaseAuthProvider(user);
    const defaultRegion = sanitizePlayerLocation({
      ...getBrowserTimezoneRegion(),
      updatedAt: now,
    });

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const existingRaw = snap.data() as Partial<UserProfile>;
        const existingLocation = sanitizePlayerLocation(existingRaw.location) || defaultRegion;
        const existingProfile: UserProfile = {
          ...(existingRaw as UserProfile),
          authProvider: existingRaw.authProvider || authProvider,
          ...(existingLocation ? { location: existingLocation } : {}),
          customAvatarUrl:
            typeof existingRaw.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(existingRaw.customAvatarUrl)
              ? existingRaw.customAvatarUrl
              : '',
          equippedVenue:
            typeof existingRaw.equippedVenue === 'string' && existingRaw.equippedVenue.length > 0
              ? existingRaw.equippedVenue
              : 'venue_billiard_cafe',
          rankPoints: typeof existingRaw.rankPoints === 'number' && Number.isFinite(existingRaw.rankPoints) ? Math.max(0, Math.floor(existingRaw.rankPoints)) : 0,
          highestRankPoints:
            typeof existingRaw.highestRankPoints === 'number' && Number.isFinite(existingRaw.highestRankPoints)
              ? Math.max(0, Math.floor(existingRaw.highestRankPoints))
              : 0,
          stats: normalizePlayerStats(existingRaw.stats),
        };

        // Backfill authProvider & coarse timezone location on legacy real Google/Email profiles
        if (!existingRaw.authProvider || (!existingRaw.location && defaultRegion)) {
          try {
            const patch: Record<string, unknown> = { updatedAt: now };
            if (!existingRaw.authProvider) patch.authProvider = authProvider;
            if (!existingRaw.location && defaultRegion) patch.location = defaultRegion;
            await updateDoc(ref, patch);
          } catch {
            // Non-fatal if background backfill cannot write immediately
          }
        }

        // Ensure private settings doc exists cleanly without failing login
        try {
          const privRef = doc(db, 'users', user.uid, 'private', 'info');
          const privSnap = await getDoc(privRef);
          if (!privSnap.exists()) {
            await setDoc(privRef, {
              uid: user.uid,
              ...(user.email ? { email: user.email.slice(0, 254) } : {}),
              ...DEFAULT_SETTINGS,
              updatedAt: now,
            });
          }
        } catch {
          // Non-fatal if private info already managed elsewhere
        }
        return existingProfile;
      }

      const uniquePlayerId = await generateUniqueFirestorePlayerId();
      const shortTag = user.uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4) || 'CLUB';
      const initialProfile: UserProfile = {
        uid: user.uid,
        playerId: uniquePlayerId,
        username: sanitizeUsernameForRule(preferredName || user.displayName || user.email?.split('@')[0] || `Player_${shortTag}`),
        authProvider,
        ...(defaultRegion ? { location: defaultRegion } : {}),
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

      await setDoc(ref, initialProfile);

      try {
        const privRef = doc(db, 'users', user.uid, 'private', 'info');
        const privSnap = await getDoc(privRef);
        if (!privSnap.exists()) {
          await setDoc(privRef, {
            uid: user.uid,
            ...(user.email ? { email: user.email.slice(0, 254) } : {}),
            ...DEFAULT_SETTINGS,
            updatedAt: now,
          });
        }
      } catch {
        // Non-fatal; public profile was created cleanly
      }

      return initialProfile;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  })();

  inFlightProfileSyncs.set(user.uid, syncTask);
  try {
    return await syncTask;
  } finally {
    inFlightProfileSyncs.delete(user.uid);
  }
}

export async function updateFirestoreProfileFields(
  uid: string,
  fields: Partial<
    Pick<
      UserProfile,
      'username' | 'avatar' | 'customAvatarUrl' | 'frame' | 'equippedCue' | 'equippedTable' | 'equippedVenue' | 'equippedEffect'
    >
  >,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (fields.username !== undefined) payload.username = sanitizeUsernameForRule(fields.username);
    if (fields.avatar !== undefined) payload.avatar = fields.avatar.slice(0, 64);
    if (fields.customAvatarUrl !== undefined) {
      payload.customAvatarUrl = isValidCustomAvatarDataUrl(fields.customAvatarUrl) ? fields.customAvatarUrl : '';
    }
    if (fields.frame !== undefined) payload.frame = fields.frame.slice(0, 64);
    if (fields.equippedCue !== undefined) payload.equippedCue = fields.equippedCue.slice(0, 64);
    if (fields.equippedTable !== undefined) payload.equippedTable = fields.equippedTable.slice(0, 64);
    if (fields.equippedVenue !== undefined) payload.equippedVenue = fields.equippedVenue.slice(0, 64);
    if (fields.equippedEffect !== undefined) payload.equippedEffect = fields.equippedEffect.slice(0, 64);
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreLocation(uid: string, location: PlayerLocation): Promise<void> {
  const path = `users/${uid}`;
  const clean = sanitizePlayerLocation({ ...location, updatedAt: new Date().toISOString() });
  if (!clean) return;
  try {
    await updateDoc(doc(db, 'users', uid), {
      location: clean,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreMatchStats(
  uid: string,
  stats: Pick<UserProfile, 'level' | 'xp' | 'coins' | 'rating' | 'wins' | 'losses' | 'matches' | 'updatedAt'> & {
    stats?: UserProfile['stats'];
  },
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      level: stats.level,
      xp: stats.xp,
      coins: stats.coins,
      rating: stats.rating,
      wins: stats.wins,
      losses: stats.losses,
      matches: stats.matches,
      ...(stats.stats ? { stats: stats.stats } : {}),
      updatedAt: stats.updatedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreShopPurchase(
  uid: string,
  next: Pick<
    UserProfile,
    'coins' | 'ownedItems' | 'equippedCue' | 'equippedTable' | 'equippedVenue' | 'equippedEffect' | 'avatar' | 'frame' | 'updatedAt'
  >,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      coins: next.coins,
      ownedItems: next.ownedItems,
      equippedCue: next.equippedCue,
      equippedTable: next.equippedTable,
      equippedVenue: next.equippedVenue || 'venue_billiard_cafe',
      equippedEffect: next.equippedEffect,
      avatar: next.avatar,
      frame: next.frame,
      updatedAt: next.updatedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreDailyReward(
  uid: string,
  next: Pick<UserProfile, 'coins' | 'dailyStreak' | 'lastDailyClaim' | 'updatedAt'>,
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      coins: next.coins,
      dailyStreak: next.dailyStreak,
      lastDailyClaim: next.lastDailyClaim,
      updatedAt: next.updatedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFirestoreSettings(uid: string, settings: UserSettings): Promise<void> {
  const path = `users/${uid}/private/info`;
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'info'), {
      musicEnabled: settings.musicEnabled,
      musicVolume: Math.max(0, Math.min(1, settings.musicVolume ?? 0.35)),
      sfxEnabled: settings.sfxEnabled,
      vibrationEnabled: settings.vibrationEnabled,
      graphicsQuality: settings.graphicsQuality,
      language: settings.language,
      sensitivity: Math.max(0.2, Math.min(2.5, settings.sensitivity)),
      aimGuide: settings.aimGuide === 'standard' ? 'standard' : 'pro',
      keyBindings: normalizeKeyBindings(settings.keyBindings),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function loadFirestoreSettings(uid: string): Promise<UserSettings> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (snap.exists()) {
      const data = snap.data();
      return {
        musicEnabled: Boolean(data.musicEnabled),
        musicVolume: typeof data.musicVolume === 'number' ? Math.max(0, Math.min(1, data.musicVolume)) : 0.35,
        sfxEnabled: Boolean(data.sfxEnabled),
        vibrationEnabled: Boolean(data.vibrationEnabled),
        graphicsQuality: (data.graphicsQuality as UserSettings['graphicsQuality']) || 'high',
        language: (data.language as UserSettings['language']) || 'en',
        sensitivity: typeof data.sensitivity === 'number' ? data.sensitivity : 1.0,
        aimGuide: data.aimGuide === 'standard' ? 'standard' : 'pro',
        keyBindings: normalizeKeyBindings(data.keyBindings as Partial<UserSettings['keyBindings']>),
      };
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface FirestoreLeaderboardEntry {
  uid: string;
  playerId: string;
  username: string;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints: number;
  wins: number;
  losses: number;
  matches: number;
  online: boolean;
}

export interface FirestoreMatchHistoryEntry {
  matchId: string;
  opponentName: string;
  opponentAvatar: string;
  result: 'win' | 'loss';
  shots: number;
  duration: number;
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  createdAt: string;
}

export async function fetchFirestoreLeaderboard(limitCount = 30): Promise<FirestoreLeaderboardEntry[]> {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), orderBy('wins', 'desc'), limit(Math.max(20, Math.min(80, limitCount * 2)))),
    );
    const entries: FirestoreLeaderboardEntry[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Partial<UserProfile>;
      if (!d.uid || !d.username) return;
      if (!isRealRegisteredPlayer(d)) return;
      entries.push({
        uid: d.uid,
        playerId: d.playerId || '',
        username: d.username,
        avatar: d.avatar || 'avatar_ace',
        customAvatarUrl:
          typeof d.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(d.customAvatarUrl)
            ? d.customAvatarUrl
            : '',
        frame: d.frame || 'frame_bronze',
        level: typeof d.level === 'number' ? d.level : 1,
        rating: typeof d.rating === 'number' ? d.rating : 1000,
        rankPoints: typeof d.rankPoints === 'number' ? d.rankPoints : 0,
        wins: typeof d.wins === 'number' ? d.wins : 0,
        losses: typeof d.losses === 'number' ? d.losses : 0,
        matches: typeof d.matches === 'number' ? d.matches : 0,
        online: false,
      });
    });
    entries.sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.rating - a.rating;
    });
    return entries.slice(0, limitCount);
  } catch {
    return [];
  }
}

export async function fetchFirestoreMatchHistory(
  uid: string,
  limitCount = 20,
): Promise<FirestoreMatchHistoryEntry[]> {
  if (!auth.currentUser || !uid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'match_history'), where('playerId', '==', uid), limit(limitCount)),
    );
    const items: FirestoreMatchHistoryEntry[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      items.push({
        matchId: String(d.matchId || docSnap.id),
        opponentName: String(d.opponentName || 'Opponent'),
        opponentAvatar: String(d.opponentAvatar || 'avatar_ace'),
        result: d.result === 'win' ? 'win' : 'loss',
        shots: Number(d.shots || 0),
        duration: Number(d.duration || 0),
        xpEarned: Number(d.xpEarned || 0),
        coinsEarned: Number(d.coinsEarned || 0),
        ratingDelta: Number(d.ratingDelta || 0),
        createdAt: String(d.createdAt || ''),
      });
    });
    items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return items;
  } catch {
    return [];
  }
}

export function getFirebaseAuthErrorMessage(error: unknown, lang: Language): string {
  const code = (error as { code?: string })?.code || '';
  const msg = (error as { message?: string })?.message || '';
  const combined = `${code} ${msg}`.toLowerCase();

  if (combined.includes('auth/popup-closed-by-user')) {
    return lang === 'id'
      ? 'Jendela masuk Google ditutup sebelum selesai.'
      : 'Google sign in popup was closed before completion.';
  }
  if (combined.includes('auth/popup-blocked')) {
    return lang === 'id'
      ? 'Popup Google diblokir oleh browser. Izinkan popup lalu coba lagi.'
      : 'Google sign in popup was blocked by your browser. Please allow popups and retry.';
  }
  if (combined.includes('auth/cancelled-popup-request')) {
    return lang === 'id'
      ? 'Permintaan masuk Google dibatalkan karena ada jendela lain yang aktif.'
      : 'Another Google sign in window is already open.';
  }
  if (combined.includes('auth/unauthorized-domain')) {
    return lang === 'id'
      ? 'Domain aplikasi ini belum diizinkan pada Firebase Auth.'
      : 'This domain is not authorized in Firebase Authentication settings.';
  }
  if (combined.includes('auth/operation-not-allowed')) {
    return lang === 'id'
      ? 'Metode masuk ini belum diaktifkan di Firebase.'
      : 'This sign in method is not enabled in Firebase.';
  }
  if (combined.includes('auth/network-request-failed')) {
    return lang === 'id'
      ? 'Koneksi internet gagal saat menghubungi Google Auth.'
      : 'Network error while connecting to Google Auth. Check your connection.';
  }
  if (combined.includes('auth/invalid-credential') || combined.includes('auth/wrong-password') || combined.includes('auth/user-not-found')) {
    return lang === 'id'
      ? 'Email atau password tidak sesuai.'
      : 'Invalid email or password.';
  }
  if (combined.includes('auth/email-already-in-use')) {
    return lang === 'id'
      ? 'Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.'
      : 'This email is already registered. Try logging in instead.';
  }
  if (combined.includes('auth/weak-password')) {
    return lang === 'id'
      ? 'Password terlalu lemah. Gunakan minimal 6 karakter.'
      : 'Password is too weak. Please use at least 6 characters.';
  }
  if (combined.includes('auth/invalid-email')) {
    return lang === 'id'
      ? 'Format alamat email tidak valid.'
      : 'Please enter a valid email address.';
  }
  return lang === 'id'
    ? 'Gagal masuk ke akun. Silakan coba lagi.'
    : 'Sign in failed. Please try again.';
}

export function isPopupBlockedError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = (error as { message?: string })?.message || '';
  return `${code} ${msg}`.toLowerCase().includes('auth/popup-blocked');
}

export async function loginWithGoogle(): Promise<User> {
  const res = await signInWithPopup(auth, googleProvider);
  return res.user;
}

export async function loginWithGoogleRedirect(): Promise<void> {
  await signInWithRedirect(auth, googleProvider);
}

export async function checkGoogleRedirectResult(): Promise<User | null> {
  try {
    const res = await getRedirectResult(auth);
    return res?.user ?? null;
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code && !code.includes('no-auth-event')) {
      throw err;
    }
    return null;
  }
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
}

export async function registerWithEmail(email: string, password: string, displayName?: string): Promise<User> {
  const res = await createUserWithEmailAndPassword(auth, email, password);
  const cleanDisplay = (displayName || '').trim();
  if (cleanDisplay.length >= 2) {
    try {
      await updateProfile(res.user, { displayName: cleanDisplay.slice(0, 24) });
    } catch {
      // Non-fatal if displayName update fails; profile sync persists preferredName
    }
  }
  return res.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function loginAnonymouslyFirebase(): Promise<User> {
  const res = await signInAnonymously(auth);
  return res.user;
}

export async function logoutFirebase(): Promise<void> {
  await signOut(auth);
}
