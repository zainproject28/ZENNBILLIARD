import React, { useEffect, useState } from 'react';
import {
  Check,
  Crosshair,
  Edit3,
  Gamepad2,
  KeyRound,
  LogOut,
  Music,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Volume2,
  X,
} from 'lucide-react';
import {
  DEFAULT_KEY_BINDINGS,
  formatKeyLabel,
  normalizeKeyBindings,
  updateKeyBinding,
  type KeyBindingAction,
} from '../game/controls.ts';
import { formatPlayerId } from '../game/playerId.ts';
import type { UserProfile, UserSettings } from '../game/types.ts';
import { audioEngine, triggerHaptic } from '../services/audio.ts';
import { auth, resetPassword } from '../services/firebase.ts';
import { t } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface SettingsModalProps {
  profile: UserProfile;
  settings: UserSettings;
  isFirebaseAccount: boolean;
  onUpdateSettings: (next: UserSettings) => void;
  onEditProfile: () => void;
  onLogout: () => void;
  onClose: () => void;
}

const KEY_ACTION_ROWS: Array<{ action: KeyBindingAction; i18nKey: string }> = [
  { action: 'aimLeft', i18nKey: 'keyAimLeft' },
  { action: 'aimRight', i18nKey: 'keyAimRight' },
  { action: 'powerUp', i18nKey: 'keyPowerUp' },
  { action: 'powerDown', i18nKey: 'keyPowerDown' },
  { action: 'shoot', i18nKey: 'keyShoot' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  profile,
  settings,
  isFirebaseAccount,
  onUpdateSettings,
  onEditProfile,
  onLogout,
  onClose,
}) => {
  const lang = settings.language;
  const [activeTab, setActiveTab] = useState<'audio' | 'controls' | 'account'>('audio');
  const [resetStatus, setResetStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);
  const [listeningAction, setListeningAction] = useState<KeyBindingAction | null>(null);
  const [controlsSavedNotice, setControlsSavedNotice] = useState(false);

  const keyBindings = normalizeKeyBindings(settings.keyBindings);
  const musicVolPct = Math.round((settings.musicVolume ?? 0.35) * 100);

  const firebaseUser = auth.currentUser;
  const userEmail = isFirebaseAccount ? firebaseUser?.email || '' : '';
  const providerId = isFirebaseAccount
    ? firebaseUser?.providerData?.[0]?.providerId || 'firebase'
    : 'guest';
  const accountBadge =
    providerId === 'google.com'
      ? lang === 'id'
        ? 'Akun Google'
        : 'Google Account'
      : isFirebaseAccount
        ? lang === 'id'
          ? 'Akun Email'
          : 'Email Account'
        : lang === 'id'
          ? 'Sesi Tamu'
          : 'Guest Session';

  useEffect(() => {
    if (!listeningAction) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListeningAction(null);
        return;
      }
      const nextCode = e.code || e.key;
      if (!nextCode) return;
      const updatedBindings = updateKeyBinding(keyBindings, listeningAction, nextCode);
      onUpdateSettings({ ...settings, keyBindings: updatedBindings });
      setListeningAction(null);
      setControlsSavedNotice(true);
      window.setTimeout(() => setControlsSavedNotice(false), 1800);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listeningAction, keyBindings, settings, onUpdateSettings]);

  const toggle = (key: 'musicEnabled' | 'sfxEnabled' | 'vibrationEnabled') => {
    const nextVal = !settings[key];
    audioEngine.unlock();
    if (key === 'sfxEnabled') {
      audioEngine.setSfxEnabled(nextVal);
      if (nextVal) audioEngine.playClick();
    } else {
      audioEngine.playClick();
    }
    if (key === 'vibrationEnabled' && nextVal) {
      triggerHaptic(true, 18);
    }
    onUpdateSettings({ ...settings, [key]: nextVal });
  };

  const handleMusicVolumeChange = (pct: number) => {
    const clamped = Math.max(0, Math.min(1, pct / 100));
    audioEngine.unlock();
    audioEngine.setMusicVolume(clamped);
    onUpdateSettings({ ...settings, musicVolume: clamped });
  };

  const handleResetControls = () => {
    audioEngine.playClick();
    onUpdateSettings({ ...settings, keyBindings: { ...DEFAULT_KEY_BINDINGS } });
    setListeningAction(null);
    setControlsSavedNotice(true);
    window.setTimeout(() => setControlsSavedNotice(false), 1800);
  };

  const handleTestSfx = () => {
    audioEngine.unlock();
    audioEngine.setSfxEnabled(true);
    audioEngine.playCueHit(0.75);
    window.setTimeout(() => audioEngine.playBallCollision(0.85), 110);
    window.setTimeout(() => audioEngine.playCoinCollect(), 240);
  };

  const handleSendPasswordReset = async () => {
    if (!userEmail) return;
    audioEngine.playClick();
    setResetStatus('sending');
    setResetError(null);
    try {
      await resetPassword(userEmail);
      setResetStatus('sent');
    } catch (err: unknown) {
      setResetStatus('error');
      setResetError(
        err instanceof Error
          ? err.message.replace(/[-–—]/g, ' ')
          : lang === 'id'
            ? 'Gagal mengirim email reset.'
            : 'Unable to send reset email.',
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'settings')}
        className="w-full max-w-xl max-h-[90vh] rounded-3xl liquid-metal-border glass-panel mafia-texture-surface flex flex-col overflow-hidden text-[#f4f1ea]"
      >
        {/* Sticky Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-white/10 shrink-0">
          <h2 className="font-display text-xl font-black text-[#f8f5ee]">{t(lang, 'settings')}</h2>
          <button
            type="button"
            aria-label={lang === 'id' ? 'Tutup Pengaturan' : 'Close Settings'}
            onClick={onClose}
            className="w-9 h-9 rounded-full neu-inset flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Clean 3-Tab Segmented Switcher */}
        <div className="px-5 sm:px-6 pt-3.5 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl neu-inset">
            {[
              { id: 'audio' as const, label: t(lang, 'settingsTabAudio'), icon: Music },
              { id: 'controls' as const, label: t(lang, 'settingsTabControls'), icon: Gamepad2 },
              { id: 'account' as const, label: t(lang, 'settingsTabAccount'), icon: ShieldCheck },
            ].map(({ id, label, icon: TabIcon }) => {
              const selected = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`settings-tab-${id}`}
                  onClick={() => {
                    audioEngine.playClick();
                    setActiveTab(id);
                  }}
                  className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    selected
                      ? 'neu-surface border border-amber-400/60 text-amber-300 shadow-sm'
                      : 'text-[#a69a87] hover:text-[#f4f1ea]'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Inner Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-3.5">
          {activeTab === 'audio' && (
            <>
              {/* Language & Graphics Quality */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl neu-inset space-y-2.5">
                  <span className="block text-xs font-bold text-zinc-200">{t(lang, 'language')}</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'en' as const, label: 'English' },
                      { id: 'id' as const, label: 'Indonesia' },
                    ].map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        data-testid={`settings-lang-${l.id}`}
                        onClick={() => {
                          audioEngine.playClick();
                          onUpdateSettings({ ...settings, language: l.id });
                        }}
                        className={`py-2 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                          settings.language === l.id
                            ? 'neu-surface border-amber-400/70 text-amber-300'
                            : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.07]'
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-300/90 font-medium">{t(lang, 'languageSaved')}</p>
                </div>

                <div className="p-3.5 rounded-2xl neu-inset space-y-2.5">
                  <span className="block text-xs font-bold text-zinc-200">{t(lang, 'graphicsQuality')}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'low', label: t(lang, 'graphicsLow') },
                        { id: 'medium', label: t(lang, 'graphicsMedium') },
                        { id: 'high', label: t(lang, 'graphicsHigh') },
                      ] as const
                    ).map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => {
                          audioEngine.playClick();
                          onUpdateSettings({ ...settings, graphicsQuality: q.id });
                        }}
                        className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                          settings.graphicsQuality === q.id
                            ? 'neu-surface border-amber-400/70 text-amber-300'
                            : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.07]'
                        }`}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Lounge Music + Volume Slider */}
              <div className="p-4 rounded-2xl neu-inset space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10 text-amber-400 shrink-0">
                      <Music className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-zinc-100">{t(lang, 'music')}</div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {lang === 'id' ? 'Musik latar lembut di menu dan meja' : 'Warm lounge soundtrack in menu and table'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.musicEnabled}
                    aria-label={t(lang, 'music')}
                    onClick={() => toggle('musicEnabled')}
                    className={`relative w-12 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                      settings.musicEnabled ? 'bg-amber-400' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                        settings.musicEnabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-white/8 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-300">{t(lang, 'musicVolume')}</span>
                    <span
                      data-testid="music-volume-value"
                      className="font-mono-tabular font-bold text-amber-300"
                    >
                      {musicVolPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={musicVolPct}
                    aria-label={t(lang, 'musicVolume')}
                    data-testid="music-volume-slider"
                    onChange={(e) => handleMusicVolumeChange(Number(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* SFX & Vibration */}
              {[
                {
                  key: 'sfxEnabled' as const,
                  label: t(lang, 'soundEffects'),
                  hint: lang === 'id' ? 'Suara sodokan stik dan benturan bola' : 'Cue strike, collision, and pocket SFX',
                  icon: Volume2,
                },
                {
                  key: 'vibrationEnabled' as const,
                  label: t(lang, 'vibration'),
                  hint: lang === 'id' ? 'Getaran halus saat break dan bola masuk' : 'Tactile pulse on break shots and pockets',
                  icon: Smartphone,
                },
              ].map(({ key, label, hint, icon: Icon }) => {
                const active = settings[key];
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 p-3.5 rounded-2xl neu-inset"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10 text-amber-400 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-zinc-100">{label}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{hint}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {key === 'sfxEnabled' && (
                        <button
                          type="button"
                          onClick={handleTestSfx}
                          className="px-2.5 py-1 rounded-lg bg-amber-400/12 hover:bg-amber-400/20 border border-amber-400/35 text-[11px] font-bold text-amber-200 cursor-pointer transition-colors"
                        >
                          {t(lang, 'testAudio')}
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={label}
                        onClick={() => toggle(key)}
                        className={`relative w-12 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                          active ? 'bg-amber-400' : 'bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`block w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                            active ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {activeTab === 'controls' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl neu-inset space-y-2.5">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <Crosshair className="w-4 h-4 text-amber-400" />
                    <span>{t(lang, 'aimGuide')}</span>
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'standard' as const, label: t(lang, 'aimGuideStandard') },
                      { id: 'pro' as const, label: t(lang, 'aimGuidePro') },
                    ].map((opt) => {
                      const selected = (settings.aimGuide || 'pro') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            audioEngine.playClick();
                            onUpdateSettings({ ...settings, aimGuide: opt.id });
                          }}
                          className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                            selected
                              ? 'neu-surface border-amber-400/70 text-amber-300'
                              : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.07]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl neu-inset space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-zinc-200">{t(lang, 'controlSensitivity')}</span>
                    <span className="font-mono-tabular font-bold text-amber-300">
                      {settings.sensitivity.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={2.0}
                    step={0.1}
                    value={settings.sensitivity}
                    onChange={(e) => onUpdateSettings({ ...settings, sensitivity: Number(e.target.value) })}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl neu-inset space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                    <Gamepad2 className="w-4 h-4 text-amber-400" />
                    <span>{t(lang, 'controlsGuideTitle')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleResetControls}
                    data-testid="reset-controls-btn"
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/12 text-[11px] font-bold text-zinc-200 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t(lang, 'resetControls')}</span>
                  </button>
                </div>

                <div className="rounded-xl bg-black/35 border border-white/8 p-3 text-[11px] text-zinc-300 space-y-1 leading-relaxed">
                  <p>{t(lang, 'controlsTouchMouse')}</p>
                  <p>{t(lang, 'controlsKeyboardHint')}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {KEY_ACTION_ROWS.map(({ action, i18nKey }) => {
                    const isListening = listeningAction === action;
                    return (
                      <div
                        key={action}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-black/30 border border-white/10"
                      >
                        <span className="text-xs font-semibold text-zinc-200">{t(lang, i18nKey)}</span>
                        <button
                          type="button"
                          data-testid={`rebind-${action}`}
                          onClick={() => {
                            audioEngine.playClick();
                            setListeningAction(isListening ? null : action);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-mono-tabular text-[11px] font-bold border transition-colors cursor-pointer ${
                            isListening
                              ? 'bg-amber-400 text-zinc-950 border-amber-300 animate-pulse'
                              : 'bg-white/[0.06] text-amber-300 border-white/15 hover:bg-white/[0.12]'
                          }`}
                        >
                          {isListening ? t(lang, 'pressAnyKey') : formatKeyLabel(keyBindings[action])}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {controlsSavedNotice && (
                  <div className="text-[11px] font-semibold text-amber-300">{t(lang, 'controlsSaved')}</div>
                )}
              </div>
            </>
          )}

          {activeTab === 'account' && (
            <div className="p-4 rounded-2xl neu-inset space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t(lang, 'accountControls')}</span>
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/12 text-[10px] font-bold text-amber-300 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  <span>{accountBadge}</span>
                </span>
              </div>

              <div className="flex items-center gap-3.5">
                <PlayerAvatar
                  avatarId={profile.avatar}
                  customAvatarUrl={profile.customAvatarUrl}
                  frameId={profile.frame}
                  username={profile.username}
                  size="lg"
                  online
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-base font-display font-black text-zinc-100 truncate">{profile.username}</div>
                  <div className="text-xs font-mono-tabular font-semibold text-amber-300">
                    {t(lang, 'playerIdLabel')}: {formatPlayerId(profile.playerId)}
                  </div>
                  {userEmail && <div className="text-xs text-zinc-400 truncate">{userEmail}</div>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.playClick();
                    onEditProfile();
                  }}
                  data-testid="settings-edit-profile-btn"
                  className="px-3.5 py-2 rounded-xl bg-amber-400/12 hover:bg-amber-400/20 border border-amber-400/35 text-amber-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{t(lang, 'editProfileAvatar')}</span>
                </button>

                {isFirebaseAccount && providerId === 'password' && userEmail && (
                  <button
                    type="button"
                    disabled={resetStatus === 'sending' || resetStatus === 'sent'}
                    onClick={() => void handleSendPasswordReset()}
                    className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/12 text-xs font-semibold text-zinc-200 flex items-center gap-1.5 disabled:opacity-60 cursor-pointer transition-colors"
                  >
                    {resetStatus === 'sent' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-amber-300" />
                        <span>{t(lang, 'passwordResetSent')}</span>
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>
                          {resetStatus === 'sending'
                            ? lang === 'id'
                              ? 'Mengirim...'
                              : 'Sending...'
                            : t(lang, 'sendPasswordReset')}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
              {resetError && <div className="text-[11px] text-red-400">{resetError}</div>}
            </div>
          )}
        </div>

        {/* Sticky Docked Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-white/10 bg-black/35 shrink-0 space-y-2">
          <button
            type="button"
            onClick={() => {
              audioEngine.playClick();
              onLogout();
            }}
            data-testid="logout-btn"
            className="w-full py-2.5 rounded-xl neu-btn-crimson text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t(lang, 'switchLogout')}</span>
          </button>

          <div className="text-center text-[11px] font-medium text-zinc-500">
            {t(lang, 'footerWatermark')}
          </div>
        </div>
      </div>
    </div>
  );
};
