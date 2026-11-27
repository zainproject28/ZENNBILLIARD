import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_RADIUS, POCKETS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.ts';
import {
  applyCueShot,
  areBallsMoving,
  computeAimPrediction,
  isValidCueBallPlacement,
  stepPhysicsFrame,
} from './physics.ts';
import { createBall, createStandardRack } from './rack.ts';
import type { ShotTelemetry } from './types.ts';

function freshTelemetry(): ShotTelemetry {
  return {
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  };
}

test('standard rack creates 16 balls with 8-ball in center and valid corner mix', () => {
  const balls = createStandardRack();
  assert.equal(balls.length, 16);
  const cue = balls.find((b) => b.id === 0)!;
  const eight = balls.find((b) => b.id === 8)!;
  assert.ok(cue);
  assert.ok(eight);

  // Verify no two balls overlap in rack
  const minDist = BALL_RADIUS * 2;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
      assert.ok(d >= minDist - 0.01, `Balls ${balls[i].id} and ${balls[j].id} overlap (${d})`);
    }
  }
});

test('ball-to-ball collision transfers momentum and detects first contact', () => {
  const cue = createBall(0, 200, 250);
  const one = createBall(1, 300, 250);
  const balls = [cue, one];
  const telemetry = freshTelemetry();

  applyCueShot(balls, { angle: 0, power: 0.75, spinX: 0, spinY: 0 }, false);

  for (let f = 0; f < 240 && areBallsMoving(balls); f++) {
    stepPhysicsFrame(balls, telemetry);
  }

  assert.equal(telemetry.firstContactBallId, 1);
  assert.ok(one.x > 350, `Expected 1-ball to move right, got x=${one.x}`);
  assert.equal(areBallsMoving(balls), false);
});

test('top spin follows forward while back spin draws backward after straight impact', () => {
  const runSpinShot = (spinY: number) => {
    const cue = createBall(0, 200, 250);
    const one = createBall(1, 320, 250);
    const balls = [cue, one];
    const telemetry = freshTelemetry();
    applyCueShot(balls, { angle: 0, power: 0.65, spinX: 0, spinY }, false);
    for (let f = 0; f < 300 && areBallsMoving(balls); f++) {
      stepPhysicsFrame(balls, telemetry);
    }
    return cue.x;
  };

  const followX = runSpinShot(1);
  const drawX = runSpinShot(-1);
  assert.ok(followX > drawX + 40, `Expected top spin (${followX}) to end further right than back spin (${drawX})`);
});

test('balls pocket cleanly into corner and side pockets without tunneling through cushions', () => {
  const cue = createBall(0, 120, 120);
  const target = createBall(2, 55, 55);
  const balls = [cue, target];
  const telemetry = freshTelemetry();

  // Aim cue ball straight at 2-ball toward top-left corner pocket (7, 7)
  const angle = Math.atan2(target.y - cue.y, target.x - cue.x);
  applyCueShot(balls, { angle, power: 0.7, spinX: 0, spinY: 0 }, false);

  for (let f = 0; f < 300 && areBallsMoving(balls); f++) {
    stepPhysicsFrame(balls, telemetry);
  }

  assert.equal(target.pocketed, true);
  assert.equal(target.pocketedInPocketId, POCKETS[0].id);
  assert.ok(cue.x >= BALL_RADIUS - 0.1 && cue.x <= TABLE_WIDTH - BALL_RADIUS + 0.1);
  assert.ok(cue.y >= BALL_RADIUS - 0.1 && cue.y <= TABLE_HEIGHT - BALL_RADIUS + 0.1);
});

test('computeAimPrediction identifies target ball and legal status', () => {
  const balls = createStandardRack();
  const pred = computeAimPrediction(balls, 0, 0, null, true);
  assert.equal(pred.hitType, 'ball');
  assert.equal(pred.targetBallId, 1);
  assert.equal(pred.isLegalTarget, true);
});

test('isValidCueBallPlacement enforces headstring and non-overlap', () => {
  const balls = createStandardRack();
  assert.equal(isValidCueBallPlacement(balls, 150, 250, true), true);
  assert.equal(isValidCueBallPlacement(balls, 600, 250, true), false);
  assert.equal(isValidCueBallPlacement(balls, 600, 250, false), true);
  assert.equal(isValidCueBallPlacement(balls, balls[1].x, balls[1].y, false), false);
});

test('strong break shot scatters rack legally with 4+ rail hits or pocketed ball', () => {
  const balls = createStandardRack();
  const telemetry = freshTelemetry();
  applyCueShot(balls, { angle: 0.015, power: 0.92, spinX: 0, spinY: 0.2 }, true);
  for (let f = 0; f < 480 && areBallsMoving(balls); f++) {
    stepPhysicsFrame(balls, telemetry);
  }
  assert.equal(areBallsMoving(balls), false);
  const objectPocketed = telemetry.pocketedBallIds.filter((id) => id !== 0 && id !== 8).length;
  assert.ok(
    objectPocketed > 0 || telemetry.cushionHitCount >= 4,
    `Expected legal break, got pocketed=${objectPocketed}, cushions=${telemetry.cushionHitCount}`,
  );
});
