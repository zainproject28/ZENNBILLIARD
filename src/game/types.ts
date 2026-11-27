export type GameVariant = '8ball' | '9ball';
export type AiDifficulty = 'club' | 'semipro' | 'pro';
export type BallGroup = 'cue' | 'solid' | 'stripe' | 'eight';

export interface CueStats {
  force: number;   // 1..100 shot velocity bonus
  aim: number;     // 1..100 guideline length & ghost visibility
  spin: number;    // 1..100 spin curve & draw/follow response
  control: number; // 1..100 reduced squirt & precision
  tier: 'Standard' | 'Club' | 'Tour' | 'Pro' | 'Master' | 'Grandmaster';
}

export interface TableMeta {
  railTone: string;
  feltGlow: string;
  trimTone: string;
  texture?: 'felt' | 'walnut' | 'marble' | 'crystal' | 'obsidian' | 'emerald';
}

export interface VenueMeta {
  id: string;
  backdropClass: string;
  ambientGlow: string;
  accentColor: string;
  atmosphereLabel: string;
}

export interface BallState {
  id: number;
  number: number; // 0 = cue, 1..7 = solid, 8 = eight, 9..15 = stripe
  group: BallGroup;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spinX: number; // -1..1 (left/right english)
  spinY: number; // -1..1 (back/top spin)
  angularZ: number;
  pocketed: boolean;
  pocketAnimProgress: number; // 0 -> 1
  pocketedInPocketId: number | null;
  rollPhase: number;
  rollDirX: number;
  rollDirY: number;
}

export interface PocketDef {
  id: number;
  x: number;
  y: number;
  radius: number;
  isCorner: boolean;
}

export interface ShotInput {
  angle: number; // radians
  power: number; // 0..1
  spinX: number; // -1..1
  spinY: number; // -1..1
  cueBallPos?: { x: number; y: number };
  seq?: number;
  cueId?: string;
}

export interface PhysicsEvent {
  type: 'ball' | 'cushion' | 'pocket' | 'cue';
  intensity: number; // 0..1
  x: number;
  y: number;
  ballId?: number;
  pocketId?: number;
}

export interface ShotTelemetry {
  firstContactBallId: number | null;
  pocketedBallIds: number[];
  railContactAfterFirstHit: boolean;
  cushionHitCount: number;
}

export type GamePhase = 'break' | 'open' | 'assigned' | 'eight_ball' | 'nine_ball' | 'gameover';
export type PlayerSlot = 'A' | 'B';
export type MatchFormat = '1v1' | '2v2';
export type BallSuit = 'solid' | 'stripe' | null;

export interface RuleOptions {
  foulOnBreakScratchHeadstring: boolean;
  loseOnEarlyEightBall: boolean;
  loseOnEightBallScratch: boolean;
}

export type AiShotType = 'break' | 'direct' | 'combo' | 'bank' | 'safety' | 'kick' | 'fallback';

export interface AiShotPlan {
  shot: ShotInput;
  targetBallId: number | null;
  pocketId: number | null;
  shotType: AiShotType;
  estimatedSuccess: number;
  reasonEn: string;
  reasonId: string;
}

export interface MatchRulesState {
  gameVariant: GameVariant;
  matchFormat?: MatchFormat;
  activeSeatIndex?: number; // 0=A1, 1=B1, 2=A2, 3=B2
  phase: GamePhase;
  currentTurn: PlayerSlot;
  groupA: BallSuit;
  groupB: BallSuit;
  targetBallNumber: number | null;
  ballInHand: boolean;
  headstringOnly: boolean;
  isBreakShot: boolean;
  foulReason: string | null;
  lastEventMessage: string | null;
  winner: PlayerSlot | null;
  winReason: string | null;
  shotCountA: number;
  shotCountB: number;
  pottedCountA: number;
  pottedCountB: number;
  turnNumber: number;
  turnDeadlineAt?: number | null;
}

export interface AimPrediction {
  ghostX: number;
  ghostY: number;
  hitType: 'ball' | 'cushion';
  targetBallId: number | null;
  targetDirX: number;
  targetDirY: number;
  cueDeflectX: number;
  cueDeflectY: number;
  bounceDirX: number;
  bounceDirY: number;
  isLegalTarget: boolean;
}

export interface ShopItemDef {
  id: string;
  category: 'cue' | 'table' | 'venue' | 'avatar' | 'frame' | 'effect';
  name: string;
  description: string;
  price: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  imageUrl?: string;
  cueStats?: CueStats;
  tableMeta?: TableMeta;
  venueMeta?: VenueMeta;
}

export type RankTier = 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master' | 'Grandmaster';
export type RankDivision = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII' | 'IX' | 'X' | 'MAX';
export type AuthProviderType = 'google' | 'email' | 'guest';

export interface PlayerLocation {
  lat?: number;
  lng?: number;
  city?: string;
  region?: string;
  timezone?: string;
  updatedAt?: string;
}

export interface PlayerStatsBreakdown {
  matches: number;
  wins: number;
  losses: number;
}

export interface PlayerStatsSummary {
  eightBall: PlayerStatsBreakdown;
  nineBall: PlayerStatsBreakdown;
  ranked: PlayerStatsBreakdown;
  vsPlayers: PlayerStatsBreakdown;
  vsBots: PlayerStatsBreakdown;
}

export interface UserProfile {
  uid: string;
  playerId: string;
  username: string;
  authProvider?: AuthProviderType;
  location?: PlayerLocation;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  equippedCue: string;
  equippedTable: string;
  equippedVenue?: string;
  equippedEffect: string;
  ownedItems: string[];
  level: number;
  xp: number;
  coins: number;
  rating: number;
  rankPoints: number;
  highestRankPoints: number;
  wins: number;
  losses: number;
  matches: number;
  stats: PlayerStatsSummary;
  dailyStreak: number;
  lastDailyClaim: string;
  createdAt: string;
  updatedAt: string;
}

import type { KeyBindingsConfig } from './controls.ts';

export type { KeyBindingsConfig };

export interface UserSettings {
  musicEnabled: boolean;
  musicVolume: number;
  sfxEnabled: boolean;
  vibrationEnabled: boolean;
  graphicsQuality: 'low' | 'medium' | 'high';
  language: 'en' | 'id';
  sensitivity: number;
  aimGuide?: 'standard' | 'pro';
  keyBindings?: KeyBindingsConfig;
}

export interface OnlineParticipantMeta {
  uid: string;
  username: string;
  avatar: string;
  customAvatarUrl?: string;
  frame: string;
  level: number;
  rating: number;
  rankPoints?: number;
  equippedCue: string;
  equippedTable: string;
  equippedVenue?: string;
  equippedEffect: string;
  connected: boolean;
  isBot?: boolean;
  aiDifficulty?: AiDifficulty;
}


