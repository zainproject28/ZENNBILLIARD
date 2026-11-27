import type { PlayerLocation } from './types.ts';

const BLOCKED_UID_PREFIXES = ['guest_', 'local_guest_', 'bot_', 'ranked_bot_', 'practice_', 'ai_'];

export function isRealRegisteredPlayer(candidate: {
  uid?: string;
  authProvider?: string;
  isBot?: boolean;
  username?: string;
}): boolean {
  const uid = (candidate.uid || '').trim();
  if (!uid) return false;
  if (candidate.isBot) return false;

  const lowerUid = uid.toLowerCase();
  for (const prefix of BLOCKED_UID_PREFIXES) {
    if (lowerUid.startsWith(prefix)) return false;
  }

  if (candidate.authProvider) {
    return candidate.authProvider === 'google' || candidate.authProvider === 'email';
  }

  const username = (candidate.username || '').trim();
  if (!username || /^Guest_[0-9]+$/i.test(username) || /^Zenn Bot/i.test(username)) {
    return false;
  }

  return true;
}

export function roundCoarseCoord(val: number): number {
  return Math.round(val * 100) / 100;
}

function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^a-zA-Z0-9_ .,\-/]/g, '').trim().slice(0, maxLen);
}

export function sanitizePlayerLocation(raw: unknown): PlayerLocation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: PlayerLocation = {};

  if (
    typeof obj.lat === 'number' &&
    Number.isFinite(obj.lat) &&
    obj.lat >= -90 &&
    obj.lat <= 90 &&
    typeof obj.lng === 'number' &&
    Number.isFinite(obj.lng) &&
    obj.lng >= -180 &&
    obj.lng <= 180
  ) {
    out.lat = roundCoarseCoord(obj.lat);
    out.lng = roundCoarseCoord(obj.lng);
  }

  const city = cleanText(obj.city, 48);
  const region = cleanText(obj.region, 48);
  const timezone = cleanText(obj.timezone, 64);
  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt.length <= 40 ? obj.updatedAt : '';

  if (city) out.city = city;
  if (region) out.region = region;
  if (timezone) out.timezone = timezone;
  if (updatedAt) out.updatedAt = updatedAt;

  if (
    out.lat === undefined &&
    out.lng === undefined &&
    !out.city &&
    !out.region &&
    !out.timezone
  ) {
    return undefined;
  }
  return out;
}

export function computeDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const km = R * c;
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}

export function formatDistanceLabel(
  distanceKm: number | null | undefined,
  location: PlayerLocation | undefined,
  lang: 'en' | 'id',
): string {
  if (typeof distanceKm === 'number' && Number.isFinite(distanceKm)) {
    const rounded = distanceKm < 1 ? '< 1' : distanceKm < 10 ? distanceKm.toFixed(1) : String(Math.round(distanceKm));
    const placeSuffix = location?.city ? ` · ${location.city}` : '';
    return lang === 'id' ? `${rounded} km dari Anda${placeSuffix}` : `${rounded} km away${placeSuffix}`;
  }
  if (location?.city && location?.region) {
    return `${location.city}, ${location.region}`;
  }
  if (location?.city) return location.city;
  if (location?.region) return location.region;
  return '';
}

export function getBrowserTimezoneRegion(): { city: string; region: string; timezone: string } {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const parts = tz.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return {
        region: cleanText(parts[0].replace(/_/g, ' '), 48),
        city: cleanText(parts[parts.length - 1].replace(/_/g, ' '), 48),
        timezone: cleanText(tz, 64),
      };
    }
    return {
      region: '',
      city: cleanText(tz.replace(/_/g, ' '), 48),
      timezone: cleanText(tz, 64),
    };
  } catch {
    return { city: '', region: '', timezone: '' };
  }
}

export interface ProximityScoredPlayer {
  uid: string;
  online: boolean;
  location?: PlayerLocation;
  distanceKm?: number | null;
  sameRegion?: boolean;
  updatedAt?: string;
}

export function evaluatePlayerProximity<T extends ProximityScoredPlayer>(
  player: T,
  selfLocation?: PlayerLocation,
): T & { distanceKm: number | null; sameRegion: boolean; locationLabel: string } {
  let distanceKm: number | null = null;
  if (
    selfLocation &&
    typeof selfLocation.lat === 'number' &&
    typeof selfLocation.lng === 'number' &&
    player.location &&
    typeof player.location.lat === 'number' &&
    typeof player.location.lng === 'number'
  ) {
    distanceKm = computeDistanceKm(
      { lat: selfLocation.lat, lng: selfLocation.lng },
      { lat: player.location.lat, lng: player.location.lng },
    );
  }

  const sameRegion = Boolean(
    selfLocation &&
      player.location &&
      ((selfLocation.city && player.location.city && selfLocation.city.toLowerCase() === player.location.city.toLowerCase()) ||
        (selfLocation.timezone &&
          player.location.timezone &&
          selfLocation.timezone.toLowerCase() === player.location.timezone.toLowerCase()) ||
        (selfLocation.region &&
          player.location.region &&
          selfLocation.region.toLowerCase() === player.location.region.toLowerCase())),
  );

  const locationLabel = player.location?.city
    ? player.location.region
      ? `${player.location.city}, ${player.location.region}`
      : player.location.city
    : player.location?.region || '';

  return {
    ...player,
    distanceKm,
    sameRegion,
    locationLabel,
  };
}

export function sortPlayersByProximity<
  T extends ProximityScoredPlayer & { distanceKm?: number | null; sameRegion?: boolean; username?: string },
>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const aHasDist = typeof a.distanceKm === 'number' && Number.isFinite(a.distanceKm);
    const bHasDist = typeof b.distanceKm === 'number' && Number.isFinite(b.distanceKm);
    if (aHasDist && bHasDist) {
      if (a.distanceKm !== b.distanceKm) return (a.distanceKm as number) - (b.distanceKm as number);
    } else if (aHasDist !== bHasDist) {
      return aHasDist ? -1 : 1;
    }

    const aSame = a.sameRegion ? 1 : 0;
    const bSame = b.sameRegion ? 1 : 0;
    if (aSame !== bSame) return bSame - aSame;

    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.username || '').localeCompare(b.username || '');
  });
}
