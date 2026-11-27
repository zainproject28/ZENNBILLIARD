import { PRO_AI_CHALLENGERS } from './quickMatchAi.ts';
import type { OnlineParticipantMeta } from './types.ts';

export interface SpinReelCandidate {
  uid: string;
  username: string;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
}

function toCandidate(entry: OnlineParticipantMeta): SpinReelCandidate {
  return {
    uid: entry.uid,
    username: entry.username,
    avatar: entry.avatar,
    customAvatarUrl: entry.customAvatarUrl,
    frame: entry.frame,
    level: entry.level,
  };
}

/**
 * Builds a deterministic vertical slot-reel sequence of challengers that ends
 * cleanly on the resolved `target` opponent. Used for Quick Match, Ranked,
 * and online VS roulette reveal animations.
 */
export function buildSpinReelItems(
  target: SpinReelCandidate,
  extraPool: readonly OnlineParticipantMeta[] = PRO_AI_CHALLENGERS,
  totalSlots = 16,
): SpinReelCandidate[] {
  const safeCount = Math.max(4, Math.floor(totalSlots));
  const pool: SpinReelCandidate[] = [];
  const seen = new Set<string>();

  for (const item of extraPool) {
    if (!item || !item.uid) continue;
    if (seen.has(item.uid)) continue;
    seen.add(item.uid);
    pool.push(toCandidate(item));
  }

  if (pool.length === 0) {
    pool.push(target);
  }

  // Rotate filler items so target doesn't repeat identically right before final lock
  const nonTargetPool = pool.filter((c) => c.uid !== target.uid);
  const sourcePool = nonTargetPool.length > 0 ? nonTargetPool : pool;

  const items: SpinReelCandidate[] = [];
  for (let i = 0; i < safeCount - 1; i++) {
    items.push(sourcePool[i % sourcePool.length]);
  }
  items.push(target);
  return items;
}

/**
 * Recursively removes keys with `undefined` values so Firestore `updateDoc` / `setDoc`
 * payloads never fail with "Unsupported field value: undefined".
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out as T;
}
