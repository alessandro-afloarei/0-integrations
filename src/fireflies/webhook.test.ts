import { expect, test } from 'vitest';
import { parseWebhook } from './fireflies.js';
import recorded from './fixtures/webhooks.json' with { type: 'json' };

test('parses documented meeting_id events and drops unrelated fields', () => {
  expect(recorded.events.map(event => parseWebhook(event))).toEqual([
    { event: 'meeting.transcribed', timestamp: 1793520000000, meeting_id: 'fixture-call-1' },
    { event: 'meeting.summarized', timestamp: 1793520001000, meeting_id: 'fixture-call-1' },
    { event: 'meeting.bot_joined', timestamp: 1793518000000, meeting_id: 'fixture-call-2' },
    { event: 'meeting.summarized', timestamp: 1793520002000, meeting_id: 'fixture-call-1' },
  ]);
});

test.each([null, [], 'text', {}, { event: 'meeting.transcribed', meeting_id: 'x' },
  { event: '', meeting_id: 'x', timestamp: 123 }, { event: 'x', meeting_id: '', timestamp: 123 },
  { event: 'x', meeting_id: 123, timestamp: 123 }, { event: 'x', meeting_id: 'x', timestamp: true },
  { event: 'x', meetingId: 'x', timestamp: 123 }])('refuses missing fields without coercion: %j', body => {
  expect(parseWebhook(body)).toBeNull();
});

test('keeps the existing string timestamp and unknown event contract', () => {
  expect(parseWebhook({ event: 'new.event', meeting_id: 'x', timestamp: '2026-11-01T00:00:00Z' }))
    .toEqual({ event: 'new.event', meeting_id: 'x', timestamp: '2026-11-01T00:00:00Z' });
});
