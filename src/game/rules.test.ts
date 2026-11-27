import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEloDelta, applyXpProgress } from './elo.ts';
import { createBall, createInitialRulesState, createNineBallRack, createStandardRack } from './rack.ts';
import { evaluateShotOutcome } from './rules.ts';
import type { ShotTelemetry } from './types.ts';

function telemetry(overrides: Partial<ShotTelemetry> = {}): ShotTelemetry {
  return {
    firstContactBallId: 1,
    pocketedBallIds: [],
    railContactAfterFirstHit: true,
    cushionHitCount: 4,
    ...overrides,
  };
}

test('break shot pocketing a solid keeps table open and retains turn', () => {
  const balls = createStandardRack();
  balls.find((b) => b.id === 1)!.pocketed = true;
  const rules = createInitialRulesState('A');

  const next = evaluateShotOutcome(rules, telemetry({ pocketedBallIds: [1] }), balls);
  assert.equal(next.phase, 'open');
  assert.equal(next.currentTurn, 'A');
  assert.equal(next.groupA, null);
  assert.equal(next.isBreakShot, false);
});

test('break shot scratch grants opponent ball-in-hand behind headstring', () => {
  const balls = createStandardRack();
  balls.find((b) => b.id === 0)!.pocketed = true;
  const rules = createInitialRulesState('A');

  const next = evaluateShotOutcome(rules, telemetry({ pocketedBallIds: [0] }), balls);
  assert.equal(next.currentTurn, 'B');
  assert.equal(next.ballInHand, true);
  assert.equal(next.headstringOnly, true);
  assert.ok(next.foulReason);
});

test('open table shot pocketing only stripe assigns stripes to shooter and solids to opponent', () => {
  const balls = createStandardRack();
  balls.find((b) => b.id === 9)!.pocketed = true;
  const rules = {
    ...createInitialRulesState('A'),
    phase: 'open' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 9, pocketedBallIds: [9] }), balls);
  assert.equal(next.groupA, 'stripe');
  assert.equal(next.groupB, 'solid');
  assert.equal(next.phase, 'assigned');
  assert.equal(next.currentTurn, 'A');
});

test('hitting opponent ball first triggers foul and ball-in-hand', () => {
  const balls = createStandardRack();
  const rules = {
    ...createInitialRulesState('A'),
    phase: 'assigned' as const,
    groupA: 'solid' as const,
    groupB: 'stripe' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 11, pocketedBallIds: [] }), balls);
  assert.equal(next.currentTurn, 'B');
  assert.equal(next.ballInHand, true);
  assert.ok(next.foulReason?.includes('solid'));
});

test('pocketing 8-ball early loses the match immediately', () => {
  const balls = createStandardRack();
  balls.find((b) => b.id === 8)!.pocketed = true;
  const rules = {
    ...createInitialRulesState('A'),
    phase: 'assigned' as const,
    groupA: 'solid' as const,
    groupB: 'stripe' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 1, pocketedBallIds: [8] }), balls);
  assert.equal(next.phase, 'gameover');
  assert.equal(next.winner, 'B');
});

test('pocketing 8-ball legally after clearing solids wins the match', () => {
  const cue = createBall(0, 200, 200);
  const eight = createBall(8, 700, 250);
  eight.pocketed = true;
  const nine = createBall(9, 400, 300);
  const balls = [cue, eight, nine];

  const rules = {
    ...createInitialRulesState('A'),
    phase: 'eight_ball' as const,
    groupA: 'solid' as const,
    groupB: 'stripe' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 8, pocketedBallIds: [8] }), balls);
  assert.equal(next.phase, 'gameover');
  assert.equal(next.winner, 'A');
});

test('Elo and XP progression compute valid deltas and level ups', () => {
  const deltaWin = calculateEloDelta(1000, 1000, true);
  const deltaLoss = calculateEloDelta(1000, 1000, false);
  assert.equal(deltaWin, 16);
  assert.equal(deltaLoss, -16);

  const prog = applyXpProgress(1, 50, 120);
  assert.equal(prog.level, 2);
  assert.equal(prog.xp, 70);
});

test('9-ball rack has 10 balls with 1 at apex and 9 in center', () => {
  const balls = createNineBallRack();
  assert.equal(balls.length, 10);
  const one = balls.find((b) => b.id === 1)!;
  const nine = balls.find((b) => b.id === 9)!;
  assert.ok(one.x < nine.x);
  assert.equal(one.y, nine.y);
});

test('9-ball foul on hitting wrong lowest ball respots pocketed 9-ball and grants ball-in-hand', () => {
  const balls = createNineBallRack();
  const nine = balls.find((b) => b.id === 9)!;
  nine.pocketed = true;
  const rules = {
    ...createInitialRulesState('A', '9ball'),
    phase: 'nine_ball' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
    targetBallNumber: 1,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 3, pocketedBallIds: [9] }), balls);
  assert.equal(next.currentTurn, 'B');
  assert.equal(next.ballInHand, true);
  assert.equal(nine.pocketed, false);
  assert.ok(next.foulReason?.includes('ball 1'));
});

test('9-ball legal combo pocketing 9-ball after hitting lowest ball wins immediately', () => {
  const balls = createNineBallRack();
  balls.find((b) => b.id === 9)!.pocketed = true;
  const rules = {
    ...createInitialRulesState('A', '9ball'),
    phase: 'nine_ball' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
    targetBallNumber: 1,
  };

  const next = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 1, pocketedBallIds: [9] }), balls);
  assert.equal(next.phase, 'gameover');
  assert.equal(next.winner, 'A');
});

test('2v2 alternating doubles rotates seats 0 -> 1 -> 2 -> 3 -> 0 across turns', () => {
  const balls = createStandardRack();
  let rules = createInitialRulesState('A', '8ball', '2v2');
  rules.isBreakShot = false;
  rules.ballInHand = false;
  rules.headstringOnly = false;
  rules.phase = 'open';
  assert.equal(rules.activeSeatIndex, 0);
  assert.equal(rules.currentTurn, 'A');

  // Seat 0 (A1) misses -> passes to Seat 1 (B1)
  rules = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 1, pocketedBallIds: [] }), balls);
  assert.equal(rules.activeSeatIndex, 1);
  assert.equal(rules.currentTurn, 'B');

  // Seat 1 (B1) pockets a solid -> keeps turn at Seat 1 (B1)
  balls.find((b) => b.id === 1)!.pocketed = true;
  rules = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 1, pocketedBallIds: [1] }), balls);
  assert.equal(rules.activeSeatIndex, 1);
  assert.equal(rules.currentTurn, 'B');

  // Seat 1 (B1) misses -> passes to Seat 2 (A2)
  rules = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 9, pocketedBallIds: [] }), balls);
  assert.equal(rules.activeSeatIndex, 2);
  assert.equal(rules.currentTurn, 'A');

  // Seat 2 (A2) misses -> passes to Seat 3 (B2)
  rules = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 2, pocketedBallIds: [] }), balls);
  assert.equal(rules.activeSeatIndex, 3);
  assert.equal(rules.currentTurn, 'B');

  // Seat 3 (B2) misses -> wraps back to Seat 0 (A1)
  rules = evaluateShotOutcome(rules, telemetry({ firstContactBallId: 10, pocketedBallIds: [] }), balls);
  assert.equal(rules.activeSeatIndex, 0);
  assert.equal(rules.currentTurn, 'A');
});

test('evaluateTurnTimeout passes turn cleanly in 1v1 and rotates seats in 2v2', async () => {
  const { evaluateTurnTimeout } = await import('./rules.ts');
  const base1v1 = {
    ...createInitialRulesState('A', '8ball', '1v1'),
    ballInHand: true,
    headstringOnly: true,
  };
  const next1v1 = evaluateTurnTimeout(base1v1);
  assert.equal(next1v1.currentTurn, 'B');
  assert.equal(next1v1.activeSeatIndex, 1);
  assert.equal(next1v1.ballInHand, false);
  assert.equal(next1v1.headstringOnly, false);
  assert.equal(next1v1.isBreakShot, true);
  assert.equal(next1v1.turnNumber, base1v1.turnNumber + 1);

  const base2v2 = {
    ...createInitialRulesState('A', '8ball', '2v2'),
    isBreakShot: false,
    phase: 'open' as const,
  };
  const s1 = evaluateTurnTimeout(base2v2);
  assert.equal(s1.activeSeatIndex, 1);
  assert.equal(s1.currentTurn, 'B');
  const s2 = evaluateTurnTimeout(s1);
  assert.equal(s2.activeSeatIndex, 2);
  assert.equal(s2.currentTurn, 'A');
  const s3 = evaluateTurnTimeout(s2);
  assert.equal(s3.activeSeatIndex, 3);
  assert.equal(s3.currentTurn, 'B');
  const s4 = evaluateTurnTimeout(s3);
  assert.equal(s4.activeSeatIndex, 0);
  assert.equal(s4.currentTurn, 'A');

  const over = { ...s4, phase: 'gameover' as const, winner: 'A' as const };
  assert.deepEqual(evaluateTurnTimeout(over), over);
});


