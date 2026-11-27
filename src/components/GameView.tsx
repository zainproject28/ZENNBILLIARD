import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Coins,
  Crosshair,
  Flag,
  HelpCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Send,
  Star,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import {
  BALL_COLORS,
  BILLIARD_EMOTES,
  getCueStats,
  getVenueMeta,
  PHYSICS_PARAMS,
  QUICK_CHAT_MESSAGES,
  SHOP_CATALOG,
  TURN_DURATION_MS,
} from '../game/constants.ts';
import {
  formatKeyLabel,
  matchesBinding,
  normalizeKeyBindings,
  shouldIgnoreHotkey,
} from '../game/controls.ts';
import { chooseAiCueBallPlacement, computeAiShotPlan } from '../game/ai.ts';
import {
  applyCueShot,
  areBallsMoving,
  findSafeCueBallSpot,
  stepPhysicsFrame,
} from '../game/physics.ts';
import {
  createInitialRulesState,
  createRackForVariant,
  getLowestObjectBallNumber,
} from '../game/rack.ts';
import { evaluateShotOutcome, evaluateTurnTimeout, getPlayerGroup } from '../game/rules.ts';
import type {
  BallState,
  BallSuit,
  MatchFormat,
  MatchRulesState,
  OnlineParticipantMeta,
  PhysicsEvent,
  PlayerSlot,
  ShotInput,
  ShotTelemetry,
  UserProfile,
  UserSettings,
} from '../game/types.ts';
import { applyXpProgress, calculateEloDelta, computeMatchRewards } from '../game/elo.ts';
import { applyCompletedMatchToStats } from '../game/rank.ts';
import { audioEngine, triggerHaptic } from '../services/audio.ts';
import {
  buildShotAction,
  loadFirestoreMatch,
  pushFirestoreAimState,
  pushFirestoreMatchAction,
  requestFirestoreRematch,
  respondFirestoreRematch,
  subscribeFirestoreMatch,
  type FirestoreMatchDoc,
} from '../services/firestoreRooms.ts';
import { isFullscreenSupported, useFullscreenState } from '../services/fullscreen.ts';
import { t } from '../services/i18n.ts';
import { wsClient } from '../services/wsClient.ts';
import { BilliardCanvas } from './BilliardCanvas.tsx';
import { MatchmakingSpinStage } from './MatchmakingSpinStage.tsx';
import { MatchResultModal, type MatchResultSummary } from './MatchResultModal.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { PowerBar } from './PowerBar.tsx';
import type { PracticeLaunchConfig } from './PracticeSetupModal.tsx';
import { SpinControl } from './SpinControl.tsx';

export type { OnlineParticipantMeta };

export interface OnlineMatchInit {
  matchId: string;
  roomId: string | null;
  gameMode: 'quick_match' | 'private_room' | 'online_ranked';
  matchFormat?: MatchFormat;
  entryFee: number;
  yourSlot: PlayerSlot;
  yourSeatIndex?: number;
  reconnectToken: string;
  seq: number;
  simulating: boolean;
  balls: BallState[];
  rules: MatchRulesState;
  turnDeadlineAt?: number | null;
  serverNow?: number;
  firestoreSync?: boolean;
  firestoreRoomCode?: string;
  playerA: OnlineParticipantMeta;
  playerB: OnlineParticipantMeta;
  playerA2?: OnlineParticipantMeta;
  playerB2?: OnlineParticipantMeta;
}

interface GameViewProps {
  profile: UserProfile;
  settings: UserSettings;
  onlineMatch: OnlineMatchInit | null;
  practiceConfig?: PracticeLaunchConfig;
  onQuickEquip?: (itemId: string) => void;
  onSettleQuickMatch?: (payload: {
    won: boolean;
    entryFee: number;
    opponent: OnlineParticipantMeta;
    shots: number;
    durationSec: number;
  }) => Promise<{ xpEarned: number; coinsEarned: number; ratingDelta: number }>;
  onUpdateSettings: (next: UserSettings) => void;
  onOnlineMatchUpdate?: (nextMatch: OnlineMatchInit) => void;
  onProfileUpdate: (next: UserProfile) => void;
  onExitToMenu: () => void;
  onPlayAgainRanked?: () => void;
  onInviteFriendFromResult: () => void;
}

interface ChatBubble {
  senderUid: string;
  senderName: string;
  text: string;
  emote: string;
  timestamp: number;
}

export const GameView: React.FC<GameViewProps> = ({
  profile,
  settings,
  onlineMatch,
  practiceConfig,
  onQuickEquip,
  onSettleQuickMatch,
  onUpdateSettings,
  onOnlineMatchUpdate,
  onProfileUpdate,
  onExitToMenu,
  onPlayAgainRanked,
  onInviteFriendFromResult,
}) => {
  const isOnline = Boolean(onlineMatch);
  const isQuickMatchAi = Boolean(!isOnline && practiceConfig?.isQuickMatch && practiceConfig?.opponent);
  const quickMatchFee = isQuickMatchAi ? practiceConfig?.entryFee || 0 : 0;
  const yourSlot: PlayerSlot = onlineMatch ? onlineMatch.yourSlot : 'A';
  const activeVariant = onlineMatch
    ? onlineMatch.rules.gameVariant
    : practiceConfig?.variant || '8ball';
  const subMode = isOnline ? 'online' : practiceConfig?.subMode || 'solo';
  const aiDifficulty = practiceConfig?.aiDifficulty || 'pro';
  const localFormat: MatchFormat = isOnline
    ? onlineMatch?.matchFormat || onlineMatch?.rules.matchFormat || '1v1'
    : subMode === 'local_2v2_ai' || subMode === 'local_2v2_pass'
      ? '2v2'
      : '1v1';
  const is2v2 = localFormat === '2v2';
  const yourSeatIndex = onlineMatch ? (onlineMatch.yourSeatIndex ?? (yourSlot === 'A' ? 0 : 1)) : 0;

  const ballsRef = useRef<BallState[]>(
    onlineMatch
      ? onlineMatch.balls.map((b) => ({ ...b }))
      : createRackForVariant(activeVariant),
  );
  const pendingEventsRef = useRef<PhysicsEvent[]>([]);
  const strikeFlashRef = useRef<number>(0);

  const [rules, setRules] = useState<MatchRulesState>(() =>
    onlineMatch
      ? { ...onlineMatch.rules }
      : createInitialRulesState('A', activeVariant, localFormat),
  );
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const [simulating, setSimulating] = useState<boolean>(
    onlineMatch ? onlineMatch.simulating : false,
  );
  const [aimAngle, setAimAngle] = useState(0);
  const aimAngleRef = useRef(0);
  const updateAimAngleLocal = useCallback((nextAngle: number) => {
    aimAngleRef.current = nextAngle;
    setAimAngle(nextAngle);
  }, []);
  const [power, setPower] = useState(0);
  const powerRef = useRef(0);
  powerRef.current = power;
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const [pocketedSnapshot, setPocketedSnapshot] = useState<number[]>([]);
  const [resultSummary, setResultSummary] = useState<MatchResultSummary | null>(null);
  const [practiceStartMs, setPracticeStartMs] = useState<number>(() => Date.now());
  const practiceStartMsRef = useRef(practiceStartMs);
  practiceStartMsRef.current = practiceStartMs;
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [controlsGuideOpen, setControlsGuideOpen] = useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreenState();
  const fullscreenSupported = isFullscreenSupported();

  // 30s turn countdown & AI educational strategy preview
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(() => {
    if (onlineMatch) {
      return onlineMatch.turnDeadlineAt ?? onlineMatch.rules.turnDeadlineAt ?? (Date.now() + TURN_DURATION_MS + 1800);
    }
    if ((practiceConfig?.subMode || 'solo') === 'solo') return null;
    return Date.now() + TURN_DURATION_MS;
  });
  const serverClockOffsetRef = useRef<number>(
    onlineMatch?.serverNow ? onlineMatch.serverNow - Date.now() : 0,
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [timeoutFlash, setTimeoutFlash] = useState<string | null>(null);
  const turnTimeoutDispatchedRef = useRef<number | null>(null);
  const [aiPreview, setAiPreview] = useState<{
    showGuide: boolean;
    targetBallId: number | null;
    reasonEn: string;
    reasonId: string;
  } | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const onProfileUpdateRef = useRef(onProfileUpdate);
  onProfileUpdateRef.current = onProfileUpdate;
  const onOnlineMatchUpdateRef = useRef(onOnlineMatchUpdate);
  onOnlineMatchUpdateRef.current = onOnlineMatchUpdate;
  const onSettleQuickMatchRef = useRef(onSettleQuickMatch);
  onSettleQuickMatchRef.current = onSettleQuickMatch;
  const quickMatchSettledRef = useRef<boolean>(false);

  // Expose live game state on document.body for testability
  useEffect(() => {
    document.body.dataset.state = resultSummary ? 'gameover' : 'playing';
    return () => {
      delete document.body.dataset.state;
    };
  }, [resultSummary]);

  // VS Intro banner (shown on online match table entry; QuickMatch already runs the full roulette spin in its modal)
  const [showVsBanner, setShowVsBanner] = useState<boolean>(Boolean(onlineMatch));

  // Online disconnect/reconnect UI & live ping
  const [opponentDisconnectSec, setOpponentDisconnectSec] = useState<number | null>(null);
  const [localWsStatus, setLocalWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');
  const [wsLatencyMs, setWsLatencyMs] = useState<number | null>(() => wsClient.getLatencyMs());

  // Chat & Emote state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const chatMutedRef = useRef(chatMuted);
  chatMutedRef.current = chatMuted;
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatBubble[]>([]);
  const [opponentBubble, setOpponentBubble] = useState<ChatBubble | null>(null);

  const localTelemetryRef = useRef<ShotTelemetry>({
    firstContactBallId: null,
    pocketedBallIds: [],
    railContactAfterFirstHit: false,
    cushionHitCount: 0,
  });

  const activeMatchIdRef = useRef<string | null>(onlineMatch?.matchId || null);
  const firestoreSeqRef = useRef<number>(onlineMatch?.seq || 1);
  const localPublishedSeqsRef = useRef<Set<number>>(new Set());
  const firestoreLastAimAtRef = useRef<number>(0);
  const firestoreAimTsRef = useRef<number>(0);
  const firestoreWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const firestoreMatchStartMsRef = useRef<number>(Date.now());
  const firestoreSettledRef = useRef<boolean>(false);
  const firestoreMatchDocRef = useRef<FirestoreMatchDoc | null>(null);

  const enqueueFirestoreWrite = useCallback((task: () => Promise<void>) => {
    firestoreWriteQueueRef.current = firestoreWriteQueueRef.current.then(task, task);
  }, []);

  useEffect(() => {
    if (onlineMatch) {
      activeMatchIdRef.current = onlineMatch.matchId;
      firestoreSeqRef.current = onlineMatch.seq || 1;
      firestoreAimTsRef.current = 0;
      firestoreMatchStartMsRef.current = Date.now();
      firestoreSettledRef.current = false;
      turnTimeoutDispatchedRef.current = null;
      if (typeof onlineMatch.serverNow === 'number') {
        serverClockOffsetRef.current = onlineMatch.serverNow - Date.now();
      } else {
        serverClockOffsetRef.current = 0;
      }
      if (!onlineMatch.firestoreSync && onlineMatch.reconnectToken) {
        wsClient.setActiveReconnectInfo({
          matchId: onlineMatch.matchId,
          reconnectToken: onlineMatch.reconnectToken,
        });
      } else {
        wsClient.setActiveReconnectInfo(null);
      }
      ballsRef.current = onlineMatch.balls.map((b) => ({ ...b }));
      setRules({ ...onlineMatch.rules });
      setSimulating(onlineMatch.simulating);
      setTurnDeadlineAt(
        onlineMatch.turnDeadlineAt ?? onlineMatch.rules.turnDeadlineAt ?? Date.now() + TURN_DURATION_MS + 1800,
      );
      setSecondsLeft(30);
      setAiPreview(null);
      setResultSummary(null);
      setShowVsBanner(true);
      const tmr = window.setTimeout(() => setShowVsBanner(false), 2000);
      return () => window.clearTimeout(tmr);
    }
    if (practiceConfig?.isQuickMatch && practiceConfig?.opponent) {
      quickMatchSettledRef.current = false;
      turnTimeoutDispatchedRef.current = null;
      setPracticeStartMs(Date.now());
      setTurnDeadlineAt(Date.now() + TURN_DURATION_MS);
      setSecondsLeft(30);
      setAiPreview(null);
      setShowVsBanner(false);
      return undefined;
    }
    turnTimeoutDispatchedRef.current = null;
    setAiPreview(null);
    setTurnDeadlineAt(subMode === 'solo' ? null : Date.now() + TURN_DURATION_MS);
    setSecondsLeft(30);
    return undefined;
  }, [onlineMatch, practiceConfig, subMode]);

  useEffect(() => {
    const unsubStatus = wsClient.onStatusChange(setLocalWsStatus);
    const unsubLatency = wsClient.onLatencyChange(setWsLatencyMs);
    return () => {
      unsubStatus();
      unsubLatency();
    };
  }, []);

  // Countdown tick for opponent disconnect
  useEffect(() => {
    if (opponentDisconnectSec === null || opponentDisconnectSec <= 0) return;
    const tmr = window.setInterval(() => {
      setOpponentDisconnectSec((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return () => window.clearInterval(tmr);
  }, [opponentDisconnectSec]);

  const lastPocketedKeyRef = useRef<string>('');
  const syncPocketedSnapshot = useCallback(() => {
    const ids = ballsRef.current.filter((b) => b.pocketed).map((b) => b.id);
    const key = ids.join(',');
    if (key !== lastPocketedKeyRef.current) {
      lastPocketedKeyRef.current = key;
      setPocketedSnapshot(ids);
    }
  }, []);

  // Reset practice / quick match rack
  const resetPracticeMatch = useCallback(() => {
    audioEngine.playClick();
    quickMatchSettledRef.current = false;
    turnTimeoutDispatchedRef.current = null;
    ballsRef.current = createRackForVariant(activeVariant);
    setRules(createInitialRulesState('A', activeVariant, localFormat));
    setSimulating(false);
    setResultSummary(null);
    setAiPreview(null);
    setTimeoutFlash(null);
    updateAimAngleLocal(0);
    setPower(0);
    setSpinX(0);
    setSpinY(0);
    setPracticeStartMs(Date.now());
    setTurnDeadlineAt(subMode === 'solo' ? null : Date.now() + TURN_DURATION_MS);
    setSecondsLeft(30);
    syncPocketedSnapshot();
  }, [activeVariant, localFormat, subMode, syncPocketedSnapshot, updateAimAngleLocal]);

  // Listen to WebSocket authoritative events during same-server online match
  useEffect(() => {
    if (!onlineMatch || onlineMatch.firestoreSync) return;
    const unsub = wsClient.subscribe((msg) => {
      const mId = msg.matchId as string | undefined;
      if (mId && mId !== activeMatchIdRef.current) return;

      switch (msg.type) {
        case 'match:state': {
          const m = msg.match as OnlineMatchInit;
          if (!m) return;
          if (typeof m.serverNow === 'number') {
            serverClockOffsetRef.current = m.serverNow - Date.now();
          }
          ballsRef.current = m.balls.map((b) => ({ ...b }));
          setRules({ ...m.rules });
          setSimulating(m.simulating);
          setTurnDeadlineAt(m.turnDeadlineAt ?? m.rules.turnDeadlineAt ?? Date.now() + TURN_DURATION_MS);
          syncPocketedSnapshot();
          break;
        }
        case 'match:aim_update': {
          if (typeof msg.angle === 'number') updateAimAngleLocal(msg.angle);
          if (typeof msg.spinX === 'number') setSpinX(msg.spinX);
          if (typeof msg.spinY === 'number') setSpinY(msg.spinY);
          if (typeof msg.power === 'number') setPower(msg.power);
          if (msg.isBotAim || typeof msg.aiReasonEn === 'string') {
            setAiPreview({
              showGuide: true,
              targetBallId: typeof msg.targetBallId === 'number' ? msg.targetBallId : null,
              reasonEn: String(msg.aiReasonEn || ''),
              reasonId: String(msg.aiReasonId || msg.aiReasonEn || ''),
            });
          }
          break;
        }
        case 'match:cue_placed': {
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && typeof msg.x === 'number' && typeof msg.y === 'number') {
            cue.x = msg.x;
            cue.y = msg.y;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
          }
          break;
        }
        case 'match:shot_accepted': {
          const shot = msg.shot as ShotInput;
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue) {
            pendingEventsRef.current.push({ type: 'cue', intensity: shot.power, x: cue.x, y: cue.y });
          }
          strikeFlashRef.current = 1;
          audioEngine.playCueHit(shot.power);
          triggerHaptic(settingsRef.current.vibrationEnabled, Math.round(10 + shot.power * 25));
          const curRules = rulesRef.current;
          applyCueShot(
            ballsRef.current,
            shot,
            curRules.headstringOnly,
            getCueStats(
              shot.cueId ||
                (curRules.currentTurn === 'A'
                  ? onlineMatch.playerA.equippedCue
                  : onlineMatch.playerB.equippedCue),
            ),
          );
          localTelemetryRef.current = {
            firstContactBallId: null,
            pocketedBallIds: [],
            railContactAfterFirstHit: false,
            cushionHitCount: 0,
          };
          setAiPreview((prev) => (prev ? { ...prev, showGuide: false } : null));
          setPower(0);
          setSimulating(true);
          break;
        }
        case 'match:snapshot': {
          const serverBalls = msg.balls as BallState[];
          if (Array.isArray(serverBalls)) {
            for (const sb of serverBalls) {
              const lb = ballsRef.current.find((b) => b.id === sb.id);
              if (!lb) continue;
              // Smooth reconciliation toward server authoritative coordinates
              const dist = Math.hypot(sb.x - lb.x, sb.y - lb.y);
              if (dist > 30 || sb.pocketed !== lb.pocketed) {
                lb.x = sb.x;
                lb.y = sb.y;
              } else {
                lb.x += (sb.x - lb.x) * 0.55;
                lb.y += (sb.y - lb.y) * 0.55;
              }
              lb.vx = sb.vx;
              lb.vy = sb.vy;
              lb.pocketed = sb.pocketed;
              lb.pocketAnimProgress = sb.pocketAnimProgress;
              lb.pocketedInPocketId = sb.pocketedInPocketId;
            }
            syncPocketedSnapshot();
          }
          break;
        }
        case 'match:turn_resolved': {
          const serverBalls = msg.balls as BallState[];
          const nextRules = msg.rules as MatchRulesState;
          if (typeof msg.serverNow === 'number') {
            serverClockOffsetRef.current = msg.serverNow - Date.now();
          }
          if (Array.isArray(serverBalls)) {
            ballsRef.current = serverBalls.map((b) => ({ ...b }));
          }
          turnTimeoutDispatchedRef.current = null;
          setRules(nextRules);
          setSimulating(false);
          setSpinX(0);
          setSpinY(0);
          setAiPreview(null);
          setTurnDeadlineAt(
            (typeof msg.turnDeadlineAt === 'number' ? msg.turnDeadlineAt : nextRules.turnDeadlineAt) ??
              Date.now() + TURN_DURATION_MS,
          );
          syncPocketedSnapshot();
          break;
        }
        case 'match:turn_timeout': {
          const nextRules = msg.rules as MatchRulesState;
          if (typeof msg.serverNow === 'number') {
            serverClockOffsetRef.current = msg.serverNow - Date.now();
          }
          turnTimeoutDispatchedRef.current = null;
          setRules(nextRules);
          setSimulating(false);
          setPower(0);
          setSpinX(0);
          setSpinY(0);
          setAiPreview(null);
          setTurnDeadlineAt(
            (typeof msg.turnDeadlineAt === 'number' ? msg.turnDeadlineAt : nextRules.turnDeadlineAt) ??
              Date.now() + TURN_DURATION_MS,
          );
          audioEngine.playNotification();
          setTimeoutFlash(t(settingsRef.current.language, 'timeExpired'));
          window.setTimeout(() => setTimeoutFlash(null), 2200);
          break;
        }
        case 'match:ended': {
          const serverBalls = msg.balls as BallState[];
          const nextRules = (msg.rules as MatchRulesState | undefined) || rulesRef.current;
          const winnerSlot = (msg.winnerSlot as PlayerSlot) || nextRules.winner || 'A';
          const winReason = String(msg.winReason || nextRules.winReason || 'Match Complete');
          const duration = Number(msg.duration || 1);
          const rewards = msg.rewards as
            | {
                A?: { xpEarned?: number; coinsEarned?: number; ratingDelta?: number; rankDelta?: number; profile?: UserProfile };
                B?: { xpEarned?: number; coinsEarned?: number; ratingDelta?: number; rankDelta?: number; profile?: UserProfile };
                A2?: { xpEarned?: number; coinsEarned?: number; ratingDelta?: number; rankDelta?: number; profile?: UserProfile };
                B2?: { xpEarned?: number; coinsEarned?: number; ratingDelta?: number; rankDelta?: number; profile?: UserProfile };
              }
            | undefined;
          if (Array.isArray(serverBalls)) {
            ballsRef.current = serverBalls.map((b) => ({ ...b }));
          }
          const finalRules: MatchRulesState = {
            ...nextRules,
            phase: 'gameover',
            winner: winnerSlot,
            winReason,
          };
          setRules(finalRules);
          setSimulating(false);
          setTurnDeadlineAt(null);
          setAiPreview(null);
          syncPocketedSnapshot();
          wsClient.setActiveReconnectInfo(null);

          const seatRewards = [rewards?.A, rewards?.B, rewards?.A2, rewards?.B2].filter(Boolean);
          const matchingSeatRew = seatRewards.find((r) => r?.profile?.uid === profileRef.current.uid);
          const myRew = matchingSeatRew || (yourSlot === 'A' ? rewards?.A : rewards?.B);
          if (myRew?.profile && myRew.profile.uid === profileRef.current.uid) {
            onProfileUpdateRef.current(myRew.profile);
          }

          if (winnerSlot === yourSlot) audioEngine.playVictory();
          else audioEngine.playDefeat();

          setResultSummary({
            isPractice: false,
            isRanked: onlineMatch.gameMode === 'online_ranked',
            rankDelta: typeof myRew?.rankDelta === 'number' ? myRew.rankDelta : 0,
            newRankPoints:
              myRew?.profile?.uid === profileRef.current.uid
                ? myRew.profile.rankPoints ?? 0
                : profileRef.current.rankPoints ?? 0,
            matchFormat: localFormat,
            winnerSlot,
            yourSlot,
            winReason,
            durationSec: duration,
            playerA: {
              uid: onlineMatch.playerA.uid,
              username: onlineMatch.playerA.username,
              avatar: onlineMatch.playerA.avatar,
              customAvatarUrl: onlineMatch.playerA.customAvatarUrl,
              frame: onlineMatch.playerA.frame,
              shots: finalRules.shotCountA ?? 0,
              potted: finalRules.pottedCountA ?? 0,
            },
            playerB: {
              uid: onlineMatch.playerB.uid,
              username: onlineMatch.playerB.username,
              avatar: onlineMatch.playerB.avatar,
              customAvatarUrl: onlineMatch.playerB.customAvatarUrl,
              frame: onlineMatch.playerB.frame,
              shots: finalRules.shotCountB ?? 0,
              potted: finalRules.pottedCountB ?? 0,
            },
            ...(onlineMatch.playerA2 ? { playerA2: onlineMatch.playerA2 } : {}),
            ...(onlineMatch.playerB2 ? { playerB2: onlineMatch.playerB2 } : {}),
            xpEarned: myRew?.xpEarned ?? 0,
            coinsEarned: myRew?.coinsEarned ?? 0,
            ratingDelta: myRew?.ratingDelta ?? 0,
            rematchRequestedByOpponent: false,
            rematchRequestedByYou: false,
          });
          break;
        }
        case 'match:opponent_disconnected': {
          setOpponentDisconnectSec(Number(msg.countdownSec || 45));
          break;
        }
        case 'match:opponent_reconnected': {
          setOpponentDisconnectSec(null);
          break;
        }
        case 'match:chat_message': {
          const senderUid = String(msg.senderUid || '');
          const bubble: ChatBubble = {
            senderUid,
            senderName: String(msg.senderName || 'Player'),
            text: String(msg.text || ''),
            emote: String(msg.emote || ''),
            timestamp: Number(msg.timestamp || Date.now()),
          };
          const myUid = profileRef.current.uid;
          if (chatMutedRef.current && senderUid !== myUid) break;
          setChatHistory((prev) => [...prev.slice(-24), bubble]);
          if (senderUid !== myUid) {
            audioEngine.playNotification();
            setOpponentBubble(bubble);
            window.setTimeout(() => {
              setOpponentBubble((cur) => (cur?.timestamp === bubble.timestamp ? null : cur));
            }, 3800);
          }
          break;
        }
        case 'match:rematch_requested': {
          setResultSummary((prev) =>
            prev ? { ...prev, rematchRequestedByOpponent: true, rematchStatus: 'incoming' } : prev,
          );
          break;
        }
        case 'match:rematch_declined': {
          setResultSummary((prev) =>
            prev ? { ...prev, rematchRequestedByYou: false, rematchStatus: 'declined' } : prev,
          );
          break;
        }
        case 'match:rematch_expired': {
          setResultSummary((prev) =>
            prev ? { ...prev, rematchRequestedByYou: false, rematchStatus: 'expired' } : prev,
          );
          break;
        }
        case 'match:started': {
          const nextMatch = msg.match as OnlineMatchInit | undefined;
          if (nextMatch) {
            onOnlineMatchUpdateRef.current?.(nextMatch);
          }
          break;
        }
      }
    });
    return unsub;
  }, [onlineMatch, yourSlot, localFormat, syncPocketedSnapshot, updateAimAngleLocal]);

  // Listen to Firestore match document during cross-instance bridged matches
  useEffect(() => {
    if (!onlineMatch || !onlineMatch.firestoreSync) return;

    const unsub = subscribeFirestoreMatch(onlineMatch.matchId, (docData) => {
      firestoreMatchDocRef.current = docData;
      const aim = docData.aimState;
      if (aim && aim.timestamp > firestoreAimTsRef.current && aim.actorSlot !== yourSlot) {
        firestoreAimTsRef.current = aim.timestamp;
        if (typeof aim.angle === 'number') updateAimAngleLocal(aim.angle);
        if (typeof aim.spinX === 'number') setSpinX(aim.spinX);
        if (typeof aim.spinY === 'number') setSpinY(aim.spinY);
        if (typeof aim.power === 'number') setPower(aim.power);
        if (typeof aim.aiReasonEn === 'string') {
          setAiPreview({
            showGuide: true,
            targetBallId: typeof aim.targetBallId === 'number' ? aim.targetBallId : null,
            reasonEn: aim.aiReasonEn,
            reasonId: aim.aiReasonId || aim.aiReasonEn,
          });
        }
      }
      const action = docData.lastAction;
      if (action && action.seq > firestoreSeqRef.current) {
        firestoreSeqRef.current = action.seq;
        const isSelfAction = localPublishedSeqsRef.current.has(action.seq);

        if (action.type === 'aim' && !isSelfAction) {
          if (typeof action.angle === 'number') updateAimAngleLocal(action.angle);
          if (typeof action.spinX === 'number') setSpinX(action.spinX);
          if (typeof action.spinY === 'number') setSpinY(action.spinY);
          if (typeof action.power === 'number') setPower(action.power);
          if (typeof action.aiReasonEn === 'string') {
            setAiPreview({
              showGuide: true,
              targetBallId: typeof action.targetBallId === 'number' ? action.targetBallId : null,
              reasonEn: action.aiReasonEn,
              reasonId: action.aiReasonId || action.aiReasonEn,
            });
          }
        } else if (action.type === 'place_cue_ball' && !isSelfAction) {
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && typeof action.x === 'number' && typeof action.y === 'number') {
            cue.x = action.x;
            cue.y = action.y;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
          }
        } else if (action.type === 'shot' && !isSelfAction) {
          const shot: ShotInput = {
            angle: Number(action.angle || 0),
            power: Number(action.power || 0.5),
            spinX: Number(action.spinX || 0),
            spinY: Number(action.spinY || 0),
            cueBallPos:
              typeof action.cueBallX === 'number' && typeof action.cueBallY === 'number'
                ? { x: action.cueBallX, y: action.cueBallY }
                : undefined,
          };
          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue) {
            pendingEventsRef.current.push({ type: 'cue', intensity: shot.power, x: cue.x, y: cue.y });
          }
          strikeFlashRef.current = 1;
          audioEngine.playCueHit(shot.power);
          triggerHaptic(settingsRef.current.vibrationEnabled, Math.round(10 + shot.power * 25));
          const oppCue =
            action.cueId ||
            (action.actorSlot === 'A' ? onlineMatch.playerA.equippedCue : onlineMatch.playerB.equippedCue);
          applyCueShot(ballsRef.current, shot, docData.rules.headstringOnly, getCueStats(oppCue));
          localTelemetryRef.current = {
            firstContactBallId: null,
            pocketedBallIds: [],
            railContactAfterFirstHit: false,
            cushionHitCount: 0,
          };
          setAiPreview((prev) => (prev ? { ...prev, showGuide: false } : null));
          setPower(0);
          setSimulating(true);
        } else if (action.type === 'turn_resolved' && !isSelfAction) {
          ballsRef.current = docData.balls.map((b) => ({ ...b }));
          setRules({ ...docData.rules });
          setSimulating(false);
          setSpinX(0);
          setSpinY(0);
          setAiPreview(null);
          turnTimeoutDispatchedRef.current = null;
          setTurnDeadlineAt(
            docData.rules.turnDeadlineAt ?? action.turnDeadlineAt ?? Date.now() + TURN_DURATION_MS,
          );
          syncPocketedSnapshot();
        } else if (action.type === 'turn_timeout' && !isSelfAction) {
          setRules({ ...docData.rules });
          setSimulating(false);
          setPower(0);
          setSpinX(0);
          setSpinY(0);
          setAiPreview(null);
          turnTimeoutDispatchedRef.current = null;
          setTurnDeadlineAt(
            docData.rules.turnDeadlineAt ?? action.turnDeadlineAt ?? Date.now() + TURN_DURATION_MS,
          );
          audioEngine.playNotification();
          setTimeoutFlash(t(settingsRef.current.language, 'timeExpired'));
          window.setTimeout(() => setTimeoutFlash(null), 2200);
        } else if (action.type === 'chat') {
          const senderUid = String(action.senderUid || '');
          const bubble: ChatBubble = {
            senderUid,
            senderName: String(action.senderName || 'Player'),
            text: String(action.text || ''),
            emote: String(action.emote || ''),
            timestamp: Number(action.timestamp || Date.now()),
          };
          const myUid = profileRef.current.uid;
          if (!chatMutedRef.current || senderUid === myUid) {
            setChatHistory((prev) => [...prev.slice(-24), bubble]);
            if (senderUid !== myUid) {
              audioEngine.playNotification();
              setOpponentBubble(bubble);
              window.setTimeout(() => {
                setOpponentBubble((cur) => (cur?.timestamp === bubble.timestamp ? null : cur));
              }, 3800);
            }
          }
        }
      }

      if (docData.status === 'completed' && !firestoreSettledRef.current) {
        firestoreSettledRef.current = true;
        ballsRef.current = docData.balls.map((b) => ({ ...b }));
        setRules({ ...docData.rules });
        setSimulating(false);
        syncPocketedSnapshot();

        const winnerSlot: PlayerSlot =
          docData.winnerId === onlineMatch.playerA.uid ||
          docData.winnerId === onlineMatch.playerA2?.uid ||
          docData.rules?.winner === 'A'
            ? 'A'
            : 'B';
        const winReason = docData.winReason || docData.rules.winReason || 'Match Complete';
        const dur = Math.max(1, Math.round((Date.now() - firestoreMatchStartMsRef.current) / 1000));
        const won = winnerSlot === yourSlot;

        const curProfile = profileRef.current;
        const oppMeta = yourSlot === 'A' ? onlineMatch.playerB : onlineMatch.playerA;
        const oppRating = oppMeta.rating;
        const myShots = yourSlot === 'A' ? docData.rules.shotCountA : docData.rules.shotCountB;
        const delta = calculateEloDelta(curProfile.rating, oppRating, won);
        const rew = computeMatchRewards(won, onlineMatch.entryFee, myShots);
        const prog = applyXpProgress(curProfile.level, curProfile.xp, rew.xpEarned);

        const nextProfile: UserProfile = {
          ...curProfile,
          level: prog.level,
          xp: prog.xp,
          coins: Math.max(0, curProfile.coins + rew.coinsEarned - onlineMatch.entryFee),
          rating: Math.max(100, curProfile.rating + delta),
          matches: curProfile.matches + 1,
          wins: curProfile.wins + (won ? 1 : 0),
          losses: curProfile.losses + (won ? 0 : 1),
          stats: applyCompletedMatchToStats(curProfile.stats, {
            variant: activeVariant,
            isRanked: onlineMatch.gameMode === 'online_ranked',
            isBotOpponent: Boolean(oppMeta.isBot),
            won,
          }),
          updatedAt: new Date().toISOString(),
        };
        onProfileUpdateRef.current(nextProfile);

        if (won) audioEngine.playVictory();
        else audioEngine.playDefeat();

        setResultSummary({
          isPractice: false,
          matchFormat: localFormat,
          winnerSlot,
          yourSlot,
          winReason,
          durationSec: dur,
          playerA: {
            uid: onlineMatch.playerA.uid,
            username: onlineMatch.playerA.username,
            avatar: onlineMatch.playerA.avatar,
            customAvatarUrl: onlineMatch.playerA.customAvatarUrl,
            frame: onlineMatch.playerA.frame,
            shots: docData.rules.shotCountA,
            potted: docData.rules.pottedCountA,
          },
          playerB: {
            uid: onlineMatch.playerB.uid,
            username: onlineMatch.playerB.username,
            avatar: onlineMatch.playerB.avatar,
            customAvatarUrl: onlineMatch.playerB.customAvatarUrl,
            frame: onlineMatch.playerB.frame,
            shots: docData.rules.shotCountB,
            potted: docData.rules.pottedCountB,
          },
          ...(onlineMatch.playerA2 ? { playerA2: onlineMatch.playerA2 } : {}),
          ...(onlineMatch.playerB2 ? { playerB2: onlineMatch.playerB2 } : {}),
          xpEarned: rew.xpEarned,
          coinsEarned: rew.coinsEarned,
          ratingDelta: delta,
          rematchRequestedByOpponent: false,
          rematchRequestedByYou: false,
          rematchStatus: 'idle',
        });
      }

      if (docData.status === 'completed') {
        const myUid = profileRef.current.uid;
        if (docData.rematchStatus === 'pending' && docData.rematchRequesterUid && docData.rematchRequesterUid !== myUid) {
          setResultSummary((prev) =>
            prev && prev.rematchStatus !== 'incoming'
              ? { ...prev, rematchRequestedByOpponent: true, rematchStatus: 'incoming' }
              : prev,
          );
        } else if (docData.rematchStatus === 'declined') {
          setResultSummary((prev) =>
            prev ? { ...prev, rematchRequestedByYou: false, rematchStatus: 'declined' } : prev,
          );
        } else if (docData.rematchStatus === 'expired') {
          setResultSummary((prev) =>
            prev ? { ...prev, rematchRequestedByYou: false, rematchStatus: 'expired' } : prev,
          );
        } else if (docData.rematchStatus === 'accepted' && docData.rematchNextMatchId) {
          void loadFirestoreMatch(docData.rematchNextMatchId).then((loaded) => {
            if (!loaded) return;
            const seatIdx =
              loaded.playerA === myUid
                ? 0
                : loaded.playerB === myUid
                  ? 1
                  : loaded.playerA2 === myUid
                    ? 2
                    : loaded.playerB2 === myUid
                      ? 3
                      : 0;
            const slot: PlayerSlot = seatIdx === 0 || seatIdx === 2 ? 'A' : 'B';
            onOnlineMatchUpdateRef.current?.({
              matchId: loaded.matchId,
              roomId: onlineMatch.roomId,
              gameMode: 'private_room',
              matchFormat: loaded.matchFormat || '1v1',
              entryFee: loaded.entryFee || 0,
              yourSlot: slot,
              yourSeatIndex: seatIdx,
              reconnectToken: '',
              seq: loaded.seq,
              simulating: false,
              balls: loaded.balls,
              rules: loaded.rules,
              turnDeadlineAt: loaded.rules.turnDeadlineAt ?? Date.now() + TURN_DURATION_MS + 1800,
              firestoreSync: true,
              firestoreRoomCode: onlineMatch.firestoreRoomCode,
              playerA: loaded.playerAInfo,
              playerB: loaded.playerBInfo,
              ...(loaded.playerA2Info ? { playerA2: loaded.playerA2Info } : {}),
              ...(loaded.playerB2Info ? { playerB2: loaded.playerB2Info } : {}),
            });
          }).catch(() => {});
        }
      }
    });

    return () => unsub();
  }, [onlineMatch, yourSlot, localFormat, syncPocketedSnapshot, updateAimAngleLocal]);

  // Compute seat metadata & bot ownership cleanly
  const pAInfo: OnlineParticipantMeta = onlineMatch
    ? onlineMatch.playerA
    : {
        uid: profile.uid,
        username: subMode === 'local_2p' || subMode === 'local_2v2_pass' ? 'Player 1' : profile.username,
        avatar: profile.avatar,
        customAvatarUrl: subMode === 'local_2p' || subMode === 'local_2v2_pass' ? '' : profile.customAvatarUrl,
        frame: profile.frame,
        level: profile.level,
        rating: profile.rating,
        equippedCue: profile.equippedCue,
        equippedTable: profile.equippedTable,
        equippedVenue: profile.equippedVenue || 'venue_billiard_cafe',
        equippedEffect: profile.equippedEffect,
        connected: true,
      };

  const pBInfo: OnlineParticipantMeta = onlineMatch
    ? onlineMatch.playerB
    : isQuickMatchAi && practiceConfig?.opponent
      ? practiceConfig.opponent
      : {
          uid: 'practice_p2',
          username:
            subMode === 'vs_ai'
              ? `Pro AI (${aiDifficulty === 'pro' ? 'GM' : aiDifficulty === 'semipro' ? 'Semi' : 'Club'})`
              : subMode === 'local_2v2_ai'
                ? 'Zenn AI I'
                : subMode === 'local_2p' || subMode === 'local_2v2_pass'
                  ? 'Player 2'
                  : 'Practice Table',
          avatar: subMode === 'vs_ai' || subMode === 'local_2v2_ai' ? 'avatar_master' : 'avatar_royale',
          frame: subMode === 'vs_ai' || subMode === 'local_2v2_ai' ? 'frame_royal_gold' : 'frame_bronze',
          level: aiDifficulty === 'pro' ? 40 : 12,
          rating: aiDifficulty === 'pro' ? 2150 : aiDifficulty === 'semipro' ? 1550 : 1100,
          equippedCue:
            subMode === 'vs_ai' || subMode === 'local_2v2_ai'
              ? aiDifficulty === 'pro'
                ? 'cue_legendary'
                : aiDifficulty === 'semipro'
                  ? 'cue_gold'
                  : 'cue_wooden'
              : profile.equippedCue,
          equippedTable: profile.equippedTable,
          equippedEffect: profile.equippedEffect,
          connected: true,
          isBot: subMode === 'vs_ai' || subMode === 'local_2v2_ai',
        };

  const pA2Info: OnlineParticipantMeta | undefined = is2v2
    ? onlineMatch
      ? onlineMatch.playerA2 || {
          uid: 'ai_partner',
          username: 'Ally AI (Pro)',
          avatar: 'avatar_royale',
          frame: 'frame_royal_gold',
          level: 28,
          rating: 1850,
          equippedCue: 'cue_gold',
          equippedTable: profile.equippedTable,
          equippedEffect: profile.equippedEffect,
          connected: true,
          isBot: true,
        }
      : {
          uid: subMode === 'local_2v2_ai' ? 'ai_partner' : 'local_p3',
          username: subMode === 'local_2v2_ai' ? 'Ally AI (Pro)' : 'Player 3',
          avatar: 'avatar_royale',
          frame: subMode === 'local_2v2_ai' ? 'frame_royal_gold' : 'frame_bronze',
          level: subMode === 'local_2v2_ai' ? 28 : profile.level,
          rating: subMode === 'local_2v2_ai' ? 1850 : profile.rating,
          equippedCue: subMode === 'local_2v2_ai' ? 'cue_gold' : profile.equippedCue,
          equippedTable: profile.equippedTable,
          equippedEffect: profile.equippedEffect,
          connected: true,
          isBot: subMode === 'local_2v2_ai',
        }
    : undefined;

  const pB2Info: OnlineParticipantMeta | undefined = is2v2
    ? onlineMatch
      ? onlineMatch.playerB2 || {
          uid: 'ai_opponent_2',
          username: 'Zenn AI II',
          avatar: 'avatar_shark',
          frame: 'frame_royal_gold',
          level: 36,
          rating: 2050,
          equippedCue: 'cue_legendary',
          equippedTable: profile.equippedTable,
          equippedEffect: profile.equippedEffect,
          connected: true,
          isBot: true,
        }
      : {
          uid: subMode === 'local_2v2_ai' ? 'ai_opponent_2' : 'local_p4',
          username: subMode === 'local_2v2_ai' ? 'Zenn AI II' : 'Player 4',
          avatar: 'avatar_shark',
          frame: subMode === 'local_2v2_ai' ? 'frame_royal_gold' : 'frame_bronze',
          level: subMode === 'local_2v2_ai' ? 36 : profile.level,
          rating: subMode === 'local_2v2_ai' ? 2050 : profile.rating,
          equippedCue: subMode === 'local_2v2_ai' ? 'cue_legendary' : profile.equippedCue,
          equippedTable: profile.equippedTable,
          equippedEffect: profile.equippedEffect,
          connected: true,
          isBot: subMode === 'local_2v2_ai',
        }
    : undefined;

  const activeSeatIndex = rules.activeSeatIndex ?? (rules.currentTurn === 'A' ? 0 : 1);
  const seatsMeta: Array<OnlineParticipantMeta | undefined> = [pAInfo, pBInfo, pA2Info, pB2Info];
  const activeShooterMeta = seatsMeta[activeSeatIndex] || (rules.currentTurn === 'A' ? pAInfo : pBInfo);
  const activeCueId = activeShooterMeta.equippedCue || profile.equippedCue;
  const activeTableId = profile.equippedTable || pAInfo.equippedTable;
  const activeEffectId = activeShooterMeta.equippedEffect || profile.equippedEffect;

  const isLocalBotTurn =
    !isOnline &&
    ((subMode === 'vs_ai' && rules.currentTurn === 'B') ||
      (subMode === 'local_2v2_ai' && activeSeatIndex !== 0));
  const isFirestoreHostBotTurn = Boolean(
    isOnline &&
      onlineMatch?.firestoreSync &&
      yourSeatIndex === 0 &&
      is2v2 &&
      activeShooterMeta?.isBot,
  );

  const seatsInfoRef = useRef({
    pAInfo,
    pBInfo,
    pA2Info,
    pB2Info,
    activeSeatIndex,
    activeShooterIsBot: Boolean(activeShooterMeta?.isBot),
  });
  seatsInfoRef.current = {
    pAInfo,
    pBInfo,
    pA2Info,
    pB2Info,
    activeSeatIndex,
    activeShooterIsBot: Boolean(activeShooterMeta?.isBot),
  };

  // Fixed-timestep Physics Simulation Loop when balls are moving
  useEffect(() => {
    if (!simulating) return;

    let rafId = 0;
    let lastTs = performance.now();
    let accumulator = 0;

    const tick = (now: number) => {
      const frameDt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      accumulator += frameDt;

      let stepped = false;
      while (accumulator >= PHYSICS_PARAMS.fixedDt) {
        const events = stepPhysicsFrame(ballsRef.current, localTelemetryRef.current, PHYSICS_PARAMS.fixedDt);
        accumulator -= PHYSICS_PARAMS.fixedDt;
        stepped = true;

        for (const ev of events) {
          pendingEventsRef.current.push(ev);
          if (ev.type === 'ball') audioEngine.playBallCollision(ev.intensity);
          else if (ev.type === 'cushion') audioEngine.playCushionHit(ev.intensity);
          else if (ev.type === 'pocket') {
            audioEngine.playPocketDrop();
            triggerHaptic(settingsRef.current.vibrationEnabled, 20);
          }
        }
      }

      if (stepped) {
        syncPocketedSnapshot();
      }

      if (!areBallsMoving(ballsRef.current)) {
        const curRules = rulesRef.current;
        const sm = seatsInfoRef.current;
        if (!isOnline) {
          // Practice / Solo / 2P / 2v2 / VS Pro AI rules resolution
          setSimulating(false);
          const nextRules = evaluateShotOutcome(curRules, localTelemetryRef.current, ballsRef.current);

          // In Solo Practice, keep active turn on player A unless game over
          if (subMode === 'solo' && nextRules.phase !== 'gameover') {
            nextRules.currentTurn = 'A';
            nextRules.activeSeatIndex = 0;
          }

          const cue = ballsRef.current.find((b) => b.id === 0);
          if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
            const safe = findSafeCueBallSpot(ballsRef.current, nextRules.headstringOnly);
            cue.x = safe.x;
            cue.y = safe.y;
            cue.vx = 0;
            cue.vy = 0;
            cue.pocketed = false;
            cue.pocketAnimProgress = 0;
            cue.pocketedInPocketId = null;
          }

          setRules(nextRules);
          setSpinX(0);
          setSpinY(0);
          setAiPreview(null);
          turnTimeoutDispatchedRef.current = null;
          if (nextRules.phase !== 'gameover') {
            setTurnDeadlineAt(subMode === 'solo' ? null : Date.now() + TURN_DURATION_MS);
            setSecondsLeft(30);
          } else {
            setTurnDeadlineAt(null);
          }
          syncPocketedSnapshot();

          if (nextRules.phase === 'gameover' && nextRules.winner) {
            if (nextRules.winner === 'A') audioEngine.playVictory();
            else audioEngine.playDefeat();
            const dur = Math.max(1, Math.round((Date.now() - practiceStartMsRef.current) / 1000));
            const wonQuick = nextRules.winner === 'A';
            const fallbackRew = isQuickMatchAi
              ? computeMatchRewards(wonQuick, quickMatchFee, nextRules.shotCountA)
              : { coinsEarned: 0, xpEarned: 0 };
            const fallbackDelta = isQuickMatchAi
              ? calculateEloDelta(profileRef.current.rating, sm.pBInfo.rating, wonQuick)
              : 0;

            setResultSummary({
              isPractice: !isQuickMatchAi,
              isLocalPassPlay: subMode === 'local_2p' || subMode === 'local_2v2_pass',
              matchFormat: localFormat,
              winnerSlot: nextRules.winner,
              yourSlot: 'A',
              winReason: nextRules.winReason || `${activeVariant === '9ball' ? '9 Ball' : '8 Ball'} completed!`,
              durationSec: dur,
              playerA: {
                uid: sm.pAInfo.uid,
                username: sm.pAInfo.username,
                avatar: sm.pAInfo.avatar,
                customAvatarUrl: sm.pAInfo.customAvatarUrl,
                frame: sm.pAInfo.frame,
                shots: nextRules.shotCountA,
                potted: nextRules.pottedCountA,
              },
              playerB: {
                uid: sm.pBInfo.uid,
                username: sm.pBInfo.username,
                avatar: sm.pBInfo.avatar,
                customAvatarUrl: sm.pBInfo.customAvatarUrl,
                frame: sm.pBInfo.frame,
                shots: nextRules.shotCountB,
                potted: nextRules.pottedCountB,
              },
              ...(is2v2 && sm.pA2Info ? { playerA2: sm.pA2Info } : {}),
              ...(is2v2 && sm.pB2Info ? { playerB2: sm.pB2Info } : {}),
              xpEarned: fallbackRew.xpEarned,
              coinsEarned: fallbackRew.coinsEarned,
              ratingDelta: fallbackDelta,
              rematchRequestedByOpponent: false,
              rematchRequestedByYou: false,
            });

            if (isQuickMatchAi && !quickMatchSettledRef.current && onSettleQuickMatchRef.current) {
              quickMatchSettledRef.current = true;
              void onSettleQuickMatchRef
                .current({
                  won: wonQuick,
                  entryFee: quickMatchFee,
                  opponent: sm.pBInfo,
                  shots: nextRules.shotCountA,
                  durationSec: dur,
                })
                .then((settled) => {
                  setResultSummary((prev) =>
                    prev
                      ? {
                          ...prev,
                          xpEarned: settled.xpEarned,
                          coinsEarned: settled.coinsEarned,
                          ratingDelta: settled.ratingDelta,
                        }
                      : prev,
                  );
                })
                .catch(() => {});
            }
          }
          return;
        }
        if (isOnline && onlineMatch?.firestoreSync) {
          setSimulating(false);
          const shouldPublishResolution = is2v2
            ? sm.activeSeatIndex === yourSeatIndex || (yourSeatIndex === 0 && sm.activeShooterIsBot)
            : curRules.currentTurn === yourSlot;

          if (shouldPublishResolution) {
            const nextRules = evaluateShotOutcome(curRules, localTelemetryRef.current, ballsRef.current);
            const cue = ballsRef.current.find((b) => b.id === 0);
            if (cue && cue.pocketed && nextRules.phase !== 'gameover') {
              const safe = findSafeCueBallSpot(ballsRef.current, nextRules.headstringOnly);
              cue.x = safe.x;
              cue.y = safe.y;
              cue.vx = 0;
              cue.vy = 0;
              cue.pocketed = false;
              cue.pocketAnimProgress = 0;
              cue.pocketedInPocketId = null;
            }
            const nextDeadline = Date.now() + TURN_DURATION_MS;
            const rulesWithTimer: MatchRulesState = {
              ...nextRules,
              turnDeadlineAt: nextRules.phase === 'gameover' ? null : nextDeadline,
            };
            const nextBalls = ballsRef.current.map((b) => ({ ...b }));
            setRules(rulesWithTimer);
            setSpinX(0);
            setSpinY(0);
            setAiPreview(null);
            turnTimeoutDispatchedRef.current = null;
            setTurnDeadlineAt(nextRules.phase === 'gameover' ? null : nextDeadline);
            syncPocketedSnapshot();

            const nextSeq = firestoreSeqRef.current + 1;
            firestoreSeqRef.current = nextSeq;
            localPublishedSeqsRef.current.add(nextSeq);
            const isOver = rulesWithTimer.phase === 'gameover' && Boolean(rulesWithTimer.winner);
            const winnerId =
              isOver && rulesWithTimer.winner
                ? rulesWithTimer.winner === 'A'
                  ? onlineMatch.playerA.uid
                  : onlineMatch.playerB.uid
                : '';

            enqueueFirestoreWrite(() =>
              pushFirestoreMatchAction(onlineMatch.matchId, {
                currentTurn: rulesWithTimer.currentTurn,
                seq: nextSeq,
                balls: nextBalls,
                rules: rulesWithTimer,
                ...(isOver
                  ? {
                      status: 'completed',
                      winnerId,
                      winReason: rulesWithTimer.winReason || 'Match Complete',
                      endedAt: new Date().toISOString(),
                    }
                  : {}),
                lastAction: {
                  type: 'turn_resolved',
                  actorSlot: curRules.currentTurn,
                  seq: nextSeq,
                  ...(rulesWithTimer.phase === 'gameover' ? {} : { turnDeadlineAt: nextDeadline }),
                  timestamp: Date.now(),
                },
              }).catch(() => {}),
            );
          }
          return;
        }
        // In server-authoritative WS online mode, keep rendering final settle until server emits match:turn_resolved
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    simulating,
    isOnline,
    isQuickMatchAi,
    quickMatchFee,
    onlineMatch,
    yourSlot,
    yourSeatIndex,
    is2v2,
    subMode,
    localFormat,
    activeVariant,
    syncPocketedSnapshot,
  ]);

  // Universal Match Completion Failsafe: guarantees Congratulations modal in ALL modes
  useEffect(() => {
    if (rules.phase !== 'gameover' || resultSummary) return undefined;

    const buildFallbackSummary = (): MatchResultSummary => {
      const sm = seatsInfoRef.current;
      const winSlot: PlayerSlot = rules.winner || 'A';
      const won = winSlot === yourSlot;
      const startRef = isOnline ? firestoreMatchStartMsRef.current : practiceStartMsRef.current;
      const dur = Math.max(1, Math.round((Date.now() - startRef) / 1000));
      const myShots = yourSlot === 'A' ? rules.shotCountA : rules.shotCountB;
      const isPaidMode = Boolean(isOnline || isQuickMatchAi);
      const fee = isOnline ? onlineMatch?.entryFee || 0 : quickMatchFee;
      const rew = isPaidMode ? computeMatchRewards(won, fee, myShots) : { coinsEarned: 0, xpEarned: 0 };
      const oppRating = yourSlot === 'A' ? sm.pBInfo.rating : sm.pAInfo.rating;
      const delta = isPaidMode ? calculateEloDelta(profileRef.current.rating, oppRating, won) : 0;

      return {
        isPractice: !isPaidMode,
        isLocalPassPlay: !isOnline && (subMode === 'local_2p' || subMode === 'local_2v2_pass'),
        isRanked: onlineMatch?.gameMode === 'online_ranked',
        matchFormat: localFormat,
        winnerSlot: winSlot,
        yourSlot,
        winReason: rules.winReason || `${activeVariant === '9ball' ? '9 Ball' : '8 Ball'} completed!`,
        durationSec: dur,
        playerA: {
          uid: sm.pAInfo.uid,
          username: sm.pAInfo.username,
          avatar: sm.pAInfo.avatar,
          customAvatarUrl: sm.pAInfo.customAvatarUrl,
          frame: sm.pAInfo.frame,
          shots: rules.shotCountA,
          potted: rules.pottedCountA,
        },
        playerB: {
          uid: sm.pBInfo.uid,
          username: sm.pBInfo.username,
          avatar: sm.pBInfo.avatar,
          customAvatarUrl: sm.pBInfo.customAvatarUrl,
          frame: sm.pBInfo.frame,
          shots: rules.shotCountB,
          potted: rules.pottedCountB,
        },
        ...(is2v2 && sm.pA2Info ? { playerA2: sm.pA2Info } : {}),
        ...(is2v2 && sm.pB2Info ? { playerB2: sm.pB2Info } : {}),
        xpEarned: rew.xpEarned,
        coinsEarned: rew.coinsEarned,
        ratingDelta: delta,
        rematchRequestedByOpponent: false,
        rematchRequestedByYou: false,
      };
    };

    const delayMs = isOnline ? 850 : 60;
    const tmr = window.setTimeout(() => {
      setResultSummary((prev) => {
        if (prev) return prev;
        const summary = buildFallbackSummary();
        if (summary.winnerSlot === summary.yourSlot) audioEngine.playVictory();
        else audioEngine.playDefeat();
        return summary;
      });
    }, delayMs);
    return () => window.clearTimeout(tmr);
  }, [
    rules.phase,
    rules.winner,
    rules.winReason,
    rules.shotCountA,
    rules.shotCountB,
    rules.pottedCountA,
    rules.pottedCountB,
    resultSummary,
    isOnline,
    isQuickMatchAi,
    quickMatchFee,
    onlineMatch,
    yourSlot,
    localFormat,
    activeVariant,
    is2v2,
  ]);

  // Synchronized 30-second Turn Clock & Auto Turn Timeout
  useEffect(() => {
    const timerActive =
      subMode !== 'solo' &&
      rules.phase !== 'gameover' &&
      !simulating &&
      !showVsBanner &&
      !resultSummary &&
      turnDeadlineAt !== null;

    if (!timerActive) return undefined;

    const tickTimer = () => {
      const syncedNow = Date.now() + serverClockOffsetRef.current;
      const remMs = turnDeadlineAt - syncedNow;
      const sec = Math.max(0, Math.ceil(remMs / 1000));
      setSecondsLeft(sec);

      if (remMs > 0) return;

      const curRules = rulesRef.current;
      if (curRules.phase === 'gameover') return;
      if (turnTimeoutDispatchedRef.current === curRules.turnNumber) return;

      if (!isOnline) {
        turnTimeoutDispatchedRef.current = curRules.turnNumber;
        const nextRules = evaluateTurnTimeout(curRules);
        const nextDeadline = Date.now() + TURN_DURATION_MS;
        setRules(nextRules);
        setPower(0);
        setSpinX(0);
        setSpinY(0);
        setAiPreview(null);
        setTurnDeadlineAt(nextDeadline);
        setSecondsLeft(30);
        audioEngine.playNotification();
        setTimeoutFlash(t(settingsRef.current.language, 'timeExpired'));
        window.setTimeout(() => setTimeoutFlash(null), 2200);
        return;
      }

      if (onlineMatch?.firestoreSync) {
        const sm = seatsInfoRef.current;
        const isActiveOwner = is2v2
          ? sm.activeSeatIndex === yourSeatIndex || (yourSeatIndex === 0 && sm.activeShooterIsBot)
          : curRules.currentTurn === yourSlot;
        const hostFallbackReady = yourSeatIndex === 0 && remMs <= -1200;
        if (!isActiveOwner && !hostFallbackReady) return;

        turnTimeoutDispatchedRef.current = curRules.turnNumber;
        const nextDeadline = Date.now() + TURN_DURATION_MS;
        const nextRules: MatchRulesState = {
          ...evaluateTurnTimeout(curRules),
          turnDeadlineAt: nextDeadline,
        };
        setRules(nextRules);
        setPower(0);
        setSpinX(0);
        setSpinY(0);
        setAiPreview(null);
        setTurnDeadlineAt(nextDeadline);
        setSecondsLeft(30);
        audioEngine.playNotification();
        setTimeoutFlash(t(settingsRef.current.language, 'timeExpired'));
        window.setTimeout(() => setTimeoutFlash(null), 2200);

        const nextSeq = firestoreSeqRef.current + 1;
        firestoreSeqRef.current = nextSeq;
        localPublishedSeqsRef.current.add(nextSeq);
        enqueueFirestoreWrite(() =>
          pushFirestoreMatchAction(onlineMatch.matchId, {
            currentTurn: nextRules.currentTurn,
            seq: nextSeq,
            rules: nextRules,
            lastAction: {
              type: 'turn_timeout',
              actorSlot: curRules.currentTurn,
              seq: nextSeq,
              turnDeadlineAt: nextDeadline,
              timestamp: Date.now(),
            },
          }).catch(() => {}),
        );
      }
    };

    tickTimer();
    const id = window.setInterval(tickTimer, 200);
    return () => window.clearInterval(id);
  }, [
    subMode,
    rules.phase,
    rules.turnNumber,
    simulating,
    showVsBanner,
    resultSummary,
    turnDeadlineAt,
    isOnline,
    onlineMatch,
    is2v2,
    yourSeatIndex,
    yourSlot,
  ]);

  // Pro Computer AI Turn Loop (Comfortable natural pace + visible aim preview + educational strategy reason)
  useEffect(() => {
    if ((!isLocalBotTurn && !isFirestoreHostBotTurn) || simulating || showVsBanner || rules.phase === 'gameover') {
      return undefined;
    }

    let cancelled = false;
    let rafId = 0;
    let shootHoldTimer = 0;
    const effectiveAiDifficulty = subMode === 'local_2v2_ai' || isOnline ? 'pro' : aiDifficulty;
    const aiCueId =
      activeCueId ||
      (effectiveAiDifficulty === 'pro'
        ? 'cue_legendary'
        : effectiveAiDifficulty === 'semipro'
          ? 'cue_gold'
          : 'cue_wooden');

    setAiPreview({
      showGuide: false,
      targetBallId: null,
      reasonEn: t('en', 'aiReadingTable'),
      reasonId: t('id', 'aiReadingTable'),
    });

    const thinkTimer = window.setTimeout(() => {
      if (cancelled) return;
      const curRules = rulesRef.current;

      if (curRules.ballInHand) {
        const spot = chooseAiCueBallPlacement(ballsRef.current, curRules, effectiveAiDifficulty);
        const cue = ballsRef.current.find((b) => b.id === 0);
        if (cue) {
          cue.x = spot.x;
          cue.y = spot.y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
        }
      }

      const plan = computeAiShotPlan(ballsRef.current, curRules, effectiveAiDifficulty);
      const aiShot = plan.shot;
      setAiPreview({
        showGuide: true,
        targetBallId: plan.targetBallId,
        reasonEn: plan.reasonEn,
        reasonId: plan.reasonId,
      });

      if (isFirestoreHostBotTurn && onlineMatch) {
        void pushFirestoreAimState(onlineMatch.matchId, {
          actorSlot: curRules.currentTurn,
          angle: aiShot.angle,
          spinX: aiShot.spinX,
          spinY: aiShot.spinY,
          power: aiShot.power,
          targetBallId: plan.targetBallId ?? undefined,
          aiReasonEn: plan.reasonEn,
          aiReasonId: plan.reasonId,
          timestamp: Date.now(),
        }).catch(() => {});
      }

      const startAngle = aimAngleRef.current;
      let angleDelta = aiShot.angle - startAngle;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;

      const animStart = performance.now();
      const animDuration = 780;

      const stepAiAim = (now: number) => {
        if (cancelled) return;
        const p = Math.min(1, (now - animStart) / animDuration);
        const eased = 1 - Math.pow(1 - p, 3);
        updateAimAngleLocal(startAngle + angleDelta * eased);
        setPower(p < 0.78 ? (p / 0.78) * aiShot.power : aiShot.power);
        setSpinX(aiShot.spinX);
        setSpinY(aiShot.spinY);

        if (p < 1) {
          rafId = requestAnimationFrame(stepAiAim);
        } else {
          // Comfortable 650ms hold so players see the ghost ball & read why before AI shoots
          shootHoldTimer = window.setTimeout(() => {
            if (cancelled) return;
            const latestRules = rulesRef.current;
            if (latestRules.phase === 'gameover') return;
            const cue = ballsRef.current.find((b) => b.id === 0);
            if (cue) {
              pendingEventsRef.current.push({ type: 'cue', intensity: aiShot.power, x: cue.x, y: cue.y });
            }
            strikeFlashRef.current = 1;
            audioEngine.playCueHit(aiShot.power);

            if (isFirestoreHostBotTurn && onlineMatch) {
              const nextSeq = firestoreSeqRef.current + 1;
              firestoreSeqRef.current = nextSeq;
              localPublishedSeqsRef.current.add(nextSeq);
              const botShotWithCue: ShotInput = {
                ...aiShot,
                cueId: aiCueId,
                ...(latestRules.ballInHand && cue ? { cueBallPos: { x: cue.x, y: cue.y } } : {}),
              };
              enqueueFirestoreWrite(() =>
                pushFirestoreMatchAction(onlineMatch.matchId, {
                  seq: nextSeq,
                  lastAction: buildShotAction(latestRules.currentTurn, nextSeq, botShotWithCue),
                }).catch(() => {}),
              );
            }

            applyCueShot(ballsRef.current, aiShot, latestRules.headstringOnly, getCueStats(aiCueId));
            localTelemetryRef.current = {
              firstContactBallId: null,
              pocketedBallIds: [],
              railContactAfterFirstHit: false,
              cushionHitCount: 0,
            };
            setAiPreview((prev) => (prev ? { ...prev, showGuide: false } : null));
            setPower(0);
            setSimulating(true);
          }, 650);
        }
      };

      rafId = requestAnimationFrame(stepAiAim);
    }, 1050);

    return () => {
      cancelled = true;
      window.clearTimeout(thinkTimer);
      if (shootHoldTimer) window.clearTimeout(shootHoldTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    isLocalBotTurn,
    isFirestoreHostBotTurn,
    rules.turnNumber,
    rules.currentTurn,
    activeSeatIndex,
    rules.phase,
    rules.isBreakShot,
    rules.ballInHand,
    subMode,
    aiDifficulty,
    activeCueId,
    isOnline,
    onlineMatch,
    simulating,
    showVsBanner,
    updateAimAngleLocal,
  ]);

  const isBotTurn = isLocalBotTurn || isFirestoreHostBotTurn;
  const canShoot =
    !simulating &&
    !showVsBanner &&
    rules.phase !== 'gameover' &&
    !isBotTurn &&
    (!isOnline || (is2v2 ? activeSeatIndex === yourSeatIndex : rules.currentTurn === yourSlot));

  const handleAimChange = useCallback(
    (nextAngle: number) => {
      updateAimAngleLocal(nextAngle);
      if (isOnline && onlineMatch && canShoot) {
        if (onlineMatch.firestoreSync) {
          const now = Date.now();
          if (now - firestoreLastAimAtRef.current < 160) return;
          firestoreLastAimAtRef.current = now;
          void pushFirestoreAimState(onlineMatch.matchId, {
            actorSlot: yourSlot,
            angle: nextAngle,
            spinX,
            spinY,
            power,
            timestamp: now,
          }).catch(() => {});
          return;
        }

        wsClient.send({
          type: 'match:aim',
          matchId: onlineMatch.matchId,
          angle: nextAngle,
          spinX,
          spinY,
          power,
        });
      }
    },
    [isOnline, onlineMatch, canShoot, yourSlot, spinX, spinY, power, updateAimAngleLocal],
  );

  const handlePlaceCueBall = (x: number, y: number) => {
    if (isOnline && onlineMatch && canShoot && rules.ballInHand) {
      if (onlineMatch.firestoreSync) {
        const cue = ballsRef.current.find((b) => b.id === 0);
        if (cue) {
          cue.x = x;
          cue.y = y;
          cue.pocketed = false;
          cue.pocketAnimProgress = 0;
        }
        const nextSeq = firestoreSeqRef.current + 1;
        firestoreSeqRef.current = nextSeq;
        localPublishedSeqsRef.current.add(nextSeq);
        enqueueFirestoreWrite(() =>
          pushFirestoreMatchAction(onlineMatch.matchId, {
            seq: nextSeq,
            lastAction: {
              type: 'place_cue_ball',
              actorSlot: yourSlot,
              seq: nextSeq,
              x,
              y,
              timestamp: Date.now(),
            },
          }).catch(() => {}),
        );
        return;
      }

      wsClient.send({
        type: 'match:place_cue_ball',
        matchId: onlineMatch.matchId,
        x,
        y,
      });
    }
  };

  const handleShoot = useCallback(
    (shotPower: number) => {
      if (!canShoot) return;
      const cue = ballsRef.current.find((b) => b.id === 0);
      if (!cue) return;

      const shot: ShotInput = {
        angle: aimAngleRef.current,
        power: shotPower,
        spinX,
        spinY,
        cueBallPos: rules.ballInHand ? { x: cue.x, y: cue.y } : undefined,
        cueId: activeCueId,
      };

      if (isOnline && onlineMatch && !onlineMatch.firestoreSync) {
        wsClient.send({
          type: 'match:shot',
          matchId: onlineMatch.matchId,
          ...shot,
        });
      } else {
        if (isOnline && onlineMatch?.firestoreSync) {
          const nextSeq = firestoreSeqRef.current + 1;
          firestoreSeqRef.current = nextSeq;
          localPublishedSeqsRef.current.add(nextSeq);
          enqueueFirestoreWrite(() =>
            pushFirestoreMatchAction(onlineMatch.matchId, {
              seq: nextSeq,
              lastAction: buildShotAction(yourSlot, nextSeq, shot),
            }).catch(() => {}),
          );
        }

        setAiPreview(null);
        pendingEventsRef.current.push({ type: 'cue', intensity: shotPower, x: cue.x, y: cue.y });
        strikeFlashRef.current = 1;
        audioEngine.playCueHit(shotPower);
        triggerHaptic(settings.vibrationEnabled, Math.round(10 + shotPower * 25));
        applyCueShot(ballsRef.current, shot, rules.headstringOnly, getCueStats(activeCueId));
        localTelemetryRef.current = {
          firstContactBallId: null,
          pocketedBallIds: [],
          railContactAfterFirstHit: false,
          cushionHitCount: 0,
        };
        setSimulating(true);
      }
    },
    [
      activeCueId,
      canShoot,
      isOnline,
      onlineMatch,
      rules.ballInHand,
      rules.headstringOnly,
      settings.vibrationEnabled,
      spinX,
      spinY,
      yourSlot,
    ],
  );

  // Desktop customizable keyboard controls (Aim Left/Right, Power Up/Down, Shoot)
  useEffect(() => {
    if (!canShoot || simulating) return undefined;
    const bindings = normalizeKeyBindings(settings.keyBindings);
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        shouldIgnoreHotkey({
          tagName: el?.tagName,
          isContentEditable: Boolean(el?.isContentEditable),
          hasOpenModal: Boolean(customizerOpen || chatOpen || controlsGuideOpen || resultSummary),
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
        })
      ) {
        return;
      }

      if (matchesBinding(e, bindings.aimLeft)) {
        e.preventDefault();
        handleAimChange(aimAngleRef.current - (e.shiftKey ? 0.002 : 0.012));
      } else if (matchesBinding(e, bindings.aimRight)) {
        e.preventDefault();
        handleAimChange(aimAngleRef.current + (e.shiftKey ? 0.002 : 0.012));
      } else if (matchesBinding(e, bindings.powerUp)) {
        e.preventDefault();
        setPower((prev) => Math.min(1, Math.max(0.16, prev + 0.08)));
      } else if (matchesBinding(e, bindings.powerDown)) {
        e.preventDefault();
        setPower((prev) => Math.max(0, prev - 0.08));
      } else if (matchesBinding(e, bindings.shoot)) {
        e.preventDefault();
        const chosenPower = Math.max(0.32, powerRef.current);
        setPower(0);
        handleShoot(chosenPower);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canShoot,
    simulating,
    settings.keyBindings,
    customizerOpen,
    chatOpen,
    controlsGuideOpen,
    resultSummary,
    handleAimChange,
    handleShoot,
  ]);

  const fineHoldTimerRef = useRef<number | null>(null);
  const stopFineHold = useCallback(() => {
    if (fineHoldTimerRef.current !== null) {
      window.clearInterval(fineHoldTimerRef.current);
      fineHoldTimerRef.current = null;
    }
  }, []);
  useEffect(() => stopFineHold, [stopFineHold]);

  const startFineHold = (dir: -1 | 1) => {
    if (!canShoot) return;
    stopFineHold();
    audioEngine.unlock();
    audioEngine.playAimTick();
    handleAimChange(aimAngleRef.current + dir * 0.005);
    fineHoldTimerRef.current = window.setInterval(() => {
      handleAimChange(aimAngleRef.current + dir * 0.0045);
    }, 55);
  };

  const sendChat = (text: string, emote = '') => {
    if (!onlineMatch) return;
    if (onlineMatch.firestoreSync) {
      const nextSeq = firestoreSeqRef.current + 1;
      firestoreSeqRef.current = nextSeq;
      enqueueFirestoreWrite(() =>
        pushFirestoreMatchAction(onlineMatch.matchId, {
          seq: nextSeq,
          lastAction: {
            type: 'chat',
            actorSlot: yourSlot,
            seq: nextSeq,
            text,
            emote,
            senderUid: profile.uid,
            senderName: profile.username,
            timestamp: Date.now(),
          },
        }).catch(() => {}),
      );
      return;
    }

    wsClient.send({
      type: 'match:chat',
      matchId: onlineMatch.matchId,
      text,
      emote,
    });
  };

  const currentSuit: BallSuit = getPlayerGroup(rules, rules.currentTurn);
  const currentTargetNumber =
    activeVariant === '9ball'
      ? rules.targetBallNumber ?? getLowestObjectBallNumber(ballsRef.current)
      : null;

  const renderRemainingBalls = (suit: BallSuit, isSlotTurn: boolean) => {
    if (activeVariant === '9ball') {
      const remaining9 = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
        (n) => !pocketedSnapshot.includes(n),
      );
      return (
        <div className="flex items-center gap-0.5 sm:gap-1 bg-black/45 px-2 py-1 rounded-full border border-white/10">
          {remaining9.slice(0, 7).map((n) => {
            const color = BALL_COLORS[n]?.base || '#fff';
            const isTarget = isSlotTurn && n === currentTargetNumber;
            return (
              <span
                key={n}
                title={`Ball ${n}`}
                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-extrabold shadow-sm ${
                  isTarget ? 'ring-2 ring-amber-400 scale-110' : 'border border-white/30 opacity-85'
                }`}
                style={{
                  background:
                    n === 9
                      ? `linear-gradient(to bottom, #f8fafc 22%, ${color} 22%, ${color} 78%, #f8fafc 78%)`
                      : color,
                  color: n === 9 || n === 1 ? '#09090b' : '#fff',
                }}
              >
                {n}
              </span>
            );
          })}
        </div>
      );
    }

    if (!suit) {
      return (
        <div className="flex items-center gap-1 bg-black/55 px-2 py-1 rounded-full border border-white/10">
          {[1, 2, 3, 4, 5, 6, 7].map((slotIdx) => (
            <span
              key={slotIdx}
              className="w-3.5 h-3.5 rounded-full bg-[#090a0d] border border-white/15 shadow-inner"
            />
          ))}
        </div>
      );
    }
    const nums = suit === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    const remaining = nums.filter((n) => !pocketedSnapshot.includes(n));
    if (remaining.length === 0 && !pocketedSnapshot.includes(8)) {
      return (
        <div className="flex items-center gap-1.5 bg-black/55 px-2.5 py-1 rounded-full border border-amber-400/50">
          <span className="w-4 h-4 rounded-full bg-zinc-950 border border-white/60 text-[9px] font-extrabold flex items-center justify-center text-white shadow">
            8
          </span>
          <span className="text-[10px] font-bold text-amber-300">8 Ball</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 bg-black/55 px-2 py-1 rounded-full border border-white/15">
        {nums.map((n) => {
          const isPocketed = pocketedSnapshot.includes(n);
          if (isPocketed) {
            return (
              <span
                key={n}
                className="w-3.5 h-3.5 rounded-full bg-[#090a0d] border border-white/10 shadow-inner"
              />
            );
          }
          const color = BALL_COLORS[n]?.base || '#fff';
          return (
            <span
              key={n}
              title={`Ball ${n}`}
              className="w-3.5 h-3.5 rounded-full border border-white/35 flex items-center justify-center text-[8px] font-extrabold shadow-sm"
              style={{
                background:
                  n > 8
                    ? `linear-gradient(to bottom, #f8fafc 22%, ${color} 22%, ${color} 78%, #f8fafc 78%)`
                    : color,
                color: n <= 8 ? '#fff' : '#09090b',
              }}
            >
              {n}
            </span>
          );
        })}
      </div>
    );
  };

  const lang = settings.language;
  const turnBanner =
    rules.phase === 'gameover'
      ? rules.winReason || 'Game Over'
      : isOnline
        ? is2v2
          ? activeSeatIndex === yourSeatIndex
            ? rules.ballInHand
              ? t(lang, 'ballInHand')
              : t(lang, 'yourTurn')
            : `${activeShooterMeta.username}${rules.currentTurn === yourSlot ? ' (Ally)' : ''}`
          : rules.currentTurn === yourSlot
            ? rules.ballInHand
              ? t(lang, 'ballInHand')
              : t(lang, 'yourTurn')
            : t(lang, 'opponentTurn')
        : subMode === 'local_2v2_ai'
          ? activeSeatIndex === 0
            ? rules.ballInHand
              ? t(lang, 'ballInHand')
              : rules.isBreakShot
                ? t(lang, 'breakShot')
                : t(lang, 'yourTurn')
            : `${activeShooterMeta.username} Turn`
          : subMode === 'local_2v2_pass'
            ? `${activeShooterMeta.username} · Team ${rules.currentTurn}${rules.ballInHand ? ' · Ball in Hand' : ''}`
            : subMode === 'vs_ai'
              ? rules.currentTurn === 'B'
                ? t(lang, 'computerTurn')
                : rules.ballInHand
                  ? t(lang, 'ballInHand')
                  : rules.isBreakShot
                    ? t(lang, 'breakShot')
                    : t(lang, 'yourTurn')
              : subMode === 'local_2p'
                ? `Player ${rules.currentTurn} Turn${rules.ballInHand ? ' · Ball in Hand' : ''}`
                : rules.ballInHand
                  ? t(lang, 'ballInHand')
                  : rules.isBreakShot
                    ? t(lang, 'breakShot')
                    : t(lang, 'yourTurn');

  const ownedTables = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'table' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const ownedCues = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'cue' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const ownedVenues = SHOP_CATALOG.filter(
    (item) =>
      item.category === 'venue' &&
      (item.price === 0 || profile.ownedItems.includes(item.id)),
  );
  const activeVenueId = profile.equippedVenue || pAInfo.equippedVenue || 'venue_billiard_cafe';
  const activeVenue = getVenueMeta(activeVenueId);

  const handleFinishSoloPractice = () => {
    audioEngine.playClick();
    const curRules = rulesRef.current;
    const dur = Math.max(1, Math.round((Date.now() - practiceStartMsRef.current) / 1000));
    setResultSummary({
      isPractice: true,
      isLocalPassPlay: true,
      matchFormat: localFormat,
      winnerSlot: 'A',
      yourSlot: 'A',
      winReason:
        lang === 'id'
          ? `Latihan selesai — ${curRules.pottedCountA} bola masuk dalam ${curRules.shotCountA} sodokan.`
          : `Solo drill complete — ${curRules.pottedCountA} potted in ${curRules.shotCountA} shots.`,
      durationSec: dur,
      playerA: {
        uid: pAInfo.uid,
        username: pAInfo.username,
        avatar: pAInfo.avatar,
        customAvatarUrl: pAInfo.customAvatarUrl,
        frame: pAInfo.frame,
        shots: curRules.shotCountA,
        potted: curRules.pottedCountA,
      },
      playerB: {
        uid: 'practice_drill',
        username: lang === 'id' ? 'Target Latihan' : 'Solo Drill',
        avatar: 'avatar_royale',
        frame: 'frame_bronze',
        shots: 0,
        potted: 0,
      },
      xpEarned: 0,
      coinsEarned: 0,
      ratingDelta: 0,
      rematchRequestedByOpponent: false,
      rematchRequestedByYou: false,
    });
  };

  const pocketedObjectBalls = pocketedSnapshot.filter((id) => id > 0);
  const potAmount = onlineMatch?.entryFee
    ? onlineMatch.entryFee * (is2v2 ? 4 : 2)
    : isQuickMatchAi && quickMatchFee > 0
      ? quickMatchFee * 2
      : 0;
  const bindings = normalizeKeyBindings(settings.keyBindings);

  return (
    <div
      data-venue={activeVenue.id}
      className={`h-[100dvh] w-screen text-zinc-100 flex flex-col overflow-hidden select-none relative ${activeVenue.backdropClass}`}
    >
      {/* Subtle architectural room lighting behind table (zero canvas blur) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(ellipse 74% 58% at 50% 54%, ${activeVenue.ambientGlow} 0%, transparent 72%)`,
        }}
      />
      {/* Luxury Broadcast Tournament Top HUD */}
      <header className="relative z-20 px-2.5 sm:px-5 py-2 bg-gradient-to-b from-[#131621]/96 via-[#0c0e15]/96 to-[#080a0f]/98 border-b border-amber-400/20 shadow-[0_10px_28px_rgba(0,0,0,0.68)] flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-2 gap-y-2 shrink-0">
        {/* Left Zone: Exit Button + Team A Player Plate */}
        <div className="order-1 flex items-center gap-2 sm:gap-3 min-w-0 lg:flex-1">
          <button
            type="button"
            aria-label={lang === 'id' ? 'Keluar ke Beranda' : 'Exit to Main Menu'}
            onClick={() => {
              audioEngine.playClick();
              if (isOnline && rules.phase !== 'gameover' && onlineMatch) {
                if (onlineMatch.firestoreSync) {
                  const winnerUid = yourSlot === 'A' ? onlineMatch.playerB.uid : onlineMatch.playerA.uid;
                  const nextSeq = firestoreSeqRef.current + 1;
                  enqueueFirestoreWrite(() =>
                    pushFirestoreMatchAction(onlineMatch.matchId, {
                      status: 'completed',
                      winnerId: winnerUid,
                      winReason: 'Opponent conceded the match.',
                      endedAt: new Date().toISOString(),
                      seq: nextSeq,
                      lastAction: {
                        type: 'concede',
                        actorSlot: yourSlot,
                        seq: nextSeq,
                        timestamp: Date.now(),
                      },
                    }).catch(() => {}),
                  );
                } else {
                  wsClient.send({ type: 'match:concede', matchId: onlineMatch.matchId });
                }
              }
              wsClient.setActiveReconnectInfo(null);
              onExitToMenu();
            }}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl neu-btn-crimson flex items-center justify-center shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            data-testid="team-a-hud"
            className={`relative flex items-center gap-2.5 px-2.5 sm:px-3.5 py-1.5 rounded-2xl border transition-all min-w-0 ${
              rules.currentTurn === 'A'
                ? 'bg-gradient-to-r from-[#222534] via-[#191c28] to-[#131620] border-amber-400/80 shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.16)]'
                : 'bg-[#0e1017]/95 border-white/10 opacity-85'
            }`}
          >
            <div className="flex items-center gap-1 shrink-0">
              <div className={is2v2 && activeSeatIndex === 0 ? 'ring-2 ring-amber-300 rounded-full' : ''}>
                <PlayerAvatar avatarId={pAInfo.avatar} customAvatarUrl={pAInfo.customAvatarUrl} frameId={pAInfo.frame} username={pAInfo.username} size="sm" />
              </div>
              {is2v2 && pA2Info && (
                <div className={activeSeatIndex === 2 ? 'ring-2 ring-amber-300 rounded-full' : 'opacity-80'}>
                  <PlayerAvatar avatarId={pA2Info.avatar} customAvatarUrl={pA2Info.customAvatarUrl} frameId={pA2Info.frame} username={pA2Info.username} size="sm" />
                </div>
              )}
            </div>

            <div className="hidden sm:flex flex-col items-start gap-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-300/30 text-[9px] font-mono-tabular font-black text-amber-300 inline-flex items-center gap-0.5 shrink-0">
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                  <span>{activeSeatIndex === 2 && pA2Info ? pA2Info.level : pAInfo.level}</span>
                </span>
                <span className="text-xs font-display font-bold text-[#f8f5ee] truncate max-w-[132px]">
                  {is2v2 && pA2Info
                    ? activeSeatIndex === 2
                      ? `${pA2Info.username} (A2)`
                      : `${pAInfo.username} · Team A`
                    : pAInfo.username}
                </span>
              </div>
              {renderRemainingBalls(rules.groupA, rules.currentTurn === 'A')}
            </div>
          </div>
        </div>

        {/* Mobile Row Break */}
        <div className="basis-full h-px bg-white/10 lg:hidden order-4" />

        {/* Center Zone: Symmetrical Match Plate + Clock + Crisp Turn Status */}
        <div className="order-5 lg:order-2 flex flex-col items-center justify-center text-center min-w-0 px-1 sm:px-2 shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-2xl bg-[#131622] border border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-400/12 border border-amber-400/35 text-amber-300">
              <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-mono-tabular font-black text-[11px] sm:text-xs tracking-wide text-[#f8f5ee]">
                {potAmount > 0
                  ? potAmount.toLocaleString()
                  : `${activeVariant === '9ball' ? t(lang, 'nineBall').toUpperCase() : t(lang, 'eightBall').toUpperCase()}${is2v2 ? ' 2v2' : ''}`}
              </span>
            </div>

            {subMode !== 'solo' && rules.phase !== 'gameover' && (
              <div
                data-testid="turn-timer"
                aria-label={t(lang, 'turnTimer')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border font-mono-tabular font-black text-[11px] sm:text-xs transition-colors ${
                  secondsLeft <= 5
                    ? 'bg-red-700 border-red-300 text-white animate-pulse'
                    : secondsLeft <= 10
                      ? 'bg-amber-400 border-amber-200 text-zinc-950'
                      : 'bg-white/[0.06] border-white/15 text-zinc-100'
                }`}
              >
                <Clock className="w-3 h-3 shrink-0" />
                <span>{simulating ? '..' : `${secondsLeft}s`}</span>
              </div>
            )}

            {isOnline && (
              <div
                data-testid="online-signal-badge"
                title={
                  onlineMatch?.firestoreSync
                    ? 'Live Cloud Sync'
                    : localWsStatus === 'connected'
                      ? `Live Signal (${wsLatencyMs ?? '--'}ms)`
                      : 'Reconnecting'
                }
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/35 border border-white/10 font-mono-tabular font-bold text-[10px] text-zinc-200"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    onlineMatch?.firestoreSync || localWsStatus === 'connected'
                      ? 'bg-emerald-400'
                      : localWsStatus === 'connecting'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-red-500'
                  }`}
                />
                <span>
                  {onlineMatch?.firestoreSync
                    ? 'SYNC'
                    : localWsStatus === 'connected'
                      ? wsLatencyMs !== null
                        ? `${wsLatencyMs}ms`
                        : 'LIVE'
                      : '...'}
                </span>
              </div>
            )}
          </div>

          <div
            data-testid="turn-indicator"
            className={`text-[10px] sm:text-[11px] font-bold truncate max-w-[220px] sm:max-w-[300px] mt-1 tracking-wide ${
              timeoutFlash || rules.foulReason
                ? 'text-amber-300'
                : rules.ballInHand
                  ? 'text-sky-300'
                  : 'text-[#d7c6a5]'
            }`}
          >
            {timeoutFlash || rules.foulReason || turnBanner}
          </div>
        </div>

        {/* Right Zone: Team B Player Plate + Utility Control Bar + Spin Dial */}
        <div className="order-2 lg:order-3 ml-auto lg:ml-0 flex items-center justify-end gap-2 sm:gap-2.5 min-w-0 lg:flex-1">
          <div
            data-testid="team-b-hud"
            className={`relative flex items-center gap-2.5 px-2.5 sm:px-3.5 py-1.5 rounded-2xl border transition-all min-w-0 ${
              rules.currentTurn === 'B'
                ? 'bg-gradient-to-l from-[#2b151c] via-[#1f1419] to-[#141016] border-red-400/80 shadow-[0_0_22px_rgba(239,68,68,0.22),inset_0_1px_0_rgba(255,255,255,0.14)]'
                : 'bg-[#0e1017]/95 border-white/10 opacity-85'
            }`}
          >
            <div className="hidden sm:flex flex-col items-end gap-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-display font-bold text-[#f8f5ee] truncate max-w-[132px]">
                  {is2v2 && pB2Info
                    ? activeSeatIndex === 3
                      ? `${pB2Info.username} (B2)`
                      : `${pBInfo.username} · Team B`
                    : pBInfo.username}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-300/30 text-[9px] font-mono-tabular font-black text-amber-300 inline-flex items-center gap-0.5 shrink-0">
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                  <span>{activeSeatIndex === 3 && pB2Info ? pB2Info.level : pBInfo.level}</span>
                </span>
              </div>
              <div className="flex justify-end">{renderRemainingBalls(rules.groupB, rules.currentTurn === 'B')}</div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <div className={is2v2 && activeSeatIndex === 1 ? 'ring-2 ring-amber-300 rounded-full' : ''}>
                <PlayerAvatar avatarId={pBInfo.avatar} customAvatarUrl={pBInfo.customAvatarUrl} frameId={pBInfo.frame} username={pBInfo.username} size="sm" />
              </div>
              {is2v2 && pB2Info && (
                <div className={activeSeatIndex === 3 ? 'ring-2 ring-amber-300 rounded-full' : 'opacity-80'}>
                  <PlayerAvatar avatarId={pB2Info.avatar} customAvatarUrl={pB2Info.customAvatarUrl} frameId={pB2Info.frame} username={pB2Info.username} size="sm" />
                </div>
              )}
            </div>
          </div>

          <div className="order-3 shrink-0 pl-0.5 lg:hidden">
            <SpinControl
              variant="compact"
              language={lang}
              spinX={spinX}
              spinY={spinY}
              disabled={!canShoot}
              onChange={(x, y) => {
                setSpinX(x);
                setSpinY(y);
              }}
            />
          </div>
        </div>

        {/* Unified Utility Dock + Desktop Spin Dial */}
        <div className="order-6 lg:order-4 ml-auto lg:ml-0 flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#11141e] border border-white/12 shadow-inner">
            <button
              type="button"
              aria-label={t(lang, 'controlsGuideTitle')}
              data-testid="controls-guide-btn"
              onClick={() => {
                audioEngine.playClick();
                setControlsGuideOpen((v) => !v);
                setCustomizerOpen(false);
              }}
              className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-200 hover:text-amber-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {!isOnline && onQuickEquip && (
              <button
                type="button"
                aria-label={lang === 'id' ? 'Ubah Meja dan Stik' : 'Customize Table & Cue'}
                data-testid="ingame-customizer-btn"
                onClick={() => {
                  audioEngine.playClick();
                  setCustomizerOpen((v) => !v);
                  setControlsGuideOpen(false);
                }}
                className="hidden sm:inline-flex w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-200 hover:text-amber-300 items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <Palette className="w-4 h-4" />
              </button>
            )}

            {!isOnline && subMode === 'solo' && (
              <button
                type="button"
                aria-label={t(lang, 'finishPractice')}
                data-testid="finish-practice-btn"
                onClick={handleFinishSoloPractice}
                className="h-8 px-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-[11px] font-bold text-emerald-300 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <Flag className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t(lang, 'finishPractice')}</span>
              </button>
            )}

            {!isOnline && (
              <button
                type="button"
                aria-label={lang === 'id' ? 'Susun Ulang Bola' : 'Rerack Balls'}
                onClick={resetPracticeMatch}
                data-testid="rerack-btn"
                className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-amber-400 hover:text-amber-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            {isOnline && (
              <button
                type="button"
                aria-label={lang === 'id' ? 'Buka Obrolan Pertandingan' : 'Toggle Match Chat'}
                onClick={() => {
                  audioEngine.playClick();
                  setChatOpen((o) => !o);
                }}
                className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-amber-400 hover:text-amber-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              aria-label={settings.sfxEnabled ? 'Mute Audio' : 'Unmute Audio'}
              onClick={() => onUpdateSettings({ ...settings, sfxEnabled: !settings.sfxEnabled })}
              className="hidden sm:inline-flex w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-200 hover:text-amber-300 items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              {settings.sfxEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {fullscreenSupported && (
              <button
                type="button"
                data-testid="fullscreen-toggle-btn"
                aria-label={
                  isFullscreen
                    ? `${t(lang, 'exitFullscreen')} (${t(lang, 'escToExit')})`
                    : t(lang, 'fullscreen')
                }
                title={
                  isFullscreen
                    ? `${t(lang, 'exitFullscreen')} (${t(lang, 'escToExit')})`
                    : `${t(lang, 'fullscreen')} (${t(lang, 'escToExit')})`
                }
                onClick={() => {
                  audioEngine.playClick();
                  void toggleFullscreen();
                }}
                className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-200 hover:text-amber-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}
          </div>

          <div className="hidden lg:block pl-1 shrink-0">
            <SpinControl
              variant="compact"
              language={lang}
              spinX={spinX}
              spinY={spinY}
              disabled={!canShoot}
              onChange={(x, y) => {
                setSpinX(x);
                setSpinY(y);
              }}
            />
          </div>
        </div>
      </header>

      {/* Main Playfield Viewport (>=85% unobstructed area) */}
      <main className="relative z-10 flex-1 grid grid-cols-2 grid-rows-[1fr_auto] sm:flex sm:flex-row items-center justify-between p-1 sm:p-2 gap-1.5 sm:gap-2.5 overflow-hidden">
        {/* Left Precision Fine-Aim Micro Adjuster (bottom-left on mobile, left dock on desktop) */}
        <div className="col-start-1 row-start-2 justify-self-start self-end sm:self-center sm:order-1 flex flex-col items-center justify-center gap-1.5 pl-1 pb-1 sm:pb-0 z-10 shrink-0">
          <div className="flex flex-row sm:flex-col items-center gap-2 sm:gap-1.5 bg-[#0e1015]/95 border border-white/15 rounded-2xl px-3 py-1.5 sm:p-2 shadow-2xl">
            <Crosshair className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <button
              type="button"
              aria-label={lang === 'id' ? 'Geser Bidikan Kiri' : 'Aim Fine Left'}
              disabled={!canShoot}
              onPointerDown={() => startFineHold(-1)}
              onPointerUp={stopFineHold}
              onPointerLeave={stopFineHold}
              onPointerCancel={stopFineHold}
              className="w-8 h-8 rounded-xl bg-[#181b24] border border-white/15 flex items-center justify-center text-zinc-200 hover:text-amber-300 hover:border-amber-400/50 disabled:opacity-40 transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <div className="text-[10px] sm:text-[9px] font-mono-tabular text-amber-300 font-bold leading-none py-0.5 min-w-[28px] text-center">
              {Math.round((((aimAngle * 180) / Math.PI) % 360 + 360) % 360)}°
            </div>
            <button
              type="button"
              aria-label={lang === 'id' ? 'Geser Bidikan Kanan' : 'Aim Fine Right'}
              disabled={!canShoot}
              onPointerDown={() => startFineHold(1)}
              onPointerUp={stopFineHold}
              onPointerLeave={stopFineHold}
              onPointerCancel={stopFineHold}
              className="w-8 h-8 rounded-xl bg-[#181b24] border border-white/15 flex items-center justify-center text-zinc-200 hover:text-amber-300 hover:border-amber-400/50 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold">
              Fine
            </span>
          </div>
        </div>

        {/* Center Billiard Table Canvas with External Bottom Ball Return Channel */}
        <div className="col-span-2 row-start-1 sm:order-2 flex-1 w-full h-full flex items-center justify-center min-w-0 min-h-0">
          <BilliardCanvas
            ballsRef={ballsRef}
            pendingEventsRef={pendingEventsRef}
            aimAngle={aimAngle}
            onAimChange={handleAimChange}
            power={power}
            spinX={spinX}
            spinY={spinY}
            canShoot={canShoot}
            isSimulating={simulating}
            ballInHand={rules.ballInHand}
            headstringOnly={rules.headstringOnly}
            currentGroup={currentSuit}
            isBreakShot={rules.isBreakShot}
            gameVariant={activeVariant}
            targetBallNumber={currentTargetNumber}
            showAiAimGuide={Boolean(aiPreview?.showGuide)}
            aiTargetBallId={aiPreview?.targetBallId ?? null}
            isBotTurn={isBotTurn}
            equippedCueId={activeCueId}
            equippedTableId={activeTableId}
            equippedEffectId={activeEffectId}
            settings={settings}
            onPlaceCueBall={handlePlaceCueBall}
            strikeFlashRef={strikeFlashRef}
            currentTurnLabel={rules.currentTurn}
            phaseLabel={rules.phase}
            pocketedObjectBalls={pocketedObjectBalls}
          />
        </div>

        {/* In-Game Controls Guide Popover */}
        {controlsGuideOpen && (
          <div className="liquid-metal-border absolute top-3 right-4 z-30 w-80 bg-[#12141a] text-zinc-100 shadow-2xl rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-extrabold text-zinc-100">
                {t(lang, 'controlsGuideTitle')}
              </span>
              <button
                type="button"
                onClick={() => setControlsGuideOpen(false)}
                className="text-xs font-bold text-amber-300 hover:text-amber-200"
              >
                {lang === 'id' ? 'Tutup' : 'Done'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {t(lang, 'controlsTouchMouse')}
            </p>
            <div className="space-y-1.5 pt-1 text-[11px]">
              <div className="flex items-center justify-between bg-[#0b0c10] border border-white/10 rounded-lg px-2.5 py-1.5">
                <span className="text-zinc-300 font-semibold">{t(lang, 'keyAimLeft')}</span>
                <span className="font-mono-tabular font-bold text-zinc-100">
                  {formatKeyLabel(bindings.aimLeft)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-[#0b0c10] border border-white/10 rounded-lg px-2.5 py-1.5">
                <span className="text-zinc-300 font-semibold">{t(lang, 'keyAimRight')}</span>
                <span className="font-mono-tabular font-bold text-zinc-100">
                  {formatKeyLabel(bindings.aimRight)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-[#0b0c10] border border-white/10 rounded-lg px-2.5 py-1.5">
                <span className="text-zinc-300 font-semibold">{t(lang, 'keyPowerUp')}</span>
                <span className="font-mono-tabular font-bold text-zinc-100">
                  {formatKeyLabel(bindings.powerUp)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-[#0b0c10] border border-white/10 rounded-lg px-2.5 py-1.5">
                <span className="text-zinc-300 font-semibold">{t(lang, 'keyPowerDown')}</span>
                <span className="font-mono-tabular font-bold text-zinc-100">
                  {formatKeyLabel(bindings.powerDown)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-amber-500/15 rounded-lg px-2.5 py-1.5 border border-amber-400/40">
                <span className="text-amber-200 font-semibold">{t(lang, 'keyShoot')}</span>
                <span className="font-mono-tabular font-bold text-amber-300">
                  {formatKeyLabel(bindings.shoot)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Live In-Game Table & Cue Customizer Popover */}
        {!isOnline && customizerOpen && onQuickEquip && (
          <div className="liquid-metal-border absolute top-3 right-4 z-30 w-72 bg-[#12141a] text-zinc-100 shadow-2xl rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-extrabold text-zinc-100">
                {lang === 'id' ? 'Pilih Meja & Stik' : 'Table & Cue Switcher'}
              </span>
              <button
                type="button"
                onClick={() => setCustomizerOpen(false)}
                className="text-[11px] font-bold text-amber-300 hover:text-amber-200"
              >
                {lang === 'id' ? 'Selesai' : 'Done'}
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                {lang === 'id' ? 'Taplak Meja' : 'Table Cloth'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedTables.map((tbl) => (
                  <button
                    key={tbl.id}
                    type="button"
                    onClick={() => onQuickEquip(tbl.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${
                      profile.equippedTable === tbl.id
                        ? 'neu-btn-gold'
                        : 'neu-inset text-zinc-300'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-white/25"
                      style={{ backgroundColor: tbl.primaryColor }}
                    />
                    <span>{tbl.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                {lang === 'id' ? 'Stik Biliar' : 'Cue Stick'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedCues.map((cue) => (
                  <button
                    key={cue.id}
                    type="button"
                    onClick={() => onQuickEquip(cue.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${
                      profile.equippedCue === cue.id
                        ? 'neu-btn-gold'
                        : 'neu-inset text-zinc-300'
                    }`}
                  >
                    {cue.name.replace(' Cue', '')}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                {t(lang, 'venue')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedVenues.map((ven) => (
                  <button
                    key={ven.id}
                    type="button"
                    onClick={() => onQuickEquip(ven.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer ${
                      (profile.equippedVenue || 'venue_billiard_cafe') === ven.id
                        ? 'neu-btn-gold'
                        : 'neu-inset text-zinc-300'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-white/25"
                      style={{ backgroundColor: ven.primaryColor }}
                    />
                    <span>{ven.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right Perimeter: Tall Precision Cue Power Bar (bottom-right on mobile, right dock on desktop) */}
        <div className="col-start-2 row-start-2 justify-self-end self-end sm:self-center sm:order-3 flex items-center pr-1 pb-1 sm:pb-0 z-10">
          <PowerBar
            disabled={!canShoot}
            power={power}
            onPowerChange={setPower}
            onShoot={handleShoot}
          />
        </div>

        {/* Opponent Speech Bubble */}
        {opponentBubble && (
          <div className="liquid-metal-border absolute top-3 right-16 z-30 bg-[#12141a] text-zinc-100 rounded-xl px-3.5 py-2 shadow-2xl max-w-xs pointer-events-none">
            <div className="text-[10px] font-extrabold text-amber-300">{opponentBubble.senderName}</div>
            <div className="text-sm text-zinc-100">
              {opponentBubble.emote} {opponentBubble.text}
            </div>
          </div>
        )}

        {/* Reconnect / Opponent Disconnected Warning */}
        {isOnline && !onlineMatch?.firestoreSync && (localWsStatus !== 'connected' || opponentDisconnectSec !== null) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-red-900/95 border border-amber-400/70 rounded-xl px-4 py-2 flex items-center gap-2 text-xs font-semibold text-amber-100 shadow-2xl pointer-events-none">
            <WifiOff className="w-4 h-4 text-amber-300" />
            <span>
              {localWsStatus !== 'connected'
                ? lang === 'id'
                  ? 'Menghubungkan ulang ke server permainan...'
                  : 'Reconnecting to game server...'
                : lang === 'id'
                  ? `Lawan terputus. Menunggu ${opponentDisconnectSec}s untuk kembali...`
                  : `Opponent disconnected. Waiting ${opponentDisconnectSec}s to reconnect...`}
            </span>
          </div>
        )}

        {/* VS Roulette Spin Intro Overlay for Online Matches (zero backdrop-blur over canvas) */}
        {showVsBanner && onlineMatch && (
          <div className="absolute inset-0 z-40 bg-black/85 flex items-center justify-center p-4 pointer-events-none">
            <MatchmakingSpinStage
              title={
                onlineMatch.gameMode === 'online_ranked'
                  ? t(lang, 'rankedMatchTitle')
                  : lang === 'id'
                    ? 'Meja Pertandingan'
                    : 'Zenn Club Table'
              }
              variant={activeVariant}
              potAmount={potAmount}
              language={lang}
              phase="locking"
              player={{
                uid: pAInfo.uid,
                username: pAInfo.username,
                avatar: pAInfo.avatar,
                customAvatarUrl: pAInfo.customAvatarUrl,
                level: pAInfo.level,
              }}
              playerPartner={pA2Info}
              opponent={pBInfo}
              opponentPartner={pB2Info}
            />
          </div>
        )}

        {/* Chat & Emote Drawer */}
        {isOnline && chatOpen && (
          <div className="liquid-metal-border absolute top-3 right-16 z-30 w-72 sm:w-80 bg-[#12141a] text-zinc-100 rounded-2xl p-3.5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-extrabold text-zinc-100">
                {lang === 'id' ? 'Obrolan & Emote' : 'Match Chat & Emotes'}
              </span>
              <button
                type="button"
                onClick={() => setChatMuted((m) => !m)}
                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                  chatMuted ? 'bg-red-700 text-white' : 'bg-[#1a1d26] text-zinc-200 border border-white/10'
                }`}
              >
                {chatMuted ? (lang === 'id' ? 'Dibisukan' : 'Muted') : lang === 'id' ? 'Bisukan' : 'Mute Opponent'}
              </button>
            </div>

            {/* Emotes */}
            <div className="grid grid-cols-6 gap-1">
              {BILLIARD_EMOTES.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => sendChat('', em)}
                  className="py-1.5 rounded-lg bg-[#161820] hover:bg-[#1f232e] border border-white/10 text-base transition-colors"
                >
                  {em}
                </button>
              ))}
            </div>

            {/* Quick Phrases */}
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_CHAT_MESSAGES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => sendChat(phrase)}
                  className="px-2 py-1.5 rounded-lg bg-[#0b0c10] hover:bg-[#181b24] border border-white/10 text-[11px] font-medium text-zinc-200 truncate transition-colors"
                >
                  {phrase}
                </button>
              ))}
            </div>

            {/* Recent Messages */}
            {chatHistory.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] bg-[#0b0c10] border border-white/10 rounded-lg p-2">
                {chatHistory.map((c, i) => (
                  <div key={`${c.timestamp}-${i}`} className="text-zinc-200">
                    <span className="font-bold text-amber-300">{c.senderName}: </span>
                    <span>
                      {c.emote} {c.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Custom Short Message */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatInput.trim()) return;
                sendChat(chatInput.trim());
                setChatInput('');
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={64}
                placeholder={lang === 'id' ? 'Tulis pesan...' : 'Say something...'}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#0b0c10] border border-white/12 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                aria-label="Send message"
                className="p-1.5 rounded-lg neu-btn-gold"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Mobile bottom warning for foul notification */}
      {rules.foulReason && !resultSummary && (
        <div className="sm:hidden px-3 py-1 bg-rose-950/90 border-t border-rose-500/40 text-[11px] text-rose-200 flex items-center justify-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <span>{rules.foulReason}</span>
        </div>
      )}

      {/* Match Result Modal */}
      {resultSummary && (
        <MatchResultModal
          result={resultSummary}
          language={lang}
          onRematch={() => {
            if (!isOnline) {
              resetPracticeMatch();
            } else if (onlineMatch?.firestoreSync) {
              void requestFirestoreRematch(onlineMatch.matchId, profile.uid);
              setResultSummary((prev) =>
                prev ? { ...prev, rematchRequestedByYou: true, rematchStatus: 'requested' } : prev,
              );
            } else if (onlineMatch) {
              wsClient.send({ type: 'match:rematch', matchId: onlineMatch.matchId });
              setResultSummary((prev) =>
                prev ? { ...prev, rematchRequestedByYou: true, rematchStatus: 'requested' } : prev,
              );
            }
          }}
          onAcceptRematch={
            isOnline
              ? () => {
                  if (onlineMatch?.firestoreSync && firestoreMatchDocRef.current) {
                    void respondFirestoreRematch(firestoreMatchDocRef.current, true);
                  } else if (onlineMatch) {
                    wsClient.send({ type: 'match:rematch', matchId: onlineMatch.matchId });
                  }
                  setResultSummary((prev) =>
                    prev ? { ...prev, rematchRequestedByYou: true, rematchStatus: 'requested' } : prev,
                  );
                }
              : undefined
          }
          onDeclineRematch={
            isOnline
              ? () => {
                  if (onlineMatch?.firestoreSync && firestoreMatchDocRef.current) {
                    void respondFirestoreRematch(firestoreMatchDocRef.current, false);
                  } else if (onlineMatch) {
                    wsClient.send({ type: 'match:rematch_decline', matchId: onlineMatch.matchId });
                  }
                  setResultSummary((prev) =>
                    prev ? { ...prev, rematchRequestedByOpponent: false, rematchStatus: 'declined' } : prev,
                  );
                }
              : undefined
          }
          onFindRankedMatch={
            onlineMatch?.gameMode === 'online_ranked'
              ? () => {
                  wsClient.setActiveReconnectInfo(null);
                  (onPlayAgainRanked || onExitToMenu)();
                }
              : undefined
          }
          onBackHome={() => {
            wsClient.setActiveReconnectInfo(null);
            onExitToMenu();
          }}
          onInviteFriend={isOnline ? onInviteFriendFromResult : undefined}
        />
      )}
    </div>
  );
};
