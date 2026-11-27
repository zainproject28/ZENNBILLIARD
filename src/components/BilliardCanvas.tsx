import React, { useEffect, useRef, useState } from 'react';
import {
  BALL_COLORS,
  BALL_RADIUS,
  getCueStats,
  HEADSTRING_X,
  POCKETS,
  SHOP_CATALOG,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '../game/constants.ts';
import { computeAimPrediction, isValidCueBallPlacement } from '../game/physics.ts';
import type { BallState, BallSuit, GameVariant, PhysicsEvent, UserSettings } from '../game/types.ts';

const RAIL_PAD = 64;
const LOGICAL_W = TABLE_WIDTH + RAIL_PAD * 2;
const LOGICAL_H = TABLE_HEIGHT + RAIL_PAD * 2;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface BilliardCanvasProps {
  ballsRef: React.MutableRefObject<BallState[]>;
  pendingEventsRef: React.MutableRefObject<PhysicsEvent[]>;
  aimAngle: number;
  onAimChange: (angle: number) => void;
  power: number;
  spinX: number;
  spinY: number;
  canShoot: boolean;
  isSimulating: boolean;
  ballInHand: boolean;
  headstringOnly: boolean;
  currentGroup: BallSuit;
  isBreakShot: boolean;
  gameVariant?: GameVariant;
  targetBallNumber?: number | null;
  showAiAimGuide?: boolean;
  aiTargetBallId?: number | null;
  isBotTurn?: boolean;
  equippedCueId: string;
  equippedTableId: string;
  equippedEffectId: string;
  settings: UserSettings;
  onPlaceCueBall: (x: number, y: number) => void;
  strikeFlashRef: React.MutableRefObject<number>;
  currentTurnLabel: string;
  phaseLabel: string;
  pocketedObjectBalls?: number[];
}

export const BilliardCanvas: React.FC<BilliardCanvasProps> = ({
  ballsRef,
  pendingEventsRef,
  aimAngle,
  onAimChange,
  power,
  spinX,
  spinY,
  canShoot,
  isSimulating,
  ballInHand,
  headstringOnly,
  currentGroup,
  isBreakShot,
  gameVariant = '8ball',
  targetBallNumber = null,
  showAiAimGuide = false,
  aiTargetBallId = null,
  isBotTurn = false,
  equippedCueId,
  equippedTableId,
  equippedEffectId,
  settings,
  onPlaceCueBall,
  strikeFlashRef,
  currentTurnLabel,
  phaseLabel,
  pocketedObjectBalls = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chuteRef = useRef<HTMLDivElement>(null);
  const feltPatternRef = useRef<CanvasPattern | null>(null);
  const feltPatternTableIdRef = useRef<string>('');
  const tableCacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tableCacheKeyRef = useRef<string>('');
  const lastRenderSigRef = useRef<string>('');
  const kickRenderRef = useRef<() => void>(() => {});
  const prevPocketedRef = useRef<number[]>([]);
  const [recentReturnedBalls, setRecentReturnedBalls] = useState<number[]>([]);

  const propsRef = useRef({
    aimAngle,
    power,
    spinX,
    spinY,
    canShoot,
    isSimulating,
    ballInHand,
    headstringOnly,
    currentGroup,
    isBreakShot,
    gameVariant,
    targetBallNumber,
    showAiAimGuide,
    aiTargetBallId,
    isBotTurn,
    equippedCueId,
    equippedTableId,
    equippedEffectId,
    settings,
    onAimChange,
    onPlaceCueBall,
  });
  propsRef.current = {
    aimAngle,
    power,
    spinX,
    spinY,
    canShoot,
    isSimulating,
    ballInHand,
    headstringOnly,
    currentGroup,
    isBreakShot,
    gameVariant,
    targetBallNumber,
    showAiAimGuide,
    aiTargetBallId,
    isBotTurn,
    equippedCueId,
    equippedTableId,
    equippedEffectId,
    settings,
    onAimChange,
    onPlaceCueBall,
  };

  // Pooled zero-GC particle ring buffer
  const particlesRef = useRef<Particle[]>(
    Array.from({ length: 140 }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.4,
      size: 2,
      color: '#ffffff',
    })),
  );
  const particleCursorRef = useRef(0);

  // Smooth non-jumping pointer drag state
  const dragStateRef = useRef<{
    mode: 'none' | 'aim' | 'place_cue';
    pointerId: number | null;
    lastAngle: number;
    startClientX: number;
    startClientY: number;
    movedDist: number;
    cueCandidateX: number;
    cueCandidateY: number;
    cueCandidateValid: boolean;
  }>({
    mode: 'none',
    pointerId: null,
    lastAngle: 0,
    startClientX: 0,
    startClientY: 0,
    movedDist: 0,
    cueCandidateX: HEADSTRING_X - 40,
    cueCandidateY: TABLE_HEIGHT / 2,
    cueCandidateValid: true,
  });

  const screenToTable = (clientX: number, clientY: number): { tx: number; ty: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { tx: TABLE_WIDTH / 2, ty: TABLE_HEIGHT / 2 };
    const rect = canvas.getBoundingClientRect();
    const lx = ((clientX - rect.left) / Math.max(1, rect.width)) * LOGICAL_W;
    const ly = ((clientY - rect.top) / Math.max(1, rect.height)) * LOGICAL_H;
    return { tx: lx - RAIL_PAD, ty: ly - RAIL_PAD };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (!p.canShoot || p.isSimulating) return;
    if (dragStateRef.current.pointerId !== null) return;

    const { tx, ty } = screenToTable(e.clientX, e.clientY);
    const cue = ballsRef.current.find((b) => b.id === 0);
    if (!cue) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    const distToCue = Math.hypot(tx - cue.x, ty - cue.y);

    if (p.ballInHand && distToCue <= BALL_RADIUS * 3.2) {
      dragStateRef.current = {
        mode: 'place_cue',
        pointerId: e.pointerId,
        lastAngle: p.aimAngle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        movedDist: 0,
        cueCandidateX: cue.x,
        cueCandidateY: cue.y,
        cueCandidateValid: true,
      };
    } else {
      const startPointerAngle = Math.atan2(ty - cue.y, tx - cue.x);
      dragStateRef.current = {
        mode: 'aim',
        pointerId: e.pointerId,
        lastAngle: startPointerAngle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        movedDist: 0,
        cueCandidateX: cue.x,
        cueCandidateY: cue.y,
        cueCandidateValid: true,
      };
    }
    kickRenderRef.current();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = dragStateRef.current;
    if (ds.mode === 'none' || ds.pointerId !== e.pointerId) return;

    const p = propsRef.current;
    const { tx, ty } = screenToTable(e.clientX, e.clientY);
    const cue = ballsRef.current.find((b) => b.id === 0);
    if (!cue) return;

    ds.movedDist = Math.max(
      ds.movedDist,
      Math.hypot(e.clientX - ds.startClientX, e.clientY - ds.startClientY),
    );

    if (ds.mode === 'place_cue') {
      const maxX = p.headstringOnly ? HEADSTRING_X : TABLE_WIDTH - BALL_RADIUS - 2;
      const cx = Math.max(BALL_RADIUS + 2, Math.min(maxX, tx));
      const cy = Math.max(BALL_RADIUS + 2, Math.min(TABLE_HEIGHT - BALL_RADIUS - 2, ty));
      const valid = isValidCueBallPlacement(ballsRef.current, cx, cy, p.headstringOnly);
      ds.cueCandidateX = cx;
      ds.cueCandidateY = cy;
      ds.cueCandidateValid = valid;
      if (valid) {
        cue.x = cx;
        cue.y = cy;
      }
    } else if (ds.mode === 'aim') {
      const nextPointerAngle = Math.atan2(ty - cue.y, tx - cue.x);
      let delta = nextPointerAngle - ds.lastAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ds.lastAngle = nextPointerAngle;

      // Radius-leverage precision rotation (farther pointer drag = smoother precision; Shift = 0.20x micro-aim)
      const distFromCue = Math.hypot(tx - cue.x, ty - cue.y);
      const radiusFactor = distFromCue > 220 ? 0.62 : 0.82;
      const sens = Math.max(0.3, Math.min(2.2, p.settings.sensitivity));
      const fineFactor = e.shiftKey ? 0.2 : radiusFactor;
      p.onAimChange(p.aimAngle + delta * sens * fineFactor);
    }
    kickRenderRef.current();
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (!p.canShoot || p.isSimulating) return;
    const sens = Math.max(0.3, Math.min(2.2, p.settings.sensitivity));
    const step = (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 0.0012 : 0.0032) * sens;
    p.onAimChange(p.aimAngle + step);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = dragStateRef.current;
    if (ds.pointerId !== e.pointerId) return;

    const p = propsRef.current;
    if (ds.mode === 'place_cue') {
      const cue = ballsRef.current.find((b) => b.id === 0);
      if (cue) {
        p.onPlaceCueBall(cue.x, cue.y);
      }
    } else if (ds.mode === 'aim' && ds.movedDist < 6) {
      // Quick stationary tap aims directly toward the tapped spot
      const { tx, ty } = screenToTable(e.clientX, e.clientY);
      const cue = ballsRef.current.find((b) => b.id === 0);
      if (cue && Math.hypot(tx - cue.x, ty - cue.y) > BALL_RADIUS * 1.8) {
        p.onAimChange(Math.atan2(ty - cue.y, tx - cue.x));
      }
    }

    dragStateRef.current.mode = 'none';
    dragStateRef.current.pointerId = null;
    kickRenderRef.current();
  };

  // ResizeObserver for crisp DPR sizing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const cw = container.clientWidth;
      const isWide = cw >= 520;
      const reserveRight = isWide ? 36 : 0;
      const reserveBottom = isWide ? 2 : 24;
      const availW = Math.max(160, cw - reserveRight);
      const ch = Math.max(120, container.clientHeight - reserveBottom);
      if (availW <= 0 || ch <= 0) return;
      const aspect = LOGICAL_W / LOGICAL_H;
      let drawW = availW;
      let drawH = availW / aspect;
      if (drawH > ch) {
        drawH = ch;
        drawW = ch * aspect;
      }
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        propsRef.current.settings.graphicsQuality === 'low' ? 1 : 2,
      );
      const nextW = Math.max(1, Math.floor(drawW * dpr));
      const nextH = Math.max(1, Math.floor(drawH * dpr));
      const nextStyleW = `${Math.floor(drawW)}px`;
      const nextStyleH = `${Math.floor(drawH)}px`;
      if (canvas.style.width !== nextStyleW) canvas.style.width = nextStyleW;
      if (canvas.style.height !== nextStyleH) canvas.style.height = nextStyleH;
      if (chuteRef.current) {
        if (isWide) {
          chuteRef.current.style.width = '';
          chuteRef.current.style.height = `${Math.max(140, Math.floor(drawH * 0.8))}px`;
        } else {
          chuteRef.current.style.height = '';
          chuteRef.current.style.width = `${Math.min(Math.floor(drawW - 8), Math.max(150, Math.floor(drawW * 0.76)))}px`;
        }
      }
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
        lastRenderSigRef.current = '';
      }
      kickRenderRef.current();
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Main 60fps Canvas Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const spawnBurst = (x: number, y: number, count: number, color: string, speedScale = 1) => {
      const pool = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const pt = pool[particleCursorRef.current];
        particleCursorRef.current = (particleCursorRef.current + 1) % pool.length;
        const a = Math.random() * Math.PI * 2;
        const sp = (25 + Math.random() * 95) * speedScale;
        pt.active = true;
        pt.x = x;
        pt.y = y;
        pt.vx = Math.cos(a) * sp;
        pt.vy = Math.sin(a) * sp;
        pt.life = 0;
        pt.maxLife = 0.25 + Math.random() * 0.25;
        pt.size = 1.6 + Math.random() * 2.4;
        pt.color = color;
      }
    };

    const getFeltPattern = (ctx: CanvasRenderingContext2D, tableId: string, baseColor: string) => {
      if (feltPatternRef.current && feltPatternTableIdRef.current === tableId) {
        return feltPatternRef.current;
      }
      const tile = document.createElement('canvas');
      tile.width = 48;
      tile.height = 48;
      const tctx = tile.getContext('2d');
      if (tctx) {
        tctx.fillStyle = baseColor;
        tctx.fillRect(0, 0, 48, 48);
        for (let y = 0; y < 48; y += 2) {
          for (let x = 0; x < 48; x += 2) {
            const noise = ((x * 37 + y * 17) % 13) - 6;
            tctx.fillStyle = noise > 0 ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.028)';
            tctx.fillRect(x, y, 1, 1);
          }
        }
        feltPatternRef.current = ctx.createPattern(tile, 'repeat');
        feltPatternTableIdRef.current = tableId;
      }
      return feltPatternRef.current;
    };

    const render = (now: number) => {
      rafId = 0;
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const wantHdr = propsRef.current.settings.graphicsQuality === 'high';
      let ctx: CanvasRenderingContext2D | null = null;
      if (wantHdr) {
        try {
          ctx = canvas.getContext('2d', { colorSpace: 'display-p3' } as CanvasRenderingContext2DSettings);
        } catch {
          ctx = null;
        }
      }
      if (!ctx) {
        ctx = canvas.getContext('2d');
      }
      if (!ctx) return;

      const p = propsRef.current;
      const tableItem =
        SHOP_CATALOG.find((i) => i.id === p.equippedTableId) ||
        SHOP_CATALOG.find((i) => i.id === 'table_tournament_blue')!;
      const cueItem = SHOP_CATALOG.find((i) => i.id === p.equippedCueId) || SHOP_CATALOG[0];
      const effectItem =
        SHOP_CATALOG.find((i) => i.id === p.equippedEffectId) ||
        SHOP_CATALOG.find((i) => i.id === 'effect_classic')!;
      const highQuality = p.settings.graphicsQuality !== 'low';

      let ballHash = 0;
      let hasPocketAnim = false;
      for (const b of ballsRef.current) {
        ballHash += b.x * 1.13 + b.y * 2.71 + (b.pocketed ? 777 : 0);
        if (b.pocketed && b.pocketAnimProgress < 1) {
          hasPocketAnim = true;
        }
      }
      const hasParticles = particlesRef.current.some((pt) => pt.active);
      const hasPending = pendingEventsRef.current.length > 0;
      const isIdle =
        !p.isSimulating &&
        !hasParticles &&
        !hasPending &&
        !hasPocketAnim &&
        strikeFlashRef.current === 0 &&
        dragStateRef.current.mode === 'none';
      const sig = `${canvas.width}x${canvas.height}|${tableItem.id}|${cueItem.id}|${effectItem.id}|${p.settings.graphicsQuality}|${p.settings.aimGuide || 'pro'}|${p.aimAngle.toFixed(4)}|${p.power.toFixed(3)}|${p.spinX.toFixed(2)}|${p.spinY.toFixed(2)}|${p.canShoot}|${p.showAiAimGuide}|${p.aiTargetBallId}|${p.isBotTurn}|${p.ballInHand}|${p.headstringOnly}|${p.currentGroup}|${p.isBreakShot}|${p.gameVariant}|${p.targetBallNumber}|${ballHash.toFixed(2)}|${dragStateRef.current.mode}`;

      if (isIdle && sig === lastRenderSigRef.current) {
        return;
      }
      lastRenderSigRef.current = isIdle ? sig : '';

      while (pendingEventsRef.current.length > 0) {
        const ev = pendingEventsRef.current.shift()!;
        if (ev.type === 'cue') {
          spawnBurst(ev.x, ev.y, 12, effectItem.accentColor, 0.95);
        } else if (ev.type === 'ball' && ev.intensity > 0.35) {
          spawnBurst(ev.x, ev.y, 9, effectItem.primaryColor, ev.intensity);
        } else if (ev.type === 'pocket') {
          spawnBurst(ev.x, ev.y, 16, '#fbbf24', 1.2);
        }
      }

      if (strikeFlashRef.current > 0) {
        strikeFlashRef.current = Math.max(0, strikeFlashRef.current - dt * 5.2);
      }

      const scaleX = canvas.width / LOGICAL_W;
      const scaleY = canvas.height / LOGICAL_H;

      // Static Luxury Table Cabinet Cache
      const tableKey = `${canvas.width}x${canvas.height}|${tableItem.id}|${highQuality}`;
      if (!tableCacheCanvasRef.current) {
        tableCacheCanvasRef.current = document.createElement('canvas');
      }
      const cacheCanvas = tableCacheCanvasRef.current;
      if (
        tableCacheKeyRef.current !== tableKey ||
        cacheCanvas.width !== canvas.width ||
        cacheCanvas.height !== canvas.height
      ) {
        cacheCanvas.width = canvas.width;
        cacheCanvas.height = canvas.height;
        const cctx = cacheCanvas.getContext('2d');
        if (cctx) {
          cctx.save();
          cctx.scale(scaleX, scaleY);
          cctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

          const railTone = tableItem.tableMeta?.railTone || tableItem.secondaryColor;
          const feltGlow = tableItem.tableMeta?.feltGlow || tableItem.primaryColor;
          const trimTone = tableItem.tableMeta?.trimTone || '#f8fafc';
          const tableTexture = tableItem.tableMeta?.texture || 'felt';
          const isLightSurface = tableTexture === 'marble';

          // 1. Sculpted Polished Wood/Ebony/Marble/Crystal Cabinet Outer Frame
          const outerGrad = cctx.createLinearGradient(0, 0, LOGICAL_W, LOGICAL_H);
          outerGrad.addColorStop(0, tableItem.secondaryColor);
          outerGrad.addColorStop(0.32, railTone);
          outerGrad.addColorStop(0.68, railTone);
          outerGrad.addColorStop(1, tableItem.secondaryColor);
          cctx.fillStyle = outerGrad;
          cctx.beginPath();
          cctx.roundRect(4, 4, LOGICAL_W - 8, LOGICAL_H - 8, 32);
          cctx.fill();

          // Bespoke rail texture details (Walnut burl / Marble veining / Crystal facets / Obsidian trim)
          cctx.save();
          cctx.beginPath();
          cctx.roundRect(4, 4, LOGICAL_W - 8, LOGICAL_H - 8, 32);
          cctx.clip();
          if (tableTexture === 'walnut') {
            cctx.strokeStyle = 'rgba(26, 10, 4, 0.34)';
            cctx.lineWidth = 2;
            for (let gx = -120; gx < LOGICAL_W + 120; gx += 28) {
              cctx.beginPath();
              cctx.moveTo(gx, 0);
              cctx.bezierCurveTo(gx + 34, LOGICAL_H * 0.3, gx - 24, LOGICAL_H * 0.7, gx + 18, LOGICAL_H);
              cctx.stroke();
            }
          } else if (tableTexture === 'marble') {
            cctx.strokeStyle = 'rgba(100, 116, 139, 0.24)';
            cctx.lineWidth = 1.6;
            for (let mx = 0; mx < LOGICAL_W; mx += 110) {
              cctx.beginPath();
              cctx.moveTo(mx, 0);
              cctx.quadraticCurveTo(mx + 45, LOGICAL_H * 0.45, mx - 16, LOGICAL_H);
              cctx.stroke();
            }
          } else if (tableTexture === 'crystal') {
            const crystalSheen = cctx.createLinearGradient(0, 0, LOGICAL_W, 0);
            crystalSheen.addColorStop(0, 'rgba(103, 232, 249, 0.05)');
            crystalSheen.addColorStop(0.5, 'rgba(236, 254, 255, 0.16)');
            crystalSheen.addColorStop(1, 'rgba(103, 232, 249, 0.05)');
            cctx.fillStyle = crystalSheen;
            cctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
          }
          cctx.restore();

          // Specular outer bezel line
          cctx.strokeStyle =
            tableTexture === 'obsidian'
              ? 'rgba(245, 158, 11, 0.42)'
              : isLightSurface
                ? 'rgba(15, 23, 42, 0.22)'
                : 'rgba(255,255,255,0.18)';
          cctx.lineWidth = 2;
          cctx.beginPath();
          cctx.roundRect(6, 6, LOGICAL_W - 12, LOGICAL_H - 12, 30);
          cctx.stroke();

          // Ornate Sculpted Corner & Side Metallic Plates (Chrome/Gold tournament finish)
          const drawCornerPlate = (x: number, y: number, w: number, h: number, r: number) => {
            const g = cctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, trimTone);
            g.addColorStop(0.35, tableItem.accentColor);
            g.addColorStop(0.75, '#64748b');
            g.addColorStop(1, '#1e293b');
            cctx.fillStyle = g;
            cctx.beginPath();
            cctx.roundRect(x, y, w, h, r);
            cctx.fill();

            cctx.strokeStyle = 'rgba(255,255,255,0.45)';
            cctx.lineWidth = 1.2;
            cctx.stroke();
          };
          drawCornerPlate(4, 4, 72, 72, 26);
          drawCornerPlate(LOGICAL_W - 76, 4, 72, 72, 26);
          drawCornerPlate(4, LOGICAL_H - 76, 72, 72, 26);
          drawCornerPlate(LOGICAL_W - 76, LOGICAL_H - 76, 72, 72, 26);
          drawCornerPlate(LOGICAL_W / 2 - 34, 4, 68, 28, 8);
          drawCornerPlate(LOGICAL_W / 2 - 34, LOGICAL_H - 32, 68, 28, 8);

          // Inner dark cushion trim rim
          cctx.fillStyle = isLightSurface ? '#64748b' : '#0b1630';
          cctx.beginPath();
          cctx.roundRect(RAIL_PAD - 15, RAIL_PAD - 15, TABLE_WIDTH + 30, TABLE_HEIGHT + 30, 14);
          cctx.fill();

          if (tableTexture === 'obsidian' || tableTexture === 'emerald') {
            cctx.strokeStyle = tableTexture === 'obsidian' ? 'rgba(251, 191, 36, 0.35)' : 'rgba(250, 204, 21, 0.28)';
            cctx.lineWidth = 1.2;
            cctx.beginPath();
            cctx.roundRect(RAIL_PAD - 12, RAIL_PAD - 12, TABLE_WIDTH + 24, TABLE_HEIGHT + 24, 12);
            cctx.stroke();
          }

          // 2. Playing Surface (Tournament Worsted Felt with HDR Overhead Studio Bloom)
          cctx.save();
          cctx.translate(RAIL_PAD, RAIL_PAD);
          const pattern = highQuality
            ? getFeltPattern(cctx, tableItem.id, tableItem.primaryColor)
            : null;
          cctx.fillStyle = pattern || tableItem.primaryColor;
          cctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

          const bloomStrength = p.settings.graphicsQuality === 'high' ? 0.62 : highQuality ? 0.48 : 0.25;
          const glowLight = cctx.createRadialGradient(
            TABLE_WIDTH * 0.5,
            TABLE_HEIGHT * 0.48,
            36,
            TABLE_WIDTH * 0.5,
            TABLE_HEIGHT * 0.5,
            TABLE_WIDTH * 0.72,
          );
          glowLight.addColorStop(0, feltGlow);
          glowLight.addColorStop(0.5, 'rgba(255,255,255,0.06)');
          glowLight.addColorStop(0.75, 'rgba(0,0,0,0)');
          glowLight.addColorStop(1, isLightSurface ? 'rgba(15,23,42,0.18)' : 'rgba(0,0,0,0.36)');
          cctx.globalAlpha = bloomStrength;
          cctx.fillStyle = glowLight;
          cctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
          cctx.globalAlpha = 1;

          // Inner cushion bevel shadow
          cctx.strokeStyle = isLightSurface ? 'rgba(15,23,42,0.34)' : 'rgba(0,0,0,0.5)';
          cctx.lineWidth = 9;
          cctx.strokeRect(-4, -4, TABLE_WIDTH + 8, TABLE_HEIGHT + 8);

          // Baulk / Headstring line & Foot spot
          cctx.strokeStyle = isLightSurface ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.22)';
          cctx.lineWidth = 1.5;
          cctx.beginPath();
          cctx.moveTo(HEADSTRING_X, 0);
          cctx.lineTo(HEADSTRING_X, TABLE_HEIGHT);
          cctx.stroke();

          cctx.fillStyle = isLightSurface ? 'rgba(15,23,42,0.34)' : 'rgba(255,255,255,0.26)';
          cctx.beginPath();
          cctx.arc(735, TABLE_HEIGHT / 2, 4, 0, Math.PI * 2);
          cctx.fill();

          // 3. Six Recessed Leather Pockets
          for (const pocket of POCKETS) {
            cctx.fillStyle = '#18100c';
            cctx.beginPath();
            cctx.arc(pocket.x, pocket.y, pocket.radius + 6, 0, Math.PI * 2);
            cctx.fill();

            const wellGrad = cctx.createRadialGradient(
              pocket.x,
              pocket.y,
              4,
              pocket.x,
              pocket.y,
              pocket.radius,
            );
            wellGrad.addColorStop(0, '#030712');
            wellGrad.addColorStop(0.75, '#0b1224');
            wellGrad.addColorStop(1, '#1e293b');
            cctx.fillStyle = wellGrad;
            cctx.beginPath();
            cctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
            cctx.fill();
          }

          // 4. Diamond Rail Sights on outer wood frame
          const drawDiamond = (cx: number, cy: number) => {
            cctx.save();
            cctx.translate(cx, cy);
            cctx.fillStyle = tableItem.accentColor;
            cctx.beginPath();
            cctx.moveTo(0, -5);
            cctx.lineTo(5, 0);
            cctx.lineTo(0, 5);
            cctx.lineTo(-5, 0);
            cctx.closePath();
            cctx.fill();
            cctx.strokeStyle = 'rgba(255,255,255,0.35)';
            cctx.lineWidth = 0.8;
            cctx.stroke();
            cctx.restore();
          };
          const sightXs = [125, 250, 375, 625, 750, 875];
          for (const sx of sightXs) {
            drawDiamond(sx, -32);
            drawDiamond(sx, TABLE_HEIGHT + 32);
          }
          const sightYs = [125, 250, 375];
          for (const sy of sightYs) {
            drawDiamond(-32, sy);
            drawDiamond(TABLE_WIDTH + 32, sy);
          }

          cctx.restore();
          cctx.restore();
          tableCacheKeyRef.current = tableKey;
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cacheCanvas, 0, 0);

      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.save();
      ctx.translate(RAIL_PAD, RAIL_PAD);

      // Highlight kitchen zone during headstring ball-in-hand
      if (p.canShoot && p.ballInHand && p.headstringOnly && !p.isSimulating) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(0, 0, HEADSTRING_X, TABLE_HEIGHT);
      }

      // 5. Render 16 Physics Balls
      const balls = ballsRef.current;
      for (const ball of balls) {
        if (ball.pocketed && ball.pocketAnimProgress >= 1) continue;

        const shrink = ball.pocketed ? Math.max(0.1, 1 - ball.pocketAnimProgress * 0.85) : 1;
        const alpha = ball.pocketed ? Math.max(0, 1 - ball.pocketAnimProgress) : 1;
        const r = BALL_RADIUS * shrink;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(ball.x, ball.y);

        if (!ball.pocketed) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.beginPath();
          ctx.arc(3.4, 4.4, r * 1.03, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();

        const colorInfo = BALL_COLORS[ball.number] || { base: '#f8fafc', label: '' };

        if (ball.group === 'stripe') {
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(-r, -r, r * 2, r * 2);

          const stripeAngle = Math.atan2(ball.rollDirY, ball.rollDirX);
          ctx.save();
          ctx.rotate(stripeAngle);
          ctx.fillStyle = colorInfo.base;
          const shift = Math.sin(ball.rollPhase) * r * 0.22;
          ctx.fillRect(-r, -r * 0.56 + shift, r * 2, r * 1.12);
          ctx.restore();
        } else {
          ctx.fillStyle = colorInfo.base;
          ctx.fillRect(-r, -r, r * 2, r * 2);
        }

        if (ball.number > 0) {
          const offsetX = Math.cos(ball.rollPhase) * ball.rollDirX * r * 0.18;
          const offsetY = Math.cos(ball.rollPhase) * ball.rollDirY * r * 0.18;

          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(offsetX, offsetY, r * 0.45, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.font = `700 ${Math.max(8, Math.round(r * 0.62))}px "JetBrains Mono", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(ball.number), offsetX, offsetY + 0.5);
        } else if (Math.abs(p.spinX) > 0.05 || Math.abs(p.spinY) > 0.05) {
          if (!p.isSimulating) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.88)';
            ctx.beginPath();
            ctx.arc(p.spinX * r * 0.45, -p.spinY * r * 0.45, r * 0.19, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        const shade = ctx.createRadialGradient(-r * 0.36, -r * 0.36, r * 0.08, 0, 0, r);
        shade.addColorStop(0, 'rgba(255,255,255,0.68)');
        shade.addColorStop(0.22, 'rgba(255,255,255,0.16)');
        shade.addColorStop(0.74, 'rgba(0,0,0,0.06)');
        shade.addColorStop(1, 'rgba(0,0,0,0.44)');
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        if (highQuality && !ball.pocketed) {
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.beginPath();
          ctx.ellipse(-r * 0.34, -r * 0.36, r * 0.22, r * 0.14, -Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      // Highlight 9-Ball legal lowest object ball subtly when stationary
      if (p.gameVariant === '9ball' && p.targetBallNumber && !p.isSimulating) {
        const lowestBall = balls.find((b) => !b.pocketed && b.number === p.targetBallNumber);
        if (lowestBall) {
          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(lowestBall.x, lowestBall.y, BALL_RADIUS + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 6. Ball-in-Hand Halo Indicator
      const cue = balls.find((b) => b.id === 0);
      if (cue && !cue.pocketed && p.canShoot && p.ballInHand && !p.isSimulating) {
        const ds = dragStateRef.current;
        const valid = ds.mode === 'place_cue' ? ds.cueCandidateValid : true;
        ctx.save();
        ctx.strokeStyle = valid ? '#38bdf8' : '#f87171';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cue.x, cue.y, BALL_RADIUS + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Highlight AI planned target object ball subtly during AI aiming preview
      if (p.showAiAimGuide && p.aiTargetBallId && !p.isSimulating) {
        const aiTarget = balls.find((b) => !b.pocketed && b.id === p.aiTargetBallId);
        if (aiTarget) {
          ctx.save();
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.92)';
          ctx.lineWidth = 2.6;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.arc(aiTarget.x, aiTarget.y, BALL_RADIUS + 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 7. Crisp Aiming Sight Lines & Full-Length Luxury Cue Stick
      if (cue && !cue.pocketed && !p.isSimulating && (p.canShoot || p.showAiAimGuide || p.power > 0)) {
        const cueStats = getCueStats(p.equippedCueId);
        const isProGuide = (p.settings.aimGuide || 'pro') === 'pro';
        const targetGuideLen = isProGuide
          ? 105 + (cueStats.aim / 100) * 165
          : 48 + (cueStats.aim / 100) * 55;
        const deflectGuideLen = isProGuide
          ? 52 + (cueStats.aim / 100) * 80
          : 26 + (cueStats.aim / 100) * 32;

        const pred = computeAimPrediction(
          balls,
          p.aimAngle,
          p.spinY,
          p.currentGroup,
          p.isBreakShot,
          p.gameVariant,
        );

        const lineColor = pred.isLegalTarget ? '#ffffff' : '#f87171';

        ctx.save();
        // Subtle dark outer halo under sight line for crystal clarity on any felt color
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.lineWidth = 4.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(pred.ghostX, pred.ghostY);
        ctx.stroke();

        // Primary bright aiming line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(pred.ghostX, pred.ghostY);
        ctx.stroke();

        // Side-english swerve preview arc when spinX is dialed in
        if (isProGuide && Math.abs(p.spinX) > 0.12) {
          const midX = (cue.x + pred.ghostX) * 0.5;
          const midY = (cue.y + pred.ghostY) * 0.5;
          const perpX = -Math.sin(p.aimAngle);
          const perpY = Math.cos(p.aimAngle);
          const curveAmt = p.spinX * 16;
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cue.x, cue.y);
          ctx.quadraticCurveTo(midX + perpX * curveAmt, midY + perpY * curveAmt, pred.ghostX, pred.ghostY);
          ctx.stroke();
          ctx.restore();
        }

        // Ghost ball ring at exact impact point
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pred.ghostX, pred.ghostY, BALL_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pred.ghostX, pred.ghostY, BALL_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        if (!pred.isLegalTarget && pred.hitType === 'ball') {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(pred.ghostX - 5.5, pred.ghostY - 5.5);
          ctx.lineTo(pred.ghostX + 5.5, pred.ghostY + 5.5);
          ctx.moveTo(pred.ghostX + 5.5, pred.ghostY - 5.5);
          ctx.lineTo(pred.ghostX - 5.5, pred.ghostY + 5.5);
          ctx.stroke();
        } else {
          // Center precision dot inside ghost circle
          ctx.fillStyle = lineColor;
          ctx.beginPath();
          ctx.arc(pred.ghostX, pred.ghostY, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Target ball outgoing trajectory & cue ball deflection/bounce
        if (pred.hitType === 'ball' && pred.targetBallId !== null) {
          const hitBall = balls.find((b) => b.id === pred.targetBallId);
          if (hitBall) {
            ctx.strokeStyle = 'rgba(0,0,0,0.38)';
            ctx.lineWidth = 4.5;
            ctx.beginPath();
            ctx.moveTo(hitBall.x, hitBall.y);
            ctx.lineTo(
              hitBall.x + pred.targetDirX * targetGuideLen,
              hitBall.y + pred.targetDirY * targetGuideLen,
            );
            ctx.stroke();

            ctx.strokeStyle = pred.isLegalTarget ? '#fde047' : 'rgba(248, 113, 113, 0.72)';
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(hitBall.x, hitBall.y);
            ctx.lineTo(
              hitBall.x + pred.targetDirX * targetGuideLen,
              hitBall.y + pred.targetDirY * targetGuideLen,
            );
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(pred.ghostX, pred.ghostY);
            ctx.lineTo(
              pred.ghostX + pred.cueDeflectX * deflectGuideLen,
              pred.ghostY + pred.cueDeflectY * deflectGuideLen,
            );
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(pred.ghostX, pred.ghostY);
          ctx.lineTo(
            pred.ghostX + pred.bounceDirX * (deflectGuideLen + 20),
            pred.ghostY + pred.bounceDirY * (deflectGuideLen + 20),
          );
          ctx.stroke();
        }
        ctx.restore();

        // Full-Length Tournament Cue Stick (580px realistic proportional cue)
        const pullback = p.power * 145 - strikeFlashRef.current * 28;
        const tipDist = BALL_RADIUS + 11 + Math.max(-5, pullback);
        const cueLength = 580;
        const shaftEnd = 310;

        ctx.save();
        ctx.translate(cue.x, cue.y);
        ctx.rotate(p.aimAngle + Math.PI);

        // Soft cast shadow on felt
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.moveTo(tipDist, 3.5);
        ctx.lineTo(tipDist + cueLength, 8);
        ctx.lineTo(tipDist + cueLength, 13.5);
        ctx.lineTo(tipDist, 7);
        ctx.closePath();
        ctx.fill();

        // Blue Chalk Tip
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.roundRect(tipDist, -2.3, 5, 4.6, 1.5);
        ctx.fill();

        // Ivory Ferrule
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(tipDist + 5, -2.5, 11, 5.0);

        // Tapered Shaft (Maple / Carbon / Gold finish)
        const shaftGrad = ctx.createLinearGradient(tipDist + 16, -4, tipDist + 16, 4);
        shaftGrad.addColorStop(0, cueItem.primaryColor);
        shaftGrad.addColorStop(0.35, '#ffffff66');
        shaftGrad.addColorStop(0.55, cueItem.primaryColor);
        shaftGrad.addColorStop(1, '#00000055');
        ctx.fillStyle = cueItem.primaryColor;
        ctx.beginPath();
        ctx.moveTo(tipDist + 16, -2.5);
        ctx.lineTo(tipDist + shaftEnd, -4.4);
        ctx.lineTo(tipDist + shaftEnd, 4.4);
        ctx.lineTo(tipDist + 16, 2.5);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = shaftGrad;
        ctx.fill();

        // Joint Collar & Inlay Rings
        ctx.fillStyle = cueItem.accentColor;
        ctx.fillRect(tipDist + shaftEnd - 3, -4.6, 9, 9.2);

        // Tapered Butt / Handle
        const buttGrad = ctx.createLinearGradient(tipDist + shaftEnd + 6, -6, tipDist + shaftEnd + 6, 6);
        buttGrad.addColorStop(0, cueItem.secondaryColor);
        buttGrad.addColorStop(0.32, 'rgba(255,255,255,0.22)');
        buttGrad.addColorStop(0.6, cueItem.secondaryColor);
        buttGrad.addColorStop(1, '#020617');

        ctx.fillStyle = cueItem.secondaryColor;
        ctx.beginPath();
        ctx.moveTo(tipDist + shaftEnd + 6, -4.4);
        ctx.lineTo(tipDist + cueLength, -6.5);
        ctx.lineTo(tipDist + cueLength, 6.5);
        ctx.lineTo(tipDist + shaftEnd + 6, 4.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = buttGrad;
        ctx.fill();

        // Wrap Grip Section + Decorative Gold/Accent Inlay Bands
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.moveTo(tipDist + shaftEnd + 42, -4.9);
        ctx.lineTo(tipDist + shaftEnd + 165, -5.8);
        ctx.lineTo(tipDist + shaftEnd + 165, 5.8);
        ctx.lineTo(tipDist + shaftEnd + 42, 4.9);
        ctx.closePath();
        ctx.fill();

        // Cue-specific grip ring & inlay pattern
        if (cueItem.id === 'cue_emerald_elite' || cueItem.id === 'cue_royal_gold' || cueItem.id === 'cue_sapphire_luxe') {
          ctx.fillStyle = cueItem.accentColor;
          for (let d = 0; d < 3; d++) {
            const dx = tipDist + shaftEnd + 185 + d * 22;
            ctx.beginPath();
            ctx.moveTo(dx, -2.5);
            ctx.lineTo(dx + 6, 0);
            ctx.lineTo(dx, 2.5);
            ctx.lineTo(dx - 6, 0);
            ctx.closePath();
            ctx.fill();
          }
        } else if (cueItem.id === 'cue_carbon_precision' || cueItem.id === 'cue_titanium_pro') {
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          for (let r = 0; r < 6; r++) {
            ctx.fillRect(tipDist + shaftEnd + 180 + r * 11, -5.4, 2.5, 10.8);
          }
        }

        ctx.fillStyle = cueItem.accentColor;
        ctx.fillRect(tipDist + shaftEnd + 38, -4.9, 4, 9.8);
        ctx.fillRect(tipDist + shaftEnd + 165, -5.8, 4, 11.6);
        ctx.fillRect(tipDist + cueLength - 14, -6.5, 10, 13.0);

        // Rubber Butt Bumper
        ctx.fillStyle = '#09090b';
        ctx.beginPath();
        ctx.roundRect(tipDist + cueLength - 4, -5.5, 7, 11, 2);
        ctx.fill();

        ctx.restore();
      }

      // 8. Pooled Effect Particles
      const pool = particlesRef.current;
      for (let i = 0; i < pool.length; i++) {
        const pt = pool[i];
        if (!pt.active) continue;
        pt.life += dt;
        if (pt.life >= pt.maxLife) {
          pt.active = false;
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.94;
        pt.vy *= 0.94;
        const a = 1 - pt.life / pt.maxLife;
        ctx.globalAlpha = a;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore();
      ctx.restore();

      const stillParticles = particlesRef.current.some((pt) => pt.active);
      if (
        p.isSimulating ||
        stillParticles ||
        pendingEventsRef.current.length > 0 ||
        hasPocketAnim ||
        strikeFlashRef.current > 0 ||
        dragStateRef.current.mode !== 'none'
      ) {
        rafId = requestAnimationFrame(render);
      }
    };

    const kick = () => {
      if (!rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(render);
      }
    };
    kickRenderRef.current = kick;
    kick();

    return () => {
      kickRenderRef.current = () => {};
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [ballsRef, pendingEventsRef, strikeFlashRef]);

  useEffect(() => {
    kickRenderRef.current();
  });

  useEffect(() => {
    const prev = prevPocketedRef.current;
    const added = pocketedObjectBalls.filter((n) => !prev.includes(n));
    prevPocketedRef.current = [...pocketedObjectBalls];
    if (added.length === 0) return;

    setRecentReturnedBalls((cur) => Array.from(new Set([...cur, ...added])));
    const timer = window.setTimeout(() => {
      setRecentReturnedBalls((cur) => cur.filter((id) => !added.includes(id)));
    }, 780);
    return () => window.clearTimeout(timer);
  }, [pocketedObjectBalls]);

  const isId = settings.language === 'id';

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center select-none touch-none"
    >
      <div className="flex flex-col sm:flex-row items-center justify-center">
        <canvas
          ref={canvasRef}
          data-testid="billiard-canvas"
          data-turn={currentTurnLabel}
          data-phase={phaseLabel}
          data-simulating={isSimulating ? 'true' : 'false'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          className="rounded-3xl shadow-[0_24px_60px_rgba(6,7,10,0.68)] cursor-crosshair touch-none relative z-10"
        />

        {/* Desktop Right-Side Brushed Metallic Ball Return Rail / Mobile Compact Bottom Groove */}
        <div
          ref={chuteRef}
          aria-label={isId ? 'Saluran Pengembali Bola' : 'Ball Return Channel'}
          data-testid="ball-return-chute"
          className="relative z-0 -mt-1 sm:mt-0 sm:-ml-2 h-6 sm:h-auto sm:w-9 rounded-b-xl sm:rounded-b-2xl sm:rounded-r-2xl sm:rounded-tl-none px-2 sm:px-1 sm:py-2.5 flex sm:flex-col-reverse items-center justify-start gap-1 overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto bg-gradient-to-b sm:bg-gradient-to-r from-[#1d2028] via-[#0d0f15] to-[#1d2028] border border-zinc-400/25 shadow-[0_12px_28px_rgba(0,0,0,0.75),inset_0_2px_6px_rgba(0,0,0,0.85)]"
        >
          {/* Metallic Dual Guide Wire Accent (subtle hardware look like real return rails) */}
          <div
            aria-hidden="true"
            className="hidden sm:block absolute inset-y-2.5 left-1.5 w-px bg-gradient-to-b from-zinc-400/45 via-zinc-300/20 to-zinc-400/45 pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="hidden sm:block absolute inset-y-2.5 right-1.5 w-px bg-gradient-to-b from-zinc-400/45 via-zinc-300/20 to-zinc-400/45 pointer-events-none"
          />

          {pocketedObjectBalls.map((n) => {
            const color = BALL_COLORS[n]?.base || '#fff';
            const isRolling = recentReturnedBalls.includes(n);
            return (
              <span
                key={n}
                title={`#${n}`}
                className={`relative z-10 w-4 h-4 sm:w-5 sm:h-5 rounded-full border border-white/65 flex items-center justify-center text-[8px] sm:text-[9px] font-extrabold shrink-0 shadow-[inset_0_2px_3px_rgba(255,255,255,0.55),0_2px_5px_rgba(0,0,0,0.65)] ${
                  isRolling ? 'ball-return-rolling' : ''
                }`}
                style={{
                  background:
                    n > 8
                      ? `linear-gradient(to bottom, #f8fafc 22%, ${color} 22%, ${color} 78%, #f8fafc 78%)`
                      : color,
                  color: n <= 8 ? '#ffffff' : '#09090b',
                }}
              >
                {n}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
