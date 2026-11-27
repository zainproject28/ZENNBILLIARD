const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;
const IGNORED_SIX_CHAR_WORDS = new Set([
  'ONLINE',
  'MASTER',
  'FRIEND',
  'JOINMY',
  'INVITE',
  'PLAYER',
  'SERVER',
  'GOOGLE',
  'POINTS',
]);

/**
 * Extracts a 6-character room code from direct typing, pasted URLs (?room=XXXXXX),
 * or pasted invitation messages ("Join my ZENN BILLIARD match! Room Code: K7M9P2...").
 * Preserves partial input (<= 6 sanitized characters) while the user is typing manually.
 */
export function extractRoomCode(raw: string): string {
  if (!raw) return '';

  // 1. Explicit URL query parameter: ?room=XXXXXX or &room=XXXXXX
  const urlMatch = raw.match(/[?&]room=([A-Za-z0-9]{1,12})/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  // 2. Explicit "Room Code: XXXXXX" label in shared invite text
  const labelMatch = raw.match(/room\s*code\s*[:#-]?\s*([A-Za-z0-9]{6})/i);
  if (labelMatch && labelMatch[1]) {
    return labelMatch[1].toUpperCase();
  }

  // 3. Multi-word text or URL pasted: look for a standalone 6-char alphanumeric token
  const trimmed = raw.trim();
  if (/[\s/:.?=&]/.test(trimmed) && trimmed.length > 6) {
    const tokens = trimmed.toUpperCase().match(/\b[A-Z0-9]{6}\b/g) || [];
    // Prefer a token containing at least one digit (room codes usually mix letters+digits)
    const digitToken = tokens.find((t) => /\d/.test(t));
    if (digitToken) return digitToken;

    // Otherwise first 6-char token not in common English invite prose words
    const plausible = tokens.find((t) => !IGNORED_SIX_CHAR_WORDS.has(t));
    if (plausible) return plausible;
  }

  // 4. Direct manual input / hyphenated code like "K7M-9P2"
  return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_REGEX.test(code);
}

export type RoomJoinErrorCode =
  | 'INVALID_FORMAT'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_EXPIRED'
  | 'IN_PROGRESS'
  | 'NOT_SIGNED_IN'
  | 'INSUFFICIENT_COINS'
  | 'CONNECTION_FAILED'
  | 'SERVER_ERROR';

export function classifyRoomJoinError(opts: {
  code?: string;
  status?: number;
  message?: string;
  isBackendAvailable?: boolean;
  isSignedIn?: boolean;
}): RoomJoinErrorCode {
  if (opts.isSignedIn === false || opts.status === 401) return 'NOT_SIGNED_IN';
  const rawCode = (opts.code || '').toUpperCase();
  const msg = (opts.message || '').toLowerCase();
  if (rawCode === 'ROOM_FULL' || msg.includes('full') || msg.includes('penuh')) return 'ROOM_FULL';
  if (rawCode === 'ROOM_EXPIRED' || msg.includes('expired') || msg.includes('kadaluarsa') || msg.includes('cancelled')) return 'ROOM_EXPIRED';
  if (rawCode === 'IN_PROGRESS' || msg.includes('already in progress') || msg.includes('berlangsung')) return 'IN_PROGRESS';
  if (rawCode === 'INSUFFICIENT_COINS' || msg.includes('insufficient coins') || msg.includes('koin')) return 'INSUFFICIENT_COINS';
  if (rawCode === 'ROOM_NOT_FOUND' || rawCode === 'INVALID_CODE' || opts.status === 404 || msg.includes('not found')) {
    return 'ROOM_NOT_FOUND';
  }
  if (opts.isBackendAvailable === false || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('offline')) {
    return 'CONNECTION_FAILED';
  }
  if ((opts.status && opts.status >= 500) || rawCode === 'SERVER_ERROR') {
    return 'SERVER_ERROR';
  }
  return 'ROOM_NOT_FOUND';
}
