export function calculateEloDelta(
  playerRating: number,
  opponentRating: number,
  won: boolean,
  kFactor: number = 32,
): number {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const actual = won ? 1 : 0;
  return Math.round(kFactor * (actual - expected));
}

export function xpRequiredForLevel(level: number): number {
  return 100 + (level - 1) * 75;
}

export function applyXpProgress(
  currentLevel: number,
  currentXp: number,
  earnedXp: number,
): { level: number; xp: number } {
  let level = currentLevel;
  let xp = currentXp + earnedXp;
  while (xp >= xpRequiredForLevel(level) && level < 500) {
    xp -= xpRequiredForLevel(level);
    level += 1;
  }
  return { level, xp };
}

export function computeMatchRewards(
  won: boolean,
  entryFee: number,
  shots: number,
): { coinsEarned: number; xpEarned: number } {
  if (won) {
    const potBonus = entryFee > 0 ? entryFee * 2 : 150;
    const skillBonus = Math.min(75, shots * 5);
    return {
      coinsEarned: potBonus,
      xpEarned: 80 + skillBonus,
    };
  }
  return {
    coinsEarned: entryFee > 0 ? 0 : 25,
    xpEarned: 30 + Math.min(30, shots * 3),
  };
}
