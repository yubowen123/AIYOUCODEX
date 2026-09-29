import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessMarker } from '../scripts/repair-thread-history-index.mjs';

const threadId = '019fe61d-6a11-7cf1-926b-435b108624b6';
const state = { thread_id: threadId, next_rollout_byte_offset: 1024, next_rollout_ordinal: 11 };
const marker = { ordinal: 10, type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: threadId } };
const next = { ordinal: 11, type: 'event_msg', payload: { type: 'task_started', turn_id: 'next-turn' } };
test('accepts only a single exact-thread settings replay followed by the next turn', () => {
  assert.equal(assessMarker(state, marker, next, threadId).correctedOrdinal, 10);
  for (const e of [ { ...marker, ordinal: 9 }, { ...marker, type: 'response_item' },
    { ...marker, payload: { ...marker.payload, type: 'item_completed' } },
    { ...marker, payload: { ...marker.payload, thread_id: 'other' } } ]) {
    assert.throws(() => assessMarker(state, e, next, threadId));
  }
  assert.throws(() => assessMarker(state, marker, { ...next, ordinal: 12 }, threadId));
  assert.throws(() => assessMarker(state, marker, { ...next, payload: { type: 'task_complete' } }, threadId));
});
