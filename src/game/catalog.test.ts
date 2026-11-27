import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FREE_OWNED_ITEMS,
  getCueStats,
  getVenueMeta,
  SHOP_CATALOG,
} from './constants.ts';
import { createEmptyPlayerStats } from './rank.ts';
import { applyLocalShopPurchase } from '../services/apiFallback.ts';
import type { UserProfile } from './types.ts';

test('SHOP_CATALOG includes all required premium tables and renamed Obsidian Gold', () => {
  const tableNames = SHOP_CATALOG.filter((i) => i.category === 'table').map((i) => i.name);
  for (const expected of [
    'Championship Blue',
    'Royal Emerald',
    'Classic Walnut',
    'Pearl Marble',
    'Obsidian Gold',
    'Crystal Lounge',
  ]) {
    assert.ok(tableNames.includes(expected), `Missing table ${expected}`);
  }
  const obsidian = SHOP_CATALOG.find((i) => i.id === 'table_obsidian_gold');
  assert.equal(obsidian?.name, 'Obsidian Gold');
  assert.equal(obsidian?.tableMeta?.texture, 'obsidian');
});

test('SHOP_CATALOG includes all required luxury cues with valid cueStats', () => {
  const cueNames = SHOP_CATALOG.filter((i) => i.category === 'cue').map((i) => i.name);
  for (const expected of [
    'Basic Cue',
    'Emerald Elite',
    'Royal Gold',
    'Carbon Precision',
    'Titanium Pro',
    'Sapphire Luxe',
  ]) {
    assert.ok(cueNames.includes(expected), `Missing cue ${expected}`);
  }
  const emeraldStats = getCueStats('cue_emerald_elite');
  assert.equal(emeraldStats.tier, 'Pro');
  assert.ok(emeraldStats.force >= 80 && emeraldStats.aim >= 80);
});

test('SHOP_CATALOG includes all 5 venue themes with Premium Billiard Café as free starter', () => {
  const venues = SHOP_CATALOG.filter((i) => i.category === 'venue');
  assert.equal(venues.length, 5);
  assert.ok(DEFAULT_FREE_OWNED_ITEMS.includes('venue_billiard_cafe'));

  for (const name of [
    'Premium Billiard Café',
    'Tropical Beach Lounge',
    'Rooftop Sunset',
    'Classic Club',
    'Emerald Palace',
  ]) {
    assert.ok(venues.some((v) => v.name === name), `Missing venue ${name}`);
  }

  const tropical = getVenueMeta('venue_tropical_beach');
  assert.equal(tropical.backdropClass, 'venue-tropical-beach');
  assert.equal(getVenueMeta(undefined).id, 'venue_billiard_cafe');
});

test('applyLocalShopPurchase unlocks and equips venue items cleanly', () => {
  const profile: UserProfile = {
    uid: 'user_catalog_test',
    playerId: '482731605',
    username: 'CueTester',
    avatar: 'avatar_ace',
    frame: 'frame_bronze',
    equippedCue: 'cue_basic',
    equippedTable: 'table_tournament_blue',
    equippedVenue: 'venue_billiard_cafe',
    equippedEffect: 'effect_classic',
    ownedItems: [...DEFAULT_FREE_OWNED_ITEMS],
    level: 1,
    xp: 0,
    coins: 5000,
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
  };

  const bought = applyLocalShopPurchase(profile, 'venue_tropical_beach');
  assert.equal(bought.ok, true);
  if (bought.ok) {
    assert.equal(bought.profile.coins, 4100);
    assert.equal(bought.profile.equippedVenue, 'venue_tropical_beach');
    assert.ok(bought.profile.ownedItems.includes('venue_tropical_beach'));
  }
});
