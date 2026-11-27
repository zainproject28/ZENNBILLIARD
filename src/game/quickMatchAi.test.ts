import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FREE_OWNED_ITEMS } from './constants';
import { computeQuickMatchClientSettlement, pickRandomQuickMatchOpponent, PRO_AI_CHALLENGERS } from './quickMatchAi';
import { createEmptyPlayerStats } from './rank';
import type { UserProfile } from './types';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'user_test_1',
    playerId: 'ZB-TST1',
    username: 'TestCueist',
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    equippedCue: 'cue_basic',
    equippedTable: 'table_tournament_blue',
    equippedEffect: 'effect_classic',
    ownedItems: [...DEFAULT_FREE_OWNED_ITEMS],
    level: 1,
    xp: 0,
    coins: 15000,
    rating: 1000,
    rankPoints: 0,
    highestRankPoints: 0,
    wins: 0,
    losses: 0,
    matches: 0,
    stats: createEmptyPlayerStats(),
    dailyStreak: 0,
    lastDailyClaim: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('pickRandomQuickMatchOpponent selects elite Pro AI challenger across rng range', () => {
  const first = pickRandomQuickMatchOpponent(() => 0);
  const last = pickRandomQuickMatchOpponent(() => 0.999);
  assert.equal(first.uid, PRO_AI_CHALLENGERS[0].uid);
  assert.equal(last.uid, PRO_AI_CHALLENGERS[PRO_AI_CHALLENGERS.length - 1].uid);
  assert.ok(first.rating >= 1900 && last.rating >= 1900);
  assert.equal(first.isBot, true);
});

test('computeQuickMatchClientSettlement awards net stake, positive Elo, and handles level-up XP', () => {
  const base = makeProfile({ coins: 15000, level: 1, xp: 60 });
  const res = computeQuickMatchClientSettlement(base, 2150, true, 1000, 8);
  assert.equal(res.coinsEarned, 2000);
  assert.equal(res.nextProfile.coins, 16000);
  assert.ok(res.ratingDelta >= 25);
  assert.equal(res.nextProfile.wins, 1);
  assert.equal(res.nextProfile.matches, 1);
  assert.equal(res.nextProfile.level, 2);
  assert.ok(res.nextProfile.xp < 175);
});

test('computeQuickMatchClientSettlement deducts stake on loss and grants free-mode consolation', () => {
  const base = makeProfile({ coins: 15000 });
  const stakedLoss = computeQuickMatchClientSettlement(base, 2100, false, 2500, 4);
  assert.equal(stakedLoss.coinsEarned, 0);
  assert.equal(stakedLoss.nextProfile.coins, 12500);
  assert.equal(stakedLoss.nextProfile.losses, 1);

  const freeLoss = computeQuickMatchClientSettlement(base, 2100, false, 0, 4);
  assert.equal(freeLoss.coinsEarned, 25);
  assert.equal(freeLoss.nextProfile.coins, 15025);
});
