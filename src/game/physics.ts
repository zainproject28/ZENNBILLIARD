import {
  BALL_RADIUS,
  CORNER_POCKET_GAP,
  getCueStats,
  HEADSTRING_X,
  PHYSICS_PARAMS,
  POCKETS,
  SIDE_POCKET_GAP,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './constants.ts';
import type {
  AimPrediction,
  BallState,
  BallSuit,
  CueStats,
  GameVariant,
  PhysicsEvent,
  ShotInput,
  ShotTelemetry,
} from './types.ts';

export function cloneBalls(balls: BallState[]): BallState[] {
  return balls.map((b) => ({ ...b }));
}

export function areBallsMoving(balls: BallState[]): boolean {
  for (const b of balls) {
    if (b.pocketed) {
      if (b.pocketAnimProgress < 1) return true;
      continue;
    }
    if (Math.hypot(b.vx, b.vy) > PHYSICS_PARAMS.stopThreshold) {
      return true;
    }
  }
  return false;
}

export function isValidCueBallPlacement(
  balls: BallState[],
  x: number,
  y: number,
  headstringOnly: boolean,
): boolean {
  const minX = BALL_RADIUS + 2;
  const maxX = headstringOnly ? HEADSTRING_X : TABLE_WIDTH - BALL_RADIUS - 2;
  const minY = BALL_RADIUS + 2;
  const maxY = TABLE_HEIGHT - BALL_RADIUS - 2;

  if (x < minX || x > maxX || y < minY || y > maxY) {
    return false;
  }

  // Must not overlap any pocket
  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < p.radius) {
      return false;
    }
  }

  // Must not overlap any active object ball
  const minDist = BALL_RADIUS * 2 + 0.5;
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    if (Math.hypot(x - b.x, y - b.y) < minDist) {
      return false;
    }
  }

  return true;
}

export function findSafeCueBallSpot(balls: BallState[], headstringOnly: boolean): { x: number; y: number } {
  const startX = headstringOnly ? HEADSTRING_X - 40 : HEADSTRING_X;
  const startY = TABLE_HEIGHT / 2;
  if (isValidCueBallPlacement(balls, startX, startY, headstringOnly)) {
    return { x: startX, y: startY };
  }
  const maxX = headstringOnly ? HEADSTRING_X : TABLE_WIDTH - BALL_RADIUS - 10;
  for (let r = 10; r <= 400; r += 16) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const cx = Math.max(BALL_RADIUS + 8, Math.min(maxX, startX + Math.cos(a) * r));
      const cy = Math.max(BALL_RADIUS + 8, Math.min(TABLE_HEIGHT - BALL_RADIUS - 8, startY + Math.sin(a) * r));
      if (isValidCueBallPlacement(balls, cx, cy, headstringOnly)) {
        return { x: cx, y: cy };
      }
    }
  }
  return { x: BALL_RADIUS + 20, y: TABLE_HEIGHT / 2 };
}

export function applyCueShot(
  balls: BallState[],
  shot: ShotInput,
  headstringOnly: boolean,
  cueStats?: CueStats,
): boolean {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) return false;

  if (shot.cueBallPos && isValidCueBallPlacement(balls, shot.cueBallPos.x, shot.cueBallPos.y, headstringOnly)) {
    cue.x = shot.cueBallPos.x;
    cue.y = shot.cueBallPos.y;
  }
  cue.pocketed = false;
  cue.pocketAnimProgress = 0;
  cue.pocketedInPocketId = null;

  const stats = cueStats ?? (shot.cueId ? getCueStats(shot.cueId) : undefined);
  // Force spec amplifies break/shot velocity (0.94..1.16x)
  const forceScale = stats ? 0.94 + (stats.force / 100) * 0.22 : 1;
  // Spin spec amplifies English & follow/draw response (0.90..1.25x)
  const spinScale = stats ? 0.88 + (stats.spin / 100) * 0.37 : 1;
  // Control spec minimizes cue-ball squirt on side English for pinpoint accuracy
  const squirtFactor = stats ? 0.012 - (stats.control / 100) * 0.009 : 0.009;

  const clampedPower = Math.max(0.02, Math.min(1, shot.power));
  const speed =
    (PHYSICS_PARAMS.minShotSpeed +
      Math.pow(clampedPower, 1.25) * (PHYSICS_PARAMS.maxShotSpeed - PHYSICS_PARAMS.minShotSpeed)) *
    forceScale;

  const spinX = Math.max(-1, Math.min(1, shot.spinX * spinScale));
  const spinY = Math.max(-1, Math.min(1, shot.spinY * spinScale));

  // Subtle realistic squirt from heavy side english (minimized by cue control)
  const squirtAngle = shot.angle - spinX * squirtFactor * clampedPower;

  cue.vx = Math.cos(squirtAngle) * speed;
  cue.vy = Math.sin(squirtAngle) * speed;
  cue.spinX = spinX;
  cue.spinY = spinY;
  cue.angularZ = spinX * clampedPower * 14;
  return true;
}

function isInPocketMouthX(x: number): boolean {
  return (
    x < CORNER_POCKET_GAP ||
    x > TABLE_WIDTH - CORNER_POCKET_GAP ||
    Math.abs(x - TABLE_WIDTH / 2) < SIDE_POCKET_GAP
  );
}

function isInPocketMouthY(y: number): boolean {
  return y < CORNER_POCKET_GAP || y > TABLE_HEIGHT - CORNER_POCKET_GAP;
}

export function stepPhysicsFrame(
  balls: BallState[],
  telemetry: ShotTelemetry,
  dt: number = PHYSICS_PARAMS.fixedDt,
): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const subDt = dt / PHYSICS_PARAMS.substeps;

  // Rounded pocket jaw posts so balls deflect naturally into or away from pockets
  const jawPosts = [
    // Top-left corner jaws
    { x: CORNER_POCKET_GAP, y: 0 },
    { x: 0, y: CORNER_POCKET_GAP },
    // Top-side pocket jaws
    { x: TABLE_WIDTH / 2 - SIDE_POCKET_GAP, y: 0 },
    { x: TABLE_WIDTH / 2 + SIDE_POCKET_GAP, y: 0 },
    // Top-right corner jaws
    { x: TABLE_WIDTH - CORNER_POCKET_GAP, y: 0 },
    { x: TABLE_WIDTH, y: CORNER_POCKET_GAP },
    // Bottom-left corner jaws
    { x: CORNER_POCKET_GAP, y: TABLE_HEIGHT },
    { x: 0, y: TABLE_HEIGHT - CORNER_POCKET_GAP },
    // Bottom-side pocket jaws
    { x: TABLE_WIDTH / 2 - SIDE_POCKET_GAP, y: TABLE_HEIGHT },
    { x: TABLE_WIDTH / 2 + SIDE_POCKET_GAP, y: TABLE_HEIGHT },
    // Bottom-right corner jaws
    { x: TABLE_WIDTH - CORNER_POCKET_GAP, y: TABLE_HEIGHT },
    { x: TABLE_WIDTH, y: TABLE_HEIGHT - CORNER_POCKET_GAP },
  ];

  for (let step = 0; step < PHYSICS_PARAMS.substeps; step++) {
    // 1. Move balls & apply spin curve
    for (const b of balls) {
      if (b.pocketed) {
        if (b.pocketAnimProgress < 1) {
          b.pocketAnimProgress = Math.min(1, b.pocketAnimProgress + subDt * 4.5);
        }
        continue;
      }

      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 0.001) {
        // Subtle swerve from side english when sliding
        if (b.id === 0 && Math.abs(b.spinX) > 0.05 && speed > 40) {
          const nx = -b.vy / speed;
          const ny = b.vx / speed;
          const swerve = b.spinX * 26 * subDt;
          b.vx += nx * swerve;
          b.vy += ny * swerve;
        }

        b.x += b.vx * subDt;
        b.y += b.vy * subDt;

        // Track visual rolling rotation
        const dist = speed * subDt;
        b.rollPhase += dist / BALL_RADIUS;
        b.rollDirX = b.vx / speed;
        b.rollDirY = b.vy / speed;
      }
    }

    // 2. Pocket detection
    for (const b of balls) {
      if (b.pocketed) continue;
      for (const p of POCKETS) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const dist = Math.hypot(dx, dy);

        // Gentle pocket lip gravity funnel when overlapping pocket mouth
        if (dist < p.radius + 5 && dist > p.radius * 0.85) {
          const pull = 120 * subDt / Math.max(1, dist);
          b.vx += dx * pull;
          b.vy += dy * pull;
        }

        if (dist <= p.radius - 2) {
          b.pocketed = true;
          b.pocketAnimProgress = 0.01;
          b.pocketedInPocketId = p.id;
          b.vx = 0;
          b.vy = 0;
          b.spinX = 0;
          b.spinY = 0;
          telemetry.pocketedBallIds.push(b.id);
          events.push({
            type: 'pocket',
            intensity: Math.min(1, Math.max(0.4, Math.hypot(b.vx, b.vy) / 500)),
            x: p.x,
            y: p.y,
            ballId: b.id,
            pocketId: p.id,
          });
          break;
        }
      }
    }

    // 3. Cushion collisions (skipping pocket mouths)
    for (const b of balls) {
      if (b.pocketed) continue;

      let hitCushion = false;

      // Left rail
      if (b.x - BALL_RADIUS < 0 && !isInPocketMouthY(b.y)) {
        b.x = BALL_RADIUS;
        b.vx = Math.abs(b.vx) * PHYSICS_PARAMS.restitutionCushion;
        if (b.id === 0 && Math.abs(b.spinX) > 0.02) {
          b.vy += b.spinX * Math.abs(b.vx) * PHYSICS_PARAMS.englishCushionFactor;
          b.spinX *= 0.6;
        }
        hitCushion = true;
      }
      // Right rail
      else if (b.x + BALL_RADIUS > TABLE_WIDTH && !isInPocketMouthY(b.y)) {
        b.x = TABLE_WIDTH - BALL_RADIUS;
        b.vx = -Math.abs(b.vx) * PHYSICS_PARAMS.restitutionCushion;
        if (b.id === 0 && Math.abs(b.spinX) > 0.02) {
          b.vy -= b.spinX * Math.abs(b.vx) * PHYSICS_PARAMS.englishCushionFactor;
          b.spinX *= 0.6;
        }
        hitCushion = true;
      }

      // Top rail
      if (b.y - BALL_RADIUS < 0 && !isInPocketMouthX(b.x)) {
        b.y = BALL_RADIUS;
        b.vy = Math.abs(b.vy) * PHYSICS_PARAMS.restitutionCushion;
        if (b.id === 0 && Math.abs(b.spinX) > 0.02) {
          b.vx -= b.spinX * Math.abs(b.vy) * PHYSICS_PARAMS.englishCushionFactor;
          b.spinX *= 0.6;
        }
        hitCushion = true;
      }
      // Bottom rail
      else if (b.y + BALL_RADIUS > TABLE_HEIGHT && !isInPocketMouthX(b.x)) {
        b.y = TABLE_HEIGHT - BALL_RADIUS;
        b.vy = -Math.abs(b.vy) * PHYSICS_PARAMS.restitutionCushion;
        if (b.id === 0 && Math.abs(b.spinX) > 0.02) {
          b.vx += b.spinX * Math.abs(b.vy) * PHYSICS_PARAMS.englishCushionFactor;
          b.spinX *= 0.6;
        }
        hitCushion = true;
      }

      // Jaw posts collision
      for (const post of jawPosts) {
        const dx = b.x - post.x;
        const dy = b.y - post.y;
        const dist = Math.hypot(dx, dy);
        const minD = BALL_RADIUS + PHYSICS_PARAMS.cornerJawRadius * 0.45;
        if (dist < minD && dist > 0.0001) {
          const nx = dx / dist;
          const ny = dy / dist;
          b.x = post.x + nx * minD;
          b.y = post.y + ny * minD;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + PHYSICS_PARAMS.restitutionCushion) * vn * nx;
            b.vy -= (1 + PHYSICS_PARAMS.restitutionCushion) * vn * ny;
            hitCushion = true;
          }
        }
      }

      if (hitCushion) {
        telemetry.cushionHitCount += 1;
        if (telemetry.firstContactBallId !== null) {
          telemetry.railContactAfterFirstHit = true;
        }
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 25) {
          events.push({
            type: 'cushion',
            intensity: Math.min(1, speed / 700),
            x: b.x,
            y: b.y,
            ballId: b.id,
          });
        }
      }
    }

    // 4. Ball-to-ball collisions (symmetric Jacobi impulse passes for clean rack shockwaves)
    const minDist = BALL_RADIUS * 2;
    const nBalls = balls.length;
    for (let iter = 0; iter < 4; iter++) {
      const dvx = new Float64Array(nBalls);
      const dvy = new Float64Array(nBalls);
      const dpx = new Float64Array(nBalls);
      const dpy = new Float64Array(nBalls);
      const counts = new Uint8Array(nBalls);

      for (let i = 0; i < nBalls; i++) {
        const a = balls[i];
        if (a.pocketed) continue;

        for (let j = i + 1; j < nBalls; j++) {
          const b = balls[j];
          if (b.pocketed) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq) || 0.0001;
            const nx = dx / dist;
            const ny = dy / dist;

            // Positional overlap separation
            const overlap = minDist - dist;
            dpx[i] -= nx * (overlap * 0.5);
            dpy[i] -= ny * (overlap * 0.5);
            dpx[j] += nx * (overlap * 0.5);
            dpy[j] += ny * (overlap * 0.5);

            // Relative velocity along normal
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;

            if (velAlongNormal < 0) {
              const jImpulse = -(1 + PHYSICS_PARAMS.restitutionBall) * velAlongNormal * 0.5;
              const ix = jImpulse * nx;
              const iy = jImpulse * ny;

              dvx[i] -= ix;
              dvy[i] -= iy;
              dvx[j] += ix;
              dvy[j] += iy;
              counts[i] += 1;
              counts[j] += 1;

              // Record first cue-ball contact & apply top/back spin reaction
              if (a.id === 0 || b.id === 0) {
                const cue = a.id === 0 ? a : b;
                const obj = a.id === 0 ? b : a;
                const cueDirX = a.id === 0 ? nx : -nx;
                const cueDirY = a.id === 0 ? ny : -ny;
                const cueIdx = a.id === 0 ? i : j;
                const cuePreSpeed = Math.hypot(cue.vx, cue.vy);

                if (telemetry.firstContactBallId === null) {
                  telemetry.firstContactBallId = obj.id;
                }

                // Follow / Draw spin impulse along cue pre-impact line of centers
                if (Math.abs(cue.spinY) > 0.02 && cuePreSpeed > 25) {
                  const spinPush = cue.spinY * Math.abs(velAlongNormal) * PHYSICS_PARAMS.followSpinFactor;
                  dvx[cueIdx] += cueDirX * spinPush;
                  dvy[cueIdx] += cueDirY * spinPush;
                  cue.spinY *= 0.25;
                }
              }

              const impact = Math.abs(velAlongNormal);
              if (impact > 18) {
                events.push({
                  type: 'ball',
                  intensity: Math.min(1, impact / 850),
                  x: (a.x + b.x) * 0.5,
                  y: (a.y + b.y) * 0.5,
                  ballId: a.id,
                });
              }
            }
          }
        }
      }

      let anyHit = false;
      for (let i = 0; i < nBalls; i++) {
        if (balls[i].pocketed) continue;
        if (dpx[i] !== 0 || dpy[i] !== 0) {
          balls[i].x += dpx[i];
          balls[i].y += dpy[i];
        }
        if (counts[i] > 0) {
          anyHit = true;
          // Scale when >1 simultaneous contact so triangle impacts stay energy-consistent
          const scale = counts[i] > 1 ? 0.72 : 1;
          balls[i].vx += dvx[i] * scale;
          balls[i].vy += dvy[i] * scale;
        }
      }
      if (!anyHit) break;
    }
  }

  // 5. Friction & deceleration once per frame
  const dampingFactor = Math.pow(PHYSICS_PARAMS.linearDamping, dt * 60);
  for (const b of balls) {
    if (b.pocketed) continue;

    b.vx *= dampingFactor;
    b.vy *= dampingFactor;

    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 0) {
      const decel = PHYSICS_PARAMS.rollingDecel * dt;
      const newSpeed = Math.max(0, speed - decel);
      if (newSpeed < PHYSICS_PARAMS.stopThreshold) {
        b.vx = 0;
        b.vy = 0;
        b.spinX = 0;
        b.spinY = 0;
      } else {
        const ratio = newSpeed / speed;
        b.vx *= ratio;
        b.vy *= ratio;
        b.spinX *= PHYSICS_PARAMS.spinDecay;
        b.spinY *= PHYSICS_PARAMS.spinDecay;
      }
    }
  }

  return events;
}

export function isTargetBallLegal(
  ballId: number,
  group: BallSuit,
  balls: BallState[],
  isBreakShot: boolean,
  gameVariant: GameVariant = '8ball',
): boolean {
  if (ballId === 0) return false;
  if (gameVariant === '9ball') {
    let lowest = Infinity;
    for (const b of balls) {
      if (b.id > 0 && !b.pocketed && b.number < lowest) {
        lowest = b.number;
      }
    }
    return ballId === lowest;
  }
  if (isBreakShot || group === null) return ballId !== 8;
  const remainingOwn = balls.filter((b) => !b.pocketed && b.group === group).length;
  if (remainingOwn === 0) return ballId === 8;
  return balls.find((b) => b.id === ballId)?.group === group;
}

export function computeAimPrediction(
  balls: BallState[],
  angle: number,
  spinY: number,
  currentGroup: BallSuit,
  isBreakShot: boolean,
  gameVariant: GameVariant = '8ball',
): AimPrediction {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) {
    return {
      ghostX: TABLE_WIDTH / 2,
      ghostY: TABLE_HEIGHT / 2,
      hitType: 'cushion',
      targetBallId: null,
      targetDirX: Math.cos(angle),
      targetDirY: Math.sin(angle),
      cueDeflectX: Math.cos(angle),
      cueDeflectY: Math.sin(angle),
      bounceDirX: -Math.cos(angle),
      bounceDirY: Math.sin(angle),
      isLegalTarget: true,
    };
  }

  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // Find closest rail intersection for cue ball center
  let minT = Infinity;
  let railNormalX = 0;
  let railNormalY = 0;

  if (dx < -1e-6) {
    const t = (BALL_RADIUS - cue.x) / dx;
    if (t > 0 && t < minT) {
      minT = t;
      railNormalX = 1;
      railNormalY = 0;
    }
  } else if (dx > 1e-6) {
    const t = (TABLE_WIDTH - BALL_RADIUS - cue.x) / dx;
    if (t > 0 && t < minT) {
      minT = t;
      railNormalX = -1;
      railNormalY = 0;
    }
  }

  if (dy < -1e-6) {
    const t = (BALL_RADIUS - cue.y) / dy;
    if (t > 0 && t < minT) {
      minT = t;
      railNormalX = 0;
      railNormalY = 1;
    }
  } else if (dy > 1e-6) {
    const t = (TABLE_HEIGHT - BALL_RADIUS - cue.y) / dy;
    if (t > 0 && t < minT) {
      minT = t;
      railNormalX = 0;
      railNormalY = -1;
    }
  }

  // Swept circle intersection against all active object balls
  let hitBall: BallState | null = null;
  const rSum = BALL_RADIUS * 2;
  const rSumSq = rSum * rSum;

  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const ocX = cue.x - b.x;
    const ocY = cue.y - b.y;
    const proj = ocX * dx + ocY * dy;
    // Ray goes away from ball
    if (proj > 0) continue;
    const cVal = ocX * ocX + ocY * ocY - rSumSq;
    const disc = proj * proj - cVal;
    if (disc < 0) continue;
    const t = -proj - Math.sqrt(disc);
    if (t >= 0 && t < minT) {
      minT = t;
      hitBall = b;
    }
  }

  const ghostX = cue.x + dx * minT;
  const ghostY = cue.y + dy * minT;

  if (hitBall) {
    const nx = (hitBall.x - ghostX) / rSum;
    const ny = (hitBall.y - ghostY) / rSum;

    // Tangent direction perpendicular to line of centers
    const dot = dx * nx + dy * ny;
    let cx = dx - dot * nx;
    let cy = dy - dot * ny;
    // Apply top/back spin tendency to predicted cue deflection
    cx += dx * spinY * 0.45;
    cy += dy * spinY * 0.45;
    const cLen = Math.hypot(cx, cy) || 1;

    return {
      ghostX,
      ghostY,
      hitType: 'ball',
      targetBallId: hitBall.id,
      targetDirX: nx,
      targetDirY: ny,
      cueDeflectX: cx / cLen,
      cueDeflectY: cy / cLen,
      bounceDirX: nx,
      bounceDirY: ny,
      isLegalTarget: isTargetBallLegal(hitBall.id, currentGroup, balls, isBreakShot, gameVariant),
    };
  }

  // Rail reflection
  const dotRail = dx * railNormalX + dy * railNormalY;
  const bx = dx - 2 * dotRail * railNormalX;
  const by = dy - 2 * dotRail * railNormalY;

  return {
    ghostX,
    ghostY,
    hitType: 'cushion',
    targetBallId: null,
    targetDirX: dx,
    targetDirY: dy,
    cueDeflectX: bx,
    cueDeflectY: by,
    bounceDirX: bx,
    bounceDirY: by,
    isLegalTarget: true,
  };
}
