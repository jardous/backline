import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTime, time } from '../src/lib.js'

test('loop timestamps format and parse minutes, seconds, and subsecond ranges', () => {
  assert.equal(time(65.5, true), '1:05.5')
  assert.equal(time(4.8, true), '0:04.8')
  assert.equal(time(59.99, true), '1:00.0')
  assert.equal(time(3605), '60:05')
  assert.equal(time(-2), '0:00')
  assert.equal(parseTime('1:05.5'), 65.5)
  assert.equal(parseTime('65.5'), 65.5)
  assert.equal(parseTime('0:02.45'), 2.45)
  assert.equal(parseTime('1:99'), null)
  assert.equal(parseTime('-1'), null)
  assert.equal(parseTime('a song'), null)
})
