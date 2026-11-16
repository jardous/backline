import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/database.js'
import type { Group, Library, Loop, Song } from '../shared/types.js'

const password = 'a-unique-owner-test-password'
let directory: string
let server: Server
let store: ReturnType<typeof openDatabase>
let origin: string
let cookie = ''
let group: Group
let song: Song
let loop: Loop

const request = (path: string, options: RequestInit = {}, authenticated = true) => fetch(`${origin}${path}`, {
  ...options,
  headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(authenticated && cookie ? { Cookie: cookie } : {}), ...options.headers },
})
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const audioForm = async (patch: Record<string, string> = {}) => {
  const form = new FormData()
  form.append('audio', new Blob([await readFile('public/demo.wav')], { type: 'audio/wav' }), 'Practice.wav')
  form.append('duration', '19.2')
  for (const [key, value] of Object.entries(patch)) form.set(key, value)
  return form
}

before(async () => {
  directory = await mkdtemp('/tmp/opencode/backline-api-')
  const created = createApp(directory, undefined, password)
  store = created.store
  server = created.app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  store?.db.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('visitors can browse but every shared-library mutation requires owner authentication', async () => {
  assert.equal((await request('/api/health', {}, false)).status, 200)
  const session = await request('/api/auth/session', {}, false)
  assert.deepEqual(await session.json(), { authenticated: false, configured: true })
  assert.equal(session.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await (await request('/api/library', {}, false)).json(), { songs: [], groups: [] })
  for (const [method, path] of [
    ['POST', '/api/groups'], ['PATCH', '/api/groups/missing'], ['DELETE', '/api/groups/missing'],
    ['POST', '/api/songs'], ['PATCH', '/api/songs/missing'], ['DELETE', '/api/songs/missing'],
    ['POST', '/api/songs/missing/loops'], ['PATCH', '/api/songs/missing/loops/missing'],
    ['DELETE', '/api/songs/missing/loops/missing'],
  ]) {
    assert.equal((await request(path, json(method, {}), false)).status, 401, `${method} ${path}`)
  }
})

test('owner login validates passwords, creates an HttpOnly SameSite cookie, and blocks cross-site writes', async () => {
  assert.equal((await request('/api/auth/login', json('POST', { password: 'incorrect' }), false)).status, 401)
  assert.equal((await request('/api/auth/login', json('POST', { password: 123 }), false)).status, 401)
  const response = await request('/api/auth/login', json('POST', { password }), false)
  assert.equal(response.status, 200)
  const setCookie = response.headers.get('set-cookie')!
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)
  cookie = setCookie.split(';')[0]
  assert.deepEqual(await (await request('/api/auth/session')).json(), { authenticated: true, configured: true })
  assert.equal((await request('/api/groups', { ...json('POST', { name: 'CSRF' }), headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
})

test('owner creates song containers and edits their shared notes independently', async () => {
  assert.equal((await request('/api/groups', json('POST', { name: '' }))).status, 400)
  const response = await request('/api/groups', json('POST', { name: 'Friday rehearsal', color: '#789978' }))
  assert.equal(response.status, 201)
  group = await response.json() as Group
  assert.equal(group.name, 'Friday rehearsal')
  assert.equal(group.color, '#789978')
  const renamed = await request(`/api/groups/${group.id}`, json('PATCH', { name: 'Live set' }))
  group = await renamed.json() as Group
  assert.equal(group.name, 'Live set')
  const notes = await request(`/api/groups/${group.id}`, json('PATCH', { notes: 'Song structure: intro, verse, chorus.' }))
  group = await notes.json() as Group
  assert.equal(group.name, 'Live set')
  assert.equal(group.notes, 'Song structure: intro, verse, chorus.')
  assert.equal((await request(`/api/groups/${group.id}`, json('PATCH', { notes: 'x'.repeat(20_001) }))).status, 400)
  assert.equal((await request(`/api/groups/${group.id}`, json('PATCH', { notes: 'Unauthorized' }), false)).status, 401)
})

test('audio uploads persist on disk, metadata is editable, and playback supports byte ranges without login', async () => {
  const response = await request('/api/songs', { method: 'POST', body: await audioForm({ groupId: group.id, notes: 'Watch the chorus cue.' }) })
  assert.equal(response.status, 201)
  song = await response.json() as Song
  assert.equal(song.title, 'Practice')
  assert.equal(song.groupId, group.id)
  assert.equal(song.notes, 'Watch the chorus cue.')
  assert.equal(song.loopCount, 0)
  assert.ok(song.size > 0)
  assert.equal('filename' in song, false)
  assert.equal((await readdir(join(directory, 'uploads'))).length, 1)
  const audio = await request(`/media/${song.id}`, { headers: { Range: 'bytes=0-43' } }, false)
  assert.equal(audio.status, 206)
  assert.match(audio.headers.get('content-type')!, /audio\/wav/)
  assert.equal((await audio.arrayBuffer()).byteLength, 44)
  const update = await request(`/api/songs/${song.id}`, json('PATCH', { title: 'The first song', bpm: 100, notes: 'New band notes' }))
  const updated = await update.json() as Song
  assert.equal(updated.title, 'The first song')
  assert.equal(updated.bpm, 100)
  assert.equal(updated.notes, 'New band notes')
  assert.equal((await request(`/api/songs/${song.id}`, json('PATCH', { bpm: 401 }))).status, 400)
  assert.equal((await request(`/api/songs/${song.id}`, json('PATCH', { notes: 'a'.repeat(20_001) }))).status, 400)
})

test('invalid uploads are rejected and do not leave orphaned files', async () => {
  const before = await readdir(join(directory, 'uploads'))
  const patches: Record<string, string>[] = [{ duration: '-1' }, { groupId: 'missing' }, { title: 'x'.repeat(201) }, {}]
  for (const patch of patches) {
    const response = await request('/api/songs', { method: 'POST', body: await audioForm(patch) })
    assert.equal(response.status, 400)
  }
  const wrongType = new FormData()
  wrongType.append('audio', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'bad.html')
  assert.equal((await request('/api/songs', { method: 'POST', body: wrongType })).status, 400)
  assert.deepEqual(await readdir(join(directory, 'uploads')), before)
})

test('shared loops validate boundaries, save, update, and are readable by bandmates', async () => {
  for (const range of [{ start: -1, end: 2 }, { start: 2, end: 1 }, { start: 0, end: 25 }, { start: 0, end: .01 }, { start: '1', end: 5 }]) {
    assert.equal((await request(`/api/songs/${song.id}/loops`, json('POST', { name: 'Invalid', ...range }))).status, 400)
  }
  const response = await request(`/api/songs/${song.id}/loops`, json('POST', { name: 'Chorus', start: 2.4, end: 7.2 }))
  assert.equal(response.status, 201)
  loop = await response.json() as Loop
  const update = await request(`/api/songs/${song.id}/loops/${loop.id}`, json('PATCH', { name: 'Chorus transition', start: 3 }))
  loop = await update.json() as Loop
  assert.equal(loop.start, 3)
  assert.equal(loop.name, 'Chorus transition')
  const publicLoops = await (await request(`/api/songs/${song.id}/loops`, {}, false)).json() as Loop[]
  assert.deepEqual(publicLoops, [loop])
  const library = await (await request('/api/library', {}, false)).json() as Library
  assert.equal(library.songs[0].loopCount, 1)
})

test('library, groups, and loops survive opening a second database connection', () => {
  const reopened = openDatabase(directory)
  try {
    assert.equal(reopened.songs()[0].id, song.id)
    assert.equal(reopened.groups()[0].id, group.id)
    assert.equal(reopened.loops(song.id)[0].id, loop.id)
  } finally { reopened.db.close() }
})

test('multiple versions attach to one song; moving or deleting a version preserves the song and other versions', async () => {
  const extra = await (await request('/api/songs', { method: 'POST', body: await audioForm({ groupId: group.id, title: 'Another take' }) })).json() as Song
  assert.equal(store.songs().filter(item => item.groupId === group.id).length, 2)
  const other = await (await request('/api/groups', json('POST', { name: 'Another song' }))).json() as Group
  const moved = await (await request(`/api/songs/${song.id}`, json('PATCH', { groupId: other.id }))).json() as Song
  assert.equal(moved.groupId, other.id)
  assert.equal(moved.notes, 'New band notes')
  assert.equal(store.loops(song.id)[0].id, loop.id)
  assert.equal(store.groups().find(item => item.id === group.id)?.notes, group.notes)
  assert.equal((await request(`/api/songs/${song.id}`, json('PATCH', { groupId: null }))).status, 400)
  await request(`/api/songs/${song.id}`, json('PATCH', { groupId: group.id }))
  await request(`/api/groups/${other.id}`, json('DELETE'))
  assert.equal((await request(`/api/songs/${extra.id}`, json('DELETE'))).status, 204)
  assert.equal(store.song(song.id)?.loopCount, 1)
  assert.ok(store.groups().some(item => item.id === group.id))
  assert.equal((await readdir(join(directory, 'uploads'))).length, 1)
})

test('explicitly deleting a song container deletes all attached recordings and loops, not orphaning versions', async () => {
  const extra = await (await request('/api/songs', { method: 'POST', body: await audioForm({ groupId: group.id, title: 'Backing track' }) })).json() as Song
  assert.equal((await request(`/api/groups/${group.id}`, json('DELETE'))).status, 409, 'Old clients must not accidentally delete recordings')
  assert.ok(store.song(song.id))
  assert.ok(store.song(extra.id))
  assert.equal((await request(`/api/groups/${group.id}`, json('DELETE', { deleteRecordings: true }))).status, 204)
  assert.equal((await request(`/api/songs/${song.id}`)).status, 404)
  assert.equal((await request(`/api/songs/${extra.id}`)).status, 404)
  assert.equal((await request(`/media/${song.id}`, {}, false)).status, 404)
  assert.deepEqual(store.loops(song.id), [])
  assert.deepEqual(await readdir(join(directory, 'uploads')), [])
})

test('logout revokes the session, forged cookies are rejected, and repeated bad logins are throttled', async () => {
  assert.equal((await request('/api/auth/logout', json('POST'))).status, 204)
  assert.equal((await request('/api/groups', json('POST', { name: 'Nope' }))).status, 401)
  assert.equal((await request('/api/groups', { ...json('POST', { name: 'Nope' }), headers: { Cookie: 'backline_owner=forged' } })).status, 401)
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', json('POST', { password: 'wrong' }), false)).status, 401)
  const limited = await request('/api/auth/login', json('POST', { password }), false)
  assert.equal(limited.status, 429)
  assert.ok(limited.headers.get('retry-after'))
})

test('missing owner configuration is read-only and weak owner passwords fail startup', async () => {
  const separateDirectory = await mkdtemp('/tmp/opencode/backline-auth-')
  const created = createApp(separateDirectory, undefined, '')
  const standalone = created.app.listen(0, '127.0.0.1')
  try {
    await new Promise<void>(resolve => standalone.once('listening', resolve))
    const base = `http://127.0.0.1:${(standalone.address() as { port: number }).port}`
    assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(), { authenticated: false, configured: false })
    assert.equal((await fetch(`${base}/api/auth/login`, { ...json('POST', { password }), headers: { 'Content-Type': 'application/json' } })).status, 503)
    assert.throws(() => createApp(separateDirectory, undefined, 'short'), /at least 12/)
  } finally {
    await new Promise<void>(resolve => standalone.close(() => resolve()))
    created.store.db.close()
    await rm(separateDirectory, { recursive: true, force: true })
  }
})
