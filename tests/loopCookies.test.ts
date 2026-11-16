import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampLoopPreference, decodeLoopCookie, MAX_LOOP_COOKIE_LENGTH, MAX_REMEMBERED_AUDIOS, updateLoopCookie } from '../src/loopCookies.js'

test('loop cookie remembers independent ranges and enabled states per audio', () => {
  let value = updateLoopCookie('', 'audio-1', { start: 1.25, end: 8.5, repeat: true })
  value = updateLoopCookie(value, 'audio-2', { start: 3, end: 12, repeat: false })
  assert.deepEqual(decodeLoopCookie(value), [
    { audioId: 'audio-2', start: 3, end: 12, repeat: false },
    { audioId: 'audio-1', start: 1.25, end: 8.5, repeat: true },
  ])
  value = updateLoopCookie(value, 'audio-1', { start: 4, end: 9, repeat: false })
  assert.equal(decodeLoopCookie(value).length, 2)
  assert.deepEqual(decodeLoopCookie(value)[0], { audioId: 'audio-1', start: 4, end: 9, repeat: false })
})

test('cookie numbers are compact and retain millisecond loop precision', () => {
  const value = updateLoopCookie('', 'audio-1', { start: 1.23456789, end: 8.7654321, repeat: true })
  assert.deepEqual(decodeLoopCookie(value)[0], { audioId: 'audio-1', start: 1.235, end: 8.765, repeat: true })
})

test('malformed cookies, unsupported formats, invalid IDs, and invalid ranges are ignored safely', () => {
  for (const value of ['%invalid', 'not-json', '%7B', encodeURIComponent('null'), encodeURIComponent('{"v":2,"items":[]}')]) {
    assert.deepEqual(decodeLoopCookie(value), [])
  }
  const invalid = encodeURIComponent(JSON.stringify({ v: 1, items: [
    ['audio-1', -1, 10, true], ['audio-2', 10, 2, true], ['audio-3', 0, 0.01, true],
    ['audio-4', 0, 200000, true], ['audio-5', '1', 4, true], ['audio-6', 1, 4, 'true'],
    ['bad/id', 1, 4, true], ['valid-audio', 1, 4, false],
  ] }))
  assert.deepEqual(decodeLoopCookie(invalid), [{ audioId: 'valid-audio', start: 1, end: 4, repeat: false }])
  assert.equal(updateLoopCookie('', 'audio-1', { start: NaN, end: 10, repeat: true }), '')
  assert.equal(updateLoopCookie('', '../audio', { start: 0, end: 10, repeat: true }), '')
})

test('cookie stays below browser/header size limits and evicts oldest audios', () => {
  let value = ''
  for (let i = 0; i < 100; i++) {
    value = updateLoopCookie(value, `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, { start: 123456.789, end: 172799.999, repeat: true })
    assert.ok(value.length <= MAX_LOOP_COOKIE_LENGTH)
  }
  const stored = decodeLoopCookie(value)
  assert.ok(stored.length <= MAX_REMEMBERED_AUDIOS)
  assert.ok(stored.length > 10)
  assert.ok(stored[0].audioId.endsWith('000000000099'))
  assert.equal(stored.some(item => item.audioId.endsWith('000000000000')), false)
})

test('restored ranges are clamped to the actual audio duration or ignored if no longer valid', () => {
  assert.deepEqual(clampLoopPreference({ start: 2, end: 20, repeat: true }, 15), { start: 2, end: 15, repeat: true })
  assert.equal(clampLoopPreference({ start: 20, end: 30, repeat: true }, 15), null)
  assert.equal(clampLoopPreference({ start: 0, end: 1, repeat: true }, .05), null)
  assert.equal(clampLoopPreference(null, 15), null)
})
