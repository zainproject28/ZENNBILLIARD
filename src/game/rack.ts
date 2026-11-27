import { BALL_RADIUS, FOOT_SPOT_X, FOOT_SPOT_Y, HEADSTRING_X, TABLE_HEIGHT } from './constants.ts';
import type { BallGroup, BallState, GameVariant, MatchFormat, MatchRulesState, PlayerSlot } from './types.ts';

export function getBallGroup(num: number): BallGroup {
  if (num === 0) return 'cue';
  if (num === 8) return 'eight';
  if (num >= 1 && num <= 7) return 'solid';
  return 'stripe';
}

export function createBall(number: number, x: number, y: number): BallState {
  return {
    id: number,
    number,
    group: getBallGroup(number),
    x,
    y,
    vx: 0,
    vy: 0,
    spinX: 0,
    spinY: 0,
    angularZ: 0,
    pocketed: false,
    pocketAnimProgress: 0,
    pocketedInPocketId: null,
    rollPhase: 0,
    rollDirX: 1,
    rollDirY: 0,
  };
}

/**
 * Standard 5-row American 8-Ball triangle rack:
 * - Row 1 (1 ball): apex on foot spot
 * - Row 2 (2 balls)
 * - Row 3 (3 balls): 8-ball in exact center
 * - Row 4 (4 balls)
 * - Row 5 (5 balls): one solid & one stripe on back corners
 */
export function createStandardRack(): BallState[] {
  const balls: BallState[] = [];
  balls.push(createBall(0, HEADSTRING_X - 40, TABLE_HEIGHT / 2));

  // Standard WPA 15-ball order across rows (row 1..5):
  // Row 3 middle (index 4) MUST be 8.
  // Back corners (indices 10 and 14) MUST be one solid and one stripe.
  const rackOrder = [
    1,             // Row 1 (1)
    9, 2,          // Row 2 (2)
    10, 8, 3,      // Row 3 (3) -> 8 in center
    4, 11, 5, 12,  // Row 4 (4)
    6, 13, 7, 14, 15, // Row 5 (5) -> corner 6 (solid) & corner 15 (stripe)
  ];

  const diameter = BALL_RADIUS * 2 + 0.08;
  const dx = diameter * Math.sqrt(3) / 2;
  const dy = diameter;

  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const ballsInRow = row + 1;
    const x = FOOT_SPOT_X + row * dx;
    const startY = FOOT_SPOT_Y - ((ballsInRow - 1) * dy) / 2;
    for (let col = 0; col < ballsInRow; col++) {
      const y = startY + col * dy;
      const num = rackOrder[idx++];
      balls.push(createBall(num, x, y));
    }
  }

  return balls;
}

/**
 * Official WPA 9-Ball diamond rack (1-2-3-2-1):
 * - 1-ball on apex (foot spot)
 * - 9-ball in dead center (row 3 middle)
 * - Balls 2..8 surrounding
 */
export function createNineBallRack(): BallState[] {
  const balls: BallState[] = [];
  balls.push(createBall(0, HEADSTRING_X - 40, TABLE_HEIGHT / 2));

  const rows: number[][] = [
    [1],          // Row 0: apex
    [2, 3],       // Row 1: 2 balls
    [4, 9, 5],    // Row 2: 3 balls (9 in center)
    [6, 7],       // Row 3: 2 balls
    [8],          // Row 4: back apex
  ];

  const diameter = BALL_RADIUS * 2 + 0.08;
  const dx = (diameter * Math.sqrt(3)) / 2;
  const dy = diameter;

  for (let row = 0; row < rows.length; row++) {
    const nums = rows[row];
    const x = FOOT_SPOT_X + row * dx;
    const startY = FOOT_SPOT_Y - ((nums.length - 1) * dy) / 2;
    for (let col = 0; col < nums.length; col++) {
      balls.push(createBall(nums[col], x, startY + col * dy));
    }
  }

  return balls;
}

export function createRackForVariant(variant: GameVariant = '8ball'): BallState[] {
  return variant === '9ball' ? createNineBallRack() : createStandardRack();
}

export function getLowestObjectBallNumber(balls: BallState[]): number | null {
  let minNum: number | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    if (minNum === null || b.number < minNum) {
      minNum = b.number;
    }
  }
  return minNum;
}

export function createInitialRulesState(
  startingPlayer: PlayerSlot = 'A',
  gameVariant: GameVariant = '8ball',
  matchFormat: MatchFormat = '1v1',
): MatchRulesState {
  const startSeat = startingPlayer === 'A' ? 0 : 1;
  return {
    gameVariant,
    matchFormat,
    activeSeatIndex: startSeat,
    phase: 'break',
    currentTurn: startingPlayer,
    groupA: null,
    groupB: null,
    targetBallNumber: gameVariant === '9ball' ? 1 : null,
    ballInHand: true,
    headstringOnly: true,
    isBreakShot: true,
    foulReason: null,
    lastEventMessage: gameVariant === '9ball' ? '9 Ball Break Shot' : 'Break Shot',
    winner: null,
    winReason: null,
    shotCountA: 0,
    shotCountB: 0,
    pottedCountA: 0,
    pottedCountB: 0,
    turnNumber: 1,
  };
}

