import React, { useState } from 'react';
import { Bot, Cpu, Play, Sparkles, User, Users, X } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import { getCueStats, SHOP_CATALOG } from '../game/constants.ts';
import type { AiDifficulty, GameVariant, OnlineParticipantMeta, UserProfile, UserSettings } from '../game/types.ts';
import { audioEngine } from '../services/audio.ts';
import { t } from '../services/i18n.ts';

export type PracticeSubMode = 'vs_ai' | 'local_2v2_ai' | 'local_2v2_pass' | 'solo' | 'local_2p';

export interface PracticeLaunchConfig {
  variant: GameVariant;
  subMode: PracticeSubMode;
  aiDifficulty: AiDifficulty;
  isQuickMatch?: boolean;
  entryFee?: number;
  opponent?: OnlineParticipantMeta;
}

interface PracticeSetupModalProps {
  profile: UserProfile;
  settings: UserSettings;
  initialSubMode?: PracticeSubMode;
  onStart: (config: PracticeLaunchConfig) => void;
  onQuickEquip: (itemId: string) => void;
  onOpenArsenal: () => void;
  onClose: () => void;
}

export const PracticeSetupModal: React.FC<PracticeSetupModalProps> = ({
  profile,
  settings,
  initialSubMode = 'vs_ai',
  onStart,
  onQuickEquip,
  onOpenArsenal,
  onClose,
}) => {
  const lang = settings.language;
  const isId = lang === 'id';
  const [subMode, setSubMode] = useState<PracticeSubMode>(initialSubMode);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('pro');
  const [variant, setVariant] = useState<GameVariant>('8ball');

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
  const activeCue = SHOP_CATALOG.find((i) => i.id === profile.equippedCue) || ownedCues[0];
  const cueStats = getCueStats(activeCue?.id);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'practiceArena')}
        className="w-full max-w-2xl liquid-metal-border glass-panel mafia-texture-surface rounded-3xl p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto text-[#f4f1ea]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-black text-zinc-50 tracking-wide">
              {t(lang, 'practiceArena')}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t(lang, 'practiceArenaDesc')}
            </p>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Pengaturan Latihan' : 'Close Arena Setup'}
            onClick={onClose}
            className="p-2 rounded-xl bg-[#161820] hover:bg-[#1f222c] border border-white/12 text-zinc-300 hover:text-white shrink-0 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Play Mode Selector */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            {isId ? 'Pilih Mode Bermain' : 'Play Mode'}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {(
              [
                { id: 'vs_ai', label: t(lang, 'vsComputer'), icon: Bot, desc: '1v1 AI' },
                { id: 'solo', label: t(lang, 'soloPractice'), icon: User, desc: isId ? 'Bebas' : 'Free Drill' },
                { id: 'local_2p', label: t(lang, 'localPassPlay'), icon: Users, desc: '2P' },
                { id: 'local_2v2_ai', label: t(lang, 'squad2v2'), icon: Users, desc: '2v2 AI' },
                { id: 'local_2v2_pass', label: t(lang, 'local2v2Pass'), icon: Users, desc: '4P' },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = subMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`practice-submode-${opt.id}`}
                  onClick={() => {
                    audioEngine.playClick();
                    setSubMode(opt.id);
                  }}
                  className={`p-3 rounded-2xl text-left transition-all flex flex-col gap-1.5 cursor-pointer border ${
                    active
                      ? 'bg-[#222531] border-amber-400/80 text-zinc-50 shadow-[0_0_16px_rgba(245,158,11,0.16)]'
                      : 'bg-[#161820] border-white/10 text-zinc-200 hover:bg-[#1d202a] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-amber-300' : 'text-amber-400'}`} />
                    <span className={`text-[10px] font-mono-tabular font-bold ${active ? 'text-amber-300' : 'text-zinc-400'}`}>
                      {opt.desc}
                    </span>
                  </div>
                  <div className="font-bold text-xs sm:text-sm leading-tight">{opt.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. AI Difficulty */}
        {(subMode === 'vs_ai' || subMode === 'local_2v2_ai') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>{isId ? 'Level Komputer' : 'Computer Skill'}</span>
              </span>
              <span className="text-[11px] text-amber-300 font-semibold">
                {aiDifficulty === 'pro'
                  ? isId
                    ? 'Taktik Presisi Tinggi'
                    : 'High Precision Angles'
                  : aiDifficulty === 'semipro'
                    ? isId
                      ? 'Bidikan Seimbang'
                      : 'Tactical Cuts'
                    : isId
                      ? 'Santai'
                      : 'Relaxed'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-[#0c0e13] border border-white/10">
              {(
                [
                  { id: 'club', label: t(lang, 'aiClub') },
                  { id: 'semipro', label: t(lang, 'aiSemiPro') },
                  { id: 'pro', label: t(lang, 'aiPro') },
                ] as const
              ).map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  data-testid={`ai-difficulty-${lvl.id}`}
                  onClick={() => {
                    audioEngine.playClick();
                    setAiDifficulty(lvl.id);
                  }}
                  className={`py-2 px-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    aiDifficulty === lvl.id
                      ? 'neu-btn-gold'
                      : 'text-zinc-400 hover:bg-[#181b24] hover:text-zinc-100'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Game Variant: 8 Ball vs 9 Ball */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            {isId ? 'Aturan Permainan' : 'Billiard Rules'}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="practice-variant-8ball"
              onClick={() => {
                audioEngine.playClick();
                setVariant('8ball');
              }}
              className={`p-3.5 rounded-2xl text-left flex items-center gap-3 transition-all cursor-pointer border ${
                variant === '8ball'
                  ? 'bg-[#222531] border-amber-400/80 text-zinc-50 shadow-[0_0_16px_rgba(245,158,11,0.16)]'
                  : 'bg-[#161820] border-white/10 text-zinc-200 hover:bg-[#1d202a]'
              }`}
            >
              <span className="w-9 h-9 rounded-full bg-zinc-950 border-2 border-amber-400 flex items-center justify-center font-mono-tabular font-extrabold text-sm text-white shrink-0">
                8
              </span>
              <div className="min-w-0">
                <div className="font-display font-bold text-sm">{t(lang, 'eightBall')}</div>
                <div className={`text-[11px] ${variant === '8ball' ? 'text-amber-200/85' : 'text-zinc-400'}`}>
                  {isId ? '15 Bola · Solid & Stripes' : '15 Balls · Solids vs Stripes'}
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="practice-variant-9ball"
              onClick={() => {
                audioEngine.playClick();
                setVariant('9ball');
              }}
              className={`p-3.5 rounded-2xl text-left flex items-center gap-3 transition-all cursor-pointer border ${
                variant === '9ball'
                  ? 'bg-[#222531] border-amber-400/80 text-zinc-50 shadow-[0_0_16px_rgba(245,158,11,0.16)]'
                  : 'bg-[#161820] border-white/10 text-zinc-200 hover:bg-[#1d202a]'
              }`}
            >
              <span
                className="w-9 h-9 rounded-full border-2 border-amber-400 flex items-center justify-center font-mono-tabular font-extrabold text-sm text-zinc-950 shrink-0"
                style={{
                  background:
                    'linear-gradient(to bottom, #f8fafc 22%, #eab308 22%, #eab308 78%, #f8fafc 78%)',
                }}
              >
                9
              </span>
              <div className="min-w-0">
                <div className="font-display font-bold text-sm">{t(lang, 'nineBall')}</div>
                <div className={`text-[11px] ${variant === '9ball' ? 'text-amber-200/85' : 'text-zinc-400'}`}>
                  {isId ? '9 Bola · Angka Terkecil Dulu' : '9 Balls · Lowest Ball First'}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* 4. Quick Table & Cue Loadout */}
        <div className="bg-[#15171f] border border-white/10 rounded-2xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{isId ? 'Meja & Stik Aktif' : 'Active Table & Cue'}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                audioEngine.playClick();
                onOpenArsenal();
              }}
              className="text-xs font-bold text-amber-300 hover:text-amber-200 underline underline-offset-2 cursor-pointer"
            >
              {isId ? 'Buka Toko Stik' : 'Open Shop'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {isId ? 'Kain Meja' : 'Table Cloth'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedTables.map((tbl) => {
                  const active = profile.equippedTable === tbl.id;
                  return (
                    <button
                      key={tbl.id}
                      type="button"
                      title={tbl.name}
                      onClick={() => {
                        audioEngine.playClick();
                        onQuickEquip(tbl.id);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-[11px] font-bold transition-all cursor-pointer border ${
                        active
                          ? 'bg-[#222531] border-amber-400/80 text-amber-300'
                          : 'bg-[#0e1015] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0"
                        style={{ backgroundColor: tbl.primaryColor }}
                      />
                      <span className="truncate max-w-[92px]">{tbl.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <span>{activeCue?.name}</span>
                <span className="text-amber-300 font-mono-tabular">{cueStats.tier}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ownedCues.map((cue) => {
                  const active = profile.equippedCue === cue.id;
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      onClick={() => {
                        audioEngine.playClick();
                        onQuickEquip(cue.id);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                        active
                          ? 'bg-[#222531] border-amber-400/80 text-amber-300'
                          : 'bg-[#0e1015] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      {cue.name.replace(' Cue', '')}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono-tabular text-zinc-400 font-semibold">
                <span>PWR {cueStats.force}</span>
                <span>AIM {cueStats.aim}</span>
                <span>SPN {cueStats.spin}</span>
                <span>CTL {cueStats.control}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 pt-1 border-t border-white/8">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {t(lang, 'venue')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ownedVenues.map((venue) => {
                const active = (profile.equippedVenue || 'venue_billiard_cafe') === venue.id;
                return (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => {
                      audioEngine.playClick();
                      onQuickEquip(venue.id);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-[11px] font-bold transition-all cursor-pointer border ${
                      active
                        ? 'bg-[#222531] border-amber-400/80 text-amber-300'
                        : 'bg-[#0e1015] border-white/10 text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: venue.accentColor }}
                    />
                    <span className="truncate max-w-[140px]">{venue.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-2xl bg-[#161820] border border-white/12 text-sm font-bold text-zinc-200 hover:bg-[#1e212b] whitespace-nowrap cursor-pointer transition-colors"
          >
            {isId ? 'Batal' : 'Cancel'}
          </button>
          <div className="flex-1 min-w-0">
            <LiquidMetalButton
              fullWidth
              height={46}
              testId="start-practice-match-btn"
              icon={<Play className="w-4 h-4 fill-current" />}
              label={`${isId ? 'Mulai Bermain' : 'Start Match'} (${variant === '9ball' ? '9 Ball' : '8 Ball'})`}
              onClick={() => {
                audioEngine.playClick();
                onStart({ variant, subMode, aiDifficulty });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
