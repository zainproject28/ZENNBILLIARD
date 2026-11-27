import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoomJoinError, extractRoomCode, isValidRoomCode } from './roomCode.ts';

test('extractRoomCode handles manual partial and full typing', () => {
  assert.equal(extractRoomCode('k7m'), 'K7M');
  assert.equal(extractRoomCode('k7m-9p2'), 'K7M9P2');
  assert.equal(extractRoomCode('  ab34cd  '), 'AB34CD');
  assert.equal(isValidRoomCode('K7M9P2'), true);
  assert.equal(isValidRoomCode('K7M9P'), false);
});

test('extractRoomCode extracts code from full share URLs', () => {
  assert.equal(
    extractRoomCode('https://ais-pre-2j7yod6eiwmlzm37yhuxdr-173763439507.asia-southeast1.run.app/?room=P7UHFA'),
    'P7UHFA',
  );
  assert.equal(
    extractRoomCode('https://example.com/?foo=1&room=k7m9p2#top'),
    'K7M9P2',
  );
});

test('extractRoomCode extracts code from copied multi-line invitation text', () => {
  const inviteText =
    'Join my ZENN BILLIARD match! Room Code: QZABCD\nhttps://example.com/?room=QZABCD';
  assert.equal(extractRoomCode(inviteText), 'QZABCD');

  const proseOnly = 'Join my ZENN BILLIARD match! Room Code: ABCDEF';
  assert.equal(extractRoomCode(proseOnly), 'ABCDEF');
});

test('classifyRoomJoinError differentiates not found, full, expired, unauthenticated, offline, and server errors', () => {
  assert.equal(classifyRoomJoinError({ code: 'ROOM_NOT_FOUND', status: 404 }), 'ROOM_NOT_FOUND');
  assert.equal(classifyRoomJoinError({ code: 'ROOM_FULL', status: 409 }), 'ROOM_FULL');
  assert.equal(classifyRoomJoinError({ code: 'ROOM_EXPIRED', status: 410 }), 'ROOM_EXPIRED');
  assert.equal(classifyRoomJoinError({ isSignedIn: false }), 'NOT_SIGNED_IN');
  assert.equal(classifyRoomJoinError({ isBackendAvailable: false }), 'CONNECTION_FAILED');
  assert.equal(classifyRoomJoinError({ status: 503 }), 'SERVER_ERROR');
});
