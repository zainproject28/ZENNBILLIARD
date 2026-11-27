import { DAILY_REWARD_SCHEDULE, DEFAULT_FREE_OWNED_ITEMS, SHOP_CATALOG } from '../game/constants.ts';
import { isValidCustomAvatarDataUrl } from '../game/avatarCrop.ts';
import { normalizeKeyBindings } from '../game/controls.ts';
import { generateRandomPlayerId, isFormattedNineDigitPlayerId } from '../game/playerId.ts';
import { normalizePlayerStats } from '../game/rank.ts';
import type { UserProfile, UserSettings } from '../game/types.ts';

export const STATIC_STARTER_COINS = 15000;
const LOCAL_PROFILE_STORAGE_KEY = 'zenn_billiard_local_profile_v1';
const LOCAL_SETTINGS_STORAGE_KEY = 'zenn_billiard_settings_v1';
const LOCAL_GUEST_SESSION_KEY = 'zenn_billiard_guest_session_v1';

export interface SafeFetchResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  isBackendAvailable: boolean;
  data: T | null;
}

/**
 * Safely calls a backend `/api/*` endpoint. When deployed on static hosting
 * (like Netlify without an Express runtime), HTML or 404 responses are treated
 * cleanly as `isBackendAvailable: false` so client/Firebase fallbacks take over.
 */
export async function safeFetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(url, init);
    const ct = res.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('application/json')) {
      return { ok: false, status: res.status, isBackendAvailable: false, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: res.ok, status: res.status, isBackendAvailable: true, data };
  } catch {
    return { ok: false, status: 0, isBackendAvailable: false, data: null };
  }
}

export function loadLocalSettings(fallback: UserSettings): UserSettings {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      musicEnabled: typeof parsed.musicEnabled === 'boolean' ? parsed.musicEnabled : fallback.musicEnabled,
      musicVolume:
        typeof parsed.musicVolume === 'number' && Number.isFinite(parsed.musicVolume)
          ? Math.max(0, Math.min(1, parsed.musicVolume))
          : fallback.musicVolume,
      sfxEnabled: typeof parsed.sfxEnabled === 'boolean' ? parsed.sfxEnabled : fallback.sfxEnabled,
      vibrationEnabled: typeof parsed.vibrationEnabled === 'boolean' ? parsed.vibrationEnabled : fallback.vibrationEnabled,
      graphicsQuality:
        parsed.graphicsQuality === 'low' || parsed.graphicsQuality === 'medium' || parsed.graphicsQuality === 'high'
          ? parsed.graphicsQuality
          : fallback.graphicsQuality,
      language: parsed.language === 'id' || parsed.language === 'en' ? parsed.language : fallback.language,
      sensitivity:
        typeof parsed.sensitivity === 'number' && Number.isFinite(parsed.sensitivity)
          ? Math.max(0.2, Math.min(2.5, parsed.sensitivity))
          : fallback.sensitivity,
      aimGuide: parsed.aimGuide === 'standard' || parsed.aimGuide === 'pro' ? parsed.aimGuide : 'pro',
      keyBindings: normalizeKeyBindings(parsed.keyBindings ?? fallback.keyBindings),
    };
  } catch {
    return fallback;
  }
}

export function saveLocalSettings(settings: UserSettings): void {
  try {
    window.localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage restriction
  }
}

export function normalizeProfileDefaults(raw: UserProfile): UserProfile {
  return {
    ...raw,
    customAvatarUrl:
      typeof raw.customAvatarUrl === 'string' && isValidCustomAvatarDataUrl(raw.customAvatarUrl)
        ? raw.customAvatarUrl
        : '',
    equippedVenue:
      typeof raw.equippedVenue === 'string' && raw.equippedVenue.length > 0
        ? raw.equippedVenue
        : 'venue_billiard_cafe',
    rankPoints: typeof raw.rankPoints === 'number' && Number.isFinite(raw.rankPoints) ? Math.max(0, Math.floor(raw.rankPoints)) : 0,
    highestRankPoints:
      typeof raw.highestRankPoints === 'number' && Number.isFinite(raw.highestRankPoints)
        ? Math.max(0, Math.floor(raw.highestRankPoints))
        : 0,
    stats: normalizePlayerStats(raw.stats),
  };
}

export function loadStoredGuestSession(): { token: string; profile: UserProfile } | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; profile?: UserProfile };
    if (!parsed.token || !parsed.profile || typeof parsed.profile.uid !== 'string') return null;
    return { token: parsed.token, profile: normalizeProfileDefaults(parsed.profile) };
  } catch {
    return null;
  }
}

export function saveStoredGuestSession(token: string, profile: UserProfile): void {
  try {
    window.localStorage.setItem(LOCAL_GUEST_SESSION_KEY, JSON.stringify({ token, profile }));
  } catch {
    // Ignore storage restriction
  }
}

export function clearStoredGuestSession(): void {
  try {
    window.localStorage.removeItem(LOCAL_GUEST_SESSION_KEY);
  } catch {
    // Ignore
  }
}

export function createLocalGuestProfile(preferredName?: string): UserProfile {
  const existing = loadStoredLocalGuestProfile();
  if (existing && (!preferredName || preferredName.trim().length < 2)) {
    if (!isFormattedNineDigitPlayerId(existing.playerId)) {
      const upgraded = { ...existing, playerId: generateRandomPlayerId() };
      saveStoredLocalGuestProfile(upgraded);
      return upgraded;
    }
    return existing;
  }
  const tag = Math.floor(1000 + Math.random() * 9000);
  const now = new Date().toISOString();
  const cleanName = (preferredName || `Guest_${tag}`)
    .replace(/[^a-zA-Z0-9_ .-]/g, '')
    .trim()
    .slice(0, 24)
    .trim();
  const validExistingPlayerId =
    existing?.playerId && isFormattedNineDigitPlayerId(existing.playerId)
      ? existing.playerId
      : generateRandomPlayerId();
  const profile: UserProfile = {
    uid: existing?.uid || `local_guest_${Date.now().toString(36)}_${tag}`,
    playerId: validExistingPlayerId,
    username: cleanName.length >= 2 ? cleanName : `Guest_${tag}`,
    avatar: existing?.avatar || 'avatar_ace',
    customAvatarUrl: existing?.customAvatarUrl || '',
    frame: existing?.frame || 'frame_bronze',
    equippedCue: existing?.equippedCue || 'cue_basic',
    equippedTable: existing?.equippedTable || 'table_tournament_blue',
    equippedVenue: existing?.equippedVenue || 'venue_billiard_cafe',
    equippedEffect: existing?.equippedEffect || 'effect_classic',
    ownedItems: existing?.ownedItems || [...DEFAULT_FREE_OWNED_ITEMS],
    level: existing?.level || 1,
    xp: existing?.xp || 0,
    coins: existing?.coins ?? STATIC_STARTER_COINS,
    rating: existing?.rating || 1000,
    rankPoints: existing?.rankPoints || 0,
    highestRankPoints: existing?.highestRankPoints || 0,
    wins: existing?.wins || 0,
    losses: existing?.losses || 0,
    matches: existing?.matches || 0,
    stats: normalizePlayerStats(existing?.stats),
    dailyStreak: existing?.dailyStreak || 0,
    lastDailyClaim: existing?.lastDailyClaim || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  saveStoredLocalGuestProfile(profile);
  return profile;
}

export function loadStoredLocalGuestProfile(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed || typeof parsed.uid !== 'string') return null;
    return normalizeProfileDefaults(parsed);
  } catch {
    return null;
  }
}

export function saveStoredLocalGuestProfile(profile: UserProfile): void {
  try {
    window.localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore private mode storage errors
  }
}

export function applyLocalDailyReward(profile: UserProfile): {
  ok: true;
  rewardCoins: number;
  streak: number;
  profile: UserProfile;
} | { ok: false; error: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (profile.lastDailyClaim === today) {
    return { ok: false, error: 'Already claimed today' };
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextStreak = profile.lastDailyClaim === yesterday ? profile.dailyStreak + 1 : 1;
  const rewardCoins = DAILY_REWARD_SCHEDULE[(nextStreak - 1) % DAILY_REWARD_SCHEDULE.length];
  const updated: UserProfile = {
    ...profile,
    coins: profile.coins + rewardCoins,
    dailyStreak: nextStreak,
    lastDailyClaim: today,
    updatedAt: new Date().toISOString(),
  };
  if (profile.uid.startsWith('local_guest_')) {
    saveStoredLocalGuestProfile(updated);
  }
  return { ok: true, rewardCoins, streak: nextStreak, profile: updated };
}

export function applyLocalShopPurchase(
  profile: UserProfile,
  itemId: string,
): { ok: true; profile: UserProfile } | { ok: false; error: string } {
  const item = SHOP_CATALOG.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Item not found' };
  const owned = new Set(profile.ownedItems || []);
  let coins = profile.coins;

  if (!owned.has(item.id) && item.price > 0) {
    if (coins < item.price) {
      return { ok: false, error: 'Not enough coins' };
    }
    coins -= item.price;
    owned.add(item.id);
  } else {
    owned.add(item.id);
  }

  const updated: UserProfile = {
    ...profile,
    coins,
    ownedItems: Array.from(owned),
    equippedCue: item.category === 'cue' ? item.id : profile.equippedCue,
    equippedTable: item.category === 'table' ? item.id : profile.equippedTable,
    equippedVenue: item.category === 'venue' ? item.id : (profile.equippedVenue || 'venue_billiard_cafe'),
    equippedEffect: item.category === 'effect' ? item.id : profile.equippedEffect,
    avatar: item.category === 'avatar' ? item.id : profile.avatar,
    frame: item.category === 'frame' ? item.id : profile.frame,
    updatedAt: new Date().toISOString(),
  };
  if (profile.uid.startsWith('local_guest_')) {
    saveStoredLocalGuestProfile(updated);
  }
  return { ok: true, profile: updated };
}
