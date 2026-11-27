import React, { useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  ArrowRight,
  Bot,
  Check,
  Coins,
  Copy,
  Gift,
  Maximize2,
  Minimize2,
  Palette,
  Settings,
  ShoppingBag,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { ZennCrestLogo } from '@/components/ui/shadcn-studio-waitlist-04.tsx';
import { getCueStats, SHOP_CATALOG } from '../game/constants.ts';
import { formatPlayerId, stripPlayerId } from '../game/playerId.ts';
import { getRankFromPoints } from '../game/rank.ts';
import type { ShopItemDef, UserProfile, UserSettings } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { isFullscreenSupported, useFullscreenState } from '../services/fullscreen.ts';
import { t } from '../services/i18n.ts';
import type { PracticeSubMode } from './PracticeSetupModal.tsx';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';
import { ArcadeBackdrop } from './ArcadeBackdrop.tsx';

interface MainMenuProps {
  profile: UserProfile;
  settings: UserSettings;
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  pendingInvite: {
    roomCode: string;
    entryFee: number;
    from: { uid: string; username: string; avatar: string; customAvatarUrl?: string };
  } | null;
  onAcceptInvite: (roomCode: string) => void;
  onDismissInvite: () => void;
  onOpenPrivateRoom: () => void;
  onOpenQuickMatch: () => void;
  onOpenRanked: () => void;
  onOpenPracticeArena: (initialSubMode?: PracticeSubMode) => void;
  onOpenFriends: () => void;
  onOpenShop: (initialTab?: ShopItemDef['category']) => void;
  onOpenLeaderboard: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenDailyReward: () => void;
  onOpenRankTiers?: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  profile,
  settings,
  wsStatus,
  pendingInvite,
  onAcceptInvite,
  onDismissInvite,
  onOpenPrivateRoom,
  onOpenQuickMatch,
  onOpenRanked,
  onOpenPracticeArena,
  onOpenFriends,
  onOpenShop,
  onOpenLeaderboard,
  onOpenProfile,
  onOpenSettings,
  onOpenDailyReward,
  onOpenRankTiers,
}) => {
  const lang = settings.language;
  const [copiedId, setCopiedId] = useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreenState();
  const fullscreenSupported = isFullscreenSupported();

  const today = new Date().toISOString().slice(0, 10);
  const dailyAvailable = profile.lastDailyClaim !== today;
  const formattedPlayerId = formatPlayerId(profile.playerId);
  const currentRank = getRankFromPoints(profile.rankPoints ?? 0);

  const activeCue =
    SHOP_CATALOG.find((i) => i.id === profile.equippedCue) ||
    SHOP_CATALOG.find((i) => i.id === 'cue_basic')!;
  const activeTable =
    SHOP_CATALOG.find((i) => i.id === profile.equippedTable) ||
    SHOP_CATALOG.find((i) => i.id === 'table_tournament_blue')!;
  const activeVenue =
    SHOP_CATALOG.find((i) => i.id === profile.equippedVenue) ||
    SHOP_CATALOG.find((i) => i.id === 'venue_billiard_cafe');
  const cueStats = getCueStats(activeCue.id);

  const handleCopyId = async () => {
    audioEngine.playClick();
    const digitsOnly = stripPlayerId(profile.playerId);
    try {
      await navigator.clipboard.writeText(digitsOnly);
    } catch {
      // Fallback ignored if clipboard permissions are restricted
    }
    setCopiedId(true);
    window.setTimeout(() => setCopiedId(false), 1800);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-[#06070a] text-[#f4f1ea] flex flex-col justify-between relative overflow-x-hidden">
        <ArcadeBackdrop variant="home" />

        {/* Top Bar: Left = Player Profile + Rank, Center = Brand Crest (true viewport center), Right = Daily Check-In + Coins + Fullscreen */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative z-10 w-full px-3 sm:px-6 pt-3 sm:pt-4"
        >
          <div className="flex flex-wrap md:grid md:grid-cols-[1fr_auto_1fr] items-center justify-between gap-2 sm:gap-3">
            {/* Top-Left: Luxury Frosted Profile Plate with Level, Rank Tier Trigger, and 9-Digit ID */}
            <div
              data-testid="profile-card"
              className="order-1 w-full md:w-auto md:justify-self-start ios-glass-dock rounded-2xl px-2.5 sm:px-3.5 py-2 flex items-center justify-between gap-2.5 sm:gap-3 min-w-0 max-w-full"
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.playClick();
                    onOpenProfile();
                  }}
                  data-testid="nav-profile-btn"
                  aria-label={`${profile.username} — ${t(lang, 'profile')}`}
                  className="relative shrink-0 rounded-full hover:opacity-95 transition-opacity cursor-pointer"
                >
                  <PlayerAvatar
                    avatarId={profile.avatar}
                    customAvatarUrl={profile.customAvatarUrl}
                    frameId={profile.frame}
                    username={profile.username}
                    size="sm"
                    online={wsStatus === 'connected'}
                  />
                </button>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      audioEngine.playClick();
                      onOpenProfile();
                    }}
                    className="flex items-center gap-1.5 min-w-0 text-left hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <span className="font-display font-bold text-xs sm:text-sm text-[#f8f5ee] truncate max-w-[130px] sm:max-w-[148px]">
                      {profile.username}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-400/15 border border-amber-300/35 text-[9px] font-mono-tabular font-black text-amber-300 shrink-0">
                      LV.{profile.level}
                    </span>
                  </button>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    {onOpenRankTiers ? (
                      <button
                        type="button"
                        data-testid="open-rank-tiers-btn"
                        onClick={() => {
                          audioEngine.playClick();
                          onOpenRankTiers();
                        }}
                        aria-label={t(lang, 'viewRankTiers')}
                        title={t(lang, 'viewRankTiers')}
                        className="hover:brightness-110 transition-all cursor-pointer shrink-0"
                      >
                        <RankBadge rankPoints={profile.rankPoints ?? 0} size="xs" language={lang} />
                      </button>
                    ) : (
                      <span data-testid="open-rank-tiers-btn" className="shrink-0">
                        <RankBadge rankPoints={profile.rankPoints ?? 0} size="xs" language={lang} />
                      </span>
                    )}
                    <span
                      data-testid="profile-player-id"
                      className="text-[10px] sm:text-[11px] font-mono-tabular font-semibold text-[#b8ae9c] tracking-tight whitespace-nowrap truncate"
                    >
                      {formattedPlayerId}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleCopyId()}
                data-testid="copy-player-id-btn"
                aria-label={t(lang, 'copyId')}
                title={t(lang, 'copyId')}
                className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 text-[#e2d6be] hover:text-amber-300 shrink-0 transition-colors cursor-pointer"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-amber-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Center: ZENN BILLIARD Matte Brass Crest (true horizontal screen center on desktop) */}
            <div className="order-2 hidden md:flex justify-self-center items-center gap-2.5 px-5 py-2 rounded-2xl ios-glass-dock">
              <ZennCrestLogo className="w-8 h-8" />
              <div className="text-left leading-none">
                <div className="font-display text-lg font-black tracking-wide text-[#f8f5ee] whitespace-nowrap">
                  ZENN <span className="text-amber-400">BILLIARD</span>
                </div>
              </div>
            </div>

            {/* Top-Right (Row 2 on mobile alongside compact crest): Daily Check-In + Coins Balance + Fullscreen Toggle */}
            <div className="order-3 w-full md:w-auto md:justify-self-end flex items-center justify-between md:justify-end gap-1.5 sm:gap-2 shrink-0">
              <div className="inline-flex md:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-xl ios-glass-dock shrink-0">
                <ZennCrestLogo className="w-5 h-5" />
                <span className="font-display text-xs font-black tracking-wide text-[#f8f5ee] whitespace-nowrap">
                  ZENN <span className="text-amber-400">BILLIARD</span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto md:ml-0">
                <button
                  type="button"
                  data-testid="daily-reward-card"
                  aria-label={t(lang, 'dailyReward')}
                  title={t(lang, 'dailyReward')}
                  onClick={() => {
                    audioEngine.playClick();
                    onOpenDailyReward();
                  }}
                  className={`ios-glass-dock rounded-2xl px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 cursor-pointer transition-all ${
                    dailyAvailable
                      ? 'border-amber-400/60 text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.22)]'
                      : 'text-[#dfd3bc] hover:border-amber-400/40'
                  }`}
                >
                  <Gift className={`w-4 h-4 shrink-0 ${dailyAvailable ? 'text-amber-400' : 'text-zinc-300'}`} />
                  <span className="hidden xl:inline text-xs font-extrabold whitespace-nowrap">
                    {t(lang, 'dailyReward')}
                  </span>
                  <span className="text-[11px] sm:text-xs font-mono-tabular font-black whitespace-nowrap">
                    {dailyAvailable
                      ? '+5K'
                      : lang === 'id'
                        ? `H${profile.dailyStreak}`
                        : `D${profile.dailyStreak}`}
                  </span>
                </button>

                <div className="ios-glass-dock border-amber-400/30 rounded-2xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2">
                  <Coins className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-amber-400 shrink-0" />
                  <span
                    className="font-mono-tabular font-black text-xs sm:text-sm text-[#f8f5ee]"
                    data-testid="player-coins"
                  >
                    {profile.coins.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    aria-label={t(lang, 'shop')}
                    onClick={() => {
                      audioEngine.playClick();
                      onOpenShop('cue');
                    }}
                    className="w-5 h-5 rounded-md neu-btn-gold font-black text-xs flex items-center justify-center cursor-pointer"
                  >
                    +
                  </button>
                </div>

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
                    className="p-2 sm:p-2.5 rounded-2xl ios-glass-dock hover:border-amber-400/50 text-[#dfd3bc] hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                    ) : (
                      <Maximize2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.header>

        {/* Live Friend Invitation Banner */}
        {pendingInvite && (
          <div className="relative z-20 max-w-2xl w-full mx-auto px-4 pt-2">
            <div className="liquid-metal-border glass-panel rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <PlayerAvatar
                  avatarId={pendingInvite.from.avatar}
                  customAvatarUrl={pendingInvite.from.customAvatarUrl}
                  username={pendingInvite.from.username}
                  size="sm"
                  online
                />
                <div className="text-xs sm:text-sm text-[#f4f1ea]">
                  <span className="font-bold text-amber-300">{pendingInvite.from.username}</span>{' '}
                  <span>{lang === 'id' ? 'mengundang Anda ke Room' : 'invited you to Room'}</span>{' '}
                  <span className="font-mono-tabular font-bold text-red-400">{pendingInvite.roomCode}</span>
                  {pendingInvite.entryFee > 0 && (
                    <span className="text-amber-400 ml-2">({pendingInvite.entryFee.toLocaleString()})</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAcceptInvite(pendingInvite.roomCode)}
                  className="px-3.5 py-1.5 rounded-xl neu-btn-gold font-bold text-xs cursor-pointer"
                >
                  {t(lang, 'joinNow')}
                </button>
                <button
                  type="button"
                  onClick={onDismissInvite}
                  className="px-3 py-1.5 rounded-xl neu-inset text-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  {t(lang, 'rematchDecline')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Center Lounge Deck: 6 Translucent iOS Frosted Glass Cards */}
        <main className="relative z-10 flex-1 max-w-[1380px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-5 flex flex-col justify-center">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
            {/* Card 1: Practice with Computer */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.02 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenPracticeArena('vs_ai');
              }}
              data-testid="mode-practice"
              className="group ios-glass-card ios-glass-blue rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-sky-400/15 border border-sky-300/25 flex items-center justify-center text-sky-200 group-hover:scale-105 transition-transform shadow-inner">
                  <Bot className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-amber-300/95 tracking-wide">8 Ball · 9 Ball</span>
              </div>

              <div className="mt-2.5">
                <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide leading-tight">
                  {t(lang, 'practiceWithComputer')}
                </h2>
                <p className="text-[10px] sm:text-[13px] text-zinc-200/75 mt-1.5 leading-snug line-clamp-2">
                  {t(lang, 'practiceWithComputerDesc')}
                </p>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between text-[11px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span>{lang === 'id' ? 'Mode Komputer' : 'VS Computer'}</span>
                <span className="inline-flex items-center gap-1 text-amber-300 group-hover:translate-x-1 transition-transform">
                  <span>{lang === 'id' ? 'Mulai' : 'Play'}</span>
                  <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
              </div>
            </motion.button>

            {/* Card 2: Practice Solo */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.05 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenPracticeArena('solo');
              }}
              data-testid="mode-practice-solo"
              className="group ios-glass-card ios-glass-sky rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-zinc-100 group-hover:scale-105 transition-transform shadow-inner">
                  <Target className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-[#e2d6be] tracking-wide">8 Ball · 9 Ball</span>
              </div>

              <div className="mt-2.5">
                <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide leading-tight">
                  {t(lang, 'practiceSolo')}
                </h2>
                <p className="text-[10px] sm:text-[13px] text-zinc-200/75 mt-1.5 leading-snug line-clamp-2">
                  {t(lang, 'practiceSoloDesc')}
                </p>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between text-[11px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span>{lang === 'id' ? 'Latihan Bebas' : 'Free Drill'}</span>
                <span className="inline-flex items-center gap-1 text-[#f8f5ee] group-hover:translate-x-1 transition-transform">
                  <span>{lang === 'id' ? 'Latihan' : 'Train'}</span>
                  <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
              </div>
            </motion.button>

            {/* Card 3: Ranked Competitive */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.08 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenRanked();
              }}
              data-testid="mode-ranked"
              className="group ios-glass-card ios-glass-red rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center text-amber-300 group-hover:scale-105 transition-transform shadow-inner">
                  <Trophy className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <RankBadge rankPoints={profile.rankPoints ?? 0} size="xs" language={lang} />
              </div>

              <div className="mt-2.5">
                <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide leading-tight">
                  {t(lang, 'rankedMatchTitle')}
                </h2>
                <p className="text-[10px] sm:text-[13px] text-zinc-200/75 mt-1.5 leading-snug line-clamp-2">
                  {t(lang, 'rankedModeDesc')}
                </p>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between gap-1 text-[10px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span className="font-mono-tabular text-amber-300 whitespace-nowrap">
                  <span className="hidden sm:inline">{currentRank.label} · </span>
                  {currentRank.points} RP
                </span>
                <span className="inline-flex items-center gap-1 text-red-200 group-hover:translate-x-1 transition-transform shrink-0 whitespace-nowrap">
                  <span>{lang === 'id' ? 'Bertanding' : 'Compete'}</span>
                  <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
              </div>
            </motion.button>

            {/* Card 4: Play with Friends */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.11 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenPrivateRoom();
              }}
              data-testid="mode-play-friends"
              className="group ios-glass-card ios-glass-gold rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center text-amber-300 group-hover:scale-105 transition-transform shadow-inner">
                  <Users className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-amber-300 tracking-wide">8 Ball · 9 Ball</span>
              </div>

              <div className="mt-2.5">
                <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide leading-tight">
                  {lang === 'id' ? 'Main Bersama Teman' : 'Play with Friends'}
                </h2>
                <p className="text-[10px] sm:text-[13px] text-zinc-200/75 mt-1.5 leading-snug line-clamp-2">
                  {lang === 'id'
                    ? 'Buat atau gabung room online 1v1 dan 2v2 dengan aturan 8 Ball atau 9 Ball.'
                    : 'Create or join online 1v1 and 2v2 friend rooms in 8 Ball or 9 Ball.'}
                </p>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between text-[11px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span>1v1 · 2v2 Online</span>
                <span className="inline-flex items-center gap-1 text-amber-300 group-hover:translate-x-1 transition-transform">
                  <span>{lang === 'id' ? 'Masuk' : 'Play'}</span>
                  <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
              </div>
            </motion.button>

            {/* Card 5: Quick Match */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.14 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenQuickMatch();
              }}
              data-testid="mode-quick-match"
              className="group ios-glass-card ios-glass-red rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-red-400/15 border border-red-300/30 flex items-center justify-center text-red-300 group-hover:scale-105 transition-transform shadow-inner">
                  <Zap className="w-4 h-4 sm:w-6 sm:h-6" />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-red-200 tracking-wide">
                  {lang === 'id' ? 'Taruhan Koin' : 'Coin Stakes'}
                </span>
              </div>

              <div className="mt-2.5">
                <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide leading-tight">
                  {t(lang, 'quickMatch')}
                </h2>
                <p className="text-[10px] sm:text-[13px] text-zinc-200/75 mt-1.5 leading-snug line-clamp-2">
                  {lang === 'id'
                    ? 'Duel cepat berhadiah koin melawan pemain online atau penantang terkalibrasi.'
                    : 'Fast coin-stake match on the table.'}
                </p>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between text-[11px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span>{lang === 'id' ? 'Arena Cepat' : 'Quick Arena'}</span>
                <span className="inline-flex items-center gap-1 text-red-200 group-hover:translate-x-1 transition-transform">
                  <span>{lang === 'id' ? 'Cari' : 'Play'}</span>
                  <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
              </div>
            </motion.button>

            {/* Card 6: Cue & Table Arsenal */}
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.17 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                audioEngine.playClick();
                onOpenShop('cue');
              }}
              data-testid="armory-cue-btn"
              className="group ios-glass-card ios-glass-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:p-6 text-left flex flex-col justify-between min-h-[126px] sm:min-h-[196px] lg:min-h-[214px] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className="w-12 h-8 sm:w-14 sm:h-9 rounded-lg border-4 shrink-0 shadow-sm"
                  style={{
                    backgroundColor: activeTable.primaryColor,
                    borderColor: activeTable.tableMeta?.railTone || activeTable.secondaryColor,
                  }}
                />
                <span className="text-[10px] sm:text-xs font-mono-tabular font-bold text-amber-300">{cueStats.tier}</span>
              </div>

              <div className="mt-2.5 space-y-2">
                <div>
                  <h2 className="font-display text-sm sm:text-xl font-black text-[#f8f5ee] tracking-wide truncate">
                    {activeCue.name}
                  </h2>
                  <p className="text-[10px] sm:text-[13px] font-semibold text-zinc-200/75 truncate">
                    {activeTable.name}{activeVenue ? ` · ${activeVenue.name}` : ''}
                  </p>
                </div>
                <div className="w-full h-2.5 rounded-full flex overflow-hidden shadow-inner border border-white/20">
                  <div className="w-2 bg-sky-500" />
                  <div className="w-2 bg-white" />
                  <div className="flex-1" style={{ backgroundColor: activeCue.primaryColor }} />
                  <div className="w-2.5" style={{ backgroundColor: activeCue.accentColor }} />
                  <div className="w-8" style={{ backgroundColor: activeCue.secondaryColor }} />
                </div>
              </div>

              <div className="pt-2.5 mt-2 border-t border-white/15 flex items-center justify-between text-[11px] sm:text-xs font-extrabold text-[#e8dcc4]">
                <span>F:{cueStats.force} · A:{cueStats.aim}</span>
                <span className="inline-flex items-center gap-1 text-[#f8f5ee] group-hover:translate-x-1 transition-transform">
                  <Palette className="w-3.5 h-3.5 text-amber-300" />
                  <span>{t(lang, 'shop')}</span>
                </span>
              </div>
            </motion.button>
          </div>
        </main>

        {/* Bottom Section: Translucent iOS Glass Navigation Dock */}
        <motion.footer
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
          className="relative z-10 w-full px-3 sm:px-6 pb-2.5 sm:pb-3 space-y-2"
        >
          <div
            data-testid="bottom-nav-dock"
            className="w-full ios-glass-dock rounded-2xl p-2 sm:p-2.5"
          >
            <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
              <button
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  onOpenSettings();
                }}
                data-testid="nav-settings-btn"
                aria-label={t(lang, 'settings')}
                className="w-full h-11 sm:h-12 px-1 sm:px-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[#f8f5ee] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-[10px] sm:text-sm font-bold leading-none transition-colors cursor-pointer"
              >
                <Settings className="w-4 h-4 shrink-0 text-[#e2d6be]" />
                <span className="truncate max-w-full">{t(lang, 'settings')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  onOpenFriends();
                }}
                data-testid="nav-friends-btn"
                aria-label={t(lang, 'friends')}
                className="w-full h-11 sm:h-12 px-1 sm:px-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[#f8f5ee] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-[10px] sm:text-sm font-bold leading-none transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 shrink-0 text-[#e2d6be]" />
                <span className="truncate max-w-full">{t(lang, 'friends')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  onOpenLeaderboard();
                }}
                data-testid="nav-leaderboard-btn"
                aria-label={t(lang, 'leaderboard')}
                className="w-full h-11 sm:h-12 px-1 sm:px-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-red-400/25 text-[#f8f5ee] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-[10px] sm:text-sm font-bold leading-none transition-colors cursor-pointer"
              >
                <Trophy className="w-4 h-4 shrink-0 text-amber-400" />
                <span className="truncate max-w-full">{t(lang, 'leaderboard')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  audioEngine.playClick();
                  onOpenShop('cue');
                }}
                data-testid="nav-shop-btn"
                aria-label={t(lang, 'shop')}
                className="w-full h-11 sm:h-12 px-1 sm:px-2 rounded-xl neu-btn-gold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 text-[10px] sm:text-sm font-black leading-none cursor-pointer"
              >
                <ShoppingBag className="w-4 h-4 shrink-0 text-zinc-950" />
                <span className="truncate max-w-full">{t(lang, 'shop')}</span>
              </button>
            </div>
          </div>

          <div className="text-center text-[11px] font-semibold text-[#8c816f]">
            {t(lang, 'footerWatermark')}
          </div>
        </motion.footer>
      </div>
    </MotionConfig>
  );
};
