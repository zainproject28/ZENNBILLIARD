import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDistanceKm,
  evaluatePlayerProximity,
  formatDistanceLabel,
  isRealRegisteredPlayer,
  roundCoarseCoord,
  sanitizePlayerLocation,
  sortPlayersByProximity,
} from './location.ts';

test('isRealRegisteredPlayer rejects guests, local guests, bots, and fake guest usernames', () => {
  assert.equal(isRealRegisteredPlayer({ uid: 'guest_1234abcd', authProvider: 'guest', username: 'Guest_2324' }), false);
  assert.equal(isRealRegisteredPlayer({ uid: 'local_guest_9999', username: 'Guest_9999' }), false);
  assert.equal(isRealRegisteredPlayer({ uid: 'bot_ranked_silver_i', isBot: true, username: 'Zenn Bot · Silver I' }), false);
  assert.equal(isRealRegisteredPlayer({ uid: 'ranked_bot_gold_ii', username: 'Zenn Bot · Gold II' }), false);
  assert.equal(isRealRegisteredPlayer({ uid: 'firebaseUid123', username: 'Guest_2601' }), false);

  assert.equal(isRealRegisteredPlayer({ uid: 'abcUserGoogle', authProvider: 'google', username: 'Giga Alfais' }), true);
  assert.equal(isRealRegisteredPlayer({ uid: 'abcUserEmail', authProvider: 'email', username: 'Daffa Zain' }), true);
  assert.equal(isRealRegisteredPlayer({ uid: 'legacyRealUid', username: 'Raka Billiard' }), true);
});

test('roundCoarseCoord limits precision to ~1.1km privacy boundary and sanitizePlayerLocation validates ranges', () => {
  assert.equal(roundCoarseCoord(-6.208763), -6.21);
  assert.equal(roundCoarseCoord(106.845599), 106.85);

  const clean = sanitizePlayerLocation({
    lat: -6.208763,
    lng: 106.845599,
    city: 'Jakarta',
    region: 'Asia',
    timezone: 'Asia/Jakarta',
  });
  assert.ok(clean);
  assert.equal(clean.lat, -6.21);
  assert.equal(clean.lng, 106.85);
  assert.equal(clean.city, 'Jakarta');

  const invalidLat = sanitizePlayerLocation({ lat: 199, lng: 106.8 });
  assert.equal(invalidLat, undefined);
});

test('computeDistanceKm and sortPlayersByProximity order closest real players first', () => {
  const selfLoc = { lat: -6.21, lng: 106.85, city: 'Jakarta', region: 'Asia', timezone: 'Asia/Jakarta' };
  const bandungKm = computeDistanceKm(selfLoc, { lat: -6.91, lng: 107.61 });
  const bekasiKm = computeDistanceKm(selfLoc, { lat: -6.24, lng: 107.0 });

  assert.ok(bekasiKm < bandungKm, `Expected Bekasi (${bekasiKm}km) < Bandung (${bandungKm}km)`);

  const pFar = evaluatePlayerProximity(
    { uid: 'u1', username: 'BandungPro', online: true, location: { lat: -6.91, lng: 107.61, city: 'Bandung' } },
    selfLoc,
  );
  const pNear = evaluatePlayerProximity(
    { uid: 'u2', username: 'BekasiCue', online: false, location: { lat: -6.24, lng: 107.0, city: 'Bekasi' } },
    selfLoc,
  );
  const pRegionOnly = evaluatePlayerProximity(
    { uid: 'u3', username: 'JakartaGuest', online: true, location: { city: 'Jakarta', region: 'Asia' } },
    selfLoc,
  );
  const pOther = evaluatePlayerProximity({ uid: 'u4', username: 'TokyoCue', online: true }, selfLoc);

  const sorted = sortPlayersByProximity([pOther, pFar, pRegionOnly, pNear]);
  assert.deepEqual(
    sorted.map((s) => s.uid),
    ['u2', 'u1', 'u3', 'u4'],
  );

  assert.match(formatDistanceLabel(pNear.distanceKm, pNear.location, 'id'), /km dari Anda/);
  assert.match(formatDistanceLabel(pNear.distanceKm, pNear.location, 'en'), /km away/);
});
