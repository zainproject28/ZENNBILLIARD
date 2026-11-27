import React, { useEffect, useRef, useState } from 'react';
import { Award, BarChart3, Camera, Check, Copy, ImagePlus, Trash2, Trophy, X, ZoomIn } from 'lucide-react';
import {
  AVATAR_EXPORT_SIZE,
  computeSquareCropRect,
  isValidCustomAvatarDataUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
  validateAvatarUploadFile,
} from '../game/avatarCrop.ts';
import { AVATAR_ASSETS, SHOP_CATALOG } from '../game/constants.ts';
import { formatPlayerId, stripPlayerId } from '../game/playerId.ts';
import { getRankFromPoints, normalizePlayerStats } from '../game/rank.ts';
import type { UserProfile } from '../game/types.ts';
import { safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { fetchFirestoreMatchHistory } from '../services/firebase.ts';
import { t, type Language } from '../services/i18n.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { RankBadge } from './RankBadge.tsx';

interface MatchHistoryItem {
  matchId: string;
  opponentName: string;
  opponentAvatar: string;
  result: 'win' | 'loss';
  shots: number;
  duration: number;
  xpEarned: number;
  coinsEarned: number;
  ratingDelta: number;
  createdAt: string;
}

export interface SaveProfilePayload {
  username: string;
  avatar: string;
  customAvatarUrl: string;
  frame: string;
}

interface ProfileModalProps {
  profile: UserProfile;
  language?: Language;
  token: string;
  isFirebaseAccount?: boolean;
  onSaveProfile: (payload: SaveProfilePayload) => Promise<void>;
  onOpenRankTiers?: () => void;
  onClose: () => void;
}

const CROP_VIEW_SIZE = 216;

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  language = 'en',
  token,
  isFirebaseAccount = false,
  onSaveProfile,
  onOpenRankTiers,
  onClose,
}) => {
  const isId = language === 'id';
  const [activeTab, setActiveTab] = useState<'stats' | 'customize'>('stats');
  const [username, setUsername] = useState(profile.username);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [frame, setFrame] = useState(profile.frame);
  const [customAvatarUrl, setCustomAvatarUrl] = useState(
    profile.customAvatarUrl && isValidCustomAvatarDataUrl(profile.customAvatarUrl)
      ? profile.customAvatarUrl
      : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState(false);

  // Interactive circular cropper state
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [cropImgSize, setCropImgSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const [cropZoom, setCropZoom] = useState<number>(1.1);
  const [cropOffset, setCropOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const cropImgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      if (token) {
        const res = await safeFetchJson<{ matches?: MatchHistoryItem[] }>('/api/history', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active && res.ok && res.data?.matches && res.data.matches.length > 0) {
          setHistory(res.data.matches);
          return;
        }
      }
      if (isFirebaseAccount && profile.uid) {
        const fbHistory = await fetchFirestoreMatchHistory(profile.uid, 20);
        if (active) setHistory(fbHistory);
      }
    };
    void loadHistory();
    return () => {
      active = false;
    };
  }, [token, isFirebaseAccount, profile.uid]);

  useEffect(() => {
    return () => {
      if (cropSourceUrl && cropSourceUrl.startsWith('blob:')) {
        URL.revokeObjectURL(cropSourceUrl);
      }
    };
  }, [cropSourceUrl]);

  const winRate = profile.matches > 0 ? Math.round((profile.wins / profile.matches) * 100) : 0;
  const stats = normalizePlayerStats(profile.stats);
  const highestRank = getRankFromPoints(Math.max(profile.highestRankPoints ?? 0, profile.rankPoints ?? 0));
  const ownedAvatars = SHOP_CATALOG.filter(
    (i) => i.category === 'avatar' && profile.ownedItems.includes(i.id),
  );
  const ownedFrames = SHOP_CATALOG.filter(
    (i) => i.category === 'frame' && profile.ownedItems.includes(i.id),
  );

  const handleCopyId = async () => {
    audioEngine.playClick();
    try {
      await navigator.clipboard.writeText(stripPlayerId(profile.playerId));
    } catch {
      // Ignore clipboard failure
    }
    setCopiedId(true);
    window.setTimeout(() => setCopiedId(false), 1800);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSavedMsg(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateAvatarUploadFile(file);
    if (!validation.ok) {
      if (validation.code === 'FILE_TOO_LARGE') {
        setError(t(language, 'photoSizeError'));
      } else if (validation.code === 'UNSUPPORTED_FORMAT') {
        setError(t(language, 'photoFormatError'));
      } else {
        setError(t(language, 'photoProcessError'));
      }
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      cropImgRef.current = img;
      setCropImgSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      setCropZoom(1.1);
      setCropOffset({ x: 0, y: 0 });
      setCropSourceUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return objectUrl;
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError(t(language, 'photoProcessError'));
    };
    img.src = objectUrl;
  };

  const handleApplyCrop = () => {
    const img = cropImgRef.current;
    if (!img) return;
    audioEngine.playClick();

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EXPORT_SIZE;
    canvas.height = AVATAR_EXPORT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError(t(language, 'photoProcessError'));
      return;
    }

    const rect = computeSquareCropRect(
      img.naturalWidth || cropImgSize.w,
      img.naturalHeight || cropImgSize.h,
      cropZoom,
      cropOffset.x,
      cropOffset.y,
    );

    ctx.fillStyle = '#0c0e13';
    ctx.fillRect(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);
    ctx.drawImage(
      img,
      rect.sx,
      rect.sy,
      rect.sWidth,
      rect.sHeight,
      0,
      0,
      AVATAR_EXPORT_SIZE,
      AVATAR_EXPORT_SIZE,
    );

    let exported = '';
    for (const quality of [0.88, 0.78, 0.68, 0.56, 0.44]) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      if (candidate.length <= MAX_AVATAR_DATA_URL_LENGTH && isValidCustomAvatarDataUrl(candidate)) {
        exported = candidate;
        break;
      }
    }

    if (!exported) {
      setError(t(language, 'photoProcessError'));
      return;
    }

    setCustomAvatarUrl(exported);
    setCropSourceUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleCancelCrop = () => {
    setCropSourceUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.playClick();
    setError(null);
    setSavedMsg(null);
    const trimmed = username.trim();
    if (!/^[a-zA-Z0-9_ .]{2,24}$/.test(trimmed)) {
      setError(
        isId
          ? 'Nama pemain harus 2 sampai 24 karakter (huruf, angka, spasi, titik, atau garis bawah).'
          : 'Username must be 2 to 24 characters using letters, numbers, spaces, underscore, or period.',
      );
      return;
    }
    setSaving(true);
    try {
      await onSaveProfile({
        username: trimmed,
        avatar,
        customAvatarUrl,
        frame,
      });
      setSavedMsg(t(language, 'profileSaved'));
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message.replace(/[-–—]/g, ' ')
          : isId
            ? 'Gagal menyimpan profil.'
            : 'Failed to save profile.',
      );
    } finally {
      setSaving(false);
    }
  };

  const formatRate = (w: number, m: number) => (m > 0 ? `${Math.round((w / m) * 100)}%` : '0%');

  const cropPreviewScale = Math.max(CROP_VIEW_SIZE / Math.max(1, cropImgSize.w), CROP_VIEW_SIZE / Math.max(1, cropImgSize.h)) * cropZoom;
  const maxPanPx = Math.max(0, (Math.max(cropImgSize.w, cropImgSize.h) * cropPreviewScale - CROP_VIEW_SIZE) / 2);

  const providerLabel =
    profile.authProvider === 'google'
      ? 'Google'
      : profile.authProvider === 'email'
        ? 'Email'
        : isFirebaseAccount
          ? 'Google / Email'
          : isId
            ? 'Sesi Tamu'
            : 'Guest';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'profile')}
        className="w-full max-w-2xl max-h-[92vh] rounded-3xl liquid-metal-border glass-panel mafia-texture-surface flex flex-col overflow-hidden text-[#f4f1ea]"
      >
        {/* Sticky Clean Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-black text-[#f8f5ee]">{t(language, 'profile')}</h2>
            <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/12 text-[10px] font-bold text-amber-300">
              {providerLabel}
            </span>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Profil' : 'Close Profile'}
            onClick={onClose}
            className="w-9 h-9 rounded-full neu-inset flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          {/* Redesigned Luxury Player Dossier Header */}
          <div className="rounded-2xl border border-white/12 bg-gradient-to-br from-[#1b1e2a]/90 via-[#12141c]/95 to-[#0b0d12]/98 p-4 sm:p-5 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <PlayerAvatar
                  avatarId={avatar}
                  customAvatarUrl={customAvatarUrl}
                  frameId={frame}
                  username={username || profile.username}
                  size="xl"
                />
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-xl font-black text-[#f8f5ee] truncate">
                      {username || profile.username}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-amber-400/15 border border-amber-300/35 text-[10px] font-mono-tabular font-black text-amber-300">
                      LV.{profile.level}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono-tabular font-bold text-[#d7c6a5]">
                      {t(language, 'playerIdLabel')}: <span className="text-amber-300">{formatPlayerId(profile.playerId)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyId()}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 text-[11px] font-bold text-[#f4f1ea] flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copiedId ? <Check className="w-3 h-3 text-amber-300" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedId ? t(language, 'copied') : t(language, 'copyId')}</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <RankBadge rankPoints={profile.rankPoints ?? 0} size="sm" showPoints language={language} />
                    {onOpenRankTiers && (
                      <button
                        type="button"
                        data-testid="profile-rank-tiers-btn"
                        onClick={() => {
                          audioEngine.playClick();
                          onOpenRankTiers();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-400/12 hover:bg-amber-400/20 border border-amber-300/35 text-[11px] font-bold text-amber-200 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Award className="w-3.5 h-3.5 text-amber-300" />
                        <span>{t(language, 'viewRankTiers')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Segmented Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl neu-inset">
            <button
              type="button"
              data-testid="profile-tab-stats"
              onClick={() => {
                audioEngine.playClick();
                setActiveTab('stats');
              }}
              className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'stats'
                  ? 'neu-surface border border-amber-400/60 text-amber-300 shadow-sm'
                  : 'text-[#a69a87] hover:text-[#f4f1ea]'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{t(language, 'statsTab')}</span>
            </button>
            <button
              type="button"
              data-testid="profile-tab-customize"
              onClick={() => {
                audioEngine.playClick();
                setActiveTab('customize');
              }}
              className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'customize'
                  ? 'neu-surface border border-amber-400/60 text-amber-300 shadow-sm'
                  : 'text-[#a69a87] hover:text-[#f4f1ea]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{t(language, 'customizeTab')}</span>
            </button>
          </div>

          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
                <div className="sm:col-span-2">
                  <RankBadge rankPoints={profile.rankPoints ?? 0} size="lg" showProgress language={language} className="h-full" />
                </div>
                <div className="flex flex-col justify-between px-3.5 py-3 rounded-2xl neu-inset text-xs gap-2">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-[#a69a87] flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t(language, 'highestRank')}</span>
                  </span>
                  <RankBadge rankPoints={highestRank.points} size="sm" showPoints language={language} />
                </div>
              </div>

              {/* Overall 4-stat grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <div className="p-3 rounded-2xl neu-inset">
                  <div className="text-[11px] text-[#a69a87] font-semibold">{t(language, 'statsWins')}</div>
                  <div className="font-mono-tabular text-xl font-black text-sky-400 mt-0.5">{profile.wins}</div>
                </div>
                <div className="p-3 rounded-2xl neu-inset">
                  <div className="text-[11px] text-[#a69a87] font-semibold">{t(language, 'statsLosses')}</div>
                  <div className="font-mono-tabular text-xl font-black text-red-400 mt-0.5">{profile.losses}</div>
                </div>
                <div className="p-3 rounded-2xl neu-inset">
                  <div className="text-[11px] text-[#a69a87] font-semibold">{t(language, 'statsMatches')}</div>
                  <div className="font-mono-tabular text-xl font-black text-[#f8f5ee] mt-0.5">{profile.matches}</div>
                </div>
                <div className="p-3 rounded-2xl neu-inset">
                  <div className="text-[11px] text-[#a69a87] font-semibold">{t(language, 'statsWinRate')}</div>
                  <div className="font-mono-tabular text-xl font-black text-amber-300 mt-0.5">{winRate}%</div>
                </div>
              </div>

              {/* Mode Breakdown Grid with subtle win-rate bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { label: t(language, 'stats8Ball'), data: stats.eightBall },
                  { label: t(language, 'stats9Ball'), data: stats.nineBall },
                  { label: t(language, 'statsRanked'), data: stats.ranked },
                  { label: t(language, 'statsVsPlayers'), data: stats.vsPlayers },
                  { label: t(language, 'statsVsBots'), data: stats.vsBots },
                ].map((row) => {
                  const pct = row.data.matches > 0 ? Math.round((row.data.wins / row.data.matches) * 100) : 0;
                  return (
                    <div
                      key={row.label}
                      className="p-3 rounded-2xl neu-inset text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#e2d6be]">{row.label}</span>
                        <span className="font-mono-tabular font-bold text-[#f8f5ee]">
                          {row.data.wins}W / {row.data.losses}L · {formatRate(row.data.wins, row.data.matches)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Completed Match History */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#a69a87]">
                  {t(language, 'recentMatches')} ({history.length})
                </h3>
                {history.length === 0 ? (
                  <div className="text-xs text-[#a69a87] py-4 text-center rounded-2xl neu-inset px-3">
                    {t(language, 'noCompletedMatches')}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {history.map((m) => (
                      <div
                        key={m.matchId}
                        className="flex items-center justify-between p-2.5 rounded-xl neu-inset text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold uppercase text-[10px] ${
                              m.result === 'win'
                                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                                : 'bg-red-500/15 text-red-400 border border-red-400/30'
                            }`}
                          >
                            {m.result}
                          </span>
                          <span className="text-[#f4f1ea] font-semibold">vs {m.opponentName}</span>
                        </div>
                        <div className="font-mono-tabular text-[#a69a87]">
                          {m.shots} {isId ? 'sodokan' : 'shots'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        {activeTab === 'customize' && (
          <form onSubmit={handleSave} className="space-y-4">
            {/* Custom Photo Upload & Interactive Cropper */}
            <div className="p-4 rounded-2xl neu-inset space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#d7c6a5] flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t(language, 'customPhotoTitle')}</span>
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    data-testid="avatar-upload-input"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    data-testid="avatar-upload-btn"
                    onClick={() => {
                      audioEngine.playClick();
                      fileInputRef.current?.click();
                    }}
                    className="px-3 py-1.5 rounded-lg neu-btn-blue text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{customAvatarUrl ? t(language, 'replacePhoto') : t(language, 'uploadPhoto')}</span>
                  </button>
                  {customAvatarUrl && (
                    <button
                      type="button"
                      data-testid="avatar-remove-btn"
                      onClick={() => {
                        audioEngine.playClick();
                        setCustomAvatarUrl('');
                      }}
                      className="px-2.5 py-1.5 rounded-lg neu-btn-crimson text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t(language, 'removePhoto')}</span>
                    </button>
                  )}
                </div>
              </div>

              {cropSourceUrl ? (
                <div data-testid="avatar-cropper" className="space-y-3 pt-1">
                  <div className="text-[11px] font-semibold text-amber-300 text-center">
                    {t(language, 'cropPhotoTitle')} · {t(language, 'cropDragHint')}
                  </div>
                  <div
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      dragRef.current = {
                        active: true,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: cropOffset.x,
                        origY: cropOffset.y,
                      };
                    }}
                    onPointerMove={(e) => {
                      if (!dragRef.current.active) return;
                      const dx = e.clientX - dragRef.current.startX;
                      const dy = e.clientY - dragRef.current.startY;
                      const denom = Math.max(24, maxPanPx || 60);
                      setCropOffset({
                        x: Math.max(-1, Math.min(1, dragRef.current.origX + dx / denom)),
                        y: Math.max(-1, Math.min(1, dragRef.current.origY + dy / denom)),
                      });
                    }}
                    onPointerUp={() => {
                      dragRef.current.active = false;
                    }}
                    className="relative mx-auto rounded-full overflow-hidden border-2 border-amber-400/75 shadow-lg cursor-grab active:cursor-grabbing touch-none bg-[#06070a]"
                    style={{ width: CROP_VIEW_SIZE, height: CROP_VIEW_SIZE }}
                  >
                    <img
                      src={cropSourceUrl}
                      alt={t(language, 'cropPhotoTitle')}
                      draggable={false}
                      className="absolute top-1/2 left-1/2 max-w-none select-none pointer-events-none"
                      style={{
                        width: cropImgSize.w * cropPreviewScale,
                        height: cropImgSize.h * cropPreviewScale,
                        transform: `translate(calc(-50% + ${cropOffset.x * maxPanPx}px), calc(-50% + ${cropOffset.y * maxPanPx}px))`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-3 px-2">
                    <ZoomIn className="w-4 h-4 text-amber-300 shrink-0" />
                    <span className="text-[11px] font-semibold text-[#a69a87] shrink-0">
                      {t(language, 'cropZoom')}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={3.5}
                      step={0.05}
                      value={cropZoom}
                      onChange={(e) => setCropZoom(Number(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleCancelCrop}
                      className="px-3.5 py-1.5 rounded-lg neu-surface text-xs font-bold text-[#d7c6a5] cursor-pointer"
                    >
                      {t(language, 'cancelCrop')}
                    </button>
                    <button
                      type="button"
                      data-testid="avatar-apply-crop-btn"
                      onClick={handleApplyCrop}
                      className="px-4 py-1.5 rounded-lg neu-btn-gold text-xs font-bold cursor-pointer"
                    >
                      {t(language, 'applyCrop')}
                    </button>
                  </div>
                </div>
              ) : (
                !customAvatarUrl && (
                  <p className="text-[11px] text-[#a69a87]">{t(language, 'defaultAvatarHint')}</p>
                )
              )}
            </div>

            <div>
              <label htmlFor="profile-username" className="block text-xs font-bold text-[#d7c6a5] mb-1.5">
                {isId ? 'Ubah Nama Pemain' : 'Edit Username'}
              </label>
              <input
                id="profile-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                maxLength={24}
                className="w-full px-3.5 py-2.5 rounded-xl neu-inset text-sm text-[#f4f1ea] placeholder:text-[#7c7264] focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <span className="block text-xs font-bold text-[#d7c6a5] mb-2">
                {isId ? 'Pilih Avatar Dimiliki' : 'Select Owned Avatar'}
              </span>
              <div className="flex flex-wrap gap-2.5">
                {ownedAvatars.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.name}
                    onClick={() => {
                      audioEngine.playClick();
                      setAvatar(item.id);
                    }}
                    className={`p-1 rounded-full border-2 transition-transform cursor-pointer ${
                      avatar === item.id && !customAvatarUrl
                        ? 'border-amber-400 scale-105'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={AVATAR_ASSETS[item.id]}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#d7c6a5] mb-2">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>{t(language, 'avatarBorderTitle')}</span>
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ownedFrames.map((item) => {
                  const selected = frame === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        audioEngine.playClick();
                        setFrame(item.id);
                      }}
                      className={`p-2 rounded-xl flex items-center gap-2 text-left text-xs font-bold transition-all cursor-pointer ${
                        selected
                          ? 'neu-surface border border-amber-400/70 text-amber-300'
                          : 'neu-inset text-[#d7c6a5] hover:text-[#f4f1ea]'
                      }`}
                    >
                      <PlayerAvatar
                        avatarId={avatar}
                        customAvatarUrl={customAvatarUrl}
                        frameId={item.id}
                        username={username || profile.username}
                        size="sm"
                      />
                      <span className="truncate">{item.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <div className="text-xs font-semibold text-red-400">{error}</div>}
            {savedMsg && <div className="text-xs font-semibold text-amber-300">{savedMsg}</div>}

            <button
              type="submit"
              disabled={saving}
              data-testid="save-profile-btn"
              className="px-5 py-2.5 rounded-xl neu-btn-gold text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              <span>{saving ? t(language, 'saving') : t(language, 'saveChanges')}</span>
            </button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
};
