import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const base = (process.argv[2] || process.env.BACKLINE_URL || '').replace(/\/+$/, '')
if (!base) throw new Error('Pass your HTTPS instance URL as the first argument, or set BACKLINE_URL.')
const target = new URL(base)
if (target.protocol !== 'https:' || target.username || target.password) {
  throw new Error('Use an HTTPS instance URL without embedded credentials.')
}
const password = process.env.OWNER_PASSWORD || parseEnv(readFileSync('.env', 'utf8')).OWNER_PASSWORD
const request = (path, options = {}) => fetch(`${base}${path}`, {
  redirect: 'manual', signal: AbortSignal.timeout(30_000), ...options,
})

const page = await request('/')
assert.equal(page.status, 200)
assert.match(await page.text(), /Backline/)
assert.ok(page.headers.get('strict-transport-security'))
assert.ok(page.headers.get('content-security-policy'))
assert.equal((await request('/api/health')).status, 200)
const library = await (await request('/api/library')).json()
console.log('Public site and library:', {
  songs: library.groups.length,
  audios: library.songs.length,
  loops: library.songs.reduce((count, song) => count + song.loopCount, 0),
})

const unauthorized = await request('/api/groups', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Must never be created' }),
})
assert.equal(unauthorized.status, 401)
const login = await request('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
})
assert.equal(login.status, 200)
const setCookie = login.headers.getSetCookie().find(cookie => cookie.startsWith('backline_owner='))
assert.ok(setCookie)
assert.match(setCookie, /;\s*Secure/i)
assert.match(setCookie, /;\s*HttpOnly/i)
assert.match(setCookie, /;\s*SameSite=Strict/i)
const cookie = setCookie.split(';')[0]
const session = await (await request('/api/auth/session', { headers: { Cookie: cookie } })).json()
assert.equal(session.authenticated, true)
assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })).status, 204)
assert.equal((await (await request('/api/auth/session', { headers: { Cookie: cookie } })).json()).authenticated, false)

for (const recording of library.songs) {
  const audio = await request(`/media/${recording.id}`, { headers: { Range: 'bytes=0-43' } })
  assert.equal(audio.status, 206)
  assert.equal((await audio.arrayBuffer()).byteLength, 44)
}
assert.equal((await request('/.env')).status, 403)
console.log('Verified HTTPS, public byte-range audio, owner login/logout, secure cookies, and read-only visitor permissions.')
