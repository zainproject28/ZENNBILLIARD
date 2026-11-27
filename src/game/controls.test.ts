import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEY_BINDINGS,
  formatKeyLabel,
  matchesBinding,
  shouldIgnoreHotkey,
  updateKeyBinding,
} from './controls.ts';

test('updateKeyBinding swaps conflicting keys so every action remains unique', () => {
  const next = updateKeyBinding(DEFAULT_KEY_BINDINGS, 'shoot', 'ArrowUp');
  assert.equal(next.shoot, 'ArrowUp');
  assert.equal(next.powerUp, 'Space');
});

test('shouldIgnoreHotkey blocks hotkeys in inputs, modifiers, modals, and key rebinding', () => {
  assert.equal(shouldIgnoreHotkey({ tagName: 'INPUT' }), true);
  assert.equal(shouldIgnoreHotkey({ tagName: 'TEXTAREA' }), true);
  assert.equal(shouldIgnoreHotkey({ tagName: 'SELECT' }), true);
  assert.equal(shouldIgnoreHotkey({ isContentEditable: true }), true);
  assert.equal(shouldIgnoreHotkey({ isRebinding: true }), true);
  assert.equal(shouldIgnoreHotkey({ hasOpenModal: true }), true);
  assert.equal(shouldIgnoreHotkey({ ctrlKey: true }), true);
  assert.equal(shouldIgnoreHotkey({ metaKey: true }), true);
  assert.equal(shouldIgnoreHotkey({ tagName: 'DIV' }), false);
});

test('matchesBinding handles default arrows, Spacebar, and A/D fallback cleanly', () => {
  assert.equal(matchesBinding({ code: 'ArrowLeft' }, DEFAULT_KEY_BINDINGS.aimLeft), true);
  assert.equal(matchesBinding({ code: 'KeyA', key: 'a' }, DEFAULT_KEY_BINDINGS.aimLeft), true);
  assert.equal(matchesBinding({ code: 'KeyD', key: 'd' }, DEFAULT_KEY_BINDINGS.aimRight), true);
  assert.equal(matchesBinding({ code: 'Space', key: ' ' }, DEFAULT_KEY_BINDINGS.shoot), true);
  assert.doesNotMatch(formatKeyLabel('ArrowLeft'), /[-–—]/);
});
