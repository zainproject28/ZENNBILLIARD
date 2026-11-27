import React, { useMemo, useState } from 'react';
import { Check, Coins, Sparkles, X } from 'lucide-react';
import { getCueStats, SHOP_CATALOG } from '../game/constants.ts';
import type { ShopItemDef, UserProfile } from '../game/types.ts';
import { applyLocalShopPurchase, safeFetchJson } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import { t, type Language } from '../services/i18n.ts';

interface ShopModalProps {
  profile: UserProfile;
  language?: Language;
  token: string;
  initialCategory?: ShopItemDef['category'];
  onProfileUpdate: (profile: UserProfile, purchasedNew?: boolean) => void;
  onClose: () => void;
}

const CueSvgGraphic: React.FC<{ item: ShopItemDef; compact?: boolean }> = ({ item, compact }) => (
  <svg
    viewBox="0 0 360 28"
    className={compact ? 'w-full h-6' : 'w-full h-9 drop-shadow-[0_6px_10px_rgba(0,0,0,0.28)]'}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id={`shaft-${item.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={item.primaryColor} />
        <stop offset="75%" stopColor={item.accentColor} />
        <stop offset="100%" stopColor={item.secondaryColor} />
      </linearGradient>
    </defs>
    <rect x="6" y="11.5" width="7" height="5" rx="1.5" fill="#38bdf8" />
    <rect x="13" y="11.2" width="12" height="5.6" fill="#f8fafc" />
    <polygon points="25,11.4 205,9.6 205,18.4 25,16.6" fill={`url(#shaft-${item.id})`} />
    <rect x="205" y="9.2" width="8" height="9.6" fill={item.accentColor} />
    <polygon points="213,9.2 346,7.2 346,20.8 213,18.8" fill={item.secondaryColor} />
    <rect x="234" y="8.8" width="42" height="10.4" rx="2" fill={item.primaryColor} opacity="0.35" />
    <rect x="336" y="7.2" width="10" height="13.6" rx="2" fill={item.accentColor} />
  </svg>
);

const TablePreviewMini: React.FC<{ item: ShopItemDef }> = ({ item }) => {
  const railTone = item.tableMeta?.railTone || item.secondaryColor;
  const feltGlow = item.tableMeta?.feltGlow || item.primaryColor;
  const trimTone = item.tableMeta?.trimTone || item.accentColor;

  return (
    <div
      className="relative w-full max-w-[260px] h-32 rounded-2xl p-3 shadow-lg border"
      style={{
        background: `linear-gradient(135deg, ${railTone} 0%, ${item.secondaryColor} 100%)`,
        borderColor: `${item.accentColor}66`,
      }}
    >
      {[
        'top-0 left-0 rounded-tl-2xl',
        'top-0 right-0 rounded-tr-2xl',
        'bottom-0 left-0 rounded-bl-2xl',
        'bottom-0 right-0 rounded-br-2xl',
      ].map((pos, idx) => (
        <span
          key={idx}
          className={`absolute w-4 h-4 ${pos}`}
          style={{
            background: `linear-gradient(135deg, ${trimTone}, ${item.accentColor})`,
          }}
        />
      ))}

      <div
        className="w-full h-full rounded-lg relative overflow-hidden border border-black/40 flex items-center justify-center"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${feltGlow} 0%, ${item.primaryColor} 72%)`,
        }}
      >
        <div className="absolute left-1/4 inset-y-0 w-px bg-white/25" />
        {[
          'top-0 left-0',
          'top-0 left-1/2 -translate-x-1/2',
          'top-0 right-0',
          'bottom-0 left-0',
          'bottom-0 left-1/2 -translate-x-1/2',
          'bottom-0 right-0',
        ].map((pos, idx) => (
          <span
            key={idx}
            className={`absolute w-2.5 h-2.5 rounded-full bg-zinc-950 border border-white/25 ${pos}`}
          />
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-white shadow" />
          <span className="w-3.5 h-3.5 rounded-full bg-yellow-400 shadow" />
          <span className="w-3.5 h-3.5 rounded-full bg-zinc-950 border border-white/40 shadow" />
        </div>
      </div>
    </div>
  );
};

const VenuePreviewMini: React.FC<{ item: ShopItemDef }> = ({ item }) => (
  <div
    className={`relative w-full max-w-[260px] h-32 rounded-2xl p-4 shadow-lg border flex flex-col justify-between overflow-hidden ${item.venueMeta?.backdropClass || ''}`}
    style={{
      borderColor: `${item.accentColor}66`,
    }}
  >
    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-200/90">
      <span>{item.venueMeta?.atmosphereLabel || item.name}</span>
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: item.accentColor }}
      />
    </div>
    <div className="mx-auto w-28 h-12 rounded-lg border-2 border-amber-500/40 bg-emerald-900/60 shadow-inner flex items-center justify-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full bg-white shadow" />
      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow" />
      <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 border border-white/40 shadow" />
    </div>
    <div className="text-[10px] font-semibold text-zinc-300/90 truncate">{item.name}</div>
  </div>
);

export const ShopModal: React.FC<ShopModalProps> = ({
  profile,
  language = 'en',
  token,
  initialCategory = 'cue',
  onProfileUpdate,
  onClose,
}) => {
  const isId = language === 'id';
  const [category, setCategory] = useState<ShopItemDef['category']>(initialCategory);
  const [selectedId, setSelectedId] = useState<string>(() =>
    initialCategory === 'table'
      ? profile.equippedTable
      : initialCategory === 'venue'
        ? profile.equippedVenue || 'venue_billiard_cafe'
        : profile.equippedCue,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories: Array<{ id: ShopItemDef['category']; label: string }> = [
    { id: 'cue', label: isId ? 'Stik Biliar' : 'Cue Sticks' },
    { id: 'table', label: isId ? 'Meja Biliar' : 'Billiard Tables' },
    { id: 'venue', label: isId ? 'Suasana' : 'Venues' },
    { id: 'avatar', label: 'Avatars' },
    { id: 'frame', label: isId ? 'Bingkai' : 'Frames' },
    { id: 'effect', label: isId ? 'Efek Pukulan' : 'Impact Effects' },
  ];

  const items = useMemo(
    () => SHOP_CATALOG.filter((i) => i.category === category),
    [category],
  );

  const effectiveTableId = SHOP_CATALOG.some((i) => i.id === profile.equippedTable)
    ? profile.equippedTable
    : 'table_tournament_blue';
  const effectiveVenueId = SHOP_CATALOG.some((i) => i.id === profile.equippedVenue)
    ? profile.equippedVenue!
    : 'venue_billiard_cafe';
  const effectiveFrameId = SHOP_CATALOG.some((i) => i.id === profile.frame)
    ? profile.frame
    : 'frame_bronze';
  const effectiveEffectId = SHOP_CATALOG.some((i) => i.id === profile.equippedEffect)
    ? profile.equippedEffect
    : 'effect_classic';

  const previewItem =
    items.find((i) => i.id === selectedId) ||
    items.find((i) =>
      category === 'cue'
        ? i.id === profile.equippedCue
        : category === 'table'
          ? i.id === effectiveTableId
          : category === 'venue'
            ? i.id === effectiveVenueId
            : false,
    ) ||
    items[0];

  const isOwned = (item: ShopItemDef) =>
    item.price === 0 || profile.ownedItems.includes(item.id);

  const isEquipped = (item: ShopItemDef) => {
    if (item.category === 'cue') return profile.equippedCue === item.id;
    if (item.category === 'table') return effectiveTableId === item.id;
    if (item.category === 'venue') return effectiveVenueId === item.id;
    if (item.category === 'avatar') return profile.avatar === item.id;
    if (item.category === 'frame') return effectiveFrameId === item.id;
    return effectiveEffectId === item.id;
  };

  const handleBuyOrEquip = async (item: ShopItemDef) => {
    audioEngine.playClick();
    setSelectedId(item.id);
    setError(null);
    setBusyId(item.id);
    const owned = isOwned(item);

    try {
      const endpoint = owned ? '/api/shop/equip' : '/api/shop/purchase';
      const res = await safeFetchJson<{ profile?: UserProfile; error?: string }>(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (res.ok && res.data?.profile) {
        onProfileUpdate(res.data.profile, !owned);
        return;
      }
      if (!res.isBackendAvailable) {
        const localRes = applyLocalShopPurchase(profile, item.id);
        if (localRes.ok) {
          onProfileUpdate(localRes.profile, !owned);
        } else {
          setError(localRes.error);
        }
        return;
      }
      setError(res.data?.error || (isId ? 'Transaksi gagal.' : 'Transaction failed.'));
    } catch {
      setError(isId ? 'Gagal terhubung saat memperbarui perlengkapan.' : 'Connection error while updating inventory.');
    } finally {
      setBusyId(null);
    }
  };

  const equippedCueStats = getCueStats(profile.equippedCue);
  const previewCueStats = previewItem?.category === 'cue' ? getCueStats(previewItem.id) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'armoryStudio')}
        className="w-full max-w-4xl liquid-metal-border glass-panel rounded-3xl p-5 sm:p-6 space-y-4 max-h-[92vh] flex flex-col text-zinc-100"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <h2 className="font-display text-lg sm:text-xl font-black text-zinc-50">
              {t(language, 'armoryStudio')}
            </h2>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-950/45 border border-amber-400/35 text-xs font-mono-tabular font-bold text-amber-200">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>{profile.coins.toLocaleString()}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label={isId ? 'Tutup Toko' : 'Close Shop'}
            onClick={onClose}
            className="p-2 rounded-xl bg-[#161820] hover:bg-[#1f222c] border border-white/12 text-zinc-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-[#0c0e13] border border-white/10">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                audioEngine.playClick();
                setCategory(cat.id);
                const first = SHOP_CATALOG.find((i) => i.category === cat.id);
                if (first) setSelectedId(first.id);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                category === cat.id
                  ? 'neu-btn-blue'
                  : 'text-zinc-400 hover:bg-[#181b24] hover:text-zinc-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Interactive Showcase */}
        {previewItem && (category === 'cue' || category === 'table' || category === 'venue') && (
          <div className="bg-[#161820] border border-white/10 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-6 flex flex-col items-center justify-center bg-[#0c0e13] border border-white/8 rounded-xl p-3.5 min-h-[120px]">
              {category === 'cue' ? (
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-zinc-100">{previewItem.name}</span>
                    <span className="font-mono-tabular font-bold text-amber-300">
                      {previewCueStats?.tier} Spec
                    </span>
                  </div>
                  <CueSvgGraphic item={previewItem} />
                </div>
              ) : category === 'venue' ? (
                <VenuePreviewMini item={previewItem} />
              ) : (
                <TablePreviewMini item={previewItem} />
              )}
            </div>

            <div className="md:col-span-6 space-y-2.5">
              <div>
                <div className="font-display font-black text-base text-zinc-50">
                  {previewItem.name}
                </div>
                <p className="text-xs text-zinc-400 leading-snug">{previewItem.description}</p>
              </div>

              {previewCueStats ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
                  {(
                    [
                      { key: 'force', label: 'Force', val: previewCueStats.force, cur: equippedCueStats.force },
                      { key: 'aim', label: 'Aim Sight', val: previewCueStats.aim, cur: equippedCueStats.aim },
                      { key: 'spin', label: 'Spin Curve', val: previewCueStats.spin, cur: equippedCueStats.spin },
                      { key: 'control', label: 'Control', val: previewCueStats.control, cur: equippedCueStats.control },
                    ] as const
                  ).map((stat) => {
                    const delta = stat.val - stat.cur;
                    return (
                      <div key={stat.key} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                          <span className="text-zinc-400">{stat.label}</span>
                          <span>
                            <span className="font-bold text-zinc-100">{stat.val}</span>
                            {delta !== 0 && (
                              <span className={`ml-1 text-[10px] ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                ({delta > 0 ? `+${delta}` : delta})
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[#0a0b0f] border border-white/8 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-zinc-400 to-amber-400 transition-all duration-300"
                            style={{ width: `${stat.val}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-between pt-1 text-xs text-zinc-300 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isId ? 'Pratinjau Kain Meja' : 'Live Tournament Cloth Preview'}</span>
                  </span>
                  <span className="font-mono-tabular text-amber-300">
                    {isOwned(previewItem) ? (isId ? 'Dimiliki' : 'Unlocked') : `${previewItem.price.toLocaleString()} Coins`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/35 text-xs text-red-200 font-semibold">
            {error}
          </div>
        )}

        {/* Catalog Grid */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pr-1">
          {items.map((item) => {
            const owned = isOwned(item);
            const equipped = isEquipped(item);
            const selected = previewItem?.id === item.id;
            const canAfford = profile.coins >= item.price;
            const stats = item.cueStats;

            return (
              <div
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`p-3.5 rounded-2xl cursor-pointer transition-all flex flex-col justify-between gap-2.5 border ${
                  equipped
                    ? 'bg-[#1a1d27] border-amber-400/55 shadow-sm'
                    : selected
                      ? 'bg-[#171a22] border-white/30 shadow-sm'
                      : 'bg-[#12141a] border-white/10 hover:border-white/25'
                }`}
              >
                <div className="space-y-2">
                  <div className="h-14 rounded-xl bg-[#090a0d] border border-white/10 flex items-center justify-center overflow-hidden p-2">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-full object-cover border-2 border-amber-400"
                      />
                    ) : item.category === 'cue' ? (
                      <CueSvgGraphic item={item} compact />
                    ) : item.category === 'table' ? (
                      <div
                        className="w-full h-11 rounded-lg border-4 relative"
                        style={{
                          backgroundColor: item.primaryColor,
                          borderColor: item.tableMeta?.railTone || item.secondaryColor,
                        }}
                      >
                        <div className="absolute left-1/4 inset-y-0 w-px bg-white/25" />
                      </div>
                    ) : item.category === 'venue' ? (
                      <div
                        className={`w-full h-11 rounded-lg border border-white/15 flex items-center justify-center text-[10px] font-bold text-zinc-200 ${item.venueMeta?.backdropClass || ''}`}
                      >
                        {item.venueMeta?.atmosphereLabel || item.name}
                      </div>
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full border-4"
                        style={{ backgroundColor: item.primaryColor, borderColor: item.accentColor }}
                      />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-zinc-100 truncate">{item.name}</span>
                      {stats && (
                        <span className="text-[10px] font-mono-tabular font-bold text-amber-300 shrink-0">
                          {stats.tier}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  {stats && (
                    <div className="grid grid-cols-4 gap-1 text-[10px] font-mono-tabular text-zinc-400 font-semibold pt-1">
                      <span>F:{stats.force}</span>
                      <span>A:{stats.aim}</span>
                      <span>S:{stats.spin}</span>
                      <span>C:{stats.control}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/8">
                  <span className="text-xs font-mono-tabular font-bold text-amber-300">
                    {owned
                      ? item.price === 0
                        ? isId
                          ? 'Bawaan'
                          : 'Starter'
                        : isId
                          ? 'Dimiliki'
                          : 'Owned'
                      : `${item.price.toLocaleString()} Coins`}
                  </span>

                  <button
                    type="button"
                    disabled={equipped || busyId === item.id || (!owned && !canAfford)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleBuyOrEquip(item);
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                      equipped
                        ? 'bg-zinc-800 border border-white/15 text-amber-300 cursor-default'
                        : owned
                          ? 'neu-btn-blue'
                          : canAfford
                            ? 'neu-btn-gold'
                            : 'bg-[#1a1c24] text-zinc-500 border border-white/8 cursor-not-allowed'
                    }`}
                  >
                    {equipped ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{isId ? 'Dipakai' : 'Equipped'}</span>
                      </>
                    ) : owned ? (
                      <span>{isId ? 'Pakai' : 'Equip'}</span>
                    ) : (
                      <span>{isId ? 'Beli' : 'Buy'}</span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
