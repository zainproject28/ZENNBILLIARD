import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpinReelItems, stripUndefinedDeep } from './matchmakingSpin.ts';

test('buildSpinReelItems places target at final index with requested length', () => {
  const target = {
    uid: 'target_1',
    username: 'Champion_99',
    avatar: 'avatar_master',
    frame: 'frame_royal_gold',
    level: 50,
  };
  const items = buildSpinReelItems(target, undefined, 16);
  assert.equal(items.length, 16);
  assert.equal(items[items.length - 1].uid, target.uid);
  assert.equal(items[items.length - 1].username, target.username);
  assert.notEqual(items[items.length - 2].uid, target.uid);
});

test('stripUndefinedDeep removes nested undefined properties without mutating valid fields', () => {
  const input = {
    seq: 4,
    status: 'completed',
    winnerId: 'uid_a',
    nested: {
      type: 'turn_resolved',
      turnDeadlineAt: undefined,
      actorSlot: 'A',
      arr: [1, { a: 2, b: undefined }],
    },
    extra: undefined,
  };
  const cleaned = stripUndefinedDeep(input) as Record<string, unknown>;
  assert.equal('extra' in cleaned, false);
  assert.equal(cleaned.status, 'completed');
  const nested = cleaned.nested as Record<string, unknown>;
  assert.equal('turnDeadlineAt' in nested, false);
  assert.equal(nested.actorSlot, 'A');
  const arr = nested.arr as Array<unknown>;
  assert.deepEqual(arr[1], { a: 2 });
});
