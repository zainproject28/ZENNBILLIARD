import type { CueStats, PocketDef, RuleOptions, ShopItemDef, VenueMeta } from './types.ts';

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 500;
export const HEADSTRING_X = 250;
export const FOOT_SPOT_X = 735;
export const FOOT_SPOT_Y = 250;

export const BALL_RADIUS = 13.5;
export const BALL_MASS = 1.0;
export const TURN_DURATION_MS = 30_000;

export const PHYSICS_PARAMS = {
  fixedDt: 1 / 60,
  substeps: 16,
  maxShotSpeed: 1760, // px/sec at 100% power for explosive, crisp breaks
  minShotSpeed: 75,
  restitutionBall: 0.96,
  restitutionCushion: 0.79,
  rollingDecel: 148, // px/s^2
  linearDamping: 0.9912, // applied per 60Hz frame
  stopThreshold: 5.0, // px/sec
  spinDecay: 0.986,
  followSpinFactor: 0.50,
  englishCushionFactor: 0.30,
  cornerJawRadius: 8,
} as const;

export const POCKETS: PocketDef[] = [
  { id: 0, x: 7, y: 7, radius: 26, isCorner: true },
  { id: 1, x: TABLE_WIDTH / 2, y: -5, radius: 24, isCorner: false },
  { id: 2, x: TABLE_WIDTH - 7, y: 7, radius: 26, isCorner: true },
  { id: 3, x: 7, y: TABLE_HEIGHT - 7, radius: 26, isCorner: true },
  { id: 4, x: TABLE_WIDTH / 2, y: TABLE_HEIGHT + 5, radius: 24, isCorner: false },
  { id: 5, x: TABLE_WIDTH - 7, y: TABLE_HEIGHT - 7, radius: 26, isCorner: true },
];

export const CORNER_POCKET_GAP = 35;
export const SIDE_POCKET_GAP = 29;

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  foulOnBreakScratchHeadstring: true,
  loseOnEarlyEightBall: true,
  loseOnEightBallScratch: true,
};

export const BALL_COLORS: Record<number, { base: string; label: string }> = {
  0: { base: '#f8fafc', label: 'Cue' },
  1: { base: '#eab308', label: 'Yellow Solid' },
  2: { base: '#2563eb', label: 'Blue Solid' },
  3: { base: '#dc2626', label: 'Red Solid' },
  4: { base: '#7c3aed', label: 'Purple Solid' },
  5: { base: '#ea580c', label: 'Orange Solid' },
  6: { base: '#15803d', label: 'Green Solid' },
  7: { base: '#7f1d1d', label: 'Burgundy Solid' },
  8: { base: '#111827', label: '8 Ball' },
  9: { base: '#eab308', label: 'Yellow Stripe' },
  10: { base: '#2563eb', label: 'Blue Stripe' },
  11: { base: '#dc2626', label: 'Red Stripe' },
  12: { base: '#7c3aed', label: 'Purple Stripe' },
  13: { base: '#ea580c', label: 'Orange Stripe' },
  14: { base: '#15803d', label: 'Green Stripe' },
  15: { base: '#7f1d1d', label: 'Burgundy Stripe' },
};

export const AVATAR_ASSETS: Record<string, string> = {
  avatar_ace: '/src/assets/images/avatar_ace_1795666735369.jpg',
  avatar_royale: '/src/assets/images/avatar_royale_1795666736035.jpg',
  avatar_shark: '/src/assets/images/avatar_shark_1795666735119.jpg',
  avatar_master: '/src/assets/images/avatar_master_1795666735925.jpg',
};

export const SHOP_CATALOG: ShopItemDef[] = [
  // Cues (with gameplay specs!)
  {
    id: 'cue_basic',
    category: 'cue',
    name: 'Basic Cue',
    description: 'Balanced club maple shaft for reliable everyday break and control.',
    price: 0,
    primaryColor: '#d6b48a',
    secondaryColor: '#3f2314',
    accentColor: '#cbd5e1',
    cueStats: { force: 58, aim: 54, spin: 50, control: 56, tier: 'Standard' },
  },
  {
    id: 'cue_wooden',
    category: 'cue',
    name: 'Wooden Cue',
    description: 'Hand oiled American ash grain with dark walnut wrap and crisp feedback.',
    price: 250,
    primaryColor: '#e0b882',
    secondaryColor: '#5c2d16',
    accentColor: '#d97706',
    cueStats: { force: 68, aim: 64, spin: 62, control: 65, tier: 'Club' },
  },
  {
    id: 'cue_premium',
    category: 'cue',
    name: 'Premium Cue',
    description: 'Crimson inlaid rosewood butt with brushed brass ferrule and high grip wrap.',
    price: 600,
    primaryColor: '#f3d5a5',
    secondaryColor: '#991b1b',
    accentColor: '#facc15',
    cueStats: { force: 76, aim: 74, spin: 72, control: 76, tier: 'Tour' },
  },
  {
    id: 'cue_emerald_elite',
    category: 'cue',
    name: 'Emerald Elite',
    description: 'Deep malachite inlaid ebony wrap with low deflection laminated pro tip.',
    price: 950,
    primaryColor: '#ecfdf5',
    secondaryColor: '#064e3b',
    accentColor: '#34d399',
    cueStats: { force: 82, aim: 81, spin: 83, control: 80, tier: 'Pro' },
  },
  {
    id: 'cue_gold',
    category: 'cue',
    name: 'Gold Cue',
    description: '24k gilded championship trim with ivory tone seasoned hard maple shaft.',
    price: 1200,
    primaryColor: '#fef3c7',
    secondaryColor: '#78350f',
    accentColor: '#fbbf24',
    cueStats: { force: 84, aim: 82, spin: 80, control: 82, tier: 'Pro' },
  },
  {
    id: 'cue_royal_gold',
    category: 'cue',
    name: 'Royal Gold',
    description: 'Sculpted crown brass rings over figured burl mahogany and tour leather wrap.',
    price: 1550,
    primaryColor: '#fde68a',
    secondaryColor: '#451a03',
    accentColor: '#f59e0b',
    cueStats: { force: 88, aim: 86, spin: 87, control: 88, tier: 'Master' },
  },
  {
    id: 'cue_carbon',
    category: 'cue',
    name: 'Carbon Cue',
    description: 'Low deflection matte carbon fiber composite shaft built for sharp cuts.',
    price: 1800,
    primaryColor: '#475569',
    secondaryColor: '#0f172a',
    accentColor: '#38bdf8',
    cueStats: { force: 90, aim: 91, spin: 88, control: 92, tier: 'Master' },
  },
  {
    id: 'cue_carbon_precision',
    category: 'cue',
    name: 'Carbon Precision',
    description: 'Woven aerospace carbon shaft with micro-taper sighting ferrule.',
    price: 2250,
    primaryColor: '#64748b',
    secondaryColor: '#020617',
    accentColor: '#22d3ee',
    cueStats: { force: 92, aim: 95, spin: 91, control: 95, tier: 'Master' },
  },
  {
    id: 'cue_titanium_pro',
    category: 'cue',
    name: 'Titanium Pro',
    description: 'Brushed grade-5 titanium joint collar with balanced kinetic break core.',
    price: 2650,
    primaryColor: '#e2e8f0',
    secondaryColor: '#1e293b',
    accentColor: '#94a3b8',
    cueStats: { force: 96, aim: 93, spin: 92, control: 94, tier: 'Grandmaster' },
  },
  {
    id: 'cue_legendary',
    category: 'cue',
    name: 'Legendary Cue',
    description: 'Master crafted royal sapphire and 24k gold heritage cue with tour precision.',
    price: 3000,
    primaryColor: '#1e3a8a',
    secondaryColor: '#09090b',
    accentColor: '#f59e0b',
    cueStats: { force: 97, aim: 96, spin: 96, control: 98, tier: 'Grandmaster' },
  },
  {
    id: 'cue_sapphire_luxe',
    category: 'cue',
    name: 'Sapphire Luxe',
    description: 'Faceted deep sapphire inlays paired with platinum rings and master control.',
    price: 3600,
    primaryColor: '#38bdf8',
    secondaryColor: '#0f172a',
    accentColor: '#f8fafc',
    cueStats: { force: 98, aim: 98, spin: 97, control: 99, tier: 'Grandmaster' },
  },
  // Tables (3 free starter tables + signature luxury & championship tables)
  {
    id: 'table_tournament_blue',
    category: 'table',
    name: 'Championship Blue',
    description: 'Pro tour Simonis royal blue worsted cloth with rich mahogany rails and gold trim.',
    price: 0,
    primaryColor: '#1d4ed8',
    secondaryColor: '#3b1f12',
    accentColor: '#facc15',
    tableMeta: { railTone: '#522c19', feltGlow: '#2563eb', trimTone: '#fef3c7', texture: 'felt' },
  },
  {
    id: 'table_sky_azure',
    category: 'table',
    name: 'Sky Azure Tour',
    description: 'Crisp electric azure tournament cloth paired with midnight slate rails.',
    price: 0,
    primaryColor: '#0284c7',
    secondaryColor: '#1e293b',
    accentColor: '#facc15',
    tableMeta: { railTone: '#334155', feltGlow: '#38bdf8', trimTone: '#f8fafc', texture: 'felt' },
  },
  {
    id: 'table_ruby_arena',
    category: 'table',
    name: 'Ruby Crimson Tour',
    description: 'Vibrant championship scarlet cloth framed by walnut rails and brass plates.',
    price: 0,
    primaryColor: '#b91c1c',
    secondaryColor: '#3b1f12',
    accentColor: '#fde047',
    tableMeta: { railTone: '#542620', feltGlow: '#ef4444', trimTone: '#fef08a', texture: 'felt' },
  },
  {
    id: 'table_royal_emerald',
    category: 'table',
    name: 'Royal Emerald',
    description: 'Heritage emerald tournament worsted wool framed by warm mahogany and brushed brass.',
    price: 550,
    primaryColor: '#047857',
    secondaryColor: '#3b1f12',
    accentColor: '#facc15',
    tableMeta: { railTone: '#5a2d18', feltGlow: '#10b981', trimTone: '#fde68a', texture: 'emerald' },
  },
  {
    id: 'table_crimson_velvet',
    category: 'table',
    name: 'Crimson Parlour',
    description: 'Vintage private lounge burgundy felt with antique brass corner plates.',
    price: 800,
    primaryColor: '#7f1d1d',
    secondaryColor: '#2c160d',
    accentColor: '#fbbf24',
    tableMeta: { railTone: '#452214', feltGlow: '#991b1b', trimTone: '#fef3c7', texture: 'felt' },
  },
  {
    id: 'table_classic_walnut',
    category: 'table',
    name: 'Classic Walnut',
    description: 'Rich figured walnut hardwood rails with warm spruce-green heritage cloth.',
    price: 1100,
    primaryColor: '#14532d',
    secondaryColor: '#451a03',
    accentColor: '#eab308',
    tableMeta: { railTone: '#6b3416', feltGlow: '#22c55e', trimTone: '#fef3c7', texture: 'walnut' },
  },
  {
    id: 'table_obsidian_gold',
    category: 'table',
    name: 'Obsidian Gold',
    description: 'Obsidian slate tournament cloth framed by smoked ebony and 24k gold trim.',
    price: 1400,
    primaryColor: '#18181b',
    secondaryColor: '#09090b',
    accentColor: '#f59e0b',
    tableMeta: { railTone: '#27272a', feltGlow: '#fbbf24', trimTone: '#fde047', texture: 'obsidian' },
  },
  {
    id: 'table_imperial_violet',
    category: 'table',
    name: 'Imperial Sapphire',
    description: 'High stakes royal indigo velvet cloth with dark walnut and champagne trim.',
    price: 1800,
    primaryColor: '#312e81',
    secondaryColor: '#1a1118',
    accentColor: '#eab308',
    tableMeta: { railTone: '#2e1d2a', feltGlow: '#4338ca', trimTone: '#fef08a', texture: 'felt' },
  },
  {
    id: 'table_pearl_marble',
    category: 'table',
    name: 'Pearl Marble',
    description: 'Sculpted alabaster marble rails paired with ice-silver tournament cloth.',
    price: 2200,
    primaryColor: '#cbd5e1',
    secondaryColor: '#f1f5f9',
    accentColor: '#d97706',
    tableMeta: { railTone: '#e2e8f0', feltGlow: '#94a3b8', trimTone: '#f59e0b', texture: 'marble' },
  },
  {
    id: 'table_crystal_lounge',
    category: 'table',
    name: 'Crystal Lounge',
    description: 'Translucent glacier sapphire cloth with faceted crystal rails and chrome trim.',
    price: 2800,
    primaryColor: '#0e7490',
    secondaryColor: '#082f49',
    accentColor: '#67e8f9',
    tableMeta: { railTone: '#164e63', feltGlow: '#22d3ee', trimTone: '#ecfeff', texture: 'crystal' },
  },
  // Venues / Atmosphere (room surrounding the table)
  {
    id: 'venue_billiard_cafe',
    category: 'venue',
    name: 'Premium Billiard Café',
    description: 'Warm tungsten pendant lights over dark slate floors and quiet club booths.',
    price: 0,
    primaryColor: '#1e293b',
    secondaryColor: '#0b0e16',
    accentColor: '#f59e0b',
    venueMeta: {
      id: 'venue_billiard_cafe',
      backdropClass: 'venue-billiard-cafe',
      ambientGlow: 'rgba(245, 158, 11, 0.14)',
      accentColor: '#f59e0b',
      atmosphereLabel: 'Tungsten Lounge',
    },
  },
  {
    id: 'venue_tropical_beach',
    category: 'venue',
    name: 'Tropical Beach Lounge',
    description: 'Open-air oceanfront terrace with twilight turquoise breeze and warm lanterns.',
    price: 900,
    primaryColor: '#0e7490',
    secondaryColor: '#082f49',
    accentColor: '#2dd4bf',
    venueMeta: {
      id: 'venue_tropical_beach',
      backdropClass: 'venue-tropical-beach',
      ambientGlow: 'rgba(45, 212, 191, 0.16)',
      accentColor: '#2dd4bf',
      atmosphereLabel: 'Coastal Twilight',
    },
  },
  {
    id: 'venue_rooftop_sunset',
    category: 'venue',
    name: 'Rooftop Sunset',
    description: 'Penthouse skyline deck bathed in amber dusk and warm architectural brass.',
    price: 1350,
    primaryColor: '#9a3412',
    secondaryColor: '#1f1218',
    accentColor: '#fb923c',
    venueMeta: {
      id: 'venue_rooftop_sunset',
      backdropClass: 'venue-rooftop-sunset',
      ambientGlow: 'rgba(251, 146, 60, 0.17)',
      accentColor: '#fb923c',
      atmosphereLabel: 'Skyline Dusk',
    },
  },
  {
    id: 'venue_classic_club',
    category: 'venue',
    name: 'Classic Club',
    description: 'Heritage mahogany billiard hall with leather armchairs and brass sconce light.',
    price: 1650,
    primaryColor: '#78350f',
    secondaryColor: '#160d08',
    accentColor: '#eab308',
    venueMeta: {
      id: 'venue_classic_club',
      backdropClass: 'venue-classic-club',
      ambientGlow: 'rgba(234, 179, 8, 0.14)',
      accentColor: '#eab308',
      atmosphereLabel: 'Mahogany Hall',
    },
  },
  {
    id: 'venue_emerald_palace',
    category: 'venue',
    name: 'Emerald Palace',
    description: 'Grand championship chamber with gilded columns and cool emerald ambiance.',
    price: 2400,
    primaryColor: '#065f46',
    secondaryColor: '#041410',
    accentColor: '#34d399',
    venueMeta: {
      id: 'venue_emerald_palace',
      backdropClass: 'venue-emerald-palace',
      ambientGlow: 'rgba(52, 211, 153, 0.15)',
      accentColor: '#34d399',
      atmosphereLabel: 'Royal Chamber',
    },
  },
  // Avatars
  {
    id: 'avatar_ace',
    category: 'avatar',
    name: 'Ace Striker',
    description: 'Cool under pressure with precision sunglasses.',
    price: 0,
    primaryColor: '#1e3a8a',
    secondaryColor: '#0f172a',
    accentColor: '#facc15',
    imageUrl: AVATAR_ASSETS.avatar_ace,
  },
  {
    id: 'avatar_royale',
    category: 'avatar',
    name: 'Lady Royale',
    description: 'Royal blue jacket championship tactician.',
    price: 0,
    primaryColor: '#1d4ed8',
    secondaryColor: '#111827',
    accentColor: '#fbbf24',
    imageUrl: AVATAR_ASSETS.avatar_royale,
  },
  {
    id: 'avatar_shark',
    category: 'avatar',
    name: 'Club Shark',
    description: 'Classic waistcoat and fedora lounge veteran.',
    price: 450,
    primaryColor: '#991b1b',
    secondaryColor: '#1e293b',
    accentColor: '#facc15',
    imageUrl: AVATAR_ASSETS.avatar_shark,
  },
  {
    id: 'avatar_master',
    category: 'avatar',
    name: 'Grandmaster',
    description: 'Black tie world tournament finalist.',
    price: 1100,
    primaryColor: '#0f172a',
    secondaryColor: '#09090b',
    accentColor: '#f59e0b',
    imageUrl: AVATAR_ASSETS.avatar_master,
  },
  // Frames
  {
    id: 'frame_bronze',
    category: 'frame',
    name: 'Classic Brass',
    description: 'Standard club brass portrait border.',
    price: 0,
    primaryColor: '#a16207',
    secondaryColor: '#422006',
    accentColor: '#eab308',
  },
  {
    id: 'frame_silver_crest',
    category: 'frame',
    name: 'Silver Crest',
    description: 'Brushed platinum silver ring with crisp blue inner trim.',
    price: 0,
    primaryColor: '#cbd5e1',
    secondaryColor: '#1e3a8a',
    accentColor: '#93c5fd',
  },
  {
    id: 'frame_royal_gold',
    category: 'frame',
    name: 'Royal Sovereign',
    description: 'Double beveled royal blue and gold leaf crest.',
    price: 550,
    primaryColor: '#2563eb',
    secondaryColor: '#1e3a8a',
    accentColor: '#facc15',
  },
  {
    id: 'frame_platinum_prism',
    category: 'frame',
    name: 'Platinum Prism',
    description: 'Faceted azure steel frame with luminous ice accents.',
    price: 900,
    primaryColor: '#0284c7',
    secondaryColor: '#0f172a',
    accentColor: '#38bdf8',
  },
  {
    id: 'frame_diamond_halo',
    category: 'frame',
    name: 'Diamond Halo',
    description: 'Brilliant sapphire and crystal white tournament ring.',
    price: 1350,
    primaryColor: '#1d4ed8',
    secondaryColor: '#0f172a',
    accentColor: '#e0f2fe',
  },
  {
    id: 'frame_obsidian',
    category: 'frame',
    name: 'Crimson Crown',
    description: 'Diamond cut crimson and gold trim for elite cueists.',
    price: 1500,
    primaryColor: '#dc2626',
    secondaryColor: '#450a0a',
    accentColor: '#f59e0b',
  },
  {
    id: 'frame_master_sovereign',
    category: 'frame',
    name: 'Master Sovereign',
    description: 'Imperial scarlet and 24k championship gold halo.',
    price: 2200,
    primaryColor: '#b91c1c',
    secondaryColor: '#78350f',
    accentColor: '#fde047',
  },
  // Ball Effects
  {
    id: 'effect_classic',
    category: 'effect',
    name: 'Classic Chalk',
    description: 'Clean white chalk burst on cue strike.',
    price: 0,
    primaryColor: '#e2e8f0',
    secondaryColor: '#94a3b8',
    accentColor: '#f8fafc',
  },
  {
    id: 'effect_gold_spark',
    category: 'effect',
    name: 'Gilded Impact',
    description: 'Warm gold sparks on heavy ball collisions and pockets.',
    price: 700,
    primaryColor: '#fbbf24',
    secondaryColor: '#d97706',
    accentColor: '#fef08a',
  },
  {
    id: 'effect_sky_trail',
    category: 'effect',
    name: 'Azure & Gold Vapor',
    description: 'Crisp sapphire and gold trail behind high power break shots.',
    price: 1100,
    primaryColor: '#38bdf8',
    secondaryColor: '#2563eb',
    accentColor: '#fde047',
  },
];

export const QUICK_CHAT_MESSAGES = [
  'Good Luck!',
  'Nice Shot!',
  'Well Played!',
  'Good Game!',
  'Sorry!',
  'Thanks!',
] as const;

export const BILLIARD_EMOTES = [
  '🎱',
  '🔥',
  '👏',
  '😎',
  '🤝',
  '🏆',
] as const;

export const DAILY_REWARD_SCHEDULE = [5000, 5000, 5000, 5000, 5000, 5000, 5000] as const;

export const MAX_CUSTOM_ENTRY_FEE = 100000;
export const PRESET_ENTRY_FEES = [0, 500, 1000, 2500, 5000, 10000] as const;

export function sanitizeEntryFee(raw: unknown, maxAllowed: number = MAX_CUSTOM_ENTRY_FEE): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(maxAllowed, Math.floor(num));
}

export const DEFAULT_FREE_OWNED_ITEMS: string[] = SHOP_CATALOG
  .filter((i) => i.price === 0)
  .map((i) => i.id);

export function getCueStats(cueId?: string): CueStats {
  const cue = SHOP_CATALOG.find((i) => i.category === 'cue' && i.id === cueId);
  return cue?.cueStats ?? { force: 58, aim: 54, spin: 50, control: 56, tier: 'Standard' };
}

export function getVenueMeta(venueId?: string): VenueMeta {
  const venue = SHOP_CATALOG.find((i) => i.category === 'venue' && i.id === venueId);
  return (
    venue?.venueMeta ?? {
      id: 'venue_billiard_cafe',
      backdropClass: 'venue-billiard-cafe',
      ambientGlow: 'rgba(245, 158, 11, 0.14)',
      accentColor: '#f59e0b',
      atmosphereLabel: 'Tungsten Lounge',
    }
  );
}

