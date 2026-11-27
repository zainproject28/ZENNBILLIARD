export const PLAYER_ID_DIGIT_LENGTH = 9;
export const FORMATTED_PLAYER_ID_REGEX = /^\d{3}-\d{3}-\d{3}$/;

function randomNineDigits(): string {
  // Crypto-random integer in [100_000_000, 999_999_999] so first digit is 1-9 and length is always 9
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    const num = 100_000_000 + (buf[0] % 900_000_000);
    return String(num);
  }
  const num = 100_000_000 + Math.floor(Math.random() * 900_000_000);
  return String(num);
}

export function formatPlayerId(raw: string | undefined | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === PLAYER_ID_DIGIT_LENGTH) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }
  return String(raw || '').trim();
}

export function stripPlayerId(raw: string | undefined | null): string {
  const trimmed = String(raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === PLAYER_ID_DIGIT_LENGTH) {
    return digits;
  }
  return trimmed.replace(/-/g, '');
}

export function isFormattedNineDigitPlayerId(raw: string | undefined | null): boolean {
  return FORMATTED_PLAYER_ID_REGEX.test(String(raw || '').trim());
}

export function generateRandomPlayerId(isTaken?: (candidateFormatted: string) => boolean): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const digits = randomNineDigits();
    // Avoid trivial sequential or repeating patterns like 123456789 / 111111111
    if (/^(\d)\1{8}$/.test(digits) || digits === '123456789' || digits === '987654321') {
      continue;
    }
    const formatted = formatPlayerId(digits);
    if (!isTaken || !isTaken(formatted)) {
      return formatted;
    }
  }
  return formatPlayerId(randomNineDigits());
}

export function matchesPlayerIdQuery(playerId: string | undefined | null, query: string): boolean {
  const cleanQuery = query.trim();
  if (!cleanQuery) return false;
  const queryDigits = cleanQuery.replace(/\D/g, '');
  const idDigits = String(playerId || '').replace(/\D/g, '');
  if (queryDigits.length > 0 && idDigits.length > 0 && !/[a-zA-Z]/.test(cleanQuery)) {
    return idDigits.includes(queryDigits);
  }
  return String(playerId || '').toLowerCase().includes(cleanQuery.toLowerCase());
}
