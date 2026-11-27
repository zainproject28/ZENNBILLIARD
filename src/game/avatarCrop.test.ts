import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSquareCropRect,
  isValidCustomAvatarDataUrl,
  MAX_RAW_AVATAR_BYTES,
  validateAvatarUploadFile,
} from './avatarCrop.ts';

test('validateAvatarUploadFile allows JPEG/PNG/WebP and rejects SVG/PDF/oversized files', () => {
  assert.deepEqual(validateAvatarUploadFile({ type: 'image/jpeg', size: 120_000, name: 'me.jpg' }), { ok: true });
  assert.deepEqual(validateAvatarUploadFile({ type: 'image/png', size: 240_000, name: 'me.png' }), { ok: true });
  assert.deepEqual(validateAvatarUploadFile({ type: 'image/webp', size: 80_000, name: 'me.webp' }), { ok: true });

  assert.deepEqual(validateAvatarUploadFile({ type: 'image/svg+xml', size: 1024, name: 'xss.svg' }), {
    ok: false,
    code: 'UNSUPPORTED_FORMAT',
  });
  assert.deepEqual(validateAvatarUploadFile({ type: 'application/pdf', size: 1024, name: 'doc.pdf' }), {
    ok: false,
    code: 'UNSUPPORTED_FORMAT',
  });
  assert.deepEqual(validateAvatarUploadFile({ type: 'image/jpeg', size: MAX_RAW_AVATAR_BYTES + 1 }), {
    ok: false,
    code: 'FILE_TOO_LARGE',
  });
  assert.deepEqual(validateAvatarUploadFile({ type: 'image/png', size: 0 }), {
    ok: false,
    code: 'EMPTY_FILE',
  });
});

test('isValidCustomAvatarDataUrl enforces safe bounded base64 raster data URLs', () => {
  assert.equal(isValidCustomAvatarDataUrl(''), true);
  assert.equal(isValidCustomAvatarDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isValidCustomAvatarDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isValidCustomAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isValidCustomAvatarDataUrl('https://evil.example/a.png'), false);
  assert.equal(isValidCustomAvatarDataUrl('javascript:alert(1)'), false);
});

test('computeSquareCropRect centers and clamps pan/zoom cleanly inside image bounds', () => {
  const rect1x = computeSquareCropRect(800, 600, 1, 0, 0);
  assert.equal(rect1x.sWidth, 600);
  assert.equal(rect1x.sHeight, 600);
  assert.equal(rect1x.sx, 100);
  assert.equal(rect1x.sy, 0);

  const zoomed = computeSquareCropRect(800, 800, 2, 1, -1);
  assert.equal(zoomed.sWidth, 400);
  assert.ok(zoomed.sx >= 0 && zoomed.sx + zoomed.sWidth <= 800);
  assert.ok(zoomed.sy >= 0 && zoomed.sy + zoomed.sHeight <= 800);
});
