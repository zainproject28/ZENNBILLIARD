import React, { useEffect, useState } from 'react';
import { isValidCustomAvatarDataUrl } from '../game/avatarCrop.ts';
import { AVATAR_ASSETS, SHOP_CATALOG } from '../game/constants.ts';

interface PlayerAvatarProps {
  avatarId: string;
  customAvatarUrl?: string;
  frameId?: string;
  username: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}

const FRAME_STYLES: Record<
  string,
  {
    ringBg: string;
    outerShadow: string;
    badgeBg?: string;
    badgeSymbol?: string;
  }
> = {
  frame_bronze: {
    ringBg: 'linear-gradient(135deg, #d97706 0%, #fef08a 45%, #78350f 100%)',
    outerShadow: '0 0 0 1px rgba(120, 53, 15, 0.35)',
  },
  frame_silver_crest: {
    ringBg: 'linear-gradient(135deg, #e2e8f0 0%, #93c5fd 50%, #475569 100%)',
    outerShadow: '0 0 0 1px rgba(30, 58, 138, 0.3)',
  },
  frame_royal_gold: {
    ringBg: 'linear-gradient(135deg, #2563eb 0%, #facc15 50%, #1e3a8a 100%)',
    outerShadow: '0 2px 10px rgba(37, 99, 235, 0.35)',
    badgeBg: '#facc15',
    badgeSymbol: '★',
  },
  frame_platinum_prism: {
    ringBg: 'linear-gradient(135deg, #38bdf8 0%, #f8fafc 45%, #0284c7 100%)',
    outerShadow: '0 2px 10px rgba(2, 132, 199, 0.35)',
    badgeBg: '#38bdf8',
    badgeSymbol: '◆',
  },
  frame_diamond_halo: {
    ringBg: 'linear-gradient(135deg, #e0f2fe 0%, #3b82f6 50%, #1e3a8a 100%)',
    outerShadow: '0 2px 12px rgba(37, 99, 235, 0.45)',
    badgeBg: '#e0f2fe',
    badgeSymbol: '✦',
  },
  frame_obsidian: {
    ringBg: 'linear-gradient(135deg, #dc2626 0%, #fbbf24 50%, #7f1d1d 100%)',
    outerShadow: '0 2px 12px rgba(220, 38, 38, 0.4)',
    badgeBg: '#dc2626',
    badgeSymbol: '♦',
  },
  frame_master_sovereign: {
    ringBg: 'linear-gradient(135deg, #fde047 0%, #dc2626 50%, #78350f 100%)',
    outerShadow: '0 2px 14px rgba(185, 28, 28, 0.5)',
    badgeBg: '#fde047',
    badgeSymbol: '♛',
  },
};

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatarId,
  customAvatarUrl = '',
  frameId = 'frame_bronze',
  username,
  size = 'md',
  online,
}) => {
  const [imgError, setImgError] = useState(false);

  const hasValidCustom = Boolean(customAvatarUrl && isValidCustomAvatarDataUrl(customAvatarUrl));
  const src = hasValidCustom ? customAvatarUrl : AVATAR_ASSETS[avatarId] || AVATAR_ASSETS.avatar_ace;

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const frameItem = SHOP_CATALOG.find((i) => i.id === frameId);
  const frameStyle = FRAME_STYLES[frameId] || {
    ringBg: `linear-gradient(135deg, ${frameItem?.accentColor || '#eab308'}, ${frameItem?.primaryColor || '#1d4ed8'})`,
    outerShadow: '0 0 0 1px rgba(30, 58, 138, 0.3)',
  };

  const dims =
    size === 'sm'
      ? 'w-9 h-9 text-xs p-[2.5px]'
      : size === 'md'
        ? 'w-11 h-11 text-sm p-[3px]'
        : size === 'lg'
          ? 'w-16 h-16 text-lg p-[3.5px]'
          : 'w-20 h-20 text-xl p-[4px]';

  const emblemSize =
    size === 'sm'
      ? 'w-3.5 h-3.5 text-[7px] -top-0.5 -right-0.5'
      : size === 'md'
        ? 'w-4 h-4 text-[8px] -top-0.5 -right-0.5'
        : 'w-5 h-5 text-[10px] -top-1 -right-0.5';

  return (
    <div className="relative inline-flex shrink-0">
      {/* Outer decorative frame ring wraps cleanly OUTSIDE the portrait so the center/face is never covered */}
      <div
        className={`${dims} rounded-full flex items-center justify-center shrink-0`}
        style={{
          background: frameStyle.ringBg,
          boxShadow: frameStyle.outerShadow,
        }}
      >
        <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-[#0e1015] font-bold text-amber-200 ring-1 ring-white/25">
          {!imgError && src ? (
            <img
              src={src}
              alt={username}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <span>{username.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
      </div>

      {frameStyle.badgeSymbol && (
        <span
          aria-hidden="true"
          className={`absolute ${emblemSize} rounded-full border border-slate-900/30 flex items-center justify-center font-black shadow-sm pointer-events-none select-none`}
          style={{
            backgroundColor: frameStyle.badgeBg || '#facc15',
            color: frameId === 'frame_obsidian' ? '#fef08a' : '#0f172a',
          }}
        >
          {frameStyle.badgeSymbol}
        </span>
      )}

      {online !== undefined && (
        <span
          aria-label={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0e1015] ${
            online ? 'bg-sky-400' : 'bg-zinc-600'
          }`}
        />
      )}
    </div>
  );
};
