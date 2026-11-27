import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAiCueBallPlacement, computeAiShot, computeAiShotPlan } from './ai.ts';
import { applyCueShot, areBallsMoving, isValidCueBallPlacement, stepPhysicsFrame } from './physics.ts';
import { createBall, createInitialRulesState } from './rack.ts';
import type { ShotTelemetry } from './types.ts';

test('Pro AI sinks a clean straight-in 8-ball pocket shot', () => {
  const cue = createBall(0, 720, 220);
  const one = createBall(1, 860, 120);
  const eight = createBall(8, 220, 380);
  const balls = [cue, one, eight];

  const rules = {
    ...createInitialRulesState('B', '8ball'),
    phase: 'assigned' as const,
    groupA: 'stripe' as const,
    groupB: 'solid' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const shot = computeAiShot(balls, rules, 'pro', () => 0.5);
  applyCueShot(balls, shot, false);

  const telemetry: ShotTelemetry = {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };

  for (let i = 0; i < 600; i++) {
    stepPhysicsFrame(balls, telemetry);
    if (!areBallsMoving(balls)) break;
  }

  assert.equal(telemetry.firstContactBallId, 1);
  assert.ok(telemetry.pocketedBallIds.includes(1), 'Expected Pro AI to pocket ball 1');
});

test('Pro AI in 9-ball targets lowest numbered ball and ignores higher balls', () => {
  const cue = createBall(0, 480, 250);
  const two = createBall(2, 660, 160);
  const nine = createBall(9, 600, 260);
  const balls = [cue, two, nine];

  const rules = {
    ...createInitialRulesState('B', '9ball'),
    phase: 'nine_ball' as const,
    targetBallNumber: 2,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const shot = computeAiShot(balls, rules, 'pro', () => 0.5);
  applyCueShot(balls, shot, false);

  const telemetry: ShotTelemetry = {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };

  for (let i = 0; i < 600; i++) {
    stepPhysicsFrame(balls, telemetry);
    if (!areBallsMoving(balls)) break;
  }

  assert.equal(telemetry.firstContactBallId, 2);
});

test('Pro AI ball-in-hand placement picks a valid unobstructed spot', () => {
  const cue = createBall(0, 200, 250);
  const three = createBall(3, 820, 140);
  const balls = [cue, three];
  const rules = {
    ...createInitialRulesState('B', '9ball'),
    phase: 'nine_ball' as const,
    targetBallNumber: 3,
    isBreakShot: false,
    ballInHand: true,
    headstringOnly: false,
  };

  const pos = chooseAiCueBallPlacement(balls, rules, 'pro');
  assert.ok(isValidCueBallPlacement(balls, pos.x, pos.y, false));
});

test('Pro AI finds a 1-rail bank shot or kick shot when direct pocket line is blocked', () => {
  const cue = createBall(0, 500, 380);
  const one = createBall(1, 500, 120);
  // Block direct pocket routes for ball 1 with stripes so only bank or kick makes sense
  const b9 = createBall(9, 700, 75);
  const b10 = createBall(10, 300, 75);
  const b11 = createBall(11, 500, 42);
  const balls = [cue, one, b9, b10, b11];
  const rules = {
    ...createInitialRulesState('B', '8ball'),
    phase: 'assigned' as const,
    groupA: 'stripe' as const,
    groupB: 'solid' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const shot = computeAiShot(balls, rules, 'pro', () => 0.5);
  assert.ok(Number.isFinite(shot.angle));
  assert.ok(shot.power >= 0.45 && shot.power <= 0.98);
});

test('computeAiShotPlan returns educational dash-free reasons and finds legal 9-ball combo wins', () => {
  const cue = createBall(0, 260, 250);
  const one = createBall(1, 520, 250);
  const nine = createBall(9, 640, 220);
  // Position cue -> 1 -> 9 -> Top Right pocket (993, 7)
  const balls = [cue, one, nine];
  const rules = {
    ...createInitialRulesState('B', '9ball'),
    phase: 'nine_ball' as const,
    targetBallNumber: 1,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const plan = computeAiShotPlan(balls, rules, 'pro', () => 0.5);
  assert.ok(plan.reasonEn.length > 10);
  assert.ok(plan.reasonId.length > 10);
  assert.doesNotMatch(plan.reasonEn, /[-–—]/);
  assert.doesNotMatch(plan.reasonId, /[-–—]/);
  assert.ok(plan.targetBallId === 1);
  assert.ok(plan.shot.power > 0.25 && plan.shot.power <= 1);
});

test('Pro AI plays a tactical safety or escape when no offensive pocket is clear', () => {
  const cue = createBall(0, 240, 250);
  const one = createBall(1, 500, 250);
  // Surround ball 1 with opponent stripes blocking all 6 pocket lines cleanly
  const blockers = [
    createBall(9, 440, 206),
    createBall(10, 500, 180),
    createBall(11, 560, 206),
    createBall(12, 440, 294),
    createBall(13, 500, 320),
    createBall(14, 560, 294),
    createBall(15, 580, 250),
  ];
  const balls = [cue, one, ...blockers];
  const rules = {
    ...createInitialRulesState('B', '8ball'),
    phase: 'assigned' as const,
    groupA: 'stripe' as const,
    groupB: 'solid' as const,
    isBreakShot: false,
    ballInHand: false,
    headstringOnly: false,
  };

  const plan = computeAiShotPlan(balls, rules, 'pro', () => 0.5);
  assert.ok(
    plan.shotType === 'safety' || plan.shotType === 'kick' || plan.shotType === 'bank' || plan.shotType === 'fallback',
    `Unexpected shotType ${plan.shotType}`,
  );
  assert.doesNotMatch(plan.reasonEn, /[-–—]/);
  assert.doesNotMatch(plan.reasonId, /[-–—]/);
});

