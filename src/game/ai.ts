import {
  BALL_RADIUS,
  FOOT_SPOT_X,
  FOOT_SPOT_Y,
  HEADSTRING_X,
  POCKETS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './constants.ts';
import { findSafeCueBallSpot, isTargetBallLegal, isValidCueBallPlacement } from './physics.ts';
import { getPlayerGroup } from './rules.ts';
import type {
  AiDifficulty,
  AiShotPlan,
  BallState,
  MatchRulesState,
  PocketDef,
  ShotInput,
} from './types.ts';

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function isSegmentClear(
  balls: BallState[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  excludeIds: number[],
): boolean {
  const minClear = BALL_RADIUS * 2 - 1.1;
  for (const b of balls) {
    if (b.pocketed || excludeIds.includes(b.id)) continue;
    if (pointToSegmentDist(b.x, b.y, ax, ay, bx, by) < minClear) {
      return false;
    }
  }
  return true;
}

function getPocketAimPoint(pocket: PocketDef): { x: number; y: number } {
  const cx = TABLE_WIDTH / 2;
  const cy = TABLE_HEIGHT / 2;
  const dx = cx - pocket.x;
  const dy = cy - pocket.y;
  const len = Math.hypot(dx, dy) || 1;
  const pull = pocket.isCorner ? 4.2 : 3.0;
  return {
    x: pocket.x + (dx / len) * pull,
    y: pocket.y + (dy / len) * pull,
  };
}

function pocketLabelEn(pocketId: number): string {
  switch (pocketId) {
    case 0:
      return 'Top Left corner';
    case 1:
      return 'Top Side pocket';
    case 2:
      return 'Top Right corner';
    case 3:
      return 'Bottom Left corner';
    case 4:
      return 'Bottom Side pocket';
    case 5:
      return 'Bottom Right corner';
    default:
      return 'target pocket';
  }
}

function pocketLabelId(pocketId: number): string {
  switch (pocketId) {
    case 0:
      return 'lubang sudut Kiri Atas';
    case 1:
      return 'lubang samping Tengah Atas';
    case 2:
      return 'lubang sudut Kanan Atas';
    case 3:
      return 'lubang sudut Kiri Bawah';
    case 4:
      return 'lubang samping Tengah Bawah';
    case 5:
      return 'lubang sudut Kanan Bawah';
    default:
      return 'lubang target';
  }
}

function getLegalTargetBalls(balls: BallState[], rules: MatchRulesState): BallState[] {
  const group = getPlayerGroup(rules, rules.currentTurn);
  return balls.filter((b) => {
    if (b.id === 0 || b.pocketed) return false;
    return isTargetBallLegal(b.id, group, balls, rules.isBreakShot, rules.gameVariant);
  });
}

function willCueDeflectScratch(
  ghostX: number,
  ghostY: number,
  deflectX: number,
  deflectY: number,
): boolean {
  for (const p of POCKETS) {
    const toPx = p.x - ghostX;
    const toPy = p.y - ghostY;
    const dist = Math.hypot(toPx, toPy);
    if (dist < 1 || dist > 420) continue;
    const dot = (toPx / dist) * deflectX + (toPy / dist) * deflectY;
    if (dot > 0.96) return true;
  }
  return false;
}

function getNextTargetBalls(
  balls: BallState[],
  rules: MatchRulesState,
  justPocketedId: number,
): BallState[] {
  if (rules.gameVariant === '9ball') {
    const remaining = balls
      .filter((b) => b.id > 0 && !b.pocketed && b.id !== justPocketedId)
      .sort((a, b) => a.number - b.number);
    return remaining.length > 0 ? [remaining[0]] : [];
  }

  const group = getPlayerGroup(rules, rules.currentTurn);
  const chosenSuit =
    group ??
    (justPocketedId >= 1 && justPocketedId <= 7
      ? 'solid'
      : justPocketedId >= 9 && justPocketedId <= 15
        ? 'stripe'
        : null);

  if (!chosenSuit) return [];
  const sameGroup = balls.filter(
    (b) => !b.pocketed && b.id !== justPocketedId && b.group === chosenSuit,
  );
  if (sameGroup.length > 0) return sameGroup;
  const eight = balls.find((b) => b.id === 8 && !b.pocketed && b.id !== justPocketedId);
  return eight ? [eight] : [];
}

function evaluatePositionalLeave(
  balls: BallState[],
  rules: MatchRulesState,
  target: BallState,
  ghostX: number,
  ghostY: number,
  cDirX: number,
  cDirY: number,
  tDirX: number,
  tDirY: number,
  cutCos: number,
  basePower: number,
  spinY: number,
): number {
  // Approximate post-impact cue travel direction & distance based on tangent + top/back spin
  const dot = cDirX * tDirX + cDirY * tDirY;
  let postX = cDirX - dot * tDirX + cDirX * spinY * 0.62;
  let postY = cDirY - dot * tDirY + cDirY * spinY * 0.62;
  const postLen = Math.hypot(postX, postY);
  if (postLen < 1e-4) {
    postX = cDirX;
    postY = cDirY;
  } else {
    postX /= postLen;
    postY /= postLen;
  }

  const travelDist = Math.min(340, (65 + basePower * 240) * (1 - cutCos * 0.35 + Math.abs(spinY) * 0.45));
  const restX = Math.max(BALL_RADIUS + 18, Math.min(TABLE_WIDTH - BALL_RADIUS - 18, ghostX + postX * travelDist));
  const restY = Math.max(BALL_RADIUS + 18, Math.min(TABLE_HEIGHT - BALL_RADIUS - 18, ghostY + postY * travelDist));

  if (willCueDeflectScratch(ghostX, ghostY, postX, postY)) {
    return -58;
  }

  // Reward staying near table middle away from cushions slightly
  let posScore = 0;
  if (restX > 90 && restX < TABLE_WIDTH - 90 && restY > 65 && restY < TABLE_HEIGHT - 65) {
    posScore += 6;
  }

  const nextTargets = getNextTargetBalls(balls, rules, target.id);
  if (nextTargets.length === 0) return posScore;

  let bestNextAngleScore = -12;
  const rSum = BALL_RADIUS * 2;
  for (const nt of nextTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const nx = aimPt.x - nt.x;
      const ny = aimPt.y - nt.y;
      const nDist = Math.hypot(nx, ny);
      if (nDist < 1) continue;
      const nDirX = nx / nDist;
      const nDirY = ny / nDist;
      if (!pocket.isCorner && Math.abs(nDirY) < 0.34) continue;

      const nGhostX = nt.x - nDirX * rSum;
      const nGhostY = nt.y - nDirY * rSum;
      const toNx = nGhostX - restX;
      const toNy = nGhostY - restY;
      const toNDist = Math.hypot(toNx, toNy);
      if (toNDist < 18) continue;

      const nextCut = (toNx / toNDist) * nDirX + (toNy / toNDist) * nDirY;
      if (nextCut < 0.38) continue;

      const clearToNext = isSegmentClear(balls, restX, restY, nGhostX, nGhostY, [0, target.id, nt.id]);
      const clearToPocket = isSegmentClear(balls, nt.x, nt.y, aimPt.x, aimPt.y, [0, target.id, nt.id]);
      if (!clearToNext || !clearToPocket) continue;

      const candidateLeave = nextCut * 22 - (toNDist + nDist) * 0.015;
      if (candidateLeave > bestNextAngleScore) {
        bestNextAngleScore = candidateLeave;
      }
    }
  }

  return posScore + bestNextAngleScore;
}

export interface ScoredAiCandidate {
  angle: number;
  power: number;
  spinX: number;
  spinY: number;
  score: number;
  targetBallId: number;
  pocketId: number;
  comboSecondBallId?: number;
  spinNoteEn?: string;
  spinNoteId?: string;
}

export function evaluateBestDirectShots(
  balls: BallState[],
  rules: MatchRulesState,
  cueX: number,
  cueY: number,
  difficulty: AiDifficulty = 'pro',
): ScoredAiCandidate[] {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const candidates: ScoredAiCandidate[] = [];
  const rSum = BALL_RADIUS * 2;

  // On open 8 Ball table, favor whichever suit has stronger clear layout
  let suitPreferenceBonus: Record<'solid' | 'stripe', number> = { solid: 0, stripe: 0 };
  if (rules.gameVariant === '8ball' && !rules.isBreakShot && getPlayerGroup(rules, rules.currentTurn) === null) {
    let solidOpen = 0;
    let stripeOpen = 0;
    for (const b of legalTargets) {
      if (b.group !== 'solid' && b.group !== 'stripe') continue;
      const hasOpenPocket = POCKETS.some((p) => {
        const pt = getPocketAimPoint(p);
        return isSegmentClear(balls, b.x, b.y, pt.x, pt.y, [0, b.id]);
      });
      if (hasOpenPocket) {
        if (b.group === 'solid') solidOpen += 1;
        else stripeOpen += 1;
      }
    }
    if (solidOpen > stripeOpen) suitPreferenceBonus = { solid: 10, stripe: 0 };
    else if (stripeOpen > solidOpen) suitPreferenceBonus = { solid: 0, stripe: 10 };
  }

  for (const target of legalTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const tx = aimPt.x - target.x;
      const ty = aimPt.y - target.y;
      const tDist = Math.hypot(tx, ty);
      if (tDist < 1) continue;

      const tDirX = tx / tDist;
      const tDirY = ty / tDist;

      // Side pockets require steeper entry into the mouth so ball does not catch side jaws
      if (!pocket.isCorner && Math.abs(tDirY) < 0.36) continue;

      const ghostX = target.x - tDirX * rSum;
      const ghostY = target.y - tDirY * rSum;

      if (
        ghostX < BALL_RADIUS + 2 ||
        ghostX > TABLE_WIDTH - BALL_RADIUS - 2 ||
        ghostY < BALL_RADIUS + 2 ||
        ghostY > TABLE_HEIGHT - BALL_RADIUS - 2
      ) {
        continue;
      }

      const cx = ghostX - cueX;
      const cy = ghostY - cueY;
      const cDist = Math.hypot(cx, cy);
      if (cDist < 1) continue;

      const cDirX = cx / cDist;
      const cDirY = cy / cDist;

      const cutCos = cDirX * tDirX + cDirY * tDirY;
      if (cutCos < 0.25) continue;

      const cueClear = isSegmentClear(balls, cueX, cueY, ghostX, ghostY, [0, target.id]);
      const objClear = isSegmentClear(balls, target.x, target.y, aimPt.x, aimPt.y, [0, target.id]);
      if (!cueClear || !objClear) continue;

      const dot = cDirX * tDirX + cDirY * tDirY;
      const defX = cDirX - dot * tDirX;
      const defY = cDirY - dot * tDirY;
      const defLen = Math.hypot(defX, defY) || 1;
      const naturalScratch = willCueDeflectScratch(ghostX, ghostY, defX / defLen, defY / defLen);

      const totalDist = cDist + tDist;
      const basePower = Math.max(
        0.30,
        Math.min(0.88, 0.30 + Math.min(0.52, totalDist / 1320) + (1 - cutCos) * 0.16),
      );

      let chosenSpinY = 0;
      let chosenPower = basePower;
      let bestLeaveBonus = 0;

      if (difficulty === 'club') {
        chosenSpinY = naturalScratch ? (cutCos > 0.72 ? -0.35 : 0.3) : 0;
        bestLeaveBonus = naturalScratch ? -40 : 0;
      } else {
        const spinCandidates =
          difficulty === 'pro' ? [-0.52, -0.22, 0, 0.25, 0.55] : [-0.24, 0, 0.28];
        const powerScales = difficulty === 'pro' ? [0.92, 1.0, 1.1] : [1.0];
        let bestPosScore = -Infinity;

        for (const sy of spinCandidates) {
          for (const pScale of powerScales) {
            const candPower = Math.max(0.28, Math.min(0.92, basePower * pScale));
            const leaveScore = evaluatePositionalLeave(
              balls,
              rules,
              target,
              ghostX,
              ghostY,
              cDirX,
              cDirY,
              tDirX,
              tDirY,
              cutCos,
              candPower,
              sy,
            );
            // Slight penalty for extreme unnecessary spin unless it gains real position or avoids scratch
            const spinEffortPenalty = Math.abs(sy) * 4;
            const totalLeave = leaveScore - spinEffortPenalty;
            if (totalLeave > bestPosScore) {
              bestPosScore = totalLeave;
              chosenSpinY = sy;
              chosenPower = candPower;
            }
          }
        }
        bestLeaveBonus = bestPosScore;
      }

      const pocketBonus = pocket.isCorner ? 14 : 4;
      const distPenalty = totalDist * 0.048;
      const cutScore = Math.pow(cutCos, 1.45) * 112;
      const groupBonus =
        target.group === 'solid' || target.group === 'stripe'
          ? suitPreferenceBonus[target.group]
          : 0;
      const score = cutScore + pocketBonus + groupBonus + bestLeaveBonus - distPenalty;

      const spinNoteEn =
        chosenSpinY <= -0.28
          ? 'with backspin to control cue position'
          : chosenSpinY >= 0.28
            ? 'with topspin for forward cue shape'
            : naturalScratch
              ? 'adjusting speed to stay clear of scratch'
              : 'with steady center cue control';
      const spinNoteId =
        chosenSpinY <= -0.28
          ? 'dengan efek backspin agar posisi bola putih terjaga'
          : chosenSpinY >= 0.28
            ? 'dengan efek topspin untuk membuka posisi bola berikutnya'
            : naturalScratch
              ? 'mengatur kekuatan agar terhindar dari scratch'
              : 'dengan pukulan tengah presisi dan terkontrol';

      candidates.push({
        angle: Math.atan2(cDirY, cDirX),
        power: chosenPower,
        spinX: 0,
        spinY: chosenSpinY,
        score,
        targetBallId: target.id,
        pocketId: pocket.id,
        spinNoteEn,
        spinNoteId,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function evaluateBestComboShots(
  balls: BallState[],
  rules: MatchRulesState,
  cueX: number,
  cueY: number,
): ScoredAiCandidate[] {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const candidates: ScoredAiCandidate[] = [];
  const rSum = BALL_RADIUS * 2;
  const group = getPlayerGroup(rules, rules.currentTurn);

  for (const ballA of legalTargets) {
    // Determine valid second object balls B for a legal combo
    const secondBallPool = balls.filter((b) => {
      if (b.id === 0 || b.id === ballA.id || b.pocketed) return false;
      if (rules.gameVariant === '9ball') {
        // In 9 Ball, hitting lowest ball first makes any subsequent object ball combo legal (especially 9 Ball!)
        return true;
      }
      // In 8 Ball, never combo into opponent ball or early 8 Ball
      if (b.id === 8) return false;
      if (group === null) return b.group === ballA.group;
      return b.group === group;
    });

    for (const ballB of secondBallPool) {
      for (const pocket of POCKETS) {
        const aimPt = getPocketAimPoint(pocket);
        const bx = aimPt.x - ballB.x;
        const by = aimPt.y - ballB.y;
        const bDist = Math.hypot(bx, by);
        if (bDist < 1) continue;
        const bDirX = bx / bDist;
        const bDirY = by / bDist;
        if (!pocket.isCorner && Math.abs(bDirY) < 0.38) continue;

        const ghostBX = ballB.x - bDirX * rSum;
        const ghostBY = ballB.y - bDirY * rSum;
        if (
          ghostBX < BALL_RADIUS + 2 ||
          ghostBX > TABLE_WIDTH - BALL_RADIUS - 2 ||
          ghostBY < BALL_RADIUS + 2 ||
          ghostBY > TABLE_HEIGHT - BALL_RADIUS - 2
        ) {
          continue;
        }

        const ax = ghostBX - ballA.x;
        const ay = ghostBY - ballA.y;
        const aDist = Math.hypot(ax, ay);
        if (aDist < 1 || aDist > 260) continue;
        const aDirX = ax / aDist;
        const aDirY = ay / aDist;

        const cutCosB = aDirX * bDirX + aDirY * bDirY;
        if (cutCosB < 0.56) continue;

        const ghostAX = ballA.x - aDirX * rSum;
        const ghostAY = ballA.y - aDirY * rSum;
        if (
          ghostAX < BALL_RADIUS + 2 ||
          ghostAX > TABLE_WIDTH - BALL_RADIUS - 2 ||
          ghostAY < BALL_RADIUS + 2 ||
          ghostAY > TABLE_HEIGHT - BALL_RADIUS - 2
        ) {
          continue;
        }

        const cx = ghostAX - cueX;
        const cy = ghostAY - cueY;
        const cDist = Math.hypot(cx, cy);
        if (cDist < 1) continue;
        const cDirX = cx / cDist;
        const cDirY = cy / cDist;

        const cutCosA = cDirX * aDirX + cDirY * aDirY;
        if (cutCosA < 0.52) continue;

        const segCueClear = isSegmentClear(balls, cueX, cueY, ghostAX, ghostAY, [0, ballA.id, ballB.id]);
        const segABClear = isSegmentClear(balls, ballA.x, ballA.y, ghostBX, ghostBY, [0, ballA.id, ballB.id]);
        const segBPClear = isSegmentClear(balls, ballB.x, ballB.y, aimPt.x, aimPt.y, [0, ballA.id, ballB.id]);
        if (!segCueClear || !segABClear || !segBPClear) continue;

        const totalDist = cDist + aDist + bDist;
        const nineBallBonus = rules.gameVariant === '9ball' && ballB.number === 9 ? 28 : 0;
        const score =
          Math.pow(cutCosA * cutCosB, 1.35) * 86 + nineBallBonus - totalDist * 0.045;
        const power = Math.max(0.46, Math.min(0.92, 0.45 + totalDist / 1280));

        candidates.push({
          angle: Math.atan2(cDirY, cDirX),
          power,
          spinX: 0,
          spinY: 0,
          score,
          targetBallId: ballA.id,
          comboSecondBallId: ballB.id,
          pocketId: pocket.id,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function evaluateBestBankShots(
  balls: BallState[],
  rules: MatchRulesState,
  cueX: number,
  cueY: number,
): ScoredAiCandidate[] {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const candidates: ScoredAiCandidate[] = [];
  const rSum = BALL_RADIUS * 2;
  const minX = BALL_RADIUS;
  const maxX = TABLE_WIDTH - BALL_RADIUS;
  const minY = BALL_RADIUS;
  const maxY = TABLE_HEIGHT - BALL_RADIUS;

  for (const target of legalTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const mirrors = [
        { mx: aimPt.x, my: 2 * minY - aimPt.y, edge: 'top' as const },
        { mx: aimPt.x, my: 2 * maxY - aimPt.y, edge: 'bottom' as const },
        { mx: 2 * minX - aimPt.x, my: aimPt.y, edge: 'left' as const },
        { mx: 2 * maxX - aimPt.x, my: aimPt.y, edge: 'right' as const },
      ];

      for (const m of mirrors) {
        const vx = m.mx - target.x;
        const vy = m.my - target.y;
        const len = Math.hypot(vx, vy);
        if (len < 10) continue;

        let tRail = -1;
        if (m.edge === 'top' && Math.abs(vy) > 1e-4) tRail = (minY - target.y) / vy;
        if (m.edge === 'bottom' && Math.abs(vy) > 1e-4) tRail = (maxY - target.y) / vy;
        if (m.edge === 'left' && Math.abs(vx) > 1e-4) tRail = (minX - target.x) / vx;
        if (m.edge === 'right' && Math.abs(vx) > 1e-4) tRail = (maxX - target.x) / vx;

        if (tRail <= 0.04 || tRail >= 0.96) continue;
        const rx = target.x + vx * tRail;
        const ry = target.y + vy * tRail;
        if (rx < minX || rx > maxX || ry < minY || ry > maxY) continue;

        const tDirX = vx / len;
        const tDirY = vy / len;
        const ghostX = target.x - tDirX * rSum;
        const ghostY = target.y - tDirY * rSum;
        if (ghostX < minX + 2 || ghostX > maxX - 2 || ghostY < minY + 2 || ghostY > maxY - 2) continue;

        const cx = ghostX - cueX;
        const cy = ghostY - cueY;
        const cDist = Math.hypot(cx, cy);
        if (cDist < 1) continue;
        const cDirX = cx / cDist;
        const cDirY = cy / cDist;
        const cutCos = cDirX * tDirX + cDirY * tDirY;
        if (cutCos < 0.5) continue;

        const cueClear = isSegmentClear(balls, cueX, cueY, ghostX, ghostY, [0, target.id]);
        const seg1Clear = isSegmentClear(balls, target.x, target.y, rx, ry, [0, target.id]);
        const seg2Clear = isSegmentClear(balls, rx, ry, aimPt.x, aimPt.y, [0, target.id]);
        if (!cueClear || !seg1Clear || !seg2Clear) continue;

        const totalDist = cDist + len;
        const power = Math.max(0.48, Math.min(0.92, 0.46 + totalDist / 1350));
        const score = Math.pow(cutCos, 1.5) * 64 - totalDist * 0.045;
        candidates.push({
          angle: Math.atan2(cDirY, cDirX),
          power,
          spinX: 0,
          spinY: 0,
          score,
          targetBallId: target.id,
          pocketId: pocket.id,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function evaluateBestSafetyShots(
  balls: BallState[],
  rules: MatchRulesState,
  cueX: number,
  cueY: number,
): ScoredAiCandidate[] {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const candidates: ScoredAiCandidate[] = [];
  const rSum = BALL_RADIUS * 2;
  const oppBalls = balls.filter((b) => b.id > 0 && !b.pocketed && !legalTargets.some((lt) => lt.id === b.id));

  for (const target of legalTargets) {
    // Try soft thin/medium cuts aimed toward safe cushions to separate cue ball and object ball
    const toTargetX = target.x - cueX;
    const toTargetY = target.y - cueY;
    const dist = Math.hypot(toTargetX, toTargetY);
    if (dist < 1) continue;
    const baseDirX = toTargetX / dist;
    const baseDirY = toTargetY / dist;
    if (!isSegmentClear(balls, cueX, cueY, target.x - baseDirX * rSum, target.y - baseDirY * rSum, [0, target.id])) {
      continue;
    }

    const hitOffsets = [-0.26, -0.14, 0.14, 0.26];
    for (const offset of hitOffsets) {
      const aimAngle = Math.atan2(baseDirY, baseDirX) + offset;
      const dx = Math.cos(aimAngle);
      const dy = Math.sin(aimAngle);

      // Verify ray still hits legal target
      const ocX = cueX - target.x;
      const ocY = cueY - target.y;
      const proj = ocX * dx + ocY * dy;
      if (proj > 0) continue;
      const disc = proj * proj - (ocX * ocX + ocY * ocY - rSum * rSum);
      if (disc < 0) continue;
      const tHit = -proj - Math.sqrt(disc);
      if (tHit < 0) continue;
      const ghostX = cueX + dx * tHit;
      const ghostY = cueY + dy * tHit;

      const nx = (target.x - ghostX) / rSum;
      const ny = (target.y - ghostY) / rSum;
      const cutCos = dx * nx + dy * ny;
      if (cutCos < 0.22) continue;

      const defX = dx - cutCos * nx;
      const defY = dy - cutCos * ny;
      const defLen = Math.hypot(defX, defY) || 1;
      const ux = defX / defLen;
      const uy = defY / defLen;
      if (willCueDeflectScratch(ghostX, ghostY, ux, uy)) continue;

      // Predict gentle post-hit cue rest spot near safety zone
      const cueSafeX = Math.max(BALL_RADIUS + 14, Math.min(TABLE_WIDTH - BALL_RADIUS - 14, ghostX + ux * 150));
      const cueSafeY = Math.max(BALL_RADIUS + 14, Math.min(TABLE_HEIGHT - BALL_RADIUS - 14, ghostY + uy * 150));

      // Count how many opponent balls are screened or kept far from cueSafe
      let screenedCount = 0;
      let avgDistToOpp = 0;
      for (const ob of oppBalls) {
        avgDistToOpp += Math.hypot(ob.x - cueSafeX, ob.y - cueSafeY);
        if (!isSegmentClear(balls, cueSafeX, cueSafeY, ob.x, ob.y, [0, ob.id])) {
          screenedCount += 1;
        }
      }
      if (oppBalls.length > 0) avgDistToOpp /= oppBalls.length;

      // Also check that object ball or cue ball can reach a rail safely (using moderate 0.42..0.52 speed)
      const nearRailDist = Math.min(
        target.x,
        TABLE_WIDTH - target.x,
        target.y,
        TABLE_HEIGHT - target.y,
        cueSafeX,
        TABLE_WIDTH - cueSafeX,
        cueSafeY,
        TABLE_HEIGHT - cueSafeY,
      );
      const railBonus = nearRailDist < 175 ? 16 : 6;
      const score = 18 + screenedCount * 11 + Math.min(20, avgDistToOpp * 0.03) + railBonus;

      candidates.push({
        angle: aimAngle,
        power: 0.46,
        spinX: 0,
        spinY: -0.18,
        score,
        targetBallId: target.id,
        pocketId: -1,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function evaluateKickEscapeAngle(
  balls: BallState[],
  target: BallState,
  cueX: number,
  cueY: number,
): number | null {
  const minX = BALL_RADIUS;
  const maxX = TABLE_WIDTH - BALL_RADIUS;
  const minY = BALL_RADIUS;
  const maxY = TABLE_HEIGHT - BALL_RADIUS;
  const mirrors = [
    { mx: target.x, my: 2 * minY - target.y, edge: 'top' as const },
    { mx: target.x, my: 2 * maxY - target.y, edge: 'bottom' as const },
    { mx: 2 * minX - target.x, my: target.y, edge: 'left' as const },
    { mx: 2 * maxX - target.x, my: target.y, edge: 'right' as const },
  ];

  for (const m of mirrors) {
    const vx = m.mx - cueX;
    const vy = m.my - cueY;
    let tRail = -1;
    if (m.edge === 'top' && Math.abs(vy) > 1e-4) tRail = (minY - cueY) / vy;
    if (m.edge === 'bottom' && Math.abs(vy) > 1e-4) tRail = (maxY - cueY) / vy;
    if (m.edge === 'left' && Math.abs(vx) > 1e-4) tRail = (minX - cueX) / vx;
    if (m.edge === 'right' && Math.abs(vx) > 1e-4) tRail = (maxX - cueX) / vx;
    if (tRail <= 0.04 || tRail >= 0.96) continue;
    const rx = cueX + vx * tRail;
    const ry = cueY + vy * tRail;
    if (rx < minX || rx > maxX || ry < minY || ry > maxY) continue;
    if (
      isSegmentClear(balls, cueX, cueY, rx, ry, [0, target.id]) &&
      isSegmentClear(balls, rx, ry, target.x, target.y, [0, target.id])
    ) {
      return Math.atan2(ry - cueY, rx - cueX);
    }
  }
  return null;
}

export function chooseAiCueBallPlacement(
  balls: BallState[],
  rules: MatchRulesState,
  difficulty: AiDifficulty = 'pro',
): { x: number; y: number } {
  const legalTargets = getLegalTargetBalls(balls, rules);
  const rSum = BALL_RADIUS * 2;
  let bestSpot: { x: number; y: number } | null = null;
  let bestScore = -Infinity;

  for (const target of legalTargets) {
    for (const pocket of POCKETS) {
      const aimPt = getPocketAimPoint(pocket);
      const tx = aimPt.x - target.x;
      const ty = aimPt.y - target.y;
      const tDist = Math.hypot(tx, ty);
      if (tDist < 1) continue;
      const tDirX = tx / tDist;
      const tDirY = ty / tDist;
      if (!pocket.isCorner && Math.abs(tDirY) < 0.36) continue;

      const objClear = isSegmentClear(balls, target.x, target.y, aimPt.x, aimPt.y, [0, target.id]);
      if (!objClear) continue;

      const distances = difficulty === 'pro' ? [115, 160, 215] : [150, 210];
      for (const setupDist of distances) {
        const cx = target.x - tDirX * (rSum + setupDist);
        const cy = target.y - tDirY * (rSum + setupDist);
        if (!isValidCueBallPlacement(balls, cx, cy, rules.headstringOnly)) continue;
        if (!isSegmentClear(balls, cx, cy, target.x - tDirX * rSum, target.y - tDirY * rSum, [0, target.id])) {
          continue;
        }
        const score = 120 - tDist * 0.06 - setupDist * 0.04 + (pocket.isCorner ? 10 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestSpot = { x: cx, y: cy };
        }
      }
    }
  }

  return bestSpot ?? findSafeCueBallSpot(balls, rules.headstringOnly);
}

export function computeAiShotPlan(
  balls: BallState[],
  rules: MatchRulesState,
  difficulty: AiDifficulty = 'pro',
  rng: () => number = Math.random,
): AiShotPlan {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) {
    return {
      shot: { angle: 0, power: 0.65, spinX: 0, spinY: 0 },
      targetBallId: null,
      pocketId: null,
      shotType: 'fallback',
      estimatedSuccess: 30,
      reasonEn: 'Aiming a controlled cue shot toward center table.',
      reasonId: 'Membidik tembakan terkontrol ke area tengah meja.',
    };
  }

  // 1. Opening Break Shot
  if (rules.isBreakShot) {
    const apex = balls.find((b) => b.id === 1) ?? { x: FOOT_SPOT_X, y: FOOT_SPOT_Y };
    const jitter = difficulty === 'pro' ? (rng() - 0.5) * 0.01 : (rng() - 0.5) * 0.036;
    const angle = Math.atan2(apex.y - cue.y, apex.x - cue.x) + jitter;
    const power = difficulty === 'pro' ? 0.97 : difficulty === 'semipro' ? 0.9 : 0.82;
    return {
      shot: { angle, power, spinX: 0, spinY: difficulty === 'pro' ? 0.22 : 0.15 },
      targetBallId: apex && 'id' in apex ? apex.id : 1,
      pocketId: null,
      shotType: 'break',
      estimatedSuccess: difficulty === 'pro' ? 88 : 74,
      reasonEn:
        'Full power break aimed through the lead ball with mild topspin to spread the rack and hold center table.',
      reasonId:
        'Break keras tepat ke bola terdepan dengan sedikit topspin untuk menyebar rak dan menguasai tengah meja.',
    };
  }

  const jitterRadius =
    difficulty === 'pro' ? 0.0018 : difficulty === 'semipro' ? 0.011 : 0.038;

  // 2. Evaluate Direct, Combo, and Bank candidates fairly
  const directCandidates = evaluateBestDirectShots(balls, rules, cue.x, cue.y, difficulty);
  const comboCandidates =
    difficulty !== 'club' ? evaluateBestComboShots(balls, rules, cue.x, cue.y) : [];
  const bankCandidates =
    difficulty !== 'club' ? evaluateBestBankShots(balls, rules, cue.x, cue.y) : [];

  const bestDirect = directCandidates[0] ?? null;
  const bestCombo = comboCandidates[0] ?? null;
  const bestBank = bankCandidates[0] ?? null;

  // Pick highest scoring offense among Direct, Combo, Bank
  const offensePool: Array<{ kind: 'direct' | 'combo' | 'bank'; c: ScoredAiCandidate }> = [];
  if (bestDirect) offensePool.push({ kind: 'direct', c: bestDirect });
  if (bestCombo) offensePool.push({ kind: 'combo', c: bestCombo });
  if (bestBank) offensePool.push({ kind: 'bank', c: bestBank });
  offensePool.sort((a, b) => b.c.score - a.c.score);

  const topOffense = offensePool[0] ?? null;

  // Smart Tactical Safety check when offense is very risky (Pro & Semi Pro)
  if (difficulty !== 'club' && (!topOffense || topOffense.c.score < (difficulty === 'pro' ? 30 : 18))) {
    const safeties = evaluateBestSafetyShots(balls, rules, cue.x, cue.y);
    if (safeties.length > 0 && (!topOffense || safeties[0].score > topOffense.c.score)) {
      const safe = safeties[0];
      const jitter = (rng() - 0.5) * 2 * jitterRadius;
      return {
        shot: {
          angle: safe.angle + jitter,
          power: safe.power,
          spinX: safe.spinX,
          spinY: safe.spinY,
        },
        targetBallId: safe.targetBallId,
        pocketId: null,
        shotType: 'safety',
        estimatedSuccess: 72,
        reasonEn: `Tactical safety on Ball ${safe.targetBallId} to leave the cue ball tucked behind blockers without an easy shot.`,
        reasonId: `Taktik safety menyentuh Bola ${safe.targetBallId} sambil menyembunyikan bola putih dari bidikan mudah lawan.`,
      };
    }
  }

  // Execute top Direct, Combo, or Bank shot
  if (topOffense) {
    let picked = topOffense.c;
    if (topOffense.kind === 'direct' && difficulty === 'club' && directCandidates.length > 1 && rng() < 0.35) {
      picked = directCandidates[1];
    }
    const jitter = (rng() - 0.5) * 2 * jitterRadius;
    const est = Math.max(25, Math.min(97, Math.round(42 + picked.score * 0.45)));

    if (topOffense.kind === 'combo' && picked.comboSecondBallId) {
      return {
        shot: {
          angle: picked.angle + jitter,
          power: picked.power,
          spinX: picked.spinX,
          spinY: picked.spinY,
        },
        targetBallId: picked.targetBallId,
        pocketId: picked.pocketId,
        shotType: 'combo',
        estimatedSuccess: est,
        reasonEn: `Combination shot clipping Ball ${picked.targetBallId} into Ball ${picked.comboSecondBallId} toward the ${pocketLabelEn(picked.pocketId)}.`,
        reasonId: `Tembakan kombinasi menyentuh Bola ${picked.targetBallId} untuk mendorong Bola ${picked.comboSecondBallId} ke ${pocketLabelId(picked.pocketId)}.`,
      };
    }

    if (topOffense.kind === 'bank') {
      return {
        shot: {
          angle: picked.angle + jitter,
          power: picked.power,
          spinX: picked.spinX,
          spinY: picked.spinY,
        },
        targetBallId: picked.targetBallId,
        pocketId: picked.pocketId,
        shotType: 'bank',
        estimatedSuccess: est,
        reasonEn: `One rail bank shot bouncing Ball ${picked.targetBallId} cleanly into the ${pocketLabelEn(picked.pocketId)}.`,
        reasonId: `Tembakan pantulan satu ban (bank shot) pada Bola ${picked.targetBallId} menuju ${pocketLabelId(picked.pocketId)}.`,
      };
    }

    return {
      shot: {
        angle: picked.angle + jitter,
        power: picked.power,
        spinX: picked.spinX,
        spinY: picked.spinY,
      },
      targetBallId: picked.targetBallId,
      pocketId: picked.pocketId,
      shotType: 'direct',
      estimatedSuccess: est,
      reasonEn: `Targeting Ball ${picked.targetBallId} into the ${pocketLabelEn(picked.pocketId)} ${picked.spinNoteEn || 'with steady cue control'}.`,
      reasonId: `Membidik Bola ${picked.targetBallId} ke ${pocketLabelId(picked.pocketId)} ${picked.spinNoteId || 'dengan kontrol bola putih presisi'}.`,
    };
  }

  // 3. Clean direct contact fallback or 1-rail kick escape
  const legalTargets = getLegalTargetBalls(balls, rules);
  let fallbackTarget: BallState | null = null;
  let bestDist = Infinity;

  for (const t of legalTargets) {
    const clear = isSegmentClear(balls, cue.x, cue.y, t.x, t.y, [0, t.id]);
    const dist = Math.hypot(t.x - cue.x, t.y - cue.y);
    if (clear && dist < bestDist) {
      bestDist = dist;
      fallbackTarget = t;
    }
  }

  if (fallbackTarget) {
    const angle =
      Math.atan2(fallbackTarget.y - cue.y, fallbackTarget.x - cue.x) +
      (rng() - 0.5) * jitterRadius;
    return {
      shot: { angle, power: 0.54, spinX: 0, spinY: 0 },
      targetBallId: fallbackTarget.id,
      pocketId: null,
      shotType: 'fallback',
      estimatedSuccess: 45,
      reasonEn: `Controlled legal hit on Ball ${fallbackTarget.id} to reach a rail safely without fouling.`,
      reasonId: `Menyentuh Bola ${fallbackTarget.id} secara terkontrol agar menyentuh ban tanpa pelanggaran.`,
    };
  }

  for (const t of legalTargets) {
    const kickAngle = evaluateKickEscapeAngle(balls, t, cue.x, cue.y);
    if (kickAngle !== null) {
      return {
        shot: {
          angle: kickAngle + (rng() - 0.5) * jitterRadius,
          power: 0.64,
          spinX: 0,
          spinY: 0,
        },
        targetBallId: t.id,
        pocketId: null,
        shotType: 'kick',
        estimatedSuccess: 52,
        reasonEn: `One rail kick escape off the cushion to reach legal Ball ${t.id} cleanly.`,
        reasonId: `Tembakan pantulan satu ban (kick shot) untuk menjangkau Bola ${t.id} yang tertutup.`,
      };
    }
  }

  if (legalTargets.length > 0) {
    const t = legalTargets[0];
    return {
      shot: {
        angle: Math.atan2(t.y - cue.y, t.x - cue.x),
        power: 0.56,
        spinX: 0,
        spinY: 0,
      },
      targetBallId: t.id,
      pocketId: null,
      shotType: 'fallback',
      estimatedSuccess: 28,
      reasonEn: `Attempting legal contact toward Ball ${t.id}.`,
      reasonId: `Berupaya menyentuh Bola ${t.id} yang sah.`,
    };
  }

  return {
    shot: { angle: 0, power: 0.55, spinX: 0, spinY: 0 },
    targetBallId: null,
    pocketId: null,
    shotType: 'fallback',
    estimatedSuccess: 20,
    reasonEn: 'Playing a neutral safety stroke.',
    reasonId: 'Memainkan sodokan netral yang aman.',
  };
}

export function computeAiShot(
  balls: BallState[],
  rules: MatchRulesState,
  difficulty: AiDifficulty = 'pro',
  rng: () => number = Math.random,
): ShotInput {
  return computeAiShotPlan(balls, rules, difficulty, rng).shot;
}
