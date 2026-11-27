export const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_RAW_AVATAR_BYTES = 8 * 1024 * 1024; // 8MB max raw file upload
export const MAX_AVATAR_DATA_URL_LENGTH = 65_000;
export const AVATAR_EXPORT_SIZE = 192;

export type AvatarFileValidationResult =
  | { ok: true }
  | { ok: false; code: 'UNSUPPORTED_FORMAT' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' };

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export function validateAvatarUploadFile(file: {
  type: string;
  size: number;
  name?: string;
}): AvatarFileValidationResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: 'EMPTY_FILE' };
  }
  if (file.size > MAX_RAW_AVATAR_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }
  const normalizedType = (file.type || '').toLowerCase().trim();
  const hasAllowedMime = (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(normalizedType);
  const hasAllowedExt = !normalizedType && file.name ? ALLOWED_EXTENSIONS.test(file.name.trim()) : false;
  if (!hasAllowedMime && !hasAllowedExt) {
    return { ok: false, code: 'UNSUPPORTED_FORMAT' };
  }
  return { ok: true };
}

/**
 * Validates cropped data URLs stored on profile documents & synced to backend.
 * Explicitly blocks SVG/HTML/arbitrary external URLs.
 */
export function isValidCustomAvatarDataUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw === '') return true;
  if (raw.length > MAX_AVATAR_DATA_URL_LENGTH) return false;
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw);
}

export interface CropRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

/**
 * Computes source rectangle inside an image of (imgWidth, imgHeight)
 * for a centered square/circular crop with zoom >= 1 and normalized offset (-1..1).
 */
export function computeSquareCropRect(
  imgWidth: number,
  imgHeight: number,
  zoom: number = 1,
  offsetXNorm: number = 0,
  offsetYNorm: number = 0,
): CropRect {
  const safeW = Math.max(1, imgWidth);
  const safeH = Math.max(1, imgHeight);
  const baseSide = Math.min(safeW, safeH);
  const clampedZoom = Math.max(1, Math.min(4, Number.isFinite(zoom) ? zoom : 1));
  const cropSide = baseSide / clampedZoom;

  const maxShiftX = Math.max(0, (safeW - cropSide) / 2);
  const maxShiftY = Math.max(0, (safeH - cropSide) / 2);

  const clampedX = Math.max(-1, Math.min(1, Number.isFinite(offsetXNorm) ? offsetXNorm : 0));
  const clampedY = Math.max(-1, Math.min(1, Number.isFinite(offsetYNorm) ? offsetYNorm : 0));

  const centerX = safeW / 2 - clampedX * maxShiftX;
  const centerY = safeH / 2 - clampedY * maxShiftY;

  const sx = Math.max(0, Math.min(safeW - cropSide, centerX - cropSide / 2));
  const sy = Math.max(0, Math.min(safeH - cropSide, centerY - cropSide / 2));

  return {
    sx,
    sy,
    sWidth: cropSide,
    sHeight: cropSide,
  };
}
