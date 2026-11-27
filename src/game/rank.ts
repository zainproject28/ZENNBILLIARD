import type {
  AiDifficulty,
  GameVariant,
  PlayerStatsBreakdown,
  PlayerStatsSummary,
  RankDivision,
  RankTier,
} from './types.ts';

export interface RankStep {
  index: number;
  tier: RankTier;
  division: RankDivision;
  label: string;
  minPoints: number;
  nextThreshold: number | null;
}

export interface RankInfo extends RankStep {
  points: number;
  pointsInDivision: number;
  pointsToNext: number;
  progressPct: number;
  isMaxRank: boolean;
}

export interface RankedBotProfile {
  uid: string;
  username: string;
  avatar: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints: number;
  equippedCue: string;
  equippedTable: string;
  equippedEffect: string;
  aiDifficulty: AiDifficulty;
  tierLabel: RankTier;
}

/**
 * Full 28-step Ranked Ladder starting at Silver I (default 0 RP) up to Grandmaster MAX:
 * Silver I–III, Gold I–IV, Platinum I–V, Diamond I–V, Master I–X, Grandmaster MAX.
 */
export const RANK_STEPS: readonly RankStep[] = [
  // Silver I - III (0..299)
  { index: 0, tier: 'Silver', division: 'I', label: 'Silver I', minPoints: 0, nextThreshold: 100 },
  { index: 1, tier: 'Silver', division: 'II', label: 'Silver II', minPoints: 100, nextThreshold: 200 },
  { index: 2, tier: 'Silver', division: 'III', label: 'Silver III', minPoints: 200, nextThreshold: 300 },
  // Gold I - IV (300..899)
  { index: 3, tier: 'Gold', division: 'I', label: 'Gold I', minPoints: 300, nextThreshold: 450 },
  { index: 4, tier: 'Gold', division: 'II', label: 'Gold II', minPoints: 450, nextThreshold: 600 },
  { index: 5, tier: 'Gold', division: 'III', label: 'Gold III', minPoints: 600, nextThreshold: 750 },
  { index: 6, tier: 'Gold', division: 'IV', label: 'Gold IV', minPoints: 750, nextThreshold: 900 },
  // Platinum I - V (900..1899)
  { index: 7, tier: 'Platinum', division: 'I', label: 'Platinum I', minPoints: 900, nextThreshold: 1100 },
  { index: 8, tier: 'Platinum', division: 'II', label: 'Platinum II', minPoints: 1100, nextThreshold: 1300 },
  { index: 9, tier: 'Platinum', division: 'III', label: 'Platinum III', minPoints: 1300, nextThreshold: 1500 },
  { index: 10, tier: 'Platinum', division: 'IV', label: 'Platinum IV', minPoints: 1500, nextThreshold: 1700 },
  { index: 11, tier: 'Platinum', division: 'V', label: 'Platinum V', minPoints: 1700, nextThreshold: 1900 },
  // Diamond I - V (1900..3149)
  { index: 12, tier: 'Diamond', division: 'I', label: 'Diamond I', minPoints: 1900, nextThreshold: 2150 },
  { index: 13, tier: 'Diamond', division: 'II', label: 'Diamond II', minPoints: 2150, nextThreshold: 2400 },
  { index: 14, tier: 'Diamond', division: 'III', label: 'Diamond III', minPoints: 2400, nextThreshold: 2650 },
  { index: 15, tier: 'Diamond', division: 'IV', label: 'Diamond IV', minPoints: 2650, nextThreshold: 2900 },
  { index: 16, tier: 'Diamond', division: 'V', label: 'Diamond V', minPoints: 2900, nextThreshold: 3150 },
  // Master I - X (3150..6199)
  { index: 17, tier: 'Master', division: 'I', label: 'Master I', minPoints: 3150, nextThreshold: 3450 },
  { index: 18, tier: 'Master', division: 'II', label: 'Master II', minPoints: 3450, nextThreshold: 3750 },
  { index: 19, tier: 'Master', division: 'III', label: 'Master III', minPoints: 3750, nextThreshold: 4050 },
  { index: 20, tier: 'Master', division: 'IV', label: 'Master IV', minPoints: 4050, nextThreshold: 4350 },
  { index: 21, tier: 'Master', division: 'V', label: 'Master V', minPoints: 4350, nextThreshold: 4650 },
  { index: 22, tier: 'Master', division: 'VI', label: 'Master VI', minPoints: 4650, nextThreshold: 4950 },
  { index: 23, tier: 'Master', division: 'VII', label: 'Master VII', minPoints: 4950, nextThreshold: 5250 },
  { index: 24, tier: 'Master', division: 'VIII', label: 'Master VIII', minPoints: 5250, nextThreshold: 5550 },
  { index: 25, tier: 'Master', division: 'IX', label: 'Master IX', minPoints: 5550, nextThreshold: 5850 },
  { index: 26, tier: 'Master', division: 'X', label: 'Master X', minPoints: 5850, nextThreshold: 6200 },
  // Grandmaster MAX (6200+)
  { index: 27, tier: 'Grandmaster', division: 'MAX', label: 'Grandmaster MAX', minPoints: 6200, nextThreshold: null },
] as const;

export const TIER_ORDER: readonly RankTier[] = [
  'Silver',
  'Gold',
  'Platinum',
  'Diamond',
  'Master',
  'Grandmaster',
] as const;

export interface RankTierGroup {
  tier: RankTier;
  steps: RankStep[];
  minPoints: number;
  maxPoints: number | null;
}

export const RANK_TIER_GROUPS: readonly RankTierGroup[] = TIER_ORDER.map((tier) => {
  const steps = RANK_STEPS.filter((s) => s.tier === tier);
  const first = steps[0];
  const last = steps[steps.length - 1];
  return {
    tier,
    steps,
    minPoints: first.minPoints,
    maxPoints: last.nextThreshold !== null ? last.nextThreshold - 1 : null,
  };
});

export function sanitizeRankPoints(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(999999, Math.floor(raw)));
}

export function getRankFromPoints(rawPoints: number): RankInfo {
  const points = sanitizeRankPoints(rawPoints);
  let matched = RANK_STEPS[0];
  for (const step of RANK_STEPS) {
    if (points >= step.minPoints) {
      matched = step;
    } else {
      break;
    }
  }

  const pointsInDivision = points - matched.minPoints;
  if (matched.nextThreshold === null) {
    return {
      ...matched,
      points,
      pointsInDivision,
      pointsToNext: 0,
      progressPct: 100,
      isMaxRank: true,
    };
  }

  const span = Math.max(1, matched.nextThreshold - matched.minPoints);
  const pointsToNext = Math.max(0, matched.nextThreshold - points);
  const progressPct = Math.max(0, Math.min(100, Math.round((pointsInDivision / span) * 100)));

  return {
    ...matched,
    points,
    pointsInDivision,
    pointsToNext,
    progressPct,
    isMaxRank: false,
  };
}

export function getTierIndex(tier: RankTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Ranked matchmaking searches within the player's own tier initially,
 * then widens cleanly to adjacent tiers as wait time increases.
 */
export function areRanksMatchmakingCompatible(
  pointsA: number,
  pointsB: number,
  waitSeconds: number,
): boolean {
  const tierA = getTierIndex(getRankFromPoints(pointsA).tier);
  const tierB = getTierIndex(getRankFromPoints(pointsB).tier);
  const tierDiff = Math.abs(tierA - tierB);
  if (waitSeconds < 2.5) {
    return tierDiff === 0;
  }
  return tierDiff <= 1;
}

export function getBotConfigForRank(playerRankPoints: number): RankedBotProfile {
  const rank = getRankFromPoints(playerRankPoints);
  switch (rank.tier) {
    case 'Silver':
      return {
        uid: `ranked_bot_silver_${rank.division.toLowerCase()}`,
        username: `Zenn Bot · ${rank.label}`,
        avatar: 'avatar_ace',
        frame: 'frame_silver_crest',
        level: 8 + rank.index * 2,
        rating: 1050 + rank.index * 40,
        rankPoints: rank.minPoints + 35,
        equippedCue: 'cue_wooden',
        equippedTable: 'table_tournament_blue',
        equippedEffect: 'effect_classic',
        aiDifficulty: rank.division === 'III' ? 'semipro' : 'club',
        tierLabel: 'Silver',
      };
    case 'Gold':
      return {
        uid: `ranked_bot_gold_${rank.division.toLowerCase()}`,
        username: `Zenn Bot · ${rank.label}`,
        avatar: 'avatar_royale',
        frame: 'frame_royal_gold',
        level: 14 + (rank.index - 3) * 2,
        rating: 1280 + (rank.index - 3) * 50,
        rankPoints: rank.minPoints + 55,
        equippedCue: 'cue_premium',
        equippedTable: 'table_tournament_blue',
        equippedEffect: 'effect_gold_spark',
        aiDifficulty: 'semipro',
        tierLabel: 'Gold',
      };
    case 'Platinum':
      return {
        uid: `ranked_bot_platinum_${rank.division.toLowerCase()}`,
        username: `Zenn Bot · ${rank.label}`,
        avatar: 'avatar_shark',
        frame: 'frame_platinum_prism',
        level: 22 + (rank.index - 7) * 2,
        rating: 1520 + (rank.index - 7) * 55,
        rankPoints: rank.minPoints + 75,
        equippedCue: 'cue_gold',
        equippedTable: 'table_sky_azure',
        equippedEffect: 'effect_sky_trail',
        aiDifficulty: 'pro',
        tierLabel: 'Platinum',
      };
    case 'Diamond':
      return {
        uid: `ranked_bot_diamond_${rank.division.toLowerCase()}`,
        username: `Zenn Bot · ${rank.label}`,
        avatar: 'avatar_master',
        frame: 'frame_diamond_halo',
        level: 32 + (rank.index - 12) * 2,
        rating: 1840 + (rank.index - 12) * 60,
        rankPoints: rank.minPoints + 95,
        equippedCue: 'cue_carbon',
        equippedTable: 'table_obsidian_gold',
        equippedEffect: 'effect_sky_trail',
        aiDifficulty: 'pro',
        tierLabel: 'Diamond',
      };
    case 'Master':
      return {
        uid: `ranked_bot_master_${rank.division.toLowerCase()}`,
        username: `Zenn Bot · ${rank.label}`,
        avatar: 'avatar_master',
        frame: 'frame_master_sovereign',
        level: 44 + (rank.index - 17) * 2,
        rating: 2180 + (rank.index - 17) * 55,
        rankPoints: rank.minPoints + 120,
        equippedCue: 'cue_legendary',
        equippedTable: 'table_imperial_violet',
        equippedEffect: 'effect_gold_spark',
        aiDifficulty: 'pro',
        tierLabel: 'Master',
      };
    case 'Grandmaster':
    default:
      return {
        uid: 'ranked_bot_grandmaster_max',
        username: 'Zenn Bot · Grandmaster MAX',
        avatar: 'avatar_master',
        frame: 'frame_master_sovereign',
        level: 75,
        rating: 2800,
        rankPoints: rank.minPoints,
        equippedCue: 'cue_legendary',
        equippedTable: 'table_imperial_violet',
        equippedEffect: 'effect_gold_spark',
        aiDifficulty: 'pro',
        tierLabel: 'Grandmaster',
      };
  }
}

/**
 * Authoritative Ranked RP calculation for human vs human matches.
 * Practice modes NEVER call this and produce 0 RP change.
 */
export function computeHumanRankedDelta(
  playerRankPoints: number,
  opponentRankPoints: number,
  won: boolean,
): number {
  const playerRank = getRankFromPoints(playerRankPoints);
  const oppRank = getRankFromPoints(opponentRankPoints);
  const tierDiff = getTierIndex(oppRank.tier) - getTierIndex(playerRank.tier);

  if (won) {
    const bonus = Math.max(-6, Math.min(12, tierDiff * 4));
    return Math.max(18, 26 + bonus);
  }

  const baseLoss =
    playerRank.tier === 'Silver'
      ? 12
      : playerRank.tier === 'Gold'
        ? 16
        : playerRank.tier === 'Platinum'
          ? 20
          : playerRank.tier === 'Diamond'
            ? 23
            : playerRank.tier === 'Master'
              ? 26
              : 28;
  const penaltyAdjust = Math.max(-5, Math.min(6, -tierDiff * 2));
  const actualDelta = -(baseLoss + penaltyAdjust);
  const nextPoints = Math.max(0, playerRank.points + actualDelta);
  return nextPoints - playerRank.points;
}

/**
 * Authoritative Ranked RP calculation for server-validated Ranked vs Bot matches.
 * Higher tiers receive modest bot win rewards so players cannot farm top ranks off bots.
 */
export function computeBotRankedDelta(playerRankPoints: number, won: boolean): number {
  const playerRank = getRankFromPoints(playerRankPoints);
  if (won) {
    switch (playerRank.tier) {
      case 'Silver':
        return 16;
      case 'Gold':
        return 13;
      case 'Platinum':
        return 10;
      case 'Diamond':
        return 7;
      case 'Master':
        return 4;
      case 'Grandmaster':
        return 2;
    }
  }

  const lossAmount =
    playerRank.tier === 'Silver'
      ? 10
      : playerRank.tier === 'Gold'
        ? 14
        : playerRank.tier === 'Platinum'
          ? 18
          : playerRank.tier === 'Diamond'
            ? 22
            : playerRank.tier === 'Master'
              ? 25
              : 28;
  const nextPoints = Math.max(0, playerRank.points - lossAmount);
  return nextPoints - playerRank.points;
}

export function createEmptyBreakdown(): PlayerStatsBreakdown {
  return { matches: 0, wins: 0, losses: 0 };
}

export function createEmptyPlayerStats(): PlayerStatsSummary {
  return {
    eightBall: createEmptyBreakdown(),
    nineBall: createEmptyBreakdown(),
    ranked: createEmptyBreakdown(),
    vsPlayers: createEmptyBreakdown(),
    vsBots: createEmptyBreakdown(),
  };
}

export function normalizePlayerStats(raw?: Partial<PlayerStatsSummary> | null): PlayerStatsSummary {
  const cleanBucket = (b?: Partial<PlayerStatsBreakdown>): PlayerStatsBreakdown => {
    const wins = typeof b?.wins === 'number' && Number.isFinite(b.wins) ? Math.max(0, Math.floor(b.wins)) : 0;
    const losses =
      typeof b?.losses === 'number' && Number.isFinite(b.losses) ? Math.max(0, Math.floor(b.losses)) : 0;
    const matches =
      typeof b?.matches === 'number' && Number.isFinite(b.matches)
        ? Math.max(wins + losses, Math.floor(b.matches))
        : wins + losses;
    return { matches, wins, losses };
  };
  return {
    eightBall: cleanBucket(raw?.eightBall),
    nineBall: cleanBucket(raw?.nineBall),
    ranked: cleanBucket(raw?.ranked),
    vsPlayers: cleanBucket(raw?.vsPlayers),
    vsBots: cleanBucket(raw?.vsBots),
  };
}

export function applyCompletedMatchToStats(
  current: PlayerStatsSummary | undefined,
  opts: {
    variant: GameVariant;
    isRanked: boolean;
    isBotOpponent: boolean;
    won: boolean;
  },
): PlayerStatsSummary {
  const next = normalizePlayerStats(current);
  const bump = (bucket: PlayerStatsBreakdown) => {
    bucket.matches += 1;
    if (opts.won) bucket.wins += 1;
    else bucket.losses += 1;
  };

  if (opts.variant === '9ball') bump(next.nineBall);
  else bump(next.eightBall);

  if (opts.isRanked) bump(next.ranked);

  if (opts.isBotOpponent) bump(next.vsBots);
  else bump(next.vsPlayers);

  return next;
}
