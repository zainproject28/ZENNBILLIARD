import { applyXpProgress, calculateEloDelta, computeMatchRewards } from './elo.ts';
import { applyCompletedMatchToStats } from './rank.ts';
import type { GameVariant, OnlineParticipantMeta, UserProfile } from './types.ts';

export interface ProAiChallengerProfile extends OnlineParticipantMeta {
  title: string;
}

export const PRO_AI_CHALLENGERS: readonly ProAiChallengerProfile[] = [
  {
    uid: 'ai_qm_reyes',
    username: 'Maestro_Efren',
    title: 'Grandmaster Tactician',
    avatar: 'avatar_master',
    frame: 'frame_royal_gold',
    level: 48,
    rating: 2340,
    equippedCue: 'cue_legendary',
    equippedTable: 'table_tournament_blue',
    equippedEffect: 'effect_gold_spark',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_kestrel',
    username: 'Kestrel_Pro',
    title: 'Precision Cut Specialist',
    avatar: 'avatar_ace',
    frame: 'frame_royal_gold',
    level: 44,
    rating: 2210,
    equippedCue: 'cue_legendary',
    equippedTable: 'table_sky_azure',
    equippedEffect: 'effect_sky_trail',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_valkyrie',
    username: 'Valkyrie_9Ball',
    title: 'Tour Speed Breaker',
    avatar: 'avatar_royale',
    frame: 'frame_obsidian',
    level: 42,
    rating: 2180,
    equippedCue: 'cue_carbon',
    equippedTable: 'table_ruby_arena',
    equippedEffect: 'effect_sky_trail',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_viper',
    username: 'Viper_BankShot',
    title: 'Rail Geometry Ace',
    avatar: 'avatar_shark',
    frame: 'frame_royal_gold',
    level: 39,
    rating: 2120,
    equippedCue: 'cue_gold',
    equippedTable: 'table_obsidian_gold',
    equippedEffect: 'effect_gold_spark',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_sora',
    username: 'Sora_Cueist',
    title: 'Spin Control Master',
    avatar: 'avatar_royale',
    frame: 'frame_royal_gold',
    level: 37,
    rating: 2060,
    equippedCue: 'cue_carbon',
    equippedTable: 'table_imperial_violet',
    equippedEffect: 'effect_sky_trail',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_titan',
    username: 'Titan_Rack',
    title: '8 Ball Runout Vet',
    avatar: 'avatar_master',
    frame: 'frame_obsidian',
    level: 36,
    rating: 2010,
    equippedCue: 'cue_gold',
    equippedTable: 'table_crimson_velvet',
    equippedEffect: 'effect_gold_spark',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_nusa',
    username: 'Nusa_Shark',
    title: 'Championship Challenger',
    avatar: 'avatar_shark',
    frame: 'frame_bronze',
    level: 34,
    rating: 1965,
    equippedCue: 'cue_carbon',
    equippedTable: 'table_sky_azure',
    equippedEffect: 'effect_sky_trail',
    connected: true,
    isBot: true,
  },
  {
    uid: 'ai_qm_zenith',
    username: 'Zenith_Break',
    title: 'Sharp Combo Strategist',
    avatar: 'avatar_ace',
    frame: 'frame_royal_gold',
    level: 32,
    rating: 1920,
    equippedCue: 'cue_gold',
    equippedTable: 'table_obsidian_gold',
    equippedEffect: 'effect_gold_spark',
    connected: true,
    isBot: true,
  },
];

export function pickRandomQuickMatchOpponent(rng: () => number = Math.random): OnlineParticipantMeta {
  const idx = Math.max(0, Math.min(PRO_AI_CHALLENGERS.length - 1, Math.floor(rng() * PRO_AI_CHALLENGERS.length)));
  const chosen = PRO_AI_CHALLENGERS[idx];
  return {
    uid: chosen.uid,
    username: chosen.username,
    avatar: chosen.avatar,
    frame: chosen.frame,
    level: chosen.level,
    rating: chosen.rating,
    equippedCue: chosen.equippedCue,
    equippedTable: chosen.equippedTable,
    equippedEffect: chosen.equippedEffect,
    connected: true,
    isBot: true,
  };
}

export function computeQuickMatchClientSettlement(
  profile: UserProfile,
  opponentRating: number,
  won: boolean,
  entryFee: number,
  shots: number,
  gameVariant: GameVariant = '8ball',
): {
  nextProfile: UserProfile;
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
} {
  const safeFee = Math.max(0, Math.min(profile.coins, Math.floor(entryFee)));
  const rew = computeMatchRewards(won, safeFee, shots);
  const delta = calculateEloDelta(profile.rating, opponentRating, won);
  const progress = applyXpProgress(profile.level, profile.xp, rew.xpEarned);

  // Settle cleanly from pre-match coins: deduct entry stake and award match payout.
  // Quick Match vs AI never changes Ranked RP or ranked stats.
  const nextCoins = Math.max(0, profile.coins - safeFee + rew.coinsEarned);
  const nextProfile: UserProfile = {
    ...profile,
    coins: nextCoins,
    level: progress.level,
    xp: progress.xp,
    rating: Math.max(400, profile.rating + delta),
    matches: profile.matches + 1,
    wins: profile.wins + (won ? 1 : 0),
    losses: profile.losses + (won ? 0 : 1),
    stats: applyCompletedMatchToStats(profile.stats, {
      won,
      variant: gameVariant,
      isRanked: false,
      isBotOpponent: true,
    }),
    updatedAt: new Date().toISOString(),
  };

  return {
    nextProfile,
    xpEarned: rew.xpEarned,
    coinsEarned: rew.coinsEarned,
    ratingDelta: delta,
  };
}
