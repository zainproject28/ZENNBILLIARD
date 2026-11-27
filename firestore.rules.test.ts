import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = fs.readFileSync('firestore.rules', 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

test('firestore.rules enforces default-deny catch-all and rules_version 2', () => {
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('firestore.rules covers every collection in firebase-blueprint.json', () => {
  const expectedMatchers = [
    'match /users/{userId}',
    'match /private/{docId}',
    'match /friends/{friendshipId}',
    'match /rooms/{roomId}',
    'match /room_invites/{inviteId}',
    'match /matches/{matchId}',
    'match /match_history/{historyId}',
    'match /transactions/{transactionId}',
  ];
  for (const m of expectedMatchers) {
    assert.ok(rules.includes(m), `Missing matcher ${m}`);
  }
  assert.ok(Object.keys(blueprint.firestore).length >= 8);
});

test('firestore.rules enforces validation helpers, affectedKeys, null-safe room checks, and no blanket reads', () => {
  assert.doesNotMatch(rules, /allow read:\s*if\s*isSignedIn\(\);/);
  assert.doesNotMatch(rules, /allow list:\s*if\s*isSignedIn\(\);/);
  assert.match(rules, /isValidUserProfile\(incoming\(\), userId\)/);
  assert.match(rules, /isValidUserPrivateInfo\(incoming\(\), userId\)/);
  assert.match(rules, /isValidFriendRelation\(incoming\(\)\)/);
  assert.match(rules, /isValidRoom\(incoming\(\), roomId\)/);
  assert.match(rules, /isValidRoomInvite\(incoming\(\), inviteId\)/);
  assert.match(rules, /isValidMatch\(incoming\(\), matchId\)/);
  assert.match(rules, /isValidMatchHistory\(incoming\(\)\)/);
  assert.match(rules, /isValidTransaction\(incoming\(\), transactionId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rules, /incoming\(\)\.coins == 15000/);
  assert.match(rules, /resource == null \|\| isRoomParticipant\(existing\(\)\)/);
  assert.match(rules, /incoming\(\)\.level > existing\(\)\.level/);
  assert.match(rules, /isRoomParticipant\(/);
  assert.match(rules, /isMatchParticipant\(/);
  assert.match(rules, /rematchStatus/);
  assert.match(rules, /aimState/);
  assert.match(rules, /musicVolume/);
  assert.match(rules, /customAvatarUrl/);
  assert.match(rules, /equippedVenue/);
  assert.match(rules, /authProvider/);
  assert.match(rules, /isValidCoarseLocation/);
  assert.match(rules, /incoming\(\)\.rankPoints == 0/);
  assert.match(rules, /incoming\(\)\.highestRankPoints == 0/);
  assert.doesNotMatch(rules, /affectedKeys\(\)\.hasOnly\([^)]*'rankPoints'/);
  assert.doesNotMatch(rules, /affectedKeys\(\)\.hasOnly\([^)]*'highestRankPoints'/);
});

