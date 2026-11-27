export interface KeyBindingsConfig {
  aimLeft: string;
  aimRight: string;
  powerUp: string;
  powerDown: string;
  shoot: string;
}

export type KeyBindingAction = keyof KeyBindingsConfig;

export const DEFAULT_KEY_BINDINGS: KeyBindingsConfig = {
  aimLeft: 'ArrowLeft',
  aimRight: 'ArrowRight',
  powerUp: 'ArrowUp',
  powerDown: 'ArrowDown',
  shoot: 'Space',
};

export function normalizeKeyBindings(raw?: Partial<KeyBindingsConfig> | null): KeyBindingsConfig {
  const candidate: KeyBindingsConfig = {
    aimLeft: typeof raw?.aimLeft === 'string' && raw.aimLeft.trim() ? raw.aimLeft.trim() : DEFAULT_KEY_BINDINGS.aimLeft,
    aimRight: typeof raw?.aimRight === 'string' && raw.aimRight.trim() ? raw.aimRight.trim() : DEFAULT_KEY_BINDINGS.aimRight,
    powerUp: typeof raw?.powerUp === 'string' && raw.powerUp.trim() ? raw.powerUp.trim() : DEFAULT_KEY_BINDINGS.powerUp,
    powerDown: typeof raw?.powerDown === 'string' && raw.powerDown.trim() ? raw.powerDown.trim() : DEFAULT_KEY_BINDINGS.powerDown,
    shoot: typeof raw?.shoot === 'string' && raw.shoot.trim() ? raw.shoot.trim() : DEFAULT_KEY_BINDINGS.shoot,
  };
  return candidate;
}

export function updateKeyBinding(
  current: KeyBindingsConfig,
  action: KeyBindingAction,
  nextCode: string,
): KeyBindingsConfig {
  const normalized = normalizeKeyBindings(current);
  const previousCode = normalized[action];
  const updated: KeyBindingsConfig = { ...normalized, [action]: nextCode };
  // Swap cleanly if another action already used nextCode
  (Object.keys(normalized) as KeyBindingAction[]).forEach((k) => {
    if (k !== action && normalized[k] === nextCode) {
      updated[k] = previousCode;
    }
  });
  return updated;
}

export function formatKeyLabel(code: string): string {
  switch (code) {
    case 'ArrowLeft':
      return 'Left Arrow';
    case 'ArrowRight':
      return 'Right Arrow';
    case 'ArrowUp':
      return 'Up Arrow';
    case 'ArrowDown':
      return 'Down Arrow';
    case 'Space':
      return 'Spacebar';
    case 'Enter':
      return 'Enter';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift';
    default:
      if (code.startsWith('Key')) return code.slice(3).toUpperCase();
      if (code.startsWith('Digit')) return code.slice(5);
      return code;
  }
}

export function shouldIgnoreHotkey(opts: {
  tagName?: string | null;
  isContentEditable?: boolean;
  isRebinding?: boolean;
  hasOpenModal?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (opts.isRebinding || opts.hasOpenModal) return true;
  if (opts.ctrlKey || opts.metaKey || opts.altKey) return true;
  if (opts.isContentEditable) return true;
  const tag = String(opts.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function matchesBinding(
  e: { code?: string; key?: string },
  boundCode: string,
  allowWasdFallback = true,
): boolean {
  const code = e.code || '';
  const key = e.key || '';
  if (code === boundCode || key === boundCode) return true;
  if (boundCode === 'Space' && (key === ' ' || code === 'Space')) return true;
  if (allowWasdFallback) {
    if (boundCode === 'ArrowLeft' && (code === 'KeyA' || key.toLowerCase() === 'a')) return true;
    if (boundCode === 'ArrowRight' && (code === 'KeyD' || key.toLowerCase() === 'd')) return true;
  }
  return false;
}
