import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCompletedMatchToStats,
  areRanksMatchmakingCompatible,
  computeBotRankedDelta,
  computeHumanRankedDelta,
  createEmptyPlayerStats,
  getBotConfigForRank,
  getRankFromPoints,
  RANK_STEPS,
  RANK_TIER_GROUPS,
} from './rank.ts';

test('rank progression starts at Silver I and ascends through all 28 divisions to Grandmaster MAX', () => {
  assert.equal(RANK_STEPS.length, 28);
  assert.equal(RANK_TIER_GROUPS.length, 6);

  assert.equal(getRankFromPoints(0).label, 'Silver I');
  assert.equal(getRankFromPoints(-50).label, 'Silver I');
  assert.equal(getRankFromPoints(100).label, 'Silver II');
  assert.equal(getRankFromPoints(200).label, 'Silver III');
  assert.equal(getRankFromPoints(300).label, 'Gold I');
  assert.equal(getRankFromPoints(750).label, 'Gold IV');
  assert.equal(getRankFromPoints(900).label, 'Platinum I');
  assert.equal(getRankFromPoints(1700).label, 'Platinum V');
  assert.equal(getRankFromPoints(1900).label, 'Diamond I');
  assert.equal(getRankFromPoints(2900).label, 'Diamond V');
  assert.equal(getRankFromPoints(3150).label, 'Master I');
  assert.equal(getRankFromPoints(5850).label, 'Master X');

  const maxRank = getRankFromPoints(6500);
  assert.equal(maxRank.tier, 'Grandmaster');
  assert.equal(maxRank.division, 'MAX');
  assert.equal(maxRank.label, 'Grandmaster MAX');
  assert.equal(maxRank.isMaxRank, true);
  assert.equal(maxRank.progressPct, 100);
});

test('tier group counts match Silver I-III, Gold I-IV, Platinum I-V, Diamond I-V, Master I-X, Grandmaster MAX', () => {
  const counts = Object.fromEntries(RANK_TIER_GROUPS.map((g) => [g.tier, g.steps.length]));
  assert.deepEqual(counts, {
    Silver: 3,
    Gold: 4,
    Platinum: 5,
    Diamond: 5,
    Master: 10,
    Grandmaster: 1,
  });

  for (let i = 1; i < RANK_STEPS.length; i++) {
    assert.ok(
      RANK_STEPS[i].minPoints > RANK_STEPS[i - 1].minPoints,
      `Step ${RANK_STEPS[i].label} minPoints must exceed previous`,
    );
  }
  const mid = getRankFromPoints(50);
  assert.equal(mid.tier, 'Silver');
  assert.equal(mid.division, 'I');
  assert.equal(mid.pointsInDivision, 50);
  assert.equal(mid.pointsToNext, 50);
  assert.equal(mid.progressPct, 50);
});

test('Ranked matchmaking pairs same tier immediately and widens to adjacent tier after wait', () => {
  assert.equal(areRanksMatchmakingCompatible(20, 220, 0.5), true); // Both Silver
  assert.equal(areRanksMatchmakingCompatible(20, 400, 0.5), false); // Silver vs Gold too early
  assert.equal(areRanksMatchmakingCompatible(20, 400, 3.0), true); // Silver vs Gold after wait
  assert.equal(areRanksMatchmakingCompatible(20, 1000, 5.0), false); // Silver vs Platinum never directly paired
  assert.equal(areRanksMatchmakingCompatible(5900, 6500, 3.0), true); // Master X vs Grandmaster after wait
});

test('Ranked bot skill scales by tier and bot RP gains taper cleanly up to Grandmaster', () => {
  const silverBot = getBotConfigForRank(50);
  const goldBot = getBotConfigForRank(400);
  const diamondBot = getBotConfigForRank(2000);
  const gmBot = getBotConfigForRank(6500);

  assert.equal(silverBot.aiDifficulty, 'club');
  assert.equal(goldBot.aiDifficulty, 'semipro');
  assert.equal(diamondBot.aiDifficulty, 'pro');
  assert.equal(gmBot.tierLabel, 'Grandmaster');
  assert.ok(silverBot.username.includes('Bot'));

  const silverWin = computeBotRankedDelta(50, true);
  const masterWin = computeBotRankedDelta(3200, true);
  const gmWin = computeBotRankedDelta(6500, true);
  assert.ok(silverWin > masterWin && masterWin > gmWin, 'Higher-tier bot wins give fewer RP than low-tier');
  assert.equal(computeBotRankedDelta(5, false), -5, 'RP cannot drop below 0');

  const humanWinUp = computeHumanRankedDelta(100, 1000, true);
  const humanWinEven = computeHumanRankedDelta(100, 100, true);
  assert.ok(humanWinUp > humanWinEven);
});

test('Completed match stats track 8 Ball, 9 Ball, Ranked, vs Players, and vs Bots independently', () => {
  let stats = createEmptyPlayerStats();
  stats = applyCompletedMatchToStats(stats, {
    variant: '8ball',
    isRanked: true,
    isBotOpponent: true,
    won: true,
  });
  stats = applyCompletedMatchToStats(stats, {
    variant: '9ball',
    isRanked: false,
    isBotOpponent: false,
    won: false,
  });

  assert.equal(stats.eightBall.wins, 1);
  assert.equal(stats.nineBall.losses, 1);
  assert.equal(stats.ranked.matches, 1);
  assert.equal(stats.ranked.wins, 1);
  assert.equal(stats.vsBots.wins, 1);
  assert.equal(stats.vsPlayers.losses, 1);
});
