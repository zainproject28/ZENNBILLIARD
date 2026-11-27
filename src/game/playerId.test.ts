import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPlayerId,
  generateRandomPlayerId,
  isFormattedNineDigitPlayerId,
  matchesPlayerIdQuery,
  stripPlayerId,
} from './playerId.ts';

test('generateRandomPlayerId produces 9 non-sequential random digits formatted XXX-XXX-XXX', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const id = generateRandomPlayerId((cand) => seen.has(cand));
    assert.equal(isFormattedNineDigitPlayerId(id), true, `Expected XXX-XXX-XXX, got ${id}`);
    assert.equal(stripPlayerId(id).length, 9);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

test('generateRandomPlayerId retries when backend uniqueness callback reports collision', () => {
  let calls = 0;
  const id = generateRandomPlayerId(() => {
    calls += 1;
    return calls <= 3;
  });
  assert.ok(calls >= 4);
  assert.equal(isFormattedNineDigitPlayerId(id), true);
});

test('formatPlayerId and stripPlayerId convert cleanly between grouped display and copyable digits', () => {
  assert.equal(formatPlayerId('482731605'), '482-731-605');
  assert.equal(formatPlayerId('482-731-605'), '482-731-605');
  assert.equal(stripPlayerId('482-731-605'), '482731605');
  assert.equal(stripPlayerId('482 731 605'), '482731605');
});

test('matchesPlayerIdQuery accepts queries with or without hyphens', () => {
  const target = '482-731-605';
  assert.equal(matchesPlayerIdQuery(target, '482731605'), true);
  assert.equal(matchesPlayerIdQuery(target, '482-731-605'), true);
  assert.equal(matchesPlayerIdQuery(target, '482 731'), true);
  assert.equal(matchesPlayerIdQuery(target, '731605'), true);
  assert.equal(matchesPlayerIdQuery(target, '999999999'), false);
});
